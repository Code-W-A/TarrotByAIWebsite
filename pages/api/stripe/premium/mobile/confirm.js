import Stripe from "stripe";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../../../../../lib/firebaseAdmin";
import { requireAuth } from "../../../../../lib/requireAuth";
import { PREMIUM_FLOW_METADATA, hasPremiumAccess } from "../../../../../lib/premiumAccess";
import { syncPremiumSubscription } from "../../../../../lib/stripePremiumSubscriptionSync";
import { resolvePremiumStripePriceId } from "../../../../../lib/stripePremiumEnv";
import { getFixedVatTaxRateId } from "../../../../../lib/stripeFixedVatServer";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2026-02-25.clover",
});
const PREMIUM_MOBILE_SESSION_COLLECTION = "premiumMobilePaymentSheets";

async function readUserPremiumActive(db, uid) {
  try {
    const userSnap = await db.collection("Users").doc(uid).get();
    const userData = userSnap.exists ? userSnap.data() || null : null;
    return hasPremiumAccess(userData);
  } catch {
    return false;
  }
}

async function respondWithSubscription({ res, db, uid, subscription, syncResult }) {
  const premiumActive = await readUserPremiumActive(db, uid);
  return res.status(200).json({
    subscriptionId: subscription.id,
    subscriptionStatus:
      (syncResult && syncResult.subscriptionStatus) || subscription.status || null,
    premiumActive,
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  let authUser;
  try {
    authUser = await requireAuth(req);
  } catch (err) {
    const code = err.statusCode || 401;
    return res.status(code).json({ error: err.message || "Unauthorized" });
  }

  const subscriptionId =
    typeof req.body?.subscriptionId === "string" ? req.body.subscriptionId.trim() : "";
  const paymentIntentId =
    typeof req.body?.paymentIntentId === "string" ? req.body.paymentIntentId.trim() : "";
  const setupIntentId =
    typeof req.body?.setupIntentId === "string" ? req.body.setupIntentId.trim() : "";

  const db = getAdminDb();

  /**
   * Canonical flow: client sends subscriptionId.
   * The Subscription was created (incomplete) by create-payment-sheet.js, so we
   * just verify ownership and sync it to Firestore. Stripe auto-activates it
   * once the invoice's PaymentIntent succeeds (via PaymentSheet).
   */
  if (subscriptionId) {
    try {
      console.log("[premium.mobile.confirm] Sync subscription", {
        subscriptionId,
        uid: authUser.uid,
      });

      const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ["latest_invoice"],
      });

      if (subscription.metadata?.flow !== PREMIUM_FLOW_METADATA) {
        console.warn("[premium.mobile.confirm] Wrong flow on subscription", {
          flow: subscription.metadata?.flow,
        });
        return res.status(404).json({ error: "Subscription not found" });
      }
      if (subscription.metadata?.uid !== authUser.uid) {
        console.warn("[premium.mobile.confirm] UID mismatch on subscription", {
          metadataUid: subscription.metadata?.uid,
          authUid: authUser.uid,
        });
        return res.status(403).json({ error: "Forbidden" });
      }

      const syncResult = await syncPremiumSubscription(subscription, { stripe });
      console.log("[premium.mobile.confirm] Subscription sync result", {
        subscriptionId: subscription.id,
        status: subscription.status,
        syncSkipped: syncResult.skipped,
        premiumActive: syncResult.premiumActive,
      });

      await db
        .collection(PREMIUM_MOBILE_SESSION_COLLECTION)
        .doc(subscription.id)
        .set(
          {
            stripeSubscriptionId: subscription.id,
            status: subscription.status,
            confirmedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

      return respondWithSubscription({
        res,
        db,
        uid: authUser.uid,
        subscription,
        syncResult,
      });
    } catch (err) {
      console.error("[premium.mobile.confirm] subscription_sync_failed", {
        subscriptionId,
        message: err?.message,
      });
      return res.status(500).json({ error: "Could not confirm subscription" });
    }
  }

  /**
   * Backwards-compat: client sends paymentIntentId.
   * Three cases:
   *  (A) PI.invoice exists → it's a subscription invoice; sync that subscription.
   *  (B) Session in Firestore has stripeSubscriptionId → sync it.
   *  (C) Truly standalone PI (legacy) → create a subscription with trial_end.
   */
  if (paymentIntentId) {
    try {
      console.log("[premium.mobile.confirm] Processing PaymentIntent", {
        paymentIntentId,
        uid: authUser.uid,
      });

      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

      if (paymentIntent.metadata?.uid !== authUser.uid) {
        console.warn("[premium.mobile.confirm] UID mismatch on PI");
        return res.status(403).json({ error: "Forbidden" });
      }

      const linkedInvoiceId =
        typeof paymentIntent.invoice === "string"
          ? paymentIntent.invoice
          : paymentIntent.invoice?.id;

      // (A) PaymentIntent is attached to an invoice → must be a subscription invoice
      if (linkedInvoiceId) {
        const invoice = await stripe.invoices.retrieve(linkedInvoiceId);
        const subId =
          typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription?.id;
        if (subId) {
          console.log("[premium.mobile.confirm] PI is linked to subscription invoice", {
            paymentIntentId,
            subId,
            invoiceStatus: invoice.status,
            piStatus: paymentIntent.status,
          });
          const subscription = await stripe.subscriptions.retrieve(subId);
          if (subscription.metadata?.uid !== authUser.uid) {
            return res.status(403).json({ error: "Forbidden" });
          }
          const syncResult = await syncPremiumSubscription(subscription, { stripe });
          return respondWithSubscription({
            res,
            db,
            uid: authUser.uid,
            subscription,
            syncResult,
          });
        }
      }

      // (B) Stored session points to a subscription
      const sessionSnap = await db
        .collection(PREMIUM_MOBILE_SESSION_COLLECTION)
        .doc(paymentIntentId)
        .get();
      const sessionData = sessionSnap.exists ? sessionSnap.data() : null;
      if (sessionData?.stripeSubscriptionId) {
        console.log("[premium.mobile.confirm] Session has subscription", {
          subscriptionId: sessionData.stripeSubscriptionId,
        });
        const subscription = await stripe.subscriptions.retrieve(
          sessionData.stripeSubscriptionId
        );
        const syncResult = await syncPremiumSubscription(subscription, { stripe });
        return respondWithSubscription({
          res,
          db,
          uid: authUser.uid,
          subscription,
          syncResult,
        });
      }

      // (C) True legacy: standalone PI, must create subscription with trial_end
      if (paymentIntent.status !== "succeeded") {
        return res.status(400).json({
          error: "Payment not complete",
          paymentIntentStatus: paymentIntent.status,
        });
      }
      const paymentMethodId = paymentIntent.payment_method;
      if (!paymentMethodId) {
        return res.status(400).json({ error: "No payment method on PaymentIntent" });
      }
      const customerId =
        typeof paymentIntent.customer === "string"
          ? paymentIntent.customer
          : paymentIntent.customer?.id;
      const priceId =
        sessionData?.pendingPriceId ||
        paymentIntent.metadata?.priceId ||
        resolvePremiumStripePriceId();
      if (!customerId || !priceId) {
        console.error("[premium.mobile.confirm] Legacy PI missing customer or priceId", {
          paymentIntentId,
          customerId,
          priceId,
        });
        return res.status(400).json({ error: "Cannot create subscription" });
      }

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

      const legacyMetadata = {
        ...(sessionData?.pendingMetadata || paymentIntent.metadata || {}),
        uid: authUser.uid,
        flow: PREMIUM_FLOW_METADATA,
        platform: "expo",
        firstPaymentIntentId: paymentIntentId,
        createdBy: "confirm_legacy_pi",
      };

      console.log("[premium.mobile.confirm] LEGACY: creating subscription with trial_end", {
        paymentIntentId,
        customerId,
        priceId,
      });

      const fixedVatTaxRateId = await getFixedVatTaxRateId(stripe);
      const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId, quantity: 1 }],
        automatic_tax: { enabled: false },
        default_tax_rates: [fixedVatTaxRateId],
        metadata: legacyMetadata,
        default_payment_method:
          typeof paymentMethodId === "string" ? paymentMethodId : paymentMethodId.id,
        trial_end: trialEndTimestamp,
      });

      const syncResult = await syncPremiumSubscription(subscription, { stripe });

      await db
        .collection(PREMIUM_MOBILE_SESSION_COLLECTION)
        .doc(paymentIntentId)
        .set(
          {
            stripeSubscriptionId: subscription.id,
            status: subscription.status,
            confirmedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            legacyRecovery: true,
          },
          { merge: true }
        );

      return respondWithSubscription({
        res,
        db,
        uid: authUser.uid,
        subscription,
        syncResult,
      });
    } catch (err) {
      console.error("[premium.mobile.confirm] PaymentIntent flow failed", {
        paymentIntentId,
        message: err?.message,
      });
      return res.status(500).json({ error: "Could not confirm subscription" });
    }
  }

  /** Very old flow: SetupIntent — keep as fallback only. */
  if (setupIntentId) {
    try {
      const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
      if (setupIntent.status !== "succeeded") {
        return res.status(400).json({
          error: "Payment setup not complete",
          setupIntentStatus: setupIntent.status,
        });
      }
      if (setupIntent.metadata?.uid !== authUser.uid) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const paymentMethodId = setupIntent.payment_method;
      if (!paymentMethodId) {
        return res.status(400).json({ error: "No payment method on SetupIntent" });
      }
      const sessionSnap = await db
        .collection(PREMIUM_MOBILE_SESSION_COLLECTION)
        .doc(setupIntentId)
        .get();
      const sessionData = sessionSnap.exists ? sessionSnap.data() : null;
      if (!sessionData) {
        return res.status(404).json({ error: "Session not found" });
      }

      const customerId = sessionData.stripeCustomerId;
      const priceId = sessionData.pendingPriceId || resolvePremiumStripePriceId();
      const metadata = sessionData.pendingMetadata || {
        uid: authUser.uid,
        flow: PREMIUM_FLOW_METADATA,
      };

      await stripe.customers.update(customerId, {
        invoice_settings: {
          default_payment_method:
            typeof paymentMethodId === "string" ? paymentMethodId : paymentMethodId.id,
        },
      });

      const fixedVatTaxRateId = await getFixedVatTaxRateId(stripe);
      const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId, quantity: 1 }],
        automatic_tax: { enabled: false },
        default_tax_rates: [fixedVatTaxRateId],
        metadata,
        default_payment_method:
          typeof paymentMethodId === "string" ? paymentMethodId : paymentMethodId.id,
      });

      const syncResult = await syncPremiumSubscription(subscription, { stripe });

      await db
        .collection(PREMIUM_MOBILE_SESSION_COLLECTION)
        .doc(setupIntentId)
        .set(
          {
            stripeSubscriptionId: subscription.id,
            status: subscription.status,
            confirmedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

      return respondWithSubscription({
        res,
        db,
        uid: authUser.uid,
        subscription,
        syncResult,
      });
    } catch (err) {
      console.error("[premium.mobile.confirm] SetupIntent flow failed", {
        setupIntentId,
        message: err?.message,
      });
      return res.status(500).json({ error: "Could not create subscription" });
    }
  }

  return res
    .status(400)
    .json({ error: "Missing subscriptionId, paymentIntentId, or setupIntentId" });
}
