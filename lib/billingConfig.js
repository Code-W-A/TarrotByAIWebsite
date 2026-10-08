const truthy = new Set(["1", "true", "yes", "on"]);

export const NATIVE_BILLING_PLATFORMS = Object.freeze(["android", "ios"]);

export const ANALYSIS_PRODUCT_KEYS = Object.freeze([
  "personal",
  "astrogramaOthers",
  "sinastrieOnePerson",
  "sinastrieOthers",
]);

const ANALYSIS_PUBLIC_KEYS = Object.freeze({
  personal: "astrogama_natala",
  astrogramaOthers: "astrogama_natala_other_person",
  sinastrieOnePerson: "sinastrie_relatie",
  sinastrieOthers: "sinastrie_relatie_others",
});

const ANALYSIS_ENV_SUFFIXES = Object.freeze({
  personal: "PERSONAL",
  astrogramaOthers: "ASTROGRAMA_OTHERS",
  sinastrieOnePerson: "SINASTRIE_ONE_PERSON",
  sinastrieOthers: "SINASTRIE_OTHERS",
});

function envFlag(name) {
  return truthy.has(String(process.env[name] || "").trim().toLowerCase());
}

function safeProvider(value, enabled) {
  const provider = String(value || "").trim().toLowerCase();
  if (!enabled) return "stripe";
  return provider === "revenuecat" ? "revenuecat" : "stripe";
}

function safeProductId(value) {
  return typeof value === "string" ? value.trim().slice(0, 255) : "";
}

function parseProductMap(name) {
  const raw = process.env[name];
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([productId, itemId]) => [safeProductId(productId), safeProductId(itemId)])
        .filter(([productId, itemId]) => productId && itemId)
    );
  } catch {
    return {};
  }
}

function analysisEnvName(platform, key) {
  const suffix = ANALYSIS_ENV_SUFFIXES[key];
  return platform === "ios"
    ? `REVENUECAT_IOS_ANALYSIS_PRODUCT_${suffix}`
    : `REVENUECAT_ANALYSIS_PRODUCT_${suffix}`;
}

export function getAnalysisProductMap(platform = "android") {
  const normalizedPlatform = platform === "ios" ? "ios" : "android";
  return Object.fromEntries(
    ANALYSIS_PRODUCT_KEYS.map((key) => [
      safeProductId(process.env[analysisEnvName(normalizedPlatform, key)]),
      key,
    ]).filter(([productId]) => productId)
  );
}

export function getStaticCourseProductMap() {
  return parseProductMap("REVENUECAT_COURSE_PRODUCT_MAP");
}

export function getStaticBundleProductMap() {
  return parseProductMap("REVENUECAT_BUNDLE_PRODUCT_MAP");
}

function analysisProductIds(platform) {
  const map = getAnalysisProductMap(platform);
  return Object.fromEntries(
    ANALYSIS_PRODUCT_KEYS.map((key) => [
      key,
      Object.entries(map).find(
        ([productId, mappedKey]) => productId && mappedKey === key
      )?.[0] || null,
    ])
  );
}

export function getBillingConfig() {
  const androidPremiumEnabled = envFlag("ANDROID_BILLING_PREMIUM_ENABLED");
  const androidAnalysesEnabled = envFlag("ANDROID_BILLING_ANALYSES_ENABLED");
  const iosPremiumEnabled = envFlag("IOS_BILLING_PREMIUM_ENABLED");
  const iosAnalysesEnabled = envFlag("IOS_BILLING_ANALYSES_ENABLED");
  const entitlementId =
    safeProductId(process.env.REVENUECAT_PREMIUM_ENTITLEMENT_ID) || "premium";

  return {
    android: {
      premium: {
        enabled: androidPremiumEnabled,
        provider: "revenuecat",
        productId: safeProductId(process.env.REVENUECAT_PREMIUM_PRODUCT_ID) || null,
        entitlementId,
      },
      courses: { enabled: false, provider: "stripe" },
      ebooks: { enabled: envFlag("ANDROID_BILLING_EBOOKS_ENABLED"), provider: "revenuecat" },
      analyses: {
        enabled: androidAnalysesEnabled,
        provider: safeProvider(
          process.env.ANDROID_BILLING_ANALYSES_PROVIDER,
          androidAnalysesEnabled
        ),
        productIds: analysisProductIds("android"),
      },
    },
    ios: {
      premium: {
        enabled: iosPremiumEnabled,
        provider: "revenuecat",
        productId:
          safeProductId(process.env.REVENUECAT_IOS_PREMIUM_PRODUCT_ID) || null,
        entitlementId,
      },
      courses: { enabled: false, provider: "stripe" },
      ebooks: { enabled: envFlag("IOS_BILLING_EBOOKS_ENABLED"), provider: "revenuecat" },
      analyses: {
        enabled: iosAnalysesEnabled,
        provider: "revenuecat",
        productIds: analysisProductIds("ios"),
      },
    },
  };
}

function publicProductIds(platformConfig) {
  return Object.fromEntries(
    Object.entries(ANALYSIS_PUBLIC_KEYS)
      .map(([internalKey, productCode]) => [
        productCode,
        platformConfig.analyses.productIds[internalKey] || null,
      ])
      .filter(([, productId]) => Boolean(productId))
  );
}

function publicPlatformConfig(platform, config, settings) {
  const row = config[platform];
  const exposedAnalysisProductIds = publicProductIds(row);
  const isIos = platform === "ios";
  const premiumRollout = isIos
    ? settings?.iosBillingPremiumProvider === "revenuecat"
    : true;
  const analysesRollout = isIos
    ? settings?.iosBillingAnalysesProvider === "revenuecat"
    : settings?.androidBillingAnalysesProvider === "revenuecat";

  return {
    providers: {
      premium: "revenuecat",
      courses: "stripe",
      ebooks: "revenuecat",
      analyses: isIos
        ? "revenuecat"
        : row.analyses.provider === "revenuecat" && analysesRollout
          ? "revenuecat"
          : "stripe",
    },
    availability: {
      premium: Boolean(row.premium.enabled && premiumRollout && row.premium.productId),
      courses: true,
      ebooks: row.ebooks.enabled,
      analyses: Boolean(
        row.analyses.enabled &&
          analysesRollout &&
          ANALYSIS_PRODUCT_KEYS.every((key) => row.analyses.productIds[key])
      ),
    },
    revenueCat: {
      premiumProductId: row.premium.productId,
      analysisProductIds: exposedAnalysisProductIds,
    },
  };
}

/**
 * Client-safe native billing routing. The legacy top-level fields remain an
 * Android alias for already-released clients; new clients use `platforms`.
 */
export function getPublicBillingConfig(settings = {}) {
  const config = getBillingConfig();
  const android = publicPlatformConfig("android", config, settings);
  const ios = publicPlatformConfig("ios", config, settings);
  return {
    providers: android.providers,
    revenueCat: android.revenueCat,
    platforms: { android, ios },
  };
}

export function isRevenueCatFlowEnabled(flow, platform) {
  const config = getBillingConfig();
  if (platform === "android" || platform === "ios") {
    const row = config[platform]?.[flow];
    return row?.enabled === true && row?.provider === "revenuecat";
  }
  return NATIVE_BILLING_PLATFORMS.some((candidate) => {
    const row = config[candidate]?.[flow];
    return row?.enabled === true && row?.provider === "revenuecat";
  });
}

export function platformFromRevenueCatStore(store) {
  const normalized = String(store || "").trim().toUpperCase();
  if (normalized === "APP_STORE" || normalized === "MAC_APP_STORE") return "ios";
  if (normalized === "PLAY_STORE") return "android";
  return null;
}

export function normalizeRevenueCatProductId(value) {
  const raw = safeProductId(value);
  return raw.includes(":") ? raw.split(":")[0] : raw;
}
