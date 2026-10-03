import { acceptSubscriptionConsent, linkSubscriptionConsent, consentErrorResponse } from "../../../../../lib/subscriptionConsent";
import Stripe from "stripe";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../../../../../lib/firebaseAdmin";
import { omitFirebaseIdTokenFromPayload, requireAuth } from "../../../../../lib/requireAuth";
import { PREMIUM_FLOW_METADATA } from "../../../../../lib/premiumAccess";
import {
  normalizeBillingDetails,
  buildBillingContextInput,
} from "../../../../../lib/stripeBillingDetails";
import {
  buildInvoiceDecision,
  logBillingAudit,
  normalizeBillingContext,
} from "../../../../../utils/billingAudit.mjs";
import {
  isStripePremiumUsingLocalOverrides,
  resolvePremiumStripePriceId,
} from "../../../../../lib/stripePremiumEnv";
import { getStripePriceTaxBehavior } from "../../../../../utils/oblioTax";
import { getFixedVatTaxRateId } from "../../../../../lib/stripeFixedVatServer";
import { assertCanStartPremiumSubscription } from "../../../../../lib/premiumSubscriptionGuard";
import { resolvePremiumPublicBaseUrl } from "../../../../../lib/premiumServerUtils";
import { buildUserIdentityPatch } from "../../../../../lib/userIdentitySync";
import {
  BILLING_ERROR_CODES,
  getBillingRequestId,
  getSafeBillingConfigSnapshot,
  logBillingObs,
  setBillingRequestId,
} from "../../../../../lib/billingObservability";
import { isIosPremiumSubscriptionsEnabled } from "../../../../../lib/globalSettings";
import { resolvePremiumMobileCheckoutPolicy } from "../../../../../lib/premiumMobileCheckoutPolicy";

const STRIPE_API_VERSION = "2026-02-25.clover";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: STRIPE_API_VERSION,
});
const PREMIUM_MOBILE_SESSION_COLLECTION = "premiumMobilePaymentSheets";

function toStripeCountryCode(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return undefined;
  if (["romania", "românia", "ro"].includes(normalized.toLowerCase())) return "RO";
  return normalized.length === 2 ? normalized.toUpperCase() : undefined;
}

async function resolveOrCreateCustomer({ db, uid, email }) {
  const userRef = db.collection("Users").doc(uid);
  const snap = await userRef.get();
  const existing = snap.exists ? snap.data()?.stripeCustomerId : null;

  if (typeof existing === "string" && existing.trim()) {
    return existing.trim();
  }

  const customer = await stripe.customers.create({
    email: email || undefined,
    metadata: { uid, flow: PREMIUM_FLOW_METADATA },
  });

  const existingData = snap.exists ? snap.data() || {} : {};
  const { patch: identityPatch } = buildUserIdentityPatch(existingData, {
    uid,
    email: email || undefined,
    authEmail: email || undefined,
  });

  await userRef.set(
    {
      ...identityPatch,
      stripeCustomerId: customer.id,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return customer.id;
}

export default async function handler(req, res) {
  const requestId = setBillingRequestId(res, getBillingRequestId(req, "sppsheet"));
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    logBillingObs({
      level: "warn",
      scope: "stripe_premium_payment_sheet",
      stage: "rejected",
      requestId,
      result: { httpStatus: 405 },
      error: { code: BILLING_ERROR_CODES.METHOD_NOT_ALLOWED },
    });
    return res.status(405).json({ error: "Method not allowed" });
  }

  let authUser;
  try {
    authUser = await requireAuth(req);
  } catch (err) {
    const code = err.statusCode || 401;
    logBillingObs({
      level: "warn",
      scope: "stripe_premium_payment_sheet",
      stage: "auth_failed",
      requestId,
      result: { httpStatus: code },
      error: { code: BILLING_ERROR_CODES.AUTH_MISSING },
    });
    return res.status(code).json({ error: err.message || "Unauthorized" });
  }

  const iosPremiumSubscriptionsEnabled = await isIosPremiumSubscriptionsEnabled();
  const checkoutPolicy = resolvePremiumMobileCheckoutPolicy(
    req.body?.platform,
    iosPremiumSubscriptionsEnabled
  );
  if (!checkoutPolicy.allowed) {
    return res.status(409).json({
      error: checkoutPolicy.error,
      ...(checkoutPolicy.premiumAccessFree ? { premiumAccessFree: true } : {}),
    });
  }
  const requestedPlatform = checkoutPolicy.platform;

  const priceId = resolvePremiumStripePriceId();
  if (!priceId) {
    console.error(
      "[premium.mobile.payment_sheet] missing price id: STRIPE_PREMIUM_PRICE_ID" +
        (process.env.NODE_ENV === "development" ? " or STRIPE_PREMIUM_PRICE_ID_TEST" : "")
    );
    logBillingObs({
      level: "error",
      scope: "stripe_premium_payment_sheet",
      stage: "config_missing",
      requestId,
      result: { httpStatus: 500 },
      config: getSafeBillingConfigSnapshot(),
      error: { code: BILLING_ERROR_CODES.FLOW_DISABLED, reason: "missing_stripe_premium_price_id" },
    });
    return res.status(500).json({ error: "Premium billing is not configured" });
  }
  if (isStripePremiumUsingLocalOverrides() && process.env.STRIPE_PREMIUM_PRICE_ID_TEST) {
    console.info("[premium.mobile.payment_sheet] using STRIPE_PREMIUM_PRICE_ID_TEST for development");
  }
  try {
    const priceTax = await getStripePriceTaxBehavior(stripe, priceId);
    if (priceTax.taxBehavior !== "exclusive") {
      console.error("[premium.mobile.payment_sheet] price_not_tax_exclusive", priceTax);
      return res.status(409).json({ error: "Premium Price must use tax_behavior=exclusive", priceId: priceTax.id, taxBehavior: priceTax.taxBehavior });
    }
  } catch (error) {
    console.error("[premium.mobile.payment_sheet] price_retrieve_failed", { message: error?.message });
    return res.status(500).json({ error: "Could not validate Premium Price tax behavior" });
  }

  const { billingDetails: rawBillingDetails } = req.body || {};
  let billingDetails = null;
  let billingAudit = null;
  let invoiceDecision = null;

  try {
    billingDetails = normalizeBillingDetails(rawBillingDetails, authUser.email || "");
    billingAudit = normalizeBillingContext(
      buildBillingContextInput(billingDetails, rawBillingDetails, authUser.email || ""),
      { defaultCountry: "Romania", individualCnpOptional: true }
    );
    invoiceDecision = buildInvoiceDecision(billingAudit);
    logBillingAudit({
      flow: "premium_subscription_mobile",
      stage: "api_payment_sheet_received",
      raw: rawBillingDetails || {},
      normalized: billingAudit.normalizedClient,
      decision: invoiceDecision,
    });
    if (!billingAudit.validation.ok) {
      return res.status(400).json({
        error: billingAudit.validation.blockingErrors[0]?.message || "Invalid billing details",
        details: billingAudit.validation.blockingErrors,
      });
    }
  } catch (auditErr) {
    console.error("[premium.mobile.payment_sheet] billing_audit_error", auditErr?.message || auditErr);
    return res.status(400).json({ error: "Invalid billing payload" });
  }

  const uid = authUser.uid;
  const db = getAdminDb();
  let subscriptionAcceptance;
  try {
    subscriptionAcceptance = await acceptSubscriptionConsent({ db, stripe, uid, channel: "mobile", consent: req.body?.subscriptionConsent });
  } catch (error) { return consentErrorResponse(res, error, req.body?.subscriptionConsent?.locale); }
  const baseUrl = resolvePremiumPublicBaseUrl(req);

  try {
    const guard = await assertCanStartPremiumSubscription({
      db,
      stripe,
      uid,
      returnUrl: baseUrl ? `${baseUrl}/settings` : "https://www.cristinazurba.com/settings",
      defaultMessage: "Ai deja un abonament premium activ.",
    });
    if (!guard.allowed) {
      return res.status(409).json({
        error: guard.code,
        reason: guard.reason,
        message: guard.message,
        portalUrl: guard.portalUrl || undefined,
        premiumActive: true,
      });
    }

    const customerId = await resolveOrCreateCustomer({
      db,
      uid,
      email: authUser.email || billingDetails?.email || "",
    });
    await stripe.customers.update(customerId, {
      name: [billingDetails?.firstName, billingDetails?.lastName].filter(Boolean).join(" ") || undefined,
      address: {
        line1: billingDetails?.address?.line1 || undefined,
        line2: billingDetails?.address?.line2 || undefined,
        city: billingDetails?.address?.city || undefined,
        state: billingDetails?.address?.state || undefined,
        postal_code: billingDetails?.address?.postalCode || undefined,
        country: toStripeCountryCode(billingDetails?.address?.country),
      },
    });

    // Cancel any existing incomplete subscriptions for this customer
    const existingSubs = await stripe.subscriptions.list({
      customer: customerId,
      status: "incomplete",
      limit: 10,
    });
    for (const sub of existingSubs.data) {
      if (sub.metadata?.flow !== PREMIUM_FLOW_METADATA) continue;
      console.log("[premium.mobile.payment_sheet] Canceling existing incomplete subscription:", sub.id);
      try {
        await stripe.subscriptions.cancel(sub.id);
      } catch (cancelErr) {
        console.warn("[premium.mobile.payment_sheet] Failed to cancel incomplete sub:", sub.id, cancelErr?.message);
      }
    }

    const metadata = {
      subscriptionConsentId: subscriptionAcceptance.id,
      uid,
      flow: PREMIUM_FLOW_METADATA,
      platform: requestedPlatform || "expo",
      checkoutSurface: "payment_sheet",
      priceId,
      invoiceSendEmail: String(billingDetails?.invoicePreferences?.sendEmail !== false),
      invoiceEInvoice: String(invoiceDecision.sendEInvoice),
      invoiceDeliveryInRomania: String(billingAudit.normalizedClient.deliveryInRomania),
      invoiceEligibleForEInvoice: String(billingAudit.normalizedClient.eligibleForEInvoice),
    };
    if (billingDetails?.billingType) {
      metadata.billingType = billingDetails.billingType;
    }
    if (
      billingDetails?.invoicePreferences?.dueDays !== null &&
      billingDetails?.invoicePreferences?.dueDays !== undefined
    ) {
      metadata.invoiceDueDays = String(billingDetails.invoicePreferences.dueDays);
    }

    // Canonical Stripe flow for mobile subscriptions:
    // 1. Create the Subscription with payment_behavior: 'default_incomplete'
    // 2. Stripe auto-creates the first invoice with a PaymentIntent
    // 3. Mobile pays that PaymentIntent via PaymentSheet
    // 4. Stripe auto-activates the subscription when payment succeeds
    // This guarantees that a Subscription always exists - no race conditions.
    let subscription;
    try {
      const fixedVatTaxRateId = await getFixedVatTaxRateId(stripe);
      subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId, quantity: 1 }],
        automatic_tax: { enabled: false },
        default_tax_rates: [fixedVatTaxRateId],
        payment_behavior: "default_incomplete",
        payment_settings: {
          save_default_payment_method: "on_subscription",
          payment_method_types: ["card"],
        },
        expand: [
          "latest_invoice.payment_intent",
          "latest_invoice.confirmation_secret",
        ],
        metadata,
      });
    } catch (subErr) {
      console.error("[premium.mobile.payment_sheet] Failed to create incomplete subscription", {
        message: subErr?.message,
        code: subErr?.code,
        type: subErr?.type,
        customerId,
        priceId,
      });
      return res.status(500).json({ error: "Could not start subscription" });
    }

    const invoice = subscription.latest_invoice;
    const piFromInvoice =
      invoice && typeof invoice === "object" && typeof invoice.payment_intent === "object"
        ? invoice.payment_intent
        : null;
    const confirmationSecret =
      invoice && typeof invoice === "object" && invoice.confirmation_secret
        ? invoice.confirmation_secret
        : null;

    let paymentIntentClientSecret = null;
    let paymentIntentId = null;
    if (piFromInvoice?.client_secret) {
      paymentIntentClientSecret = piFromInvoice.client_secret;
      paymentIntentId = piFromInvoice.id;
    } else if (confirmationSecret?.client_secret) {
      // Newer API versions expose confirmation_secret instead of payment_intent
      paymentIntentClientSecret = confirmationSecret.client_secret;
    }

    if (!paymentIntentClientSecret) {
      console.error(
        "[premium.mobile.payment_sheet] No client secret on subscription invoice",
        {
          subscriptionId: subscription.id,
          invoiceId: invoice?.id,
          hasPaymentIntent: Boolean(piFromInvoice),
          hasConfirmationSecret: Boolean(confirmationSecret),
        }
      );
      // Cleanup the incomplete subscription so we don't leak it
      try {
        await stripe.subscriptions.cancel(subscription.id);
      } catch (_) {}
      return res
        .status(500)
        .json({ error: "Could not start subscription payment" });
    }

    await linkSubscriptionConsent(db, subscriptionAcceptance.id, { stripeSubscriptionId: subscription.id, stripePaymentIntentId: paymentIntentId || null, paymentStatus: "pending" });

    console.log("[premium.mobile.payment_sheet] Subscription created (incomplete)", {
      subscriptionId: subscription.id,
      status: subscription.status,
      invoiceId: invoice?.id,
      paymentIntentId,
      hasClientSecret: Boolean(paymentIntentClientSecret),
    });

    // Store session data indexed by subscription ID (most stable identifier)
    await db
      .collection(PREMIUM_MOBILE_SESSION_COLLECTION)
      .doc(subscription.id)
      .set(
        {
          uid,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscription.id,
          stripePaymentIntentId: paymentIntentId || null,
          stripeInvoiceId: invoice?.id || null,
          pendingPriceId: priceId,
          pendingMetadata: metadata,
          status: subscription.status,
          flow: PREMIUM_FLOW_METADATA,
          billing: billingDetails,
          rawFormValues: rawBillingDetails || null,
          normalizedBeforeCheckout: billingAudit.normalizedClient,
          stripeMetadataSnapshot: metadata,
          invoiceDecision,
          checkoutRequestPayload: omitFirebaseIdTokenFromPayload(req.body) || {},
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

    // Also index by PaymentIntent ID for backwards-compat lookups
    if (paymentIntentId) {
      await db
        .collection(PREMIUM_MOBILE_SESSION_COLLECTION)
        .doc(paymentIntentId)
        .set(
          {
            uid,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscription.id,
            stripePaymentIntentId: paymentIntentId,
            stripeInvoiceId: invoice?.id || null,
            pendingPriceId: priceId,
            pendingMetadata: metadata,
            status: subscription.status,
            flow: PREMIUM_FLOW_METADATA,
            indexedBy: "paymentIntentId",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
    }

    const userSnap = await db.collection("Users").doc(uid).get();
    const existingUser = userSnap.exists ? userSnap.data() || {} : {};
    const { patch: identityPatch } = buildUserIdentityPatch(existingUser, {
      uid,
      email: billingDetails?.email || authUser.email || undefined,
      authEmail: authUser.email || undefined,
      firstName: billingDetails?.firstName,
      lastName: billingDetails?.lastName,
    });

    await db.collection("Users").doc(uid).set(
      {
        ...identityPatch,
        premiumBillingProfile: {
          billing: billingDetails,
          rawFormValues: rawBillingDetails ?? null,
          normalizedBeforeCheckout: billingAudit.normalizedClient,
          stripeMetadataSnapshot: metadata,
          invoiceDecision,
          paymentSheetPendingSubscriptionId: subscription.id,
          paymentSheetPendingPaymentIntentId: paymentIntentId || null,
          updatedAt: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customerId },
      { apiVersion: STRIPE_API_VERSION }
    );

    return res.status(200).json({
      // PaymentSheet uses this client secret; correct amount comes from the invoice
      paymentIntentClientSecret,
      customerEphemeralKeySecret: ephemeralKey.secret,
      customerId,
      // New canonical identifier — client should prefer this for confirm calls
      subscriptionId: subscription.id,
      paymentIntentId,
    });
  } catch (err) {
    console.error("[premium.mobile.payment_sheet] stripe_error", { message: err?.message });
    return res.status(500).json({ error: "Could not start premium payment" });
  }
}
