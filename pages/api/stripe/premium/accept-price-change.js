import Stripe from "stripe";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../../../../lib/firebaseAdmin";
import { requireAuth } from "../../../../lib/requireAuth";
import { assessStripeCustomerTaxAddress } from "../../../../lib/premiumTaxAddressGate";
import {
  PREMIUM_ACCEPT_PRICE_PATH,
  PREMIUM_PRICE_CHANGE_CONSENT_TEXT_RO,
  PREMIUM_PRICE_CHANGE_CONSENT_VERSION,
  PREMIUM_PRICE_CHANGE_NEW_TOTAL_CENTS,
  PREMIUM_PRICE_CHANGE_OLD_TOTAL_CENTS,
  PREMIUM_TAX_MIGRATION_METADATA,
  buildConsentRecord,
  findExclusiveSubscriptionItem,
  findLegacySubscriptionItem,
  hasValidPriceChangeConsent,
  migrateSubscriptionToExclusivePrice,
  parseLegacyPriceIdsFromEnv,
  resolveExclusivePriceIdFromEnv,
  subscriptionPrimaryPriceId,
  subscriptionTaxMigrationMeta,
} from "../../../../lib/premiumPriceChangeConsent";
import { getFixedVatTaxRateId } from "../../../../lib/stripeFixedVatServer";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function findUserDocument(db, uid) {
  const directRef = db.collection("Users").doc(uid);
  const direct = await directRef.get();
  if (direct.exists) return { ref: directRef, data: direct.data() || {} };

  const byOwner = await db.collection("Users").where("owner_uid", "==", uid).limit(2).get();
  if (byOwner.docs.length !== 1) return null;
  return { ref: byOwner.docs[0].ref, data: byOwner.docs[0].data() || {} };
}

function periodEndIso(subscription) {
  const end = Number(subscription?.current_period_end);
  if (!Number.isFinite(end) || end <= 0) return null;
  return new Date(end * 1000).toISOString();
}

function resolveSubscriptionId(userData) {
  const fromUser =
    typeof userData?.stripeSubscriptionId === "string"
      ? userData.stripeSubscriptionId.trim()
      : "";
  if (fromUser) return fromUser;
  const fromSource =
    typeof userData?.premiumSources?.stripe?.subscriptionId === "string"
      ? userData.premiumSources.stripe.subscriptionId.trim()
      : "";
  return fromSource || "";
}

async function loadSubscriptionContext(userData) {
  const subscriptionId = resolveSubscriptionId(userData);
  if (!subscriptionId) return { error: "missing_subscription", status: 400 };

  let subscription;
  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId);
  } catch (error) {
    return { error: "subscription_retrieve_failed", status: 404, detail: error?.message };
  }

  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id ||
        (typeof userData.stripeCustomerId === "string" ? userData.stripeCustomerId.trim() : "");

  let customer = null;
  if (customerId) {
    try {
      customer = await stripe.customers.retrieve(customerId);
      if (customer?.deleted) customer = null;
    } catch (_) {
      customer = null;
    }
  }

  return { subscription, customer, customerId, subscriptionId };
}

function buildStatusPayload({ userData, subscription, customer, exclusivePriceId, legacyPriceIds }) {
  const priceId = subscriptionPrimaryPriceId(subscription);
  const taxMigration = subscriptionTaxMigrationMeta(subscription);
  const onExclusive =
    priceId === exclusivePriceId || taxMigration === PREMIUM_TAX_MIGRATION_METADATA;
  const consentAccepted = hasValidPriceChangeConsent(userData);
  const address = assessStripeCustomerTaxAddress(customer);
  return {
    path: PREMIUM_ACCEPT_PRICE_PATH,
    consentVersion: PREMIUM_PRICE_CHANGE_CONSENT_VERSION,
    consentText: PREMIUM_PRICE_CHANGE_CONSENT_TEXT_RO,
    oldTotalCents: PREMIUM_PRICE_CHANGE_OLD_TOTAL_CENTS,
    newTotalCents: PREMIUM_PRICE_CHANGE_NEW_TOTAL_CENTS,
    renewalAt: periodEndIso(subscription),
    subscriptionId: subscription.id,
    priceId,
    onExclusivePrice: onExclusive,
    cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    consentAccepted,
    addressComplete: address.complete,
    addressReasons: address.reasons,
    exclusivePriceId,
    legacyPriceIds,
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  let authUser;
  try {
    authUser = await requireAuth(req);
  } catch (error) {
    return res.status(error?.statusCode || 401).json({ error: error?.message || "Unauthorized" });
  }

  const exclusivePriceId = resolveExclusivePriceIdFromEnv();
  const legacyPriceIds = parseLegacyPriceIdsFromEnv();
  if (!exclusivePriceId) {
    return res.status(500).json({ error: "Missing exclusive premium price configuration" });
  }

  try {
    const db = getAdminDb();
    const user = await findUserDocument(db, authUser.uid);
    if (!user) return res.status(404).json({ error: "User profile not found" });

    const loaded = await loadSubscriptionContext(user.data);
    if (loaded.error) {
      return res.status(loaded.status || 400).json({ error: loaded.error });
    }
    const { subscription, customer } = loaded;

    if (req.method === "GET") {
      return res.status(200).json(
        buildStatusPayload({
          userData: user.data,
          subscription,
          customer,
          exclusivePriceId,
          legacyPriceIds,
        })
      );
    }

    const acceptedFlag = req.body?.accepted === true || req.body?.accepted === "true";
    if (!acceptedFlag) {
      return res.status(400).json({ error: "Explicit acceptance is required" });
    }

    if (hasValidPriceChangeConsent(user.data)) {
      const finalSubscription = subscription;
      return res.status(200).json({
        ok: true,
        alreadyAccepted: true,
        ...buildStatusPayload({
          userData: user.data,
          subscription: finalSubscription,
          customer,
          exclusivePriceId,
          legacyPriceIds,
        }),
      });
    }

    const address = assessStripeCustomerTaxAddress(customer);
    if (!address.complete) {
      return res.status(409).json({
        error: "Billing address is still incomplete",
        complete: false,
        reasons: address.reasons,
        needsAddress: true,
      });
    }

    const priceId = subscriptionPrimaryPriceId(subscription);
    const onExclusive =
      priceId === exclusivePriceId ||
      subscriptionTaxMigrationMeta(subscription) === PREMIUM_TAX_MIGRATION_METADATA;

    let migrated = false;
    let finalSubscription = subscription;

    if (!onExclusive) {
      const legacyItem =
        findLegacySubscriptionItem(subscription, legacyPriceIds) ||
        subscription.items?.data?.[0] ||
        null;
      if (!legacyItem?.id) {
        return res.status(409).json({ error: "No migratable subscription item found" });
      }
      finalSubscription = await migrateSubscriptionToExclusivePrice(stripe, {
        subscription,
        item: legacyItem,
        destinationPriceId: exclusivePriceId,
        uid: authUser.uid,
      });
      migrated = true;
    } else {
      // Already exclusive: stamp consent metadata while preserving any scheduled cancellation.
      const exclusiveItem =
        findExclusiveSubscriptionItem(subscription, exclusivePriceId) ||
        subscription.items?.data?.[0];
      if (exclusiveItem?.id) {
        const fixedVatTaxRateId = await getFixedVatTaxRateId(stripe);
        finalSubscription = await stripe.subscriptions.update(
          subscription.id,
          {
            automatic_tax: { enabled: false },
            default_tax_rates: [fixedVatTaxRateId],
            metadata: {
              ...(subscription.metadata || {}),
              flow: "site_premium",
              uid: authUser.uid,
              taxMigration: PREMIUM_TAX_MIGRATION_METADATA,
              priceChangeConsentVersion: PREMIUM_PRICE_CHANGE_CONSENT_VERSION,
            },
          },
          { idempotencyKey: `premium-price-consent-stamp-v1-${subscription.id}` }
        );
      }
    }

    const country =
      cleanCountry(customer?.address?.country) ||
      cleanCountry(customer?.shipping?.address?.country) ||
      null;

    const consent = buildConsentRecord({
      subscriptionId: finalSubscription.id,
      oldPriceId: onExclusive ? null : priceId,
      newPriceId: exclusivePriceId,
      renewalAtIso: periodEndIso(finalSubscription),
      billingCountry: country,
      uid: authUser.uid,
      serverTimestamp: FieldValue.serverTimestamp(),
    });

    await user.ref.set(
      {
        premiumPriceChangeConsent: consent,
        premiumTaxAddressGate: {
          required: false,
          readyForMigration: false,
          migrationCompleted: migrated || onExclusive,
          priceChangeAcceptedAt: FieldValue.serverTimestamp(),
          version: 1,
        },
      },
      { merge: true }
    );

    console.info("[premium.price-change] accepted", {
      uid: authUser.uid,
      subscriptionId: finalSubscription.id,
      migrated,
    });

    const refreshedUser = { ...user.data, premiumPriceChangeConsent: { ...consent, status: "accepted", acceptedAt: true } };

    return res.status(200).json({
      ok: true,
      migrated,
      alreadyAccepted: false,
      ...buildStatusPayload({
        userData: refreshedUser,
        subscription: finalSubscription,
        customer,
        exclusivePriceId,
        legacyPriceIds,
      }),
      consentAccepted: true,
    });
  } catch (error) {
    console.error("[premium.price-change] failed", {
      uid: authUser.uid,
      message: String(error?.message || "unknown_error").slice(0, 300),
    });
    return res.status(500).json({ error: "Could not accept price change" });
  }
}

function cleanCountry(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}
