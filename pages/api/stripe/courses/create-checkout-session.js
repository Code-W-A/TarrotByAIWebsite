import Stripe from "stripe";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../../../../lib/firebaseAdmin";
import { requireAuth } from "../../../../lib/requireAuth";
import {
  isCourseVisibleOnChannel,
  resolveCourseChannelFromPlatform,
} from "../../../../lib/courses";
import {
  isCourseFreeFullAccess,
  resolveCourseEntitlement,
} from "../../../../lib/courseSubscriptionAccess";
import {
  buildInvoiceDecision,
  logBillingAudit,
  normalizeBillingContext,
} from "../../../../utils/billingAudit.mjs";
import {
  normalizeBillingDetails,
  buildBillingContextInput,
} from "../../../../lib/stripeBillingDetails";
import { resolveCourseCheckoutTaxCustomerFields } from "../../../../lib/stripeCourseCheckoutTax";
import { getFixedVatTaxRateId } from "../../../../lib/stripeFixedVatServer";
import {
  COURSE_BUNDLE_COLLECTION,
  isCourseBundleVisibleOnChannel,
  loadBundleCourses,
  normalizeBundleCourseIds,
  resolveBundleAccess,
  resolveBundleThumbnailUrl,
} from "../../../../lib/courseBundles";
import { getGlobalSettings } from "../../../../lib/globalSettings";
import { shouldBlockIosCourseCheckout } from "../../../../lib/iosCoursesVisibility";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const CHECKOUT_SESSION_COLLECTION = "courseCheckoutSessions";
const DEFAULT_MOBILE_CHECKOUT_DEEP_LINK_BASE = "com.cristina.zurba.tarot://courses/checkout";

function maskUid(value) {
  if (typeof value !== "string" || !value) return "unknown";
  if (value.length <= 6) return value;
  return `${value.slice(0, 3)}...${value.slice(-3)}`;
}

function resolveBaseUrl(req) {
  const configuredBaseUrl =
    typeof process.env.NEXT_PUBLIC_SITE_URL === "string"
      ? process.env.NEXT_PUBLIC_SITE_URL.trim()
      : "";
  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/+$/, "");
  }

  const forwardedProto = req.headers?.["x-forwarded-proto"];
  const forwardedHost = req.headers?.["x-forwarded-host"];
  const host = forwardedHost || req.headers?.host;
  const proto = forwardedProto || "http";
  if (!host) return null;
  return `${proto}://${host}`.replace(/\/+$/, "");
}

function sanitizeString(value, maxLength = 255) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  if (!normalized) return "";
  return normalized.slice(0, maxLength);
}

function isMobilePlatform(value) {
  const normalized = sanitizeString(value, 32).toLowerCase();
  return (
    normalized === "expo" ||
    normalized === "mobile" ||
    normalized === "react-native" ||
    normalized === "ios" ||
    normalized === "android"
  );
}

function resolveMobileCheckoutDeepLinkBase() {
  const configured = sanitizeString(
    process.env.COURSES_MOBILE_CHECKOUT_DEEP_LINK_BASE || "",
    2048
  );
  const fallback = configured || DEFAULT_MOBILE_CHECKOUT_DEEP_LINK_BASE;
  return fallback.replace(/\/+$/, "");
}

function buildMobileReturnUrls() {
  const mobileBase = resolveMobileCheckoutDeepLinkBase();
  return {
    successUrl: `${mobileBase}?checkout=success`,
    cancelUrl: `${mobileBase}?checkout=cancel`,
  };
}

function detectProtocol(urlValue) {
  const candidate = sanitizeString(urlValue, 2048);
  const match = candidate.match(/^([a-z][a-z0-9+.-]*):/i);
  return match ? match[1].toLowerCase() : "";
}

function normalizeAllowedPrefix(value) {
  if (typeof value !== "string") return "";
  let normalized = value.trim();
  if (!normalized) return "";
  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1).trim();
  }
  normalized = normalized.toLowerCase();
  normalized = normalized.replace(/\/+$/, "");
  return normalized;
}



function parseAllowedReturnUrlPrefixes() {
  const joined = [
    process.env.COURSES_CHECKOUT_ALLOWED_RETURN_URL_PREFIXES || "",
    process.env.MOBILE_DEEP_LINK_ALLOWED_PREFIXES || "",
    resolveMobileCheckoutDeepLinkBase(),
  ]
    .map((value) => sanitizeString(value, 2048))
    .filter(Boolean)
    .join(",");

  const prefixes = joined
    .split(",")
    .map((entry) => normalizeAllowedPrefix(entry))
    .filter(Boolean);

  if (process.env.NODE_ENV !== "production") {
    prefixes.push("exp://", "exps://");
  }

  return Array.from(new Set(prefixes));
}

function isValidReturnUrl(urlValue, baseUrl, allowedPrefixes) {
  if (!urlValue) return false;
  const candidate = sanitizeString(urlValue, 2048);
  if (!candidate) return false;
  const protocol = detectProtocol(candidate);
  if (!protocol) return false;

  if (protocol === "http" || protocol === "https") {
    let parsed;
    try {
      parsed = new URL(candidate);
      return parsed.origin === new URL(baseUrl).origin;
    } catch (_) {
      return false;
    }
  }

  const loweredCandidate = candidate.toLowerCase();
  const normalizedCandidate = loweredCandidate.replace(/\/+$/, "");
  return allowedPrefixes.some((prefix) => {
    if (!prefix) return false;
    return (
      normalizedCandidate === prefix ||
      normalizedCandidate.startsWith(`${prefix}/`) ||
      normalizedCandidate.startsWith(`${prefix}?`) ||
      normalizedCandidate.startsWith(`${prefix}#`)
    );
  });
}

function createValidationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function resolveReturnUrls({ baseUrl, courseId, successUrl, cancelUrl, sourcePlatform }) {
  const webDefaults = {
    successUrl: `${baseUrl}/courses/${courseId}?success=1`,
    cancelUrl: `${baseUrl}/courses/${courseId}?canceled=1`,
  };
  const mobileDefaults = buildMobileReturnUrls();
  const defaults = isMobilePlatform(sourcePlatform) ? mobileDefaults : webDefaults;

  const requestedSuccessUrl = sanitizeString(successUrl, 2048);
  const requestedCancelUrl = sanitizeString(cancelUrl, 2048);
  if (!requestedSuccessUrl && !requestedCancelUrl) {
    console.info("[courses.checkout] return_urls_defaults", {
      courseId,
      baseUrl,
      sourcePlatform,
      mode: isMobilePlatform(sourcePlatform) ? "mobile" : "web",
      successUrl: defaults.successUrl,
      cancelUrl: defaults.cancelUrl,
    });
    return defaults;
  }

  const allowedPrefixes = parseAllowedReturnUrlPrefixes();
  if ((requestedSuccessUrl || requestedCancelUrl) && allowedPrefixes.length === 0) {
    console.warn("[courses.checkout] return_url_allowlist_empty");
  }
  if (requestedSuccessUrl && !isValidReturnUrl(requestedSuccessUrl, baseUrl, allowedPrefixes)) {
    console.warn("[courses.checkout] invalid_success_url", {
      courseId,
      requestedSuccessUrl,
      baseUrl,
      allowedPrefixes,
    });
    throw createValidationError("Invalid successUrl");
  }
  if (requestedCancelUrl && !isValidReturnUrl(requestedCancelUrl, baseUrl, allowedPrefixes)) {
    console.warn("[courses.checkout] invalid_cancel_url", {
      courseId,
      requestedCancelUrl,
      baseUrl,
      allowedPrefixes,
    });
    throw createValidationError("Invalid cancelUrl");
  }

  console.info("[courses.checkout] return_urls_custom", {
    courseId,
    sourcePlatform,
    mode: isMobilePlatform(sourcePlatform) ? "mobile" : "web",
    requestedSuccessUrl: requestedSuccessUrl || defaults.successUrl,
    requestedCancelUrl: requestedCancelUrl || defaults.cancelUrl,
  });

  return {
    successUrl: requestedSuccessUrl || defaults.successUrl,
    cancelUrl: requestedCancelUrl || defaults.cancelUrl,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end("Method Not Allowed");
  }

  let authUser;
  try {
    authUser = await requireAuth(req);
  } catch (err) {
    return res.status(err.statusCode || 401).json({ error: err.message });
  }

  const {
    courseId: rawCourseId,
    bundleId: rawBundleId,
    purchaseType: rawPurchaseType,
    successUrl: rawSuccessUrl,
    cancelUrl: rawCancelUrl,
    platform: rawPlatform,
    billingDetails: rawBillingDetails,
  } = req.body || {};
  const purchaseType =
    typeof rawPurchaseType === "string" && rawPurchaseType.trim().toLowerCase() === "bundle"
      ? "bundle"
      : "course";
  const courseId = typeof rawCourseId === "string" ? rawCourseId.trim() : "";
  const bundleId = typeof rawBundleId === "string" ? rawBundleId.trim() : "";
  const itemId = purchaseType === "bundle" ? bundleId : courseId;
  if (!itemId) {
    return res
      .status(400)
      .json({ error: purchaseType === "bundle" ? "Missing bundleId" : "Missing courseId" });
  }
  const sourcePlatform = sanitizeString(rawPlatform, 32).toLowerCase() || "web";
  const headerPlatform = sanitizeString(req.headers?.["x-app-platform"], 32).toLowerCase();
  const courseChannel = resolveCourseChannelFromPlatform(sourcePlatform);

  console.info("[courses.checkout] start", {
    uid: maskUid(authUser.uid),
    courseId,
    bundleId,
    purchaseType,
    sourcePlatform,
    headerPlatform,
    hasSuccessUrl: Boolean(sanitizeString(rawSuccessUrl, 2048)),
    hasCancelUrl: Boolean(sanitizeString(rawCancelUrl, 2048)),
  });

  try {
    let iosCoursesHidden = true;
    try {
      const settings = await getGlobalSettings();
      iosCoursesHidden = settings.iosCoursesHidden !== false;
    } catch (settingsError) {
      console.warn("[courses.checkout] settings_unavailable", {
        message: settingsError?.message || "unknown_error",
      });
    }
    if (
      shouldBlockIosCourseCheckout({
        platform: sourcePlatform,
        headerPlatform,
        iosCoursesHidden,
      })
    ) {
      console.info("[courses.checkout] ios_courses_hidden", {
        uid: maskUid(authUser.uid),
        courseId,
        bundleId,
        purchaseType,
        sourcePlatform,
        headerPlatform,
      });
      return res.status(403).json({ error: "ios_courses_unavailable" });
    }
    const db = getAdminDb();
    const billingDetails = normalizeBillingDetails(rawBillingDetails, authUser.email || "");
    const billingAudit = normalizeBillingContext(
      buildBillingContextInput(billingDetails, rawBillingDetails, authUser.email || ""),
      {
        defaultCountry: "Romania",
        individualCnpOptional: true,
      }
    );
    const invoiceDecision = buildInvoiceDecision(billingAudit);
    logBillingAudit({
      flow: "courses",
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
    const collection =
      purchaseType === "bundle" ? COURSE_BUNDLE_COLLECTION : "courses";
    const snap = await db.collection(collection).doc(itemId).get();
    if (!snap.exists) {
      console.warn("[courses.checkout] course_not_found", {
        uid: maskUid(authUser.uid),
        courseId,
        bundleId,
        purchaseType,
      });
      return res
        .status(404)
        .json({ error: purchaseType === "bundle" ? "Course bundle not found" : "Course not found" });
    }
    const item = snap.data() || {};
    const bundleCourseIds =
      purchaseType === "bundle" ? normalizeBundleCourseIds(item.courseIds) : [];
    if (purchaseType === "bundle" && bundleCourseIds.length < 2) {
      return res.status(400).json({ error: "Course bundle is invalid" });
    }
    let bundleVisibleCourses = [];
    if (purchaseType === "bundle") {
      bundleVisibleCourses = await loadBundleCourses(db, bundleCourseIds, "ro", {
        visibleOnly: true,
        channel: courseChannel,
      });
      if (bundleVisibleCourses.length !== bundleCourseIds.length) {
        return res.status(400).json({
          error: "All courses in this bundle must be published",
        });
      }
    }
    if (purchaseType === "course" && isCourseFreeFullAccess(item)) {
      console.warn("[courses.checkout] free_course", {
        uid: maskUid(authUser.uid),
        courseId,
      });
      return res.status(400).json({ error: "free_course" });
    }
    const isPurchasable =
      purchaseType === "bundle"
        ? isCourseBundleVisibleOnChannel(item, courseChannel)
        : isCourseVisibleOnChannel(item, courseChannel, Date.now());
    if (!isPurchasable) {
      console.warn("[courses.checkout] course_not_purchasable", {
        uid: maskUid(authUser.uid),
        courseId,
        bundleId,
        purchaseType,
        status: item?.status || "unknown",
      });
      return res.status(400).json({
        error:
          purchaseType === "bundle"
            ? "Course bundle not available for purchase"
            : "Course not available for purchase",
      });
    }

    const entitlement =
      purchaseType === "bundle"
        ? await resolveBundleAccess(db, authUser.uid, bundleId, item)
        : await resolveCourseEntitlement(db, authUser.uid, courseId, item, {
            courseVisible: isCourseVisibleOnChannel(item, courseChannel, Date.now()),
          });
    if (entitlement.hasAccess) {
      console.info("[courses.checkout] already_has_access", {
        uid: maskUid(authUser.uid),
        courseId,
        bundleId,
        purchaseType,
        accessSource: entitlement.accessSource,
      });
      return res.status(409).json({
        error:
          purchaseType === "bundle"
            ? "You already have access to all courses in this bundle"
            : "You already have access to this course",
      });
    }

    const currency = String(item.currency || "RON").toLowerCase();
    const unitAmount = Math.round(Number(item.price) * 100);
    if (!Number.isFinite(unitAmount) || unitAmount <= 0) {
      return res.status(400).json({ error: "Invalid course price" });
    }

    const baseUrl = resolveBaseUrl(req);
    if (!baseUrl) {
      console.error("[courses.checkout] missing_base_url", {
        uid: maskUid(authUser.uid),
        courseId,
      });
      return res.status(500).json({ error: "Missing site URL configuration" });
    }

    const returnUrls = resolveReturnUrls({
      baseUrl,
      courseId: purchaseType === "bundle" ? `bundles/${bundleId}` : courseId,
      successUrl: rawSuccessUrl,
      cancelUrl: rawCancelUrl,
      sourcePlatform,
    });
    console.info("[courses.checkout] return_urls_resolved", {
      uid: maskUid(authUser.uid),
      courseId,
      bundleId,
      purchaseType,
      baseUrl,
      successUrl: returnUrls.successUrl,
      cancelUrl: returnUrls.cancelUrl,
    });

    const metadata = {
      uid: authUser.uid,
      purchaseType,
      ...(purchaseType === "bundle" ? { bundleId } : { courseId }),
      ...(purchaseType === "bundle"
        ? { courseIds: bundleCourseIds.join(",") }
        : {}),
      expectedAmount: String(unitAmount),
      expectedCurrency: currency.toUpperCase(),
      sourcePlatform,
      invoiceSendEmail: String(billingDetails?.invoicePreferences?.sendEmail !== false),
      invoiceEInvoice: String(invoiceDecision.sendEInvoice),
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
    metadata.invoiceDeliveryInRomania = String(billingAudit.normalizedClient.deliveryInRomania);
    metadata.invoiceEligibleForEInvoice = String(billingAudit.normalizedClient.eligibleForEInvoice);

    // Mobile: reuse the purchase Customer with app billing details.
    // Web keeps customer_email-only behavior.
    // Never writes Users.stripeCustomerId — avoids Premium tax-address side effects.
    const taxCustomerFields = await resolveCourseCheckoutTaxCustomerFields({
      stripe,
      db,
      sourcePlatform,
      isMobilePlatform,
      billingDetails,
      authEmail: authUser.email || "",
      uid: authUser.uid,
    });

    const fixedVatTaxRateId = await getFixedVatTaxRateId(stripe);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      billing_address_collection: isMobilePlatform(sourcePlatform) ? "auto" : "required",
      phone_number_collection: { enabled: !isMobilePlatform(sourcePlatform) },
      line_items: [
        {
          price_data: {
            currency,
            tax_behavior: "exclusive",
            product_data: {
              name: item.title,
              ...(purchaseType === "bundle"
                ? (() => {
                    const resolvedThumb = resolveBundleThumbnailUrl(
                      item,
                      bundleVisibleCourses
                    );
                    return resolvedThumb ? { images: [resolvedThumb] } : {};
                  })()
                : {}),
            },
            unit_amount: unitAmount,
          },
          quantity: 1,
          tax_rates: [fixedVatTaxRateId],
        },
      ],
      metadata,
      client_reference_id: `${authUser.uid}:${purchaseType}:${itemId}`,
      ...taxCustomerFields,
      success_url: returnUrls.successUrl,
      cancel_url: returnUrls.cancelUrl,
    });

    try {
      const checkoutSessionPayload = {
        uid: authUser.uid,
        purchaseType,
        ...(purchaseType === "bundle" ? { bundleId } : { courseId }),
        ...(purchaseType === "bundle" ? { courseIds: bundleCourseIds } : {}),
        sourcePlatform,
        stripeCheckoutSessionId: session.id,
        paymentStatus: "pending",
        status: "created",
        returnUrls,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (billingDetails) {
        checkoutSessionPayload.billing = billingDetails;
      }
      checkoutSessionPayload.rawFormValues = rawBillingDetails || null;
      checkoutSessionPayload.normalizedBeforeCheckout = billingAudit.normalizedClient;
      checkoutSessionPayload.checkoutRequestPayload = req.body || {};
      checkoutSessionPayload.stripeMetadataSnapshot = metadata;
      checkoutSessionPayload.invoiceDecision = invoiceDecision;
      await db
        .collection(CHECKOUT_SESSION_COLLECTION)
        .doc(session.id)
        .set(checkoutSessionPayload, { merge: true });
    } catch (persistError) {
      console.warn("[courses.checkout] checkout_session_persist_failed", {
        uid: maskUid(authUser.uid),
        courseId,
        sessionId: session.id,
        message: persistError?.message || "unknown_error",
      });
    }

    console.info("[courses.checkout] session_created", {
      uid: maskUid(authUser.uid),
      courseId,
      bundleId,
      purchaseType,
      sessionId: session.id,
    });

    return res.status(200).json({ url: session.url, sessionId: session.id });
  } catch (error) {
    const statusCode = error?.statusCode || 500;
    console.error("[courses.checkout] failed", {
      uid: maskUid(authUser.uid),
      courseId,
      bundleId,
      purchaseType,
      statusCode,
      message: error?.message || "unknown_error",
    });
    if (statusCode === 400) {
      return res.status(400).json({ error: error.message });
    }
    return res.status(500).json({ error: "Failed to create checkout session" });
  }
}
