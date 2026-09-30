import { getAdminDb } from "./firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import {
  recordFirestoreCacheHit,
  withFirestoreCostLog,
} from "./firestoreCostLogger";
import {
  STRIPE_FIXED_VAT_PERCENTAGE,
  normalizeVatPercentage,
} from "./stripeFixedVatCore";

const SETTINGS_COLLECTION = "settings";
const GLOBAL_DOC_ID = "global";

const DEFAULT_SETTINGS = {
  astroLocationProvider: "geonames",
  // Legacy clients still interpret false as "premium is free on iOS". Keep
  // this permanently true and use the iOS billing rollout fields below.
  iosPremiumSubscriptionsEnabled: true,
  subscriptionSystemEnabled: true,
  iosBillingPremiumProvider: "disabled",
  iosBillingAnalysesProvider: "disabled",
  androidBillingPremiumProvider: "revenuecat",
  androidBillingCoursesProvider: "stripe",
  androidBillingAnalysesProvider: "stripe",
  // Missing Firestore value means hidden, so a new iOS build stays review-safe.
  iosCoursesHidden: true,
  vatPercentage: STRIPE_FIXED_VAT_PERCENTAGE,
};

export function normalizeIosCoursesHidden(value) {
  return value !== false;
}

function normalizeAndroidBillingProvider(value) {
  return value === "revenuecat" ? "revenuecat" : "stripe";
}

function normalizeIosBillingProvider(value) {
  return value === "revenuecat" ? "revenuecat" : "disabled";
}

/** Override via GLOBAL_SETTINGS_CACHE_TTL_MS (default 5 minutes). */
const DEFAULT_SETTINGS_TTL_MS = 5 * 60 * 1000;
const parsedSettingsTtlMs = Number.parseInt(
  process.env.GLOBAL_SETTINGS_CACHE_TTL_MS || "",
  10
);
const GLOBAL_SETTINGS_CACHE_TTL_MS =
  Number.isFinite(parsedSettingsTtlMs) && parsedSettingsTtlMs > 0
    ? parsedSettingsTtlMs
    : DEFAULT_SETTINGS_TTL_MS;

let settingsCache = {
  value: null,
  expiresAt: 0,
  promise: null,
};

function clearGlobalSettingsCache() {
  settingsCache = { value: null, expiresAt: 0, promise: null };
}

async function fetchGlobalSettings() {
  const db = getAdminDb();
  const docRef = db.collection(SETTINGS_COLLECTION).doc(GLOBAL_DOC_ID);
  const docSnap = await withFirestoreCostLog(
    {
      page: "api.global-settings",
      queryName: "settings.global",
      operationType: "document",
    },
    () => docRef.get()
  );

  if (!docSnap.exists) {
    return { ...DEFAULT_SETTINGS };
  }

  const data = docSnap.data() || {};
  return {
    astroLocationProvider: data.astroLocationProvider === "google" ? "google" : "geonames",
    iosPremiumSubscriptionsEnabled: true,
    subscriptionSystemEnabled: true,
    iosBillingPremiumProvider: normalizeIosBillingProvider(
      data.iosBillingPremiumProvider
    ),
    iosBillingAnalysesProvider: normalizeIosBillingProvider(
      data.iosBillingAnalysesProvider
    ),
    // Premium Android is live in Play and must never be remotely routed to Stripe.
    androidBillingPremiumProvider: "revenuecat",
    androidBillingCoursesProvider: "stripe",
    androidBillingAnalysesProvider: normalizeAndroidBillingProvider(
      data.androidBillingAnalysesProvider
    ),
    iosCoursesHidden: normalizeIosCoursesHidden(data.iosCoursesHidden),
    vatPercentage:
      normalizeVatPercentage(data.vatPercentage) ?? DEFAULT_SETTINGS.vatPercentage,
    updatedAt: data.updatedAt?.toDate?.() || null,
    updatedBy: data.updatedBy || null,
  };
}

/**
 * Get global settings from Firestore.
 * Returns default values merged with stored values.
 *
 * Backed by a short-lived in-memory cache so the rarely-changing global flag
 * is not re-read from Firestore on every premium request. The returned object
 * shape is identical to a direct read.
 * @returns {Promise<{ iosPremiumSubscriptionsEnabled: boolean, subscriptionSystemEnabled: boolean, iosBillingPremiumProvider: string, iosBillingAnalysesProvider: string, androidBillingPremiumProvider: string, androidBillingCoursesProvider: string, androidBillingAnalysesProvider: string, iosCoursesHidden: boolean, updatedAt?: Date, updatedBy?: string }>}
 */
export async function getGlobalSettings() {
  const now = Date.now();
  if (settingsCache.value && settingsCache.expiresAt > now) {
    recordFirestoreCacheHit({
      page: "api.global-settings",
      queryName: "settings.global",
    });
    return settingsCache.value;
  }

  if (!settingsCache.promise) {
    settingsCache.promise = fetchGlobalSettings()
      .then((value) => {
        settingsCache = {
          value,
          expiresAt: Date.now() + GLOBAL_SETTINGS_CACHE_TTL_MS,
          promise: null,
        };
        return value;
      })
      .catch((error) => {
        settingsCache.promise = null;
        throw error;
      });
  }

  return settingsCache.promise;
}

/**
 * Check if subscription system is enabled.
 * Optimized single-field read for use in API routes.
 * @returns {Promise<boolean>}
 */
export async function isSubscriptionSystemEnabled() {
  return true;
}

/** Whether premium video subscriptions are enabled in the iOS app. */
export async function isIosPremiumSubscriptionsEnabled() {
  return true;
}

/**
 * VAT rate used for every price shown to customers on web and mobile.
 * Falls back to the built-in rate when settings are unreachable.
 * @returns {Promise<number>}
 */
export async function getVatPercentage() {
  try {
    const settings = await getGlobalSettings();
    return (
      normalizeVatPercentage(settings?.vatPercentage) ?? DEFAULT_SETTINGS.vatPercentage
    );
  } catch {
    return DEFAULT_SETTINGS.vatPercentage;
  }
}

/**
 * Update global settings.
 * @param {{ iosPremiumSubscriptionsEnabled?: boolean, subscriptionSystemEnabled?: boolean, iosBillingPremiumProvider?: string, iosBillingAnalysesProvider?: string, androidBillingAnalysesProvider?: string, iosCoursesHidden?: boolean, vatPercentage?: number|string }} updates
 * @param {string} [updatedBy="dashboard"]
 * @returns {Promise<{ ok: boolean }>}
 */
export async function updateGlobalSettings(updates, updatedBy = "dashboard") {
  const db = getAdminDb();
  const docRef = db.collection(SETTINGS_COLLECTION).doc(GLOBAL_DOC_ID);

  const payload = {
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy,
  };
  if (["google", "geonames"].includes(updates.astroLocationProvider)) {
    payload.astroLocationProvider = updates.astroLocationProvider;
  }

  // Persist the legacy fields as enabled so old app versions can never unlock
  // premium content merely because native billing is unavailable.
  if (
    typeof updates.subscriptionSystemEnabled === "boolean" ||
    typeof updates.iosPremiumSubscriptionsEnabled === "boolean"
  ) {
    payload.iosPremiumSubscriptionsEnabled = true;
    payload.subscriptionSystemEnabled = true;
  }
  ["iosBillingPremiumProvider", "iosBillingAnalysesProvider"].forEach((key) => {
    if (updates[key] === "disabled" || updates[key] === "revenuecat") {
      payload[key] = updates[key];
    }
  });
  [
    "androidBillingAnalysesProvider",
  ].forEach((key) => {
    if (updates[key] === "stripe" || updates[key] === "revenuecat") {
      payload[key] = updates[key];
    }
  });
  if (typeof updates.iosCoursesHidden === "boolean") {
    payload.iosCoursesHidden = updates.iosCoursesHidden;
  }
  if (updates.vatPercentage !== undefined) {
    const vatPercentage = normalizeVatPercentage(updates.vatPercentage);
    if (vatPercentage === null) throw new Error("invalid_vat_percentage");
    payload.vatPercentage = vatPercentage;
  }

  await docRef.set(payload, { merge: true });

  clearGlobalSettingsCache();

  return { ok: true };
}
