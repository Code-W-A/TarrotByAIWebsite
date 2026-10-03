jest.mock("stripe", () => jest.fn(() => ({ checkout: { sessions: { create: jest.fn() } }, customers: { create: jest.fn(), update: jest.fn() }, subscriptions: { create: jest.fn(), list: jest.fn() } })));
jest.mock("../../lib/firebaseAdmin", () => ({ getAdminDb: () => ({ collection: jest.fn() }) }));
jest.mock("../../lib/requireAuth", () => ({ requireAuth: async () => ({ uid: "test-user", email: "test@example.com" }) }));
jest.mock("../../lib/stripePremiumEnv", () => ({ resolvePremiumStripePriceId: () => "price_test", isStripePremiumUsingLocalOverrides: () => false }));
jest.mock("../../utils/oblioTax", () => ({ getStripePriceTaxBehavior: async () => ({ taxBehavior: "exclusive" }) }));
jest.mock("../../lib/stripeBillingDetails", () => ({ normalizeBillingDetails: () => ({}), buildBillingContextInput: () => ({}) }));
jest.mock("../../utils/billingAudit.mjs", () => ({ normalizeBillingContext: () => ({ validation: { ok: true }, normalizedClient: {} }), buildInvoiceDecision: () => ({}), logBillingAudit: () => {} }));
jest.mock("../../lib/premiumServerUtils", () => ({ resolvePremiumPublicBaseUrl: () => "https://example.com" }));
jest.mock("../../lib/globalSettings", () => ({ isIosPremiumSubscriptionsEnabled: async () => true }));
jest.mock("../../lib/premiumMobileCheckoutPolicy", () => ({ resolvePremiumMobileCheckoutPolicy: () => ({ allowed: true, platform: "android" }) }));
jest.mock("../../lib/subscriptionConsent", () => ({
 acceptSubscriptionConsent: jest.fn(), linkSubscriptionConsent: jest.fn(),
 consentErrorResponse: (res, error) => res.status(error.code ? 409 : 503).json({ error: error.code || "SUBSCRIPTION_CONSENT_UNAVAILABLE", message: error.message })
}));
const { acceptSubscriptionConsent } = require("../../lib/subscriptionConsent");
const Stripe = require("stripe");
const web = require("../../pages/api/stripe/premium/create-checkout-session").default;
const mobile = require("../../pages/api/stripe/premium/mobile/create-payment-sheet").default;
function response() { return { setHeader: jest.fn(), status: jest.fn(function(code) { this.statusCode = code; return this; }), json: jest.fn() }; }
it.each([["web", web], ["mobile", mobile]])("%s never creates Stripe objects without acceptance or when journal fails", async (_, handler) => {
 for (const error of [Object.assign(new Error("acceptance required"), { code: "SUBSCRIPTION_CONSENT_REQUIRED" }), Object.assign(new Error("stale price"), { code: "SUBSCRIPTION_CONSENT_STALE" }), new Error("journal unavailable")]) {
  acceptSubscriptionConsent.mockRejectedValueOnce(error);
  const res = response(); await handler({ method: "POST", body: { platform: "android" }, headers: {} }, res);
  expect(res.statusCode).toBe(error.code ? 409 : 503);
  for (const client of Stripe.mock.results.map(r => r.value)) {
    expect(client.checkout.sessions.create).not.toHaveBeenCalled(); expect(client.customers.create).not.toHaveBeenCalled(); expect(client.customers.update).not.toHaveBeenCalled(); expect(client.subscriptions.create).not.toHaveBeenCalled();
  }
 }
});
