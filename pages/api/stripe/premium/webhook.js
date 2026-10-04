import { linkSubscriptionConsent } from "../../../../lib/subscriptionConsent";
import Stripe from "stripe";
import { buffer } from "micro";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../../../../lib/firebaseAdmin";
import { PREMIUM_FLOW_METADATA } from "../../../../lib/premiumAccess";
import { emitPremiumSubscriptionOblioInvoice } from "../../../../lib/premiumSubscriptionOblio";
import { resolvePremiumAbonamentWebhookSecret } from "../../../../lib/stripePremiumEnv";
import { getFixedVatTaxRateId } from "../../../../lib/stripeFixedVatServer";
import {
  syncPremiumSubscription,
  syncPremiumSubscriptionById,
} from "../../../../lib/stripePremiumSubscriptionSync";
import {
  BILLING_ERROR_CODES,
  getBillingRequestId,
  getSafeBillingConfigSnapshot,
  logBillingObs,
  setBillingRequestId,
} from "../../../../lib/billingObservability";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const WEBHOOK_EVENTS_COLLECTION = "stripePremiumWebhookEvents";
const PREMIUM_CHECKOUT_SESSION_COLLECTION = "premiumCheckoutSessions";

export const config = {
  api: {
    bodyParser: false,
  },
};

async function persistPremiumBillingFromCheckoutSession(db, session) {
  if (session.mode !== "subscription") return;
  if (session.metadata?.flow !== PREMIUM_FLOW_METADATA) return;
  const uid = session.client_reference_id || session.metadata?.uid;
  if (!uid || typeof uid !== "string") return;

  const snap = await db.collection(PREMIUM_CHECKOUT_SESSION_COLLECTION).doc(session.id).get();
  if (!snap.exists) {
    console.warn("[premium.webhook] checkout_session_snapshot_missing", { sessionId: session.id, uid });
    return;
  }
  const row = snap.data() || {};

  await db.collection("Users").doc(uid).set(
    {
      premiumBillingProfile: {
        billing: row.billing || null,
        rawFormValues: row.rawFormValues ?? null,
        normalizedBeforeCheckout: row.normalizedBeforeCheckout ?? null,
        stripeMetadataSnapshot: row.stripeMetadataSnapshot || session.metadata || {},
        invoiceDecision: row.invoiceDecision ?? null,
        updatedFromCheckoutSessionId: session.id,
        updatedAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await db
    .collection(PREMIUM_CHECKOUT_SESSION_COLLECTION)
    .doc(session.id)
    .set(
      {
        paymentStatus: session.payment_status || "unknown",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

function resolvePremiumWebhookSecret() {
  return resolvePremiumAbonamentWebhookSecret();
}

export default async function handler(req, res) {
  const requestId = setBillingRequestId(res, getBillingRequestId(req, "spwh"));
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    logBillingObs({
      level: "warn",
      scope: "stripe_premium_webhook",
      stage: "rejected",
      requestId,
      result: { httpStatus: 405 },
      error: { code: BILLING_ERROR_CODES.METHOD_NOT_ALLOWED },
    });
    return res.status(405).end("Method Not Allowed");
  }

  const webhookSecret = resolvePremiumWebhookSecret();
  if (!webhookSecret) {
    console.error(
      "[premium.webhook] missing signing secret: set STRIPE_WEBHOOK_SECRET_ABONAMENT_TEST (dev), or STRIPE_WEBHOOK_SECRET_ABONAMENT / STRIPE_WEBHOOK_SECRET",
    );
    logBillingObs({
      level: "error",
      scope: "stripe_premium_webhook",
      stage: "config_missing",
      requestId,
      result: { httpStatus: 500 },
      config: getSafeBillingConfigSnapshot(),
      error: { code: BILLING_ERROR_CODES.FLOW_DISABLED, reason: "missing_stripe_webhook_secret" },
    });
    return res.status(500).json({ error: "Webhook not configured" });
  }

  let event;
  try {
    const buf = await buffer(req);
    const sig = req.headers["stripe-signature"];
    if (!sig) {
      logBillingObs({
        level: "warn",
        scope: "stripe_premium_webhook",
        stage: "signature_missing",
        requestId,
        result: { httpStatus: 400 },
        error: { code: BILLING_ERROR_CODES.AUTH_MISSING },
      });
      return res.status(400).send("Webhook Error: Missing stripe-signature header");
    }
    event = stripe.webhooks.constructEvent(buf, sig, webhookSecret);
  } catch (err) {
    console.error("[premium.webhook] signature_failed", err.message);
    logBillingObs({
      level: "warn",
      scope: "stripe_premium_webhook",
      stage: "signature_failed",
      requestId,
      result: { httpStatus: 400 },
      error: { code: BILLING_ERROR_CODES.AUTH_MISSING, message: err?.message || "unknown_error" },
    });
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const db = getAdminDb();
  const eventRef = db.collection(WEBHOOK_EVENTS_COLLECTION).doc(event.id);
  const existing = await eventRef.get();
  if (existing.exists) {
    return res.status(200).json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.expired": {
        const session = event.data.object;
        if (session.metadata?.flow === PREMIUM_FLOW_METADATA) await linkSubscriptionConsent(db, session.metadata?.subscriptionConsentId, { stripeCheckoutSessionId: session.id, paymentStatus: "expired" }, event);
        break;
      }
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.mode !== "subscription") break;
        if (session.metadata?.flow !== PREMIUM_FLOW_METADATA) break;
        const uid = session.client_reference_id || session.metadata?.uid;
        if (!uid) {
          console.warn("[premium.webhook] checkout missing uid");
          break;
        }
        const subId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;
        if (!subId) {
          console.warn("[premium.webhook] checkout missing subscription id");
          break;
        }
        await syncPremiumSubscriptionById(stripe, subId, {
          eventTimestampMs: event.created * 1000,
        });
        await persistPremiumBillingFromCheckoutSession(db, session);
        await linkSubscriptionConsent(db, session.metadata?.subscriptionConsentId, { stripeCheckoutSessionId: session.id, stripeSubscriptionId: subId, paymentStatus: session.payment_status || "pending" }, event);
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        await linkSubscriptionConsent(db, sub.metadata?.subscriptionConsentId, { stripeSubscriptionId: sub.id, subscriptionStatus: sub.status }, event);
        try {
          await syncPremiumSubscriptionById(stripe, sub.id, {
            eventTimestampMs: event.created * 1000,
          });
        } catch (retrieveError) {
          console.warn("[premium.webhook] current subscription retrieval failed", {
            subscriptionId: sub.id,
            message: retrieveError?.message,
          });
          await syncPremiumSubscription(sub, {
            eventTimestampMs: event.created * 1000,
          });
        }
        break;
      }
      case "invoice.payment_succeeded":
      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const invoiceSubscription = invoice.subscription || invoice.parent?.subscription_details?.subscription;
        const subId = typeof invoiceSubscription === "string" ? invoiceSubscription : invoiceSubscription?.id;
        if (!subId) break;
        await syncPremiumSubscriptionById(stripe, subId, {
          eventTimestampMs: event.created * 1000,
        });
        const consentId = invoice.subscription_details?.metadata?.subscriptionConsentId || invoice.parent?.subscription_details?.metadata?.subscriptionConsentId;
        await linkSubscriptionConsent(db, consentId, { stripeSubscriptionId: subId, stripeInvoiceId: invoice.id, paymentStatus: event.type === "invoice.payment_succeeded" ? "paid" : "failed" }, event);
        if (event.type === "invoice.payment_succeeded") {
          const oblioResult = await emitPremiumSubscriptionOblioInvoice({
            db,
            stripe,
            invoice,
            premiumFlowMetadata: PREMIUM_FLOW_METADATA,
          });
          if (!oblioResult.skipped && oblioResult.status === "created") {
            console.info("[premium.webhook] oblio_ok", { invoiceId: oblioResult.invoiceId });
          } else if (!oblioResult.skipped && oblioResult.status === "error") {
            console.warn("[premium.webhook] oblio_error", oblioResult);
          } else if (oblioResult.skipped) {
            console.warn("[premium.webhook] oblio_skipped", {
              invoiceId: oblioResult.invoiceId || invoice.id,
              reason: oblioResult.reason || "unknown",
              detail: oblioResult.detail || undefined,
            });
          }
        }
        break;
      }
      case "payment_intent.succeeded": {
        const pi = event.data.object;

        // New canonical flow: PI is attached to a subscription invoice → sync the sub.
        const invoiceId =
          typeof pi.invoice === "string" ? pi.invoice : pi.invoice?.id;
        if (invoiceId) {
          try {
            const invoice = await stripe.invoices.retrieve(invoiceId);
            const subId =
              typeof invoice.subscription === "string"
                ? invoice.subscription
                : invoice.subscription?.id;
            if (subId) {
              console.log("[premium.webhook] PI linked to sub invoice — syncing sub", {
                piId: pi.id,
                invoiceId,
                subId,
              });
              await syncPremiumSubscriptionById(stripe, subId, {
                eventTimestampMs: event.created * 1000,
              });
            }
          } catch (err) {
            console.error("[premium.webhook] PI → invoice → sub sync failed", {
              piId: pi.id,
              invoiceId,
              message: err?.message,
            });
          }
          break;
        }

        // Legacy/standalone mobile PI fallback (pre-default_incomplete flow):
        // recover by creating the subscription with trial_end so the user gets access
        // even if the client never called /confirm.
        if (pi.metadata?.platform === "expo" && pi.metadata?.priceId && pi.metadata?.uid) {
          const uid = pi.metadata.uid;
          const priceId = pi.metadata.priceId;
          const paymentMethodId = pi.payment_method;
          const customerId = typeof pi.customer === "string" ? pi.customer : pi.customer?.id;

          const sessionRef = db.collection("premiumMobilePaymentSheets").doc(pi.id);
          const sessionSnap = await sessionRef.get();
          const sessionData = sessionSnap.exists ? sessionSnap.data() : null;

          if (sessionData?.stripeSubscriptionId) {
            try {
              await syncPremiumSubscriptionById(stripe, sessionData.stripeSubscriptionId);
            } catch (_) {}
            break;
          }

          if (!customerId || !paymentMethodId) break;

          try {
            await stripe.customers.update(customerId, {
              invoice_settings: {
                default_payment_method:
                  typeof paymentMethodId === "string" ? paymentMethodId : paymentMethodId.id,
              },
            });
            const price = await stripe.prices.retrieve(priceId);
            const interval = price.recurring?.interval || "month";
            const intervalCount = price.recurring?.interval_count || 1;
            const now = Math.floor(Date.now() / 1000);
            let trialEndTimestamp = now;
            if (interval === "month") trialEndTimestamp = now + 30 * 86400 * intervalCount;
            else if (interval === "year") trialEndTimestamp = now + 365 * 86400 * intervalCount;
            else if (interval === "week") trialEndTimestamp = now + 7 * 86400 * intervalCount;
            else if (interval === "day") trialEndTimestamp = now + 86400 * intervalCount;

            const fixedVatTaxRateId = await getFixedVatTaxRateId(stripe);
            const subscription = await stripe.subscriptions.create({
              customer: customerId,
              items: [{ price: priceId, quantity: 1 }],
              automatic_tax: { enabled: false },
              default_tax_rates: [fixedVatTaxRateId],
              metadata: {
                uid,
                flow: pi.metadata.flow || PREMIUM_FLOW_METADATA,
                platform: "expo",
                firstPaymentIntentId: pi.id,
                createdByWebhook: "true",
              },
              default_payment_method:
                typeof paymentMethodId === "string" ? paymentMethodId : paymentMethodId.id,
              trial_end: trialEndTimestamp,
            });

            await sessionRef.set(
              {
                stripeSubscriptionId: subscription.id,
                status: subscription.status,
                createdByWebhook: true,
                confirmedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
            await syncPremiumSubscriptionById(stripe, subscription.id);

            console.log("[premium.webhook] LEGACY recovery: created subscription", {
              subscriptionId: subscription.id,
            });
          } catch (subErr) {
            console.error("[premium.webhook] Legacy recovery failed", {
              piId: pi.id,
              message: subErr?.message,
            });
          }
        }
        break;
      }
      default:
        break;
    }

    await eventRef.set(
      {
        type: event.type,
        processedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    console.error("[premium.webhook] handler_error", {
      type: event.type,
      message: err?.message,
    });
    return res.status(500).json({ error: "Webhook handler failed" });
  }

  return res.status(200).json({ received: true });
}
