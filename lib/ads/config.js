export const ADSENSE_ROUTE_PATTERNS = Object.freeze([
  /^\/main-dashboard(?:\/|$)/,
  /^\/videouri(?:\/|$)/,
  /^\/news\/[^/]+\/?$/,
]);

export const ADSTERRA_ROUTE_PATTERNS = Object.freeze([
  /^\/$/,
  /^\/about(?:\/|$)/,
  /^\/news\/?$/,
  /^\/citire-personalizata(?:\/|$)/,
  /^\/citire-viitor(?:\/|$)/,
  /^\/numar-norocos(?:\/|$)/,
  /^\/culoare-norocoasa(?:\/|$)/,
  /^\/ora-norocoasa(?:\/|$)/,
  /^\/citat-motivational(?:\/|$)/,
  /^\/ce-gandeste(?:\/|$)/,
  /^\/ce-simte(?:\/|$)/,
  /^\/cartea-ta(?:\/|$)/,
]);

/**
 * Three distinct Adsterra Native Banner keys per page (banner1 top, banner2 mid, banner3 low).
 * Legacy ids (home, article, …) map to the same env vars.
 */
export const ADSTERRA_PLACEMENT_ENV_KEYS = Object.freeze({
  banner1: "NEXT_PUBLIC_ADSTERRA_KEY_BANNER_1",
  banner2: "NEXT_PUBLIC_ADSTERRA_KEY_BANNER_2",
  banner3: "NEXT_PUBLIC_ADSTERRA_KEY_BANNER_3",
  home: "NEXT_PUBLIC_ADSTERRA_KEY_BANNER_1",
  article: "NEXT_PUBLIC_ADSTERRA_KEY_BANNER_2",
  default: "NEXT_PUBLIC_ADSTERRA_KEY_BANNER_3",
  video: "NEXT_PUBLIC_ADSTERRA_KEY_BANNER_2",
  reading: "NEXT_PUBLIC_ADSTERRA_KEY_BANNER_1",
});

const BANNER_FALLBACK_CHAINS = Object.freeze({
  banner1: [
    "NEXT_PUBLIC_ADSTERRA_KEY_BANNER_1",
    "NEXT_PUBLIC_ADSTERRA_KEY_HOME",
    "NEXT_PUBLIC_ADSTERRA_KEY_DEFAULT",
  ],
  banner2: [
    "NEXT_PUBLIC_ADSTERRA_KEY_BANNER_2",
    "NEXT_PUBLIC_ADSTERRA_KEY_ARTICLE",
    "NEXT_PUBLIC_ADSTERRA_KEY_VIDEO",
    "NEXT_PUBLIC_ADSTERRA_KEY_DEFAULT",
  ],
  banner3: [
    "NEXT_PUBLIC_ADSTERRA_KEY_BANNER_3",
    "NEXT_PUBLIC_ADSTERRA_KEY_DEFAULT",
  ],
});

function normalizePath(pathname) {
  if (!pathname || typeof pathname !== "string") return "/";
  const trimmed = pathname.split("?")[0].split("#")[0];
  return trimmed || "/";
}

export function isAdsenseRouteEligible(pathname) {
  const normalized = normalizePath(pathname);
  return ADSENSE_ROUTE_PATTERNS.some((pattern) => pattern.test(normalized));
}

// Keep AdSense enabled by default for backwards compatibility. Setting this
// public build-time flag to "false" removes both its script and ad containers.
export function isAdsenseEnabled() {
  return process.env.NEXT_PUBLIC_ENABLE_ADSENSE !== "false";
}

export function isAdsterraRouteEligible(pathname) {
  const normalized = normalizePath(pathname);
  return ADSTERRA_ROUTE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isAdsterraEnabled() {
  return process.env.NEXT_PUBLIC_ENABLE_ADSTERRA === "true";
}

export function getAdsterraScriptHost() {
  const raw = process.env.NEXT_PUBLIC_ADSTERRA_SCRIPT_HOST || "";
  return raw.trim().replace(/\/$/, "");
}

function resolvePlacementSlot(placementId) {
  if (placementId === "native") return "native";
  if (placementId === "banner1" || placementId === "home" || placementId === "reading") {
    return "banner1";
  }
  if (placementId === "banner2" || placementId === "article" || placementId === "video") {
    return "banner2";
  }
  if (placementId === "banner3" || placementId === "default") {
    return "banner3";
  }
  return "banner1";
}

function firstEnvKey(...keys) {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return "";
}

export function getAdsterraPlacementKey(placementId = "banner1") {
  return getAdsterraPlacementConfig(placementId).key;
}

const SLOT_ENV_PREFIX = Object.freeze({
  banner1: "NEXT_PUBLIC_ADSTERRA_BANNER_1",
  banner2: "NEXT_PUBLIC_ADSTERRA_BANNER_2",
  banner3: "NEXT_PUBLIC_ADSTERRA_BANNER_3",
});

const DEFAULT_IFRAME_DIMENSIONS = Object.freeze({
  banner1: { width: 300, height: 250 },
  banner2: { width: 468, height: 60 },
  banner3: { width: 728, height: 90 },
});

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * @returns {{
 *   slot: string,
 *   format: 'native' | 'iframe',
 *   host: string,
 *   key: string,
 *   width: number,
 *   height: number,
 * }}
 */
export function getAdsterraPlacementConfig(placementId = "banner1") {
  const slot = resolvePlacementSlot(placementId);
  if (slot === "native") {
    return { ...getAdsterraNativePlacementConfig(), width: 0, height: 0 };
  }

  const chain = BANNER_FALLBACK_CHAINS[slot] || BANNER_FALLBACK_CHAINS.banner1;
  let key = firstEnvKey(...chain);

  if (!key) {
    const directKey = ADSTERRA_PLACEMENT_ENV_KEYS[placementId];
    if (directKey) key = process.env[directKey]?.trim() || "";
  }
  if (!key) key = process.env.NEXT_PUBLIC_ADSTERRA_KEY_DEFAULT?.trim() || "";

  const prefix = SLOT_ENV_PREFIX[slot];
  const formatRaw = process.env[`${prefix}_FORMAT`]?.trim().toLowerCase();
  const slotHost = process.env[`${prefix}_HOST`]?.trim() || "";
  const defaultHost = getAdsterraScriptHost();

  let format = formatRaw === "iframe" || formatRaw === "banner" ? "iframe" : "native";
  if (!formatRaw && slotHost.includes("highperformanceformat")) {
    format = "iframe";
  }
  if (!formatRaw && !slotHost && defaultHost.includes("highperformanceformat")) {
    format = "iframe";
  }

  const host = slotHost || defaultHost;
  const defaults = DEFAULT_IFRAME_DIMENSIONS[slot] || DEFAULT_IFRAME_DIMENSIONS.banner1;
  const width = parsePositiveInt(process.env[`${prefix}_WIDTH`], defaults.width);
  const height = parsePositiveInt(process.env[`${prefix}_HEIGHT`], defaults.height);

  return { slot, format, host, key, width, height };
}

/** Native Banner unit (container-*), separate from standard iframe banners. */
export function getAdsterraNativePlacementConfig() {
  const key =
    process.env.NEXT_PUBLIC_ADSTERRA_KEY_NATIVE?.trim() ||
    process.env.NEXT_PUBLIC_ADSTERRA_KEY_DEFAULT?.trim() ||
    "";
  const host =
    process.env.NEXT_PUBLIC_ADSTERRA_NATIVE_HOST?.trim() ||
    getAdsterraScriptHost();
  return { format: "native", host, key, width: 0, height: 0, slot: "native" };
}

export function isAdsConsentRequired() {
  return process.env.NEXT_PUBLIC_ADS_CONSENT_REQUIRED === "true";
}
