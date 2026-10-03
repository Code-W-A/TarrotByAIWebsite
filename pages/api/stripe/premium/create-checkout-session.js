import { acceptSubscriptionConsent, linkSubscriptionConsent, consentErrorResponse } from "../../../../lib/subscriptionConsent";
import Stripe from "stripe";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../../../../lib/firebaseAdmin";
import { requireAuth } from "../../../../lib/requireAuth";
import { PREMIUM_FLOW_METADATA } from "../../../../lib/premiumAccess";
import { resolvePremiumPublicBaseUrl } from "../../../../lib/premiumServerUtils";
import {
  normalizeBillingDetails,
  buildBillingContextInput,
} from "../../../../lib/stripeBillingDetails";
import {
  buildInvoiceDecision,
  logBillingAudit,
  normalizeBillingContext,
} from "../../../../utils/billingAudit.mjs";
import {
  isStripePremiumUsingLocalOverrides,
  resolvePremiumStripePriceId,
} from "../../../../lib/stripePremiumEnv";
import { getStripePriceTaxBehavior } from "../../../../utils/oblioTax";
import { getFixedVatTaxRateId } from "../../../../lib/stripeFixedVatServer";
import { assertCanStartPremiumSubscription } from "../../../../lib/premiumSubscriptionGuard";
import { buildUserIdentityPatch } from "../../../../lib/userIdentitySync";
import {
  BILLING_ERROR_CODES,
  getBillingRequestId,
  getSafeBillingConfigSnapshot,
  logBillingObs,
  setBillingRequestId,
} from "../../../../lib/billingObservability";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const PREMIUM_CHECKOUT_SESSION_COLLECTION = "premiumCheckoutSessions";

export default async function handler(req, res) {
  const requestId = setBillingRequestId(res, getBillingRequestId(req, "spcheckout"));
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    logBillingObs({
      level: "warn",
      scope: "stripe_premium_checkout",
      stage: "rejected",
      requestId,
      result: { httpStatus: 405 },
      error: { code: BILLING_ERROR_CODES.METHOD_NOT_ALLOWED },
    });
    return res.status(405).json({ error: "Method not allowed" });
  }

  const priceId = resolvePremiumStripePriceId();
  if (!priceId) {
    console.error(
      "[premium.checkout] missing price id: STRIPE_PREMIUM_PRICE_ID" +
        (process.env.NODE_ENV === "development" ? " or STRIPE_PREMIUM_PRICE_ID_TEST" : ""),
    );
    logBillingObs({
      level: "error",
      scope: "stripe_premium_checkout",
      stage: "config_missing",
      requestId,
      result: { httpStatus: 500 },
      config: getSafeBillingConfigSnapshot(),
      error: { code: BILLING_ERROR_CODES.FLOW_DISABLED, reason: "missing_stripe_premium_price_id" },
    });
    return res.status(500).json({ error: "Premium billing is not configured" });
  }
  if (isStripePremiumUsingLocalOverrides() && process.env.STRIPE_PREMIUM_PRICE_ID_TEST) {
    console.info("[premium.checkout] using STRIPE_PREMIUM_PRICE_ID_TEST for development");
  }
  try {
    const priceTax = await getStripePriceTaxBehavior(stripe, priceId);
    if (priceTax.taxBehavior !== "exclusive") {
      console.error("[premium.checkout] price_not_tax_exclusive", priceTax);
      return res.status(409).json({ error: "Premium Price must use tax_behavior=exclusive", priceId: priceTax.id, taxBehavior: priceTax.taxBehavior });
    }
  } catch (error) {
    console.error("[premium.checkout] price_retrieve_failed", { message: error?.message });
    return res.status(500).json({ error: "Could not validate Premium Price tax behavior" });
  }

  let authUser;
  try {
    authUser = await requireAuth(req);
  } catch (err) {
    const code = err.statusCode || 401;
    logBillingObs({
      level: "warn",
      scope: "stripe_premium_checkout",
      stage: "auth_failed",
      requestId,
      result: { httpStatus: code },
      error: { code: BILLING_ERROR_CODES.AUTH_MISSING },
    });
    return res.status(code).json({ error: err.message || "Unauthorized" });
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
      flow: "premium_subscription",
      stage: "api_checkout_received",
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
    console.error("[premium.checkout] billing_audit_error", auditErr?.message || auditErr);
    return res.status(400).json({ error: "Invalid billing payload" });
  }

  const baseUrl = resolvePremiumPublicBaseUrl(req);
  if (!baseUrl) {
    console.error("[premium.checkout] missing_base_url");
    return res.status(500).json({ error: "Missing site URL configuration" });
  }

  const uid = authUser.uid;
  const db = getAdminDb();
  let subscriptionAcceptance;
  try {
    subscriptionAcceptance = await acceptSubscriptionConsent({ db, stripe, uid, channel: "web", consent: req.body?.subscriptionConsent });
  } catch (error) { return consentErrorResponse(res, error, req.body?.subscriptionConsent?.locale); }

  const guard = await assertCanStartPremiumSubscription({
    db,
    stripe,
    uid,
    returnUrl: `${baseUrl}/settings`,
    defaultMessage: "Ai deja un abonament premium activ. Gestionează-l din setări sau portalul de facturare.",
  });
  if (!guard.allowed) {
    return res.status(409).json({
      error: guard.code,
      reason: guard.reason,
      message: guard.message,
      portalUrl: guard.portalUrl || undefined,
    });
  }

  let stripeCustomerId = null;
  try {
    const snap = await db.collection("Users").doc(uid).get();
    if (snap.exists) {
      const c = snap.data()?.stripeCustomerId;
      if (typeof c === "string" && c.trim()) {
        stripeCustomerId = c.trim();
      }
    }
  } catch (e) {
    console.warn("[premium.checkout] user_read_failed", { message: e?.message });
  }

  const metadata = {
    subscriptionConsentId: subscriptionAcceptance.id,
    uid,
    flow: PREMIUM_FLOW_METADATA,
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

  const fixedVatTaxRateId = await getFixedVatTaxRateId(stripe);
  const sessionParams = {
    mode: "subscription",
    custom_text: { submit: { message: subscriptionAcceptance.quote.text } },
    payment_method_types: ["card"],
    billing_address_collection: "required",
    phone_number_collection: { enabled: true },
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: uid,
    metadata,
    subscription_data: {
      metadata,
      default_tax_rates: [fixedVatTaxRateId],
    },
    success_url: `${baseUrl}/premium?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/abonament?checkout=cancel`,
  };

  if (stripeCustomerId) {
    sessionParams.customer = stripeCustomerId;
    // Automatic Tax needs a valid location on an existing Customer. Checkout
    // collects it above and persists the entered billing address/name.
    sessionParams.customer_update = {
      address: "auto",
      name: "auto",
    };
  } else if (authUser.email) {
    sessionParams.customer_email = authUser.email;
  }

  try {
    const session = await stripe.checkout.sessions.create(sessionParams);
    await linkSubscriptionConsent(db, subscriptionAcceptance.id, { stripeCheckoutSessionId: session.id, paymentStatus: "pending" });
    if (!session?.url) {
      return res.status(500).json({ error: "Checkout session missing URL" });
    }

    try {
      const checkoutSessionPayload = {
        subscriptionConsentId: subscriptionAcceptance.id,
        uid,
        stripeCheckoutSessionId: session.id,
        paymentStatus: "pending",
        status: "created",
        flow: PREMIUM_FLOW_METADATA,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (billingDetails) {
        checkoutSessionPayload.billing = billingDetails;
      }
      checkoutSessionPayload.rawFormValues = rawBillingDetails || null;
      checkoutSessionPayload.normalizedBeforeCheckout = billingAudit.normalizedClient;
      checkoutSessionPayload.stripeMetadataSnapshot = metadata;
      checkoutSessionPayload.invoiceDecision = invoiceDecision;
      checkoutSessionPayload.checkoutRequestPayload = req.body || {};

      await db
        .collection(PREMIUM_CHECKOUT_SESSION_COLLECTION)
        .doc(session.id)
        .set(checkoutSessionPayload, { merge: true });

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
            checkoutSessionPendingId: session.id,
            updatedAt: FieldValue.serverTimestamp(),
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } catch (persistError) {
      console.warn("[premium.checkout] session_persist_failed", {
        sessionId: session.id,
        message: persistError?.message || "unknown_error",
      });
    }

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("[premium.checkout] stripe_error", { message: err?.message });
    return res.status(500).json({ error: "Could not start checkout" });
  }
}
