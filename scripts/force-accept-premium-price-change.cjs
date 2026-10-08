#!/usr/bin/env node
/* eslint-disable no-console */

/** Legacy read-only audit. Bulk reactivation is disabled; owners reactivate in Settings. */

const path = require("path");
const dotenv = require("dotenv");
const Stripe = require("stripe");
const admin = require("firebase-admin");

dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });

const LIVE = process.argv.includes("--live");
const APPLY = process.argv.includes("--apply");

const PAYING_STATUSES = new Set(["active", "trialing", "past_due"]);
const CANCEL_REASON = "unaccepted_v1_6_05";
const OLD_TOTAL_CENTS = 500;
const EXPECTED_VAT_PERCENTAGE = 21;

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function initFirestore() {
  const projectId = clean(process.env.FIREBASE_PROJECT_ID);
  const clientEmail = clean(process.env.FIREBASE_CLIENT_EMAIL);
  const privateKey = clean(process.env.FIREBASE_PRIVATE_KEY).replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Missing Firebase Admin credentials");
  }
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    });
  }
  return admin.firestore();
}

function maskId(value) {
  const v = clean(value);
  return v ? `${v.slice(0, 14)}…` : "";
}

function isoDay(sec) {
  return typeof sec === "number" ? new Date(sec * 1000).toISOString().slice(0, 10) : "";
}

/**
 * The subscription must already sit on the exclusive price with a single 21%
 * exclusive tax rate, otherwise clearing the cancellation would renew it at the
 * wrong amount.
 */
function billingBlockers(subscription, exclusivePriceId) {
  const reasons = [];
  const items = subscription?.items?.data || [];
  if (items.length !== 1) reasons.push("subscription_items_not_single");
  const price = items[0]?.price;
  if (clean(price?.id) !== clean(exclusivePriceId)) reasons.push("not_on_exclusive_price");
  if (price?.tax_behavior !== "exclusive") reasons.push("price_not_tax_exclusive");
  if (Number(price?.unit_amount) !== OLD_TOTAL_CENTS) reasons.push("price_not_500_cents");
  if (subscription?.automatic_tax?.enabled === true) reasons.push("automatic_tax_enabled");
  const rates = subscription?.default_tax_rates || [];
  if (rates.length !== 1) reasons.push(`default_tax_rates_${rates.length}`);
  else {
    const rate = rates[0];
    if (Number(rate.percentage) !== EXPECTED_VAT_PERCENTAGE) reasons.push("tax_rate_not_21");
    if (rate.inclusive === true) reasons.push("tax_rate_inclusive");
  }
  return reasons;
}

async function findUid(db, subscription) {
  const metaUid = clean(subscription?.metadata?.uid);
  if (metaUid) {
    const snap = await db.collection("Users").doc(metaUid).get();
    if (snap.exists) return { uid: metaUid, data: snap.data() || {} };
  }
  const bySub = await db
    .collection("Users")
    .where("stripeSubscriptionId", "==", subscription.id)
    .limit(2)
    .get();
  if (bySub.size === 1) return { uid: bySub.docs[0].id, data: bySub.docs[0].data() || {} };
  return { uid: null, data: null };
}

async function main() {
  if (APPLY) throw new Error("Bulk reactivation is disabled. The account owner must explicitly reactivate one subscription in Settings.");
  const secretKey = LIVE
    ? clean(process.env.STRIPE_SECRET_KEY_LIVE)
    : clean(process.env.STRIPE_SECRET_KEY);
  if (!secretKey) throw new Error("Missing Stripe secret key");


  const exclusivePriceId = clean(process.env.STRIPE_PREMIUM_PRICE_ID_EXCLUSIVE);
  if (!exclusivePriceId) throw new Error("Missing STRIPE_PREMIUM_PRICE_ID_EXCLUSIVE");

  console.log(
    `Mode: ${secretKey.startsWith("sk_live") ? "LIVE" : "TEST"} / ${APPLY ? "APPLY" : "DRY RUN"}`
  );
  console.log(`Exclusive price: ${exclusivePriceId}\n`);

  const stripe = new Stripe(secretKey);
  const db = initFirestore();

  const candidates = [];
  for await (const sub of stripe.subscriptions.list({ status: "all", limit: 100 })) {
    if (!PAYING_STATUSES.has(sub.status)) continue;
    if (sub.cancel_at_period_end !== true) continue;
    if (clean(sub.metadata?.priceChangeCancelReason) !== CANCEL_REASON) continue;
    candidates.push(sub);
  }
  console.log(`Subscriptions scheduled to cancel as ${CANCEL_REASON}: ${candidates.length}`);

  const summary = { eligible: 0, restored: 0, blocked: 0, failed: 0 };
  const blockedRows = [];

  for (const sub of candidates) {
    const reasons = billingBlockers(sub, exclusivePriceId);
    const { uid, data: userData } = await findUid(db, sub);
    if (!uid) reasons.push("user_not_found");

    if (reasons.length) {
      summary.blocked += 1;
      blockedRows.push({ subscriptionId: sub.id, uid, reasons });
      console.warn("[force-accept] blocked", { subscriptionId: maskId(sub.id), reasons });
      continue;
    }

    summary.eligible += 1;
    const renewalAt = isoDay(sub.current_period_end);

    console.log("[force-accept] audit_only", {
      subscriptionId: maskId(sub.id),
      uid: maskId(uid),
      renewalAt,
      platform: clean(sub.metadata?.platform) || "web",
      alreadyConsented: Boolean(userData?.premiumPriceChangeConsent?.acceptedAt),
    });
  }

  console.log("\nSummary:", summary);
  if (blockedRows.length) {
    console.log("Blocked:", JSON.stringify(blockedRows, null, 2));
  }
  if (summary.failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error("FORCE ACCEPT FAILED:", err?.message || err);
  process.exit(1);
});
