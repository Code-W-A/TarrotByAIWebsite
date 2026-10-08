import crypto from "crypto";
import { resolveNativeEbookProduct, processNativeEbookEvent } from "./ebooks/native";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  getAnalysisProductMap,
  getBillingConfig,
  getStaticBundleProductMap,
  getStaticCourseProductMap,
  isRevenueCatFlowEnabled,
  normalizeRevenueCatProductId,
  platformFromRevenueCatStore,
} from "./billingConfig";
import { COURSE_BUNDLE_COLLECTION, normalizeBundleCourseIds } from "./courseBundles";
import {
  buildPremiumSourcePatch,
  hasRevenueCatPurchaseEvidence,
  isSourceActive,
} from "./premiumSources";
import { logBillingObs } from "./billingObservability";

const PRODUCT_FIELDS = [
  "revenueCatProductId",
  "googlePlayProductId",
  "androidProductId",
];
const PURCHASE_EVENTS = new Set(["INITIAL_PURCHASE", "NON_RENEWING_PURCHASE"]);
const PREMIUM_INACTIVE_EVENTS = new Set(["EXPIRATION", "REFUND"]);
const ANALYSIS_LEDGER_MAPPING = Object.freeze({
  personal: {
    productCode: "astrogama_natala",
    analysisType: "personalAstrograma",
  },
  astrogramaOthers: {
    productCode: "astrogama_natala_other_person",
    analysisType: "othersAstrograma",
  },
  sinastrieOnePerson: {
    productCode: "sinastrie_relatie",
    analysisType: "personalSinastry",
  },
  sinastrieOthers: {
    productCode: "sinastrie_relatie_others",
    analysisType: "othersSinastry",
  },
});
const REVENUECAT_API_BASE = "https://api.revenuecat.com/v1";

function logRevenueCatVerbose(stage, context) {
  if (String(process.env.BILLING_OBS_VERBOSE || "").toLowerCase() !== "true") return;
  logBillingObs({
    scope: "revenuecat_library",
    stage,
    ...context,
  });
}

function clean(value, max = 255) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeDocId(value) {
  return clean(value, 500).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 500);
}

function normalizeStore(value) {
  return clean(value, 100).toUpperCase();
}

function eventExpirationMs(event) {
  const value = Number(event?.expiration_at_ms);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function eventRevisionMs(event) {
  for (const value of [
    event?.event_timestamp_ms,
    event?.purchased_at_ms,
  ]) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return Date.now();
}

export function isAuthorizedRevenueCatWebhook(header, secret) {
  const expected = clean(secret, 2000);
  const supplied = clean(header, 2000).replace(/^Bearer\s+/i, "");
  if (!expected || !supplied) return false;
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function getRevenueCatEvent(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const event = body.event && typeof body.event === "object" ? body.event : body;
  return clean(event.id) && clean(event.type) ? event : null;
}

function configuredAnalysisMapping(productId, platform) {
  const normalized = normalizeRevenueCatProductId(productId);
  const platforms = platform ? [platform] : ["android", "ios"];
  for (const candidate of platforms) {
    const map = getAnalysisProductMap(candidate);
    const analysisKey = Object.entries(map).find(
      ([configuredId]) => normalizeRevenueCatProductId(configuredId) === normalized
    )?.[1];
    if (analysisKey) return { analysisKey, platform: candidate };
  }
  return null;
}

function lookupStaticProduct(map, productId) {
  const normalized = normalizeRevenueCatProductId(productId);
  return Object.entries(map).find(
    ([configuredId]) => normalizeRevenueCatProductId(configuredId) === normalized
  )?.[1];
}

async function findFirestoreProduct(db, collectionName, productIds) {
  for (const field of PRODUCT_FIELDS) {
    for (const productId of productIds) {
      const snapshot = await db
        .collection(collectionName)
        .where(field, "==", productId)
        .limit(2)
        .get();
      if (!snapshot.empty) {
        if (snapshot.size > 1) {
          throw new Error(`Duplicate ${collectionName} RevenueCat product mapping`);
        }
        const doc = snapshot.docs[0];
        return { id: doc.id, data: doc.data() || {}, field };
      }
    }
  }
  return null;
}

export async function resolveRevenueCatProduct(db, rawProductId, storeOrPlatform, allowDisabledEbooks = false) {
  const raw = clean(rawProductId);
  const productId = normalizeRevenueCatProductId(rawProductId);
  if (!productId) {
    logRevenueCatVerbose("mapping_missing_product_id", { routing: { productId: null } });
    return null;
  }
  const config = getBillingConfig();
  const requestedPlatform =
    storeOrPlatform === "android" || storeOrPlatform === "ios"
      ? storeOrPlatform
      : platformFromRevenueCatStore(storeOrPlatform);
  const candidatePlatforms = requestedPlatform
    ? [requestedPlatform]
    : ["android", "ios"];
  for (const platform of candidatePlatforms) {
    const premium = config[platform].premium;
    if (
      isRevenueCatFlowEnabled("premium", platform) &&
      premium.productId &&
      normalizeRevenueCatProductId(premium.productId) === productId
    ) {
      const mapping = { kind: "premium", productId, platform };
      logRevenueCatVerbose("mapping_resolved", {
        routing: { productId, kind: mapping.kind, platform },
      });
      return mapping;
    }
  }

  if (candidatePlatforms.some((platform) => isRevenueCatFlowEnabled("analyses", platform))) {
    const analysisMapping = configuredAnalysisMapping(productId, requestedPlatform);
    const ledgerMapping = ANALYSIS_LEDGER_MAPPING[analysisMapping?.analysisKey];
    if (ledgerMapping) {
      const mapping = {
        kind: "analysis",
        productId,
        analysisKey: analysisMapping.analysisKey,
        platform: analysisMapping.platform,
        ...ledgerMapping,
      };
      logRevenueCatVerbose("mapping_resolved", {
        routing: { productId, kind: mapping.kind, platform: mapping.platform },
      });
      return mapping;
    }
  }

  for (const platform of candidatePlatforms) {
    const ebook = await resolveNativeEbookProduct(db, productId, platform, allowDisabledEbooks);
    if (ebook) return ebook;
  }
  if (isRevenueCatFlowEnabled("courses")) {
    const staticCourseId = lookupStaticProduct(getStaticCourseProductMap(), productId);
    if (staticCourseId) {
      const mapping = { kind: "course", productId, itemId: staticCourseId, source: "env" };
      logRevenueCatVerbose("mapping_resolved", { routing: { productId, kind: mapping.kind } });
      return mapping;
    }
    const staticBundleId = lookupStaticProduct(getStaticBundleProductMap(), productId);
    if (staticBundleId) {
      const mapping = { kind: "bundle", productId, itemId: staticBundleId, source: "env" };
      logRevenueCatVerbose("mapping_resolved", { routing: { productId, kind: mapping.kind } });
      return mapping;
    }
    const productCandidates = Array.from(new Set([raw, productId].filter(Boolean)));
    const course = await findFirestoreProduct(db, "courses", productCandidates);
    if (course) {
      const mapping = {
        kind: "course",
        productId,
        itemId: course.id,
        itemData: course.data,
        source: course.field,
      };
      logRevenueCatVerbose("mapping_resolved", { routing: { productId, kind: mapping.kind } });
      return mapping;
    }
    const bundle = await findFirestoreProduct(
      db,
      COURSE_BUNDLE_COLLECTION,
      productCandidates
    );
    if (bundle) {
      const mapping = {
        kind: "bundle",
        productId,
        itemId: bundle.id,
        itemData: bundle.data,
        source: bundle.field,
      };
      logRevenueCatVerbose("mapping_resolved", { routing: { productId, kind: mapping.kind } });
      return mapping;
    }
  }
  logRevenueCatVerbose("mapping_unmapped_product", { routing: { productId } });
  return null;
}

function premiumStateFromEvent(event) {
  const type = clean(event.type);
  const expirationMs = eventExpirationMs(event);
  const active =
    !PREMIUM_INACTIVE_EVENTS.has(type) &&
    !(type === "CANCELLATION" && expirationMs != null && expirationMs <= Date.now());
  return {
    active,
    status: active ? (type === "BILLING_ISSUE" ? "past_due" : "active") : "expired",
    expirationMs,
    cancelAtPeriodEnd: active && type === "CANCELLATION",
  };
}

function buildPremiumWrite(userData, event, mapping, revisionMs) {
  const state = premiumStateFromEvent(event);
  const expiresAt = state.expirationMs ? Timestamp.fromMillis(state.expirationMs) : null;
  return {
    ...buildPremiumSourcePatch(userData, "revenuecat", {
      active: state.active,
      status: state.status,
      expiresAt,
      productId: mapping.productId,
      originalTransactionId: clean(event.original_transaction_id),
      store: normalizeStore(event.store) || null,
      environment: clean(event.environment) || null,
      eventTimestampMs: revisionMs,
      cancelAtPeriodEnd: state.cancelAtPeriodEnd,
      willRenew: state.active ? !state.cancelAtPeriodEnd : false,
      updatedAt: FieldValue.serverTimestamp(),
    }),
    revenueCatSubscriptionStatus: state.status,
    revenueCatCurrentPeriodEnd: expiresAt,
    revenueCatProductId: mapping.productId,
    revenueCatOriginalTransactionId: clean(event.original_transaction_id) || null,
    revenueCatStore: normalizeStore(event.store) || null,
    revenueCatEnvironment: clean(event.environment) || null,
    revenueCatCancelAtPeriodEnd: state.cancelAtPeriodEnd,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function basePurchasePayload(event, mapping) {
  return {
    provider: "revenuecat",
    productId: mapping.productId,
    revenueCatEventId: clean(event.id),
    revenueCatTransactionId: clean(event.transaction_id),
    revenueCatOriginalTransactionId: clean(event.original_transaction_id),
    store: normalizeStore(event.store),
    environment: clean(event.environment),
    status: "paid",
    paymentStatus: "paid",
    amountPaid: null,
    amountPaidCents: null,
    currency: clean(event.currency).toUpperCase() || null,
    purchasedAt: event.purchased_at_ms
      ? Timestamp.fromMillis(Number(event.purchased_at_ms))
      : FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function setManualInvoicePending(transaction, paymentRef, event, mapping, uid) {
  transaction.set(
    paymentRef,
    {
      uid,
      provider: "revenuecat",
      productId: mapping.productId,
      purchaseType: mapping.kind,
      revenueCatEventId: clean(event.id),
      revenueCatTransactionId: clean(event.transaction_id),
      entitlementGranted: true,
      paymentStatus: "paid",
      oblio: {
        status: "pending_manual",
        reason: "Marketplace transaction requires manual fiscal review",
        provider: "revenuecat",
        store: normalizeStore(event.store) || null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function processOneTimePurchase(transaction, db, event, mapping, uid, userData) {
  if (!PURCHASE_EVENTS.has(clean(event.type))) {
    return { skipped: true, reason: "event_not_purchase" };
  }
  const transactionId =
    clean(event.transaction_id) || clean(event.original_transaction_id) || clean(event.id);
  const paymentRef = db.collection("payments").doc(`revenuecat_${safeDocId(transactionId)}`);
  const base = basePurchasePayload(event, mapping);

  if (mapping.kind === "analysis") {
    const entitlementRef = db
      .collection("purchaseEntitlements")
      .doc(`revenuecat_${safeDocId(transactionId)}`);
    transaction.set(
      entitlementRef,
      {
        transactionId,
        provider: "revenuecat",
        legacy: false,
        status: "succeeded",
        productCode: mapping.productCode,
        productId: mapping.productId,
        ownerUid: uid,
        customer: {
          name: clean(
            [userData?.first_name, userData?.last_name].filter(Boolean).join(" ")
          ),
          email: clean(userData?.email, 320),
          emailLower: clean(userData?.email, 320).toLowerCase(),
          phone: clean(userData?.phone, 64),
          phoneNormalized: clean(userData?.phone, 64).replace(/\D/g, ""),
        },
        analysis: { analysisId: "", analysisType: mapping.analysisType },
        source: { lastWriter: "revenuecat_webhook" },
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    setManualInvoicePending(transaction, paymentRef, event, mapping, uid);
    return {
      entitlementGranted: true,
      kind: "analysis",
      analysisKey: mapping.analysisKey,
      analysisType: mapping.analysisType,
    };
  }

  if (mapping.kind === "course") {
    const purchaseRef = db
      .collection("users")
      .doc(uid)
      .collection("purchases")
      .doc(mapping.itemId);
    const existing = await transaction.get(purchaseRef);
    transaction.set(
      purchaseRef,
      { ...base, courseId: mapping.itemId, accessSource: "purchase" },
      { merge: true }
    );
    if (!existing.exists || existing.data()?.status !== "paid") {
      transaction.set(
        db.collection("courses").doc(mapping.itemId),
        { purchaseCount: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
    }
    setManualInvoicePending(transaction, paymentRef, event, mapping, uid);
    return { entitlementGranted: true, kind: "course", itemId: mapping.itemId };
  }

  const bundleRef = db.collection(COURSE_BUNDLE_COLLECTION).doc(mapping.itemId);
  const bundleSnap = mapping.itemData
    ? { exists: true, data: () => mapping.itemData }
    : await transaction.get(bundleRef);
  if (!bundleSnap.exists) throw new Error("Mapped course bundle not found");
  const courseIds = normalizeBundleCourseIds(bundleSnap.data()?.courseIds);
  if (!courseIds.length) throw new Error("Mapped course bundle has no courses");
  const bundlePurchaseRef = db
    .collection("users")
    .doc(uid)
    .collection("bundlePurchases")
    .doc(mapping.itemId);
  const existingBundle = await transaction.get(bundlePurchaseRef);
  transaction.set(
    bundlePurchaseRef,
    { ...base, bundleId: mapping.itemId, courseIds },
    { merge: true }
  );
  courseIds.forEach((courseId) => {
    transaction.set(
      db.collection("users").doc(uid).collection("purchases").doc(courseId),
      {
        ...base,
        courseId,
        bundleId: mapping.itemId,
        accessSource: "bundle",
      },
      { merge: true }
    );
  });
  if (!existingBundle.exists || existingBundle.data()?.status !== "paid") {
    transaction.set(
      bundleRef,
      { purchaseCount: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
  }
  setManualInvoicePending(transaction, paymentRef, event, mapping, uid);
  return { entitlementGranted: true, kind: "bundle", itemId: mapping.itemId, courseIds };
}

export async function processRevenueCatEvent(db, event) {
  const eventId = clean(event?.id);
  const eventType = clean(event?.type);
  const uid = clean(event?.app_user_id, 128);
  if (!eventId || !eventType) throw new Error("Invalid RevenueCat event");
  if (!uid || uid.startsWith("$RCAnonymousID:")) {
    logRevenueCatVerbose("event_skipped", {
      correlation: { revenueCatEventId: eventId },
      result: { reason: "invalid_app_user_id", skipped: true },
    });
    return { skipped: true, reason: "invalid_app_user_id" };
  }

  const mapping = await resolveRevenueCatProduct(db, event.product_id, event.store, ["REFUND", "CANCELLATION"].includes(eventType));
  if (mapping?.kind === "ebook") return processNativeEbookEvent(db, event, mapping);
  const eventRef = db.collection("revenueCatWebhookEvents").doc(eventId);
  return db.runTransaction(async (transaction) => {
    const eventSnap = await transaction.get(eventRef);
    if (eventSnap.exists) {
      logRevenueCatVerbose("event_skipped", {
        correlation: { revenueCatEventId: eventId },
        result: { reason: "already_processed", skipped: true },
      });
      return { skipped: true, reason: "already_processed" };
    }

    let result = { skipped: true, reason: mapping ? "event_not_applicable" : "unmapped_product" };
    if (mapping?.kind === "premium") {
      const userRef = db.collection("Users").doc(uid);
      const userSnap = await transaction.get(userRef);
      const userData = userSnap.exists ? userSnap.data() || {} : {};
      const revisionMs = eventRevisionMs(event);
      const existingRevisionMs = Number(
        userData?.premiumSources?.revenuecat?.eventTimestampMs || 0
      );
      if (existingRevisionMs > revisionMs) {
        result = { skipped: true, reason: "stale_event", kind: "premium" };
      } else {
        transaction.set(
          userRef,
          buildPremiumWrite(userData, event, mapping, revisionMs),
          { merge: true }
        );
        result = { skipped: false, kind: "premium", entitlementGranted: true };
      }
    } else if (mapping) {
      const userRef = db.collection("Users").doc(uid);
      const userSnap = await transaction.get(userRef);
      result = await processOneTimePurchase(
        transaction,
        db,
        event,
        mapping,
        uid,
        userSnap.exists ? userSnap.data() || {} : {}
      );
      result.skipped = result.entitlementGranted !== true;
    }

    transaction.set(eventRef, {
      eventId,
      eventType,
      uid,
      productId: normalizeRevenueCatProductId(event.product_id) || null,
      store: normalizeStore(event.store) || null,
      mappingKind: mapping?.kind || null,
      result,
      processedAt: FieldValue.serverTimestamp(),
    });
    logRevenueCatVerbose("event_processed", {
      correlation: { revenueCatEventId: eventId, transactionId: event.transaction_id },
      actor: { uid },
      routing: { eventType, productId: event.product_id, mappingKind: mapping?.kind || null },
      result,
    });
    return result;
  });
}

function parseRevenueCatDate(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function findPremiumSubscription(subscriber, entitlement) {
  const config = getBillingConfig();
  const configuredProductIds = new Set(
    [config.android.premium.productId, config.ios.premium.productId]
      .map(normalizeRevenueCatProductId)
      .filter(Boolean)
  );
  const entitlementProductId = normalizeRevenueCatProductId(
    entitlement?.product_identifier
  );
  const candidates = Object.entries(subscriber?.subscriptions || {})
    .filter(([productId]) => {
      const normalized = normalizeRevenueCatProductId(productId);
      return Boolean(
        normalized &&
          (normalized === entitlementProductId || configuredProductIds.has(normalized))
      );
    })
    .map(([productId, subscription]) => ({
      productId: normalizeRevenueCatProductId(productId),
      subscription: subscription || {},
      expiresMs: parseRevenueCatDate(subscription?.expires_date),
    }))
    .sort((left, right) => (right.expiresMs || 0) - (left.expiresMs || 0));
  return candidates[0] || null;
}

export function resolveRevenueCatSubscriberPremiumState(subscriber, nowMs = Date.now()) {
  const config = getBillingConfig();
  const entitlementId =
    config.android.premium.entitlementId || config.ios.premium.entitlementId;
  const entitlement = subscriber?.entitlements?.[entitlementId] || null;
  const subscriptionMatch = findPremiumSubscription(subscriber, entitlement);
  const subscription = subscriptionMatch?.subscription || null;
  const entitlementExpiresMs = parseRevenueCatDate(entitlement?.expires_date);
  const subscriptionExpiresMs = subscriptionMatch?.expiresMs ?? null;
  const expiresMs = entitlementExpiresMs ?? subscriptionExpiresMs;
  const hasSubscriberHistory = Boolean(entitlement || subscriptionMatch);
  const active = Boolean(
    hasSubscriberHistory && (expiresMs == null || expiresMs > nowMs)
  );
  const billingIssue = Boolean(subscription?.billing_issues_detected_at);
  const cancelAtPeriodEnd = active && Boolean(subscription?.unsubscribe_detected_at);
  const productId =
    normalizeRevenueCatProductId(entitlement?.product_identifier) ||
    subscriptionMatch?.productId ||
    null;
  const store = normalizeStore(subscription?.store || entitlement?.store) || null;
  const environment = clean(
    subscription?.is_sandbox === true || entitlement?.is_sandbox === true
      ? "SANDBOX"
      : subscription?.environment || entitlement?.environment
  ) || null;
  return {
    entitlement,
    subscription,
    hasSubscriberHistory,
    active,
    expiresMs,
    productId,
    store,
    environment,
    cancelAtPeriodEnd,
    status: !hasSubscriberHistory
      ? "no_purchase"
      : active
        ? billingIssue
          ? "past_due"
          : "active"
        : "expired",
  };
}

export async function syncRevenueCatPremiumFromSubscriber(db, uid, subscriber) {
  const resolved = resolveRevenueCatSubscriberPremiumState(subscriber);
  const userRef = db.collection("Users").doc(uid);
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(userRef);
    const userData = snap.exists ? snap.data() || {} : {};
    const existingSource = userData?.premiumSources?.revenuecat || null;
    const hasLocalHistory = hasRevenueCatPurchaseEvidence(userData);

    // Empty restore/sync for an account that never purchased must not turn the
    // profile into a historical native-store subscriber.
    if (!resolved.hasSubscriberHistory && !hasLocalHistory) {
      return {
        active: false,
        productId: null,
        status: "no_purchase",
        hasPurchaseHistory: false,
        pending: false,
        wrote: false,
      };
    }

    // RevenueCat can be briefly eventually-consistent immediately after a
    // store purchase. Preserve an already-active paid period while verification
    // is pending; an EXPIRATION/CANCELLATION webhook can still revoke it.
    if (!resolved.hasSubscriberHistory && isSourceActive(existingSource)) {
      transaction.set(
        userRef,
        {
          ...buildPremiumSourcePatch(userData, "revenuecat", {
            ...existingSource,
            verificationStatus: "pending",
            lastVerifiedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          }),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return {
        active: true,
        productId: clean(existingSource?.productId) || null,
        status: "verification_pending",
        hasPurchaseHistory: true,
        pending: true,
        wrote: true,
      };
    }

    const expiresAt = Number.isFinite(resolved.expiresMs)
      ? Timestamp.fromMillis(resolved.expiresMs)
      : null;
    const status = resolved.hasSubscriberHistory ? resolved.status : "expired";
    const productId = resolved.productId || clean(existingSource?.productId) || null;
    const active = resolved.hasSubscriberHistory ? resolved.active : false;
    transaction.set(
      userRef,
      {
        ...buildPremiumSourcePatch(userData, "revenuecat", {
          ...(existingSource || {}),
          active,
          status,
          expiresAt: resolved.hasSubscriberHistory
            ? expiresAt
            : existingSource?.expiresAt || null,
          productId,
          store: resolved.store || existingSource?.store || null,
          environment: resolved.environment || existingSource?.environment || null,
          cancelAtPeriodEnd: resolved.cancelAtPeriodEnd,
          willRenew: active ? !resolved.cancelAtPeriodEnd : false,
          verificationStatus: "verified",
          lastVerifiedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }),
        revenueCatSubscriptionStatus: status,
        revenueCatCurrentPeriodEnd: resolved.hasSubscriberHistory
          ? expiresAt
          : userData?.revenueCatCurrentPeriodEnd || null,
        revenueCatProductId: productId,
        revenueCatStore: resolved.store || userData?.revenueCatStore || null,
        revenueCatEnvironment:
          resolved.environment || userData?.revenueCatEnvironment || null,
        revenueCatCancelAtPeriodEnd: resolved.cancelAtPeriodEnd,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return {
      active,
      productId,
      status,
      hasPurchaseHistory: true,
      pending: false,
      wrote: true,
    };
  });
}

const defaultRevenueCatRetryDelay = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function reconcileRevenueCatPremium(
  db,
  uid,
  {
    fetchImpl = fetch,
    maxAttempts = 1,
    retryDelaysMs = [750, 1500, 3000],
    waitImpl = defaultRevenueCatRetryDelay,
  } = {}
) {
  const attemptsLimit = Math.max(1, Math.min(Number(maxAttempts) || 1, 4));
  let result = null;
  for (let attempt = 1; attempt <= attemptsLimit; attempt += 1) {
    const subscriber = await fetchRevenueCatSubscriber(uid, fetchImpl);
    result = await syncRevenueCatPremiumFromSubscriber(db, uid, subscriber);
    if (
      result.active ||
      (result.hasPurchaseHistory && result.status === "expired")
    ) {
      return { ...result, attempts: attempt };
    }
    if (attempt < attemptsLimit) {
      await waitImpl(retryDelaysMs[attempt - 1] || retryDelaysMs.at(-1) || 750);
    }
  }
  return {
    ...(result || {
      active: false,
      productId: null,
      status: "no_purchase",
      hasPurchaseHistory: false,
    }),
    attempts: attemptsLimit,
    pending: true,
  };
}

export async function fetchRevenueCatSubscriber(uid, fetchImpl = fetch) {
  const apiKey = clean(process.env.REVENUECAT_SECRET_API_KEY, 2000);
  if (!apiKey) {
    logRevenueCatVerbose("subscriber_fetch_not_configured", { actor: { uid } });
    throw new Error("RevenueCat API is not configured");
  }
  const response = await fetchImpl(
    `${REVENUECAT_API_BASE}/subscribers/${encodeURIComponent(clean(uid, 128))}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    }
  );
  if (!response.ok) {
    logRevenueCatVerbose("subscriber_fetch_failed", {
      actor: { uid },
      result: { upstreamStatus: response.status },
    });
    const error = new Error(
      response.status === 404
        ? "RevenueCat subscriber not found"
        : "RevenueCat subscriber verification failed"
    );
    error.statusCode = response.status === 404 ? 404 : 502;
    throw error;
  }
  const payload = await response.json();
  return payload?.subscriber || null;
}

function transactionMatches(candidate, transactionId) {
  const expected = clean(transactionId, 500);
  return [
    candidate?.id,
    candidate?.transaction_id,
    candidate?.store_transaction_id,
    candidate?.original_transaction_id,
  ].some((value) => clean(value, 500) === expected);
}

export function findRevenueCatNonSubscriptionPurchase(
  subscriber,
  rawProductId,
  transactionId
) {
  const requestedProductId = normalizeRevenueCatProductId(rawProductId);
  const nonSubscriptions = subscriber?.non_subscriptions || {};
  for (const [storedProductId, purchases] of Object.entries(nonSubscriptions)) {
    if (normalizeRevenueCatProductId(storedProductId) !== requestedProductId) continue;
    const match = Array.isArray(purchases)
      ? purchases.find((candidate) => transactionMatches(candidate, transactionId))
      : null;
    if (match) return { ...match, productId: requestedProductId };
  }
  return null;
}

function storeForPlatform(platform) {
  return platform === "ios" ? "APP_STORE" : platform === "android" ? "PLAY_STORE" : "";
}

export function revenueCatPurchaseMatchesPlatform(purchase, platform) {
  const expectedStore = storeForPlatform(platform);
  if (!expectedStore) return true;
  return normalizeStore(purchase?.store) === expectedStore;
}

function verifiedPurchaseEvent(uid, productId, transactionId, purchase, platform) {
  const digest = crypto
    .createHash("sha256")
    .update(`${uid}:${productId}:${transactionId}`)
    .digest("hex");
  const purchasedMs = Date.parse(purchase?.purchase_date || "");
  return {
    id: `client_sync_${digest}`,
    type: "NON_RENEWING_PURCHASE",
    app_user_id: uid,
    product_id: productId,
    transaction_id: transactionId,
    original_transaction_id:
      clean(purchase?.original_transaction_id, 500) || transactionId,
    store:
      normalizeStore(purchase?.store) ||
      storeForPlatform(platform) ||
      "UNKNOWN_STORE",
    environment: purchase?.is_sandbox === true ? "SANDBOX" : "PRODUCTION",
    purchased_at_ms: Number.isFinite(purchasedMs) ? purchasedMs : Date.now(),
    currency: clean(purchase?.currency),
  };
}

export async function verifyAndSyncRevenueCatOneTimePurchase({
  db,
  uid,
  productId,
  transactionId,
  expectedKind,
  expectedItemId,
  platform,
  fetchImpl = fetch,
}) {
  const normalizedProductId = normalizeRevenueCatProductId(productId);
  const normalizedTransactionId = clean(transactionId, 500);
  if (!normalizedProductId || !normalizedTransactionId) {
    const error = new Error("Missing RevenueCat purchase identifiers");
    error.statusCode = 400;
    throw error;
  }
  const requestedPlatform = platform === "ios" || platform === "android" ? platform : null;
  const mapping = await resolveRevenueCatProduct(
    db,
    normalizedProductId,
    requestedPlatform
  );
  if (!mapping || mapping.kind === "premium" || mapping.kind === "ebook") {
    const error = new Error("RevenueCat product is not mapped as a one-time purchase");
    error.statusCode = 409;
    throw error;
  }
  if (expectedKind && mapping.kind !== expectedKind) {
    const error = new Error("RevenueCat product type does not match the requested purchase");
    error.statusCode = 409;
    throw error;
  }
  if (expectedItemId && mapping.itemId !== expectedItemId) {
    const error = new Error("RevenueCat product does not match the requested item");
    error.statusCode = 409;
    throw error;
  }

  const subscriber = await fetchRevenueCatSubscriber(uid, fetchImpl);
  const purchase = findRevenueCatNonSubscriptionPurchase(
    subscriber,
    normalizedProductId,
    normalizedTransactionId
  );
  if (!purchase) {
    const error = new Error("Purchase is not yet verified by RevenueCat");
    error.statusCode = 409;
    throw error;
  }
  if (!revenueCatPurchaseMatchesPlatform(purchase, requestedPlatform)) {
    const error = new Error("RevenueCat purchase store does not match the requested platform");
    error.statusCode = 409;
    throw error;
  }

  const result = await processRevenueCatEvent(
    db,
    verifiedPurchaseEvent(
      uid,
      normalizedProductId,
      normalizedTransactionId,
      purchase,
      requestedPlatform || mapping.platform
    )
  );
  return { mapping, purchase, result, transactionId: normalizedTransactionId };
}

export async function bindVerifiedAnalysisPurchase({
  db,
  uid,
  analysisId,
  productCode,
  productId,
  transactionId,
  platform,
  fetchImpl = fetch,
}) {
  const normalizedAnalysisId = clean(analysisId, 500);
  const normalizedProductCode = clean(productCode, 100);
  if (!normalizedAnalysisId) {
    const error = new Error("Missing analysis id");
    error.statusCode = 400;
    throw error;
  }

  const verified = await verifyAndSyncRevenueCatOneTimePurchase({
    db,
    uid,
    productId,
    transactionId,
    expectedKind: "analysis",
    platform,
    fetchImpl,
  });
  if (verified.mapping.productCode !== normalizedProductCode) {
    const error = new Error("Analysis product mapping mismatch");
    error.statusCode = 409;
    throw error;
  }

  const entitlementRef = db
    .collection("purchaseEntitlements")
    .doc(`revenuecat_${safeDocId(verified.transactionId)}`);
  const bindingId = crypto
    .createHash("sha256")
    .update(`${uid}:${normalizedAnalysisId}`)
    .digest("hex");
  const bindingRef = db.collection("analysisPurchaseBindings").doc(bindingId);

  await db.runTransaction(async (transaction) => {
    const [snap, bindingSnap] = await Promise.all([
      transaction.get(entitlementRef),
      transaction.get(bindingRef),
    ]);
    const current = snap.exists ? snap.data() || {} : {};
    if (current.ownerUid && current.ownerUid !== uid) {
      const error = new Error("Purchase belongs to another user");
      error.statusCode = 403;
      throw error;
    }
    const boundAnalysisId = clean(current?.analysis?.analysisId, 500);
    if (boundAnalysisId && boundAnalysisId !== normalizedAnalysisId) {
      const error = new Error("Purchase is already bound to another analysis");
      error.statusCode = 409;
      throw error;
    }
    if (
      bindingSnap.exists &&
      clean(bindingSnap.data()?.transactionId, 500) !== verified.transactionId
    ) {
      const error = new Error("Analysis already has a different purchase entitlement");
      error.statusCode = 409;
      throw error;
    }
    transaction.set(
      entitlementRef,
      {
        ownerUid: uid,
        status: "succeeded",
        productCode: verified.mapping.productCode,
        productId: verified.mapping.productId,
        transactionId: verified.transactionId,
        analysis: {
          analysisId: normalizedAnalysisId,
          analysisType: verified.mapping.analysisType,
        },
        source: { lastWriter: "revenuecat_authenticated_confirmation" },
        confirmedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    transaction.set(
      bindingRef,
      {
        uid,
        analysisId: normalizedAnalysisId,
        transactionId: verified.transactionId,
        productCode: verified.mapping.productCode,
        provider: "revenuecat",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  return {
    confirmed: true,
    isPaid: true,
    analysisId: normalizedAnalysisId,
    transactionId: verified.transactionId,
    pdfDelivered: false,
  };
}
