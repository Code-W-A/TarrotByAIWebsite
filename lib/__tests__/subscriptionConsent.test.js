jest.mock("../globalSettings", () => ({ getVatPercentage: jest.fn(async () => 21) }));
jest.mock("../stripePremiumEnv", () => ({ resolvePremiumStripePriceId: () => "price_monthly" }));
jest.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "SERVER_TIME" } }));
const { buildConsentQuote, validateSubscriptionConsent, acceptSubscriptionConsent, linkSubscriptionConsent, CONSENT_TTL_MS, SUBSCRIPTION_CONSENT_VERSION } = require("../subscriptionConsent");
const translations = require("../subscriptionConsentTranslations.json");
const price = { id: "price_monthly", active: true, unit_amount: 500, currency: "eur", tax_behavior: "exclusive", recurring: { interval: "month", interval_count: 1 } };
const stripe = { prices: { retrieve: jest.fn(async () => price) } };
const acceptance = q => ({ accepted: true, version: q.version, locale: q.locale, quoteId: q.quoteId });
beforeEach(() => { process.env.STRIPE_SECRET_KEY = "test-consent-secret"; stripe.prices.retrieve.mockResolvedValue(price); });
function quote() { return buildConsentQuote(price, 21, "ro", Date.now() + CONSENT_TTL_MS - 1000, process.env.STRIPE_SECRET_KEY); }
it("uses real price and VAT and validates a signed acceptance", async () => {
 const q = quote(); expect(q.totalAmountCents).toBe(605); expect(q.text).toContain(q.priceText); expect(q.version).toBe(SUBSCRIPTION_CONSENT_VERSION);
 expect(await validateSubscriptionConsent(stripe, acceptance(q))).toEqual(q);
});
it.each([undefined, {}, { accepted: false }, { accepted: "true" }])("rejects missing or unchecked acceptance before reading Stripe: %p", async consent => {
 stripe.prices.retrieve.mockClear(); await expect(validateSubscriptionConsent(stripe, consent)).rejects.toMatchObject({ code: "SUBSCRIPTION_CONSENT_REQUIRED" }); expect(stripe.prices.retrieve).not.toHaveBeenCalled();
});
it("includes manual website fallback for old apps", async () => {
 await expect(validateSubscriptionConsent(stripe, null)).rejects.toThrow("https://www.cristinazurba.com/abonament");
});
it("rejects expired, tampered, and changed offers", async () => {
 const q = quote();
 await expect(validateSubscriptionConsent(stripe, acceptance(q), q.expiresAt + 1)).rejects.toMatchObject({ code: "SUBSCRIPTION_CONSENT_STALE" });
 await expect(validateSubscriptionConsent(stripe, { ...acceptance(q), quoteId: q.quoteId.slice(0,-1) + (q.quoteId.endsWith('a') ? 'b' : 'a') })).rejects.toMatchObject({ code: "SUBSCRIPTION_CONSENT_STALE" });
 stripe.prices.retrieve.mockResolvedValue({ ...price, unit_amount: 700 });
 await expect(validateSubscriptionConsent(stripe, acceptance(q))).rejects.toMatchObject({ code: "SUBSCRIPTION_CONSENT_STALE" });
});
it("fails closed on journal failure and allows retry with a separate record", async () => {
 const set = jest.fn().mockRejectedValueOnce(new Error("db unavailable")).mockResolvedValueOnce(undefined);
 const db = { collection: () => ({ doc: () => ({ id: "consent-1", set }) }) };
 const params = { db, stripe, uid: "user", channel: "web", consent: acceptance(quote()) };
 await expect(acceptSubscriptionConsent(params)).rejects.toThrow("db unavailable");
 const result = await acceptSubscriptionConsent(params); expect(result.id).toBe("consent-1");
 expect(set.mock.calls[1][0]).toMatchObject({ uid: "user", channel: "web", acceptedAt: "SERVER_TIME", paymentStatus: "not_started" });
});
it("does not manufacture evidence for old subscriptions", async () => {
 const db = { collection: jest.fn() }; await linkSubscriptionConsent(db, undefined, { paymentStatus: "paid" }); expect(db.collection).not.toHaveBeenCalled();
});
it("has matching translations for all 27 web and mobile languages", () => {
 const mobile = require("../../../expo-mobile-app/src/features/video-library/utils/subscriptionConsentTranslations.json");
 const locales = require("../../next-i18next.config").i18n.locales;
 expect(Object.keys(translations).sort()).toEqual([...locales].sort()); expect(mobile).toEqual(translations);
 for (const locale of locales) { const q = buildConsentQuote(price, 21, locale, 123, "secret"); expect(q.text).toContain(q.priceText); expect(q.text).not.toContain("{price}"); expect(q.consentText).toBeTruthy(); }
});
it("links Stripe outcomes without losing acceptance and journals out-of-order events", async () => {
 const stored = { text: "accepted text", acceptedAt: "SERVER_TIME", paymentStatus: "not_started" };
 const events = {};
 const ref = { collection: () => ({ doc: id => ({ eventId: id }) }) };
 const transaction = {
  get: async () => ({ exists: true, data: () => ({ ...stored }) }),
  set: (eventRef, fields) => { events[eventRef.eventId] = fields; },
  update: (_, fields) => Object.assign(stored, fields),
 };
 const db = { collection: () => ({ doc: () => ref }), runTransaction: async callback => callback(transaction) };
 await linkSubscriptionConsent(db, "consent", { stripeSubscriptionId: "sub_test", paymentStatus: "paid" }, { id: "evt_paid", type: "invoice.payment_succeeded", created: 100 });
 await linkSubscriptionConsent(db, "consent", { paymentStatus: "pending" }, { id: "evt_completed", type: "checkout.session.completed", created: 99 });
 await linkSubscriptionConsent(db, "consent", { stripeCheckoutSessionId: "cs_test", paymentStatus: "pending" });
 expect(stored).toMatchObject({ text: "accepted text", acceptedAt: "SERVER_TIME", stripeSubscriptionId: "sub_test", stripeCheckoutSessionId: "cs_test", paymentStatus: "paid" });
 expect(events.evt_completed.eventType).toBe("checkout.session.completed");
 await linkSubscriptionConsent(db, "consent", { subscriptionStatus: "canceled" }, { id: "evt_cancel", type: "customer.subscription.deleted", created: 101 });
 expect(stored.subscriptionStatus).toBe("canceled"); expect(stored.paymentStatus).toBe("paid");
});
it("rejects a VAT change and non-monthly pricing", async () => {
 const settings = require("../globalSettings"); const q = quote();
 settings.getVatPercentage.mockResolvedValueOnce(19);
 await expect(validateSubscriptionConsent(stripe, acceptance(q))).rejects.toMatchObject({ code: "SUBSCRIPTION_CONSENT_STALE" });
 expect(() => buildConsentQuote({ ...price, recurring: { interval: "year", interval_count: 1 } }, 21, "ro", 100, "secret")).toThrow();
});
