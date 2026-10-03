/** Server-only: offers are signed, short-lived, and checked against fresh Stripe pricing. */
import { createHmac, timingSafeEqual } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import translations from "./subscriptionConsentTranslations.json";
import { resolvePremiumStripePriceId } from "./stripePremiumEnv";
import { getVatPercentage } from "./globalSettings";
import { buildPremiumDisplayPricing } from "./premiumDisplayPricing";

export const SUBSCRIPTION_CONSENT_VERSION = "monthly-recurring-v1";
export const SUBSCRIPTION_CONSENT_COLLECTION = "premiumSubscriptionConsents";
export const CONSENT_TTL_MS = 30 * 60 * 1000;
export function consentLocale(value) {
  const locale = typeof value === "string" ? value.toLowerCase().split("-")[0] : "ro";
  return Object.hasOwn(translations, locale) ? locale : "ro";
}
export function buildConsentQuote(price, vatPercentage, locale, expiresAt, secret) {
  if (!secret || !price?.active || price.tax_behavior !== "exclusive" ||
      price.recurring?.interval !== "month" || price.recurring?.interval_count !== 1 ||
      !Number.isInteger(price.unit_amount) || price.unit_amount < 0) {
    throw new Error("Premium monthly pricing unavailable");
  }
  locale = consentLocale(locale);
  const pricing = buildPremiumDisplayPricing({ netAmountCents: price.unit_amount, currency: price.currency.toUpperCase(), interval: "month" }, vatPercentage);
  const priceText = new Intl.NumberFormat(locale, { style: "currency", currency: pricing.currency, currencyDisplay: "code" }).format(pricing.totalAmount);
  const text = translations[locale].premiumRecurringNotice.replace("{price}", priceText);
  const quote = { version: SUBSCRIPTION_CONSENT_VERSION, locale, priceId: price.id, ...pricing, intervalCount: 1, expiresAt, priceText, text, consentText: translations[locale].premiumRecurringConsent };
  const signature = createHmac("sha256", secret).update(JSON.stringify(quote)).digest("hex");
  return { ...quote, quoteId: `${expiresAt}.${signature}` };
}
export async function getConsentQuote(stripe, locale, expiresAt = Date.now() + CONSENT_TTL_MS) {
  const priceId = resolvePremiumStripePriceId();
  if (!priceId) throw new Error("Premium pricing unavailable");
  const [price, vat] = await Promise.all([stripe.prices.retrieve(priceId), getVatPercentage()]);
  return buildConsentQuote(price, vat, locale, expiresAt, process.env.STRIPE_SECRET_KEY);
}
export async function validateSubscriptionConsent(stripe, consent, now = Date.now()) {
  const locale = consentLocale(consent?.locale);
  const strings = translations[locale];
  if (consent?.accepted !== true || typeof consent?.locale !== "string" || !Object.hasOwn(translations, consent.locale)) {
    const error = new Error(`${strings.premiumRecurringRequired} https://www.cristinazurba.com/abonament`);
    error.code = "SUBSCRIPTION_CONSENT_REQUIRED";
    throw error;
  }
  const [expires, signature] = String(consent.quoteId || "").split(".");
  const expiresAt = Number(expires);
  if (consent.version !== SUBSCRIPTION_CONSENT_VERSION || !Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + CONSENT_TTL_MS || !/^[a-f0-9]{64}$/.test(signature || "")) {
    const error = new Error(strings.premiumRecurringExpired); error.code = "SUBSCRIPTION_CONSENT_STALE"; throw error;
  }
  const quote = await getConsentQuote(stripe, locale, expiresAt);
  if (quote.quoteId.length !== String(consent.quoteId).length || !timingSafeEqual(Buffer.from(quote.quoteId), Buffer.from(String(consent.quoteId)))) {
    const error = new Error(strings.premiumRecurringExpired); error.code = "SUBSCRIPTION_CONSENT_STALE"; throw error;
  }
  return quote;
}
export async function acceptSubscriptionConsent({ db, stripe, consent, uid, channel }) {
  const quote = await validateSubscriptionConsent(stripe, consent);
  const ref = db.collection(SUBSCRIPTION_CONSENT_COLLECTION).doc();
  await ref.set({ ...quote, uid, channel, acceptedAt: FieldValue.serverTimestamp(), status: "accepted", paymentStatus: "not_started" });
  return { id: ref.id, quote };
}
export async function linkSubscriptionConsent(db, consentId, fields, event = null) {
  if (!consentId) return;
  const ref = db.collection(SUBSCRIPTION_CONSENT_COLLECTION).doc(consentId);
  // Never manufacture a historical acceptance; journal verified webhook events separately.
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new Error("Subscription consent record missing");
    const previous = snapshot.data();
    const patch = { ...fields, updatedAt: FieldValue.serverTimestamp() };
    if (event) {
      transaction.set(ref.collection("events").doc(event.id), {
        ...fields, eventType: event.type, occurredAtMs: event.created * 1000,
      });
      if ((previous.lastEventAtMs || 0) > event.created * 1000) return;
      patch.lastEventAtMs = event.created * 1000;
      patch.lastEventId = event.id;
    }
    // A fast webhook can confirm payment before the creation request stores its IDs.
    if (patch.paymentStatus === "pending" && ["paid", "failed", "expired"].includes(previous.paymentStatus)) delete patch.paymentStatus;
    transaction.update(ref, patch);
  });
}
export function consentErrorResponse(res, error, locale) {
  return res.status(error.code ? 409 : 503).json({ error: error.code || "SUBSCRIPTION_CONSENT_UNAVAILABLE", message: error.code ? error.message : `${translations[consentLocale(locale)].premiumRecurringUnavailable} https://www.cristinazurba.com/abonament` });
}
