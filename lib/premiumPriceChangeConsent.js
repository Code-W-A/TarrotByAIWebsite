/**
 * Opt-in consent for Premium 5 EUR → 5 EUR + VAT (RO: 6.05 EUR).
 * Address completion alone is NOT acceptance.
 * Policy: accept 6.05 or cancel at period end — no long-term stay at 5 EUR.
 */

import { getFixedVatTaxRateId } from "./stripeFixedVat";

export const PREMIUM_PRICE_CHANGE_CONSENT_VERSION = "v1_6_05";
export const PREMIUM_PRICE_CHANGE_EMAIL_NOTICE_VERSION = "v1_6_05_accept_or_cancel";
export const PREMIUM_PRICE_CHANGE_SITE_NOTICE_VERSION = "v1_6_05_site";
export const PREMIUM_PRICE_CHANGE_OLD_TOTAL_CENTS = 500;
export const PREMIUM_PRICE_CHANGE_NEW_TOTAL_CENTS = 605;
export const PREMIUM_TAX_MIGRATION_METADATA = "exclusive_v1";
export const PREMIUM_PRICE_CHANGE_CANCEL_REASON = "unaccepted_v1_6_05";
export const PREMIUM_ACCEPT_PRICE_PATH = "/premium/accept-price";
export const PREMIUM_ACCEPT_PAGE_URL = "https://www.cristinazurba.com/premium/accept-price";

export const PREMIUM_PRICE_CHANGE_CONSENT_TEXT_RO =
  "Sunt de acord ca, începând cu următoarea reînnoire, abonamentul meu Premium să fie facturat la prețul de 5 EUR + TVA aplicabil (pentru România: 6,05 EUR/lună, TVA inclus). Înțeleg că fără această confirmare abonamentul se oprește la finalul perioadei deja plătite.";

export const PREMIUM_PRICE_CHANGE_SITE_NOTICE_HEADLINE_RO =
  "Abonamentul Premium a fost trecut la 5 EUR + TVA";

export const PREMIUM_PRICE_CHANGE_SITE_NOTICE_BODY_RO =
  "Pentru România: 6,05 EUR/lună (TVA inclus), de la următoarea reînnoire. Dacă nu doriți să continuați la noul preț, opriți abonamentul — rămâneți cu accesul până la finalul perioadei deja plătite.";

const SITE_NOTICE_ACTIVE_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "cancel_at_period_end",
]);

export const PRICE_CHANGE_SEGMENTS = {
  A_NEMIGRAT: "A_nemigrat",
  B_MIGRAT_NEFACTURAT: "B_migrat_nefacturat_605",
  C_DEJA_605: "C_deja_605",
  OTHER: "other",
};

const RENEWING_STATUSES = new Set(["active", "trialing", "past_due"]);

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function hasValidPriceChangeConsent(
  userData,
  version = PREMIUM_PRICE_CHANGE_CONSENT_VERSION
) {
  const consent = userData?.premiumPriceChangeConsent;
  if (!consent || typeof consent !== "object") return false;
  if (clean(consent.version) !== version) return false;
  if (clean(consent.status) !== "accepted") return false;
  return Boolean(consent.acceptedAt);
}

export function hasAcknowledgedPriceChangeSiteNotice(
  userData,
  version = PREMIUM_PRICE_CHANGE_SITE_NOTICE_VERSION
) {
  const notice = userData?.premiumPriceChangeNotice;
  if (!notice || typeof notice !== "object") return false;
  if (clean(notice.version) !== version) return false;
  return Boolean(notice.acknowledgedAt);
}

/**
 * Whether the site banner should show for this user profile.
 * Auth / route / address-gate checks stay in the UI component.
 */
export function shouldShowPremiumPriceChangeSiteNotice(userData) {
  if (!userData || typeof userData !== "object") return false;
  if (userData.premiumTaxAddressGate?.required === true) return false;
  if (hasAcknowledgedPriceChangeSiteNotice(userData)) return false;

  const subscriptionId = clean(userData.stripeSubscriptionId);
  if (!subscriptionId) return false;

  const status = clean(userData.subscriptionStatus).toLowerCase();
  const premiumActive = userData.premium === true || userData.premiumActive === true;
  if (status) {
    if (!SITE_NOTICE_ACTIVE_STATUSES.has(status)) return false;
  } else if (!premiumActive) {
    return false;
  }

  const consent = userData.premiumPriceChangeConsent;
  const hasConsentRecord = Boolean(consent && typeof consent === "object");
  const migrationCompleted = userData.premiumTaxAddressGate?.migrationCompleted === true;
  const cancelScheduled = status === "cancel_at_period_end";

  return hasConsentRecord || migrationCompleted || cancelScheduled;
}

export function buildPriceChangeSiteNoticeRecord({
  source = "site_banner",
  version = PREMIUM_PRICE_CHANGE_SITE_NOTICE_VERSION,
  serverTimestamp,
}) {
  return {
    version,
    acknowledgedAt: serverTimestamp || new Date().toISOString(),
    source: clean(source) || "site_banner",
  };
}

export function buildConsentRecord({
  subscriptionId,
  oldPriceId,
  newPriceId,
  renewalAtIso,
  billingCountry,
  uid,
  consentText = PREMIUM_PRICE_CHANGE_CONSENT_TEXT_RO,
  version = PREMIUM_PRICE_CHANGE_CONSENT_VERSION,
  serverTimestamp,
}) {
  return {
    version,
    status: "accepted",
    consentText,
    oldTotalCents: PREMIUM_PRICE_CHANGE_OLD_TOTAL_CENTS,
    newTotalCents: PREMIUM_PRICE_CHANGE_NEW_TOTAL_CENTS,
    oldPriceId: clean(oldPriceId) || null,
    newPriceId: clean(newPriceId) || null,
    subscriptionId: clean(subscriptionId) || null,
    renewalAt: clean(renewalAtIso) || null,
    billingCountry: clean(billingCountry).toUpperCase() || null,
    uid: clean(uid) || null,
    acceptedAt: serverTimestamp || new Date().toISOString(),
    noticeVersion: version,
  };
}

/**
 * Classify a renewing premium subscription for price-change outreach.
 * @param {{ priceId?: string, taxMigration?: string, latestAmountPaid?: number|null, exclusivePriceId?: string, legacyPriceIds?: string[] }} input
 */
export function classifyPriceChangeSegment(input = {}) {
  const priceId = clean(input.priceId);
  const taxMigration = clean(input.taxMigration);
  const exclusivePriceId = clean(input.exclusivePriceId);
  const legacyPriceIds = Array.isArray(input.legacyPriceIds)
    ? input.legacyPriceIds.map(clean).filter(Boolean)
    : [];
  const latestAmountPaid =
    input.latestAmountPaid == null ? null : Number(input.latestAmountPaid);

  if (latestAmountPaid === PREMIUM_PRICE_CHANGE_NEW_TOTAL_CENTS) {
    return PRICE_CHANGE_SEGMENTS.C_DEJA_605;
  }

  // Prefer the live Price ID over stale metadata left after rollback.
  if (legacyPriceIds.includes(priceId)) {
    return PRICE_CHANGE_SEGMENTS.A_NEMIGRAT;
  }

  const onExclusive =
    (Boolean(exclusivePriceId) && priceId === exclusivePriceId) ||
    (!legacyPriceIds.includes(priceId) && taxMigration === PREMIUM_TAX_MIGRATION_METADATA);

  if (onExclusive) {
    return PRICE_CHANGE_SEGMENTS.B_MIGRAT_NEFACTURAT;
  }

  return PRICE_CHANGE_SEGMENTS.OTHER;
}

export function subscriptionPrimaryPriceId(subscription) {
  return clean(subscription?.items?.data?.[0]?.price?.id);
}

export function subscriptionTaxMigrationMeta(subscription) {
  return clean(subscription?.metadata?.taxMigration);
}

export function findLegacySubscriptionItem(subscription, legacyPriceIds) {
  const allow = new Set((legacyPriceIds || []).map(clean).filter(Boolean));
  const items = subscription?.items?.data || [];
  return items.find((item) => allow.has(clean(item?.price?.id))) || null;
}

export function findExclusiveSubscriptionItem(subscription, exclusivePriceId) {
  const want = clean(exclusivePriceId);
  if (!want) return null;
  const items = subscription?.items?.data || [];
  return items.find((item) => clean(item?.price?.id) === want) || null;
}

/**
 * Move subscription item to exclusive (VAT-exclusive) price. No immediate proration charge.
 */
export async function migrateSubscriptionToExclusivePrice(
  stripe,
  { subscription, item, destinationPriceId, uid }
) {
  const subId = clean(subscription?.id);
  const itemId = clean(item?.id);
  const priceId = clean(destinationPriceId);
  if (!subId || !itemId || !priceId) {
    throw new Error("migrateSubscriptionToExclusivePrice_missing_args");
  }
  const fixedVatTaxRateId = await getFixedVatTaxRateId(stripe);
  return stripe.subscriptions.update(
    subId,
    {
      automatic_tax: { enabled: false },
      default_tax_rates: [fixedVatTaxRateId],
      billing_cycle_anchor: "unchanged",
      proration_behavior: "none",
      items: [{ id: itemId, price: priceId, quantity: 1 }],
      metadata: {
        ...(subscription.metadata || {}),
        flow: "site_premium",
        uid: clean(uid) || clean(subscription?.metadata?.uid),
        taxMigration: PREMIUM_TAX_MIGRATION_METADATA,
        priceChangeConsentVersion: PREMIUM_PRICE_CHANGE_CONSENT_VERSION,
      },
    },
    {
      idempotencyKey: `premium-tax-exclusive-consent-v1-${subId}-${priceId}`,
    }
  );
}

/**
 * Roll exclusive (unaccepted) subscription back to legacy inclusive price. No immediate charge.
 */
export async function rollbackSubscriptionToLegacyPrice(
  stripe,
  { subscription, item, legacyPriceId, uid }
) {
  const subId = clean(subscription?.id);
  const itemId = clean(item?.id);
  const priceId = clean(legacyPriceId);
  if (!subId || !itemId || !priceId) {
    throw new Error("rollbackSubscriptionToLegacyPrice_missing_args");
  }
  const nextMeta = { ...(subscription.metadata || {}) };
  // Stripe clears metadata keys only when set to empty string.
  nextMeta.taxMigration = "";
  nextMeta.priceChangeConsentVersion = "";
  if (clean(uid)) nextMeta.uid = clean(uid);
  nextMeta.flow = nextMeta.flow || "site_premium";
  nextMeta.taxMigrationRollback = "unaccepted_exclusive_v1";

  return stripe.subscriptions.update(
    subId,
    {
      automatic_tax: { enabled: false },
      billing_cycle_anchor: "unchanged",
      proration_behavior: "none",
      items: [{ id: itemId, price: priceId, quantity: 1 }],
      metadata: nextMeta,
    },
    {
      idempotencyKey: `premium-tax-rollback-unaccepted-v1-${subId}-${priceId}`,
    }
  );
}

export function resolveExclusivePriceIdFromEnv(env = process.env) {
  const dev = env.NODE_ENV === "development";
  const exclusive = clean(
    env[dev ? "STRIPE_PREMIUM_PRICE_ID_EXCLUSIVE_TEST" : "STRIPE_PREMIUM_PRICE_ID_EXCLUSIVE"]
  );
  if (exclusive) return exclusive;
  return clean(env.STRIPE_PREMIUM_PRICE_ID_EXCLUSIVE);
}

export function parseLegacyPriceIdsFromEnv(env = process.env) {
  return [
    ...new Set(
      clean(env.STRIPE_PREMIUM_LEGACY_PRICE_IDS)
        .split(",")
        .map(clean)
        .filter(Boolean)
    ),
  ];
}

/**
 * Schedule cancel_at_period_end when user has not accepted price change (segments A or C).
 */
export function isEligibleForScheduleCancelUnaccepted(input = {}) {
  const status = clean(input.status);
  const segment = clean(input.segment);
  const hasConsent = Boolean(input.hasConsent);
  const cancelAtPeriodEnd = Boolean(input.cancelAtPeriodEnd);

  if (!RENEWING_STATUSES.has(status)) {
    return { ok: false, reason: `status_${status || "unknown"}` };
  }
  if (cancelAtPeriodEnd) {
    return { ok: false, reason: "already_cancel_at_period_end" };
  }
  if (hasConsent) {
    return { ok: false, reason: "has_consent" };
  }
  if (
    segment !== PRICE_CHANGE_SEGMENTS.A_NEMIGRAT &&
    segment !== PRICE_CHANGE_SEGMENTS.C_DEJA_605
  ) {
    return { ok: false, reason: "segment_not_ac" };
  }
  return { ok: true, reason: null };
}

/**
 * Full refund of latest 605 invoice after decline/cancel without consent.
 */
export function isEligibleForRefundDeclined605(input = {}) {
  const status = clean(input.status);
  const hasConsent = Boolean(input.hasConsent);
  const cancelAtPeriodEnd = Boolean(input.cancelAtPeriodEnd);
  const latestAmountPaid =
    input.latestAmountPaid == null ? null : Number(input.latestAmountPaid);
  const amountRefunded =
    input.amountRefunded == null ? 0 : Number(input.amountRefunded);

  if (hasConsent) {
    return { ok: false, reason: "has_consent" };
  }
  if (latestAmountPaid !== PREMIUM_PRICE_CHANGE_NEW_TOTAL_CENTS) {
    return { ok: false, reason: "not_605_invoice" };
  }
  if (amountRefunded >= PREMIUM_PRICE_CHANGE_NEW_TOTAL_CENTS) {
    return { ok: false, reason: "already_refunded" };
  }
  if (!(cancelAtPeriodEnd || status === "canceled")) {
    return { ok: false, reason: "not_canceled_or_scheduled" };
  }
  return { ok: true, reason: null };
}
