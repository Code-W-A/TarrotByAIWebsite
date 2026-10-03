/** Opt-in Stripe TEST integration. Firestore/auth are isolated in memory; never writes live Firebase. */
const rows = new Map();
function reference(path) {
 return { id: path.split('/').pop(), collection: name => collection(`${path}/${name}`),
  get: async () => ({ exists: rows.has(path), data: () => rows.get(path) }),
  set: async (data, options) => rows.set(path, options?.merge ? { ...rows.get(path), ...data } : data),
  update: async data => { if (!rows.has(path)) throw new Error('Missing record'); rows.set(path, { ...rows.get(path), ...data }); },
 };
}
let sequence = 0;
function collection(path) { return { doc: id => reference(`${path}/${id || `test-${++sequence}`}`) }; }
const db = { collection, runTransaction: async callback => callback({ get: ref => ref.get(), set: (ref,data) => ref.set(data), update: (ref,data) => ref.update(data) }) };
jest.mock('../../lib/firebaseAdmin', () => ({ getAdminDb: () => db }));
jest.mock('../../lib/requireAuth', () => ({ requireAuth: async () => ({ uid: 'isolated-consent-test', email: 'consent-test@example.com' }) }));
jest.mock('../../lib/globalSettings', () => ({ getVatPercentage: async () => 21, isIosPremiumSubscriptionsEnabled: async () => true }));
jest.mock('../../lib/stripePremiumEnv', () => ({ resolvePremiumStripePriceId: () => process.env.CONSENT_INTEGRATION_PRICE_ID, isStripePremiumUsingLocalOverrides: () => false }));
jest.mock('../../lib/stripeFixedVatServer', () => ({ getFixedVatTaxRateId: async () => process.env.CONSENT_INTEGRATION_TAX_ID }));
jest.mock('../../lib/premiumMobileCheckoutPolicy', () => ({ resolvePremiumMobileCheckoutPolicy: () => ({ allowed: true, platform: 'android' }) }));
jest.mock('../../lib/premiumSubscriptionGuard', () => ({ assertCanStartPremiumSubscription: async () => ({ allowed: true }) }));
jest.mock('../../lib/stripeBillingDetails', () => ({ normalizeBillingDetails: () => ({ firstName: 'Consent', lastName: 'Test', email: 'consent-test@example.com', phone: '+40700000000', billingType: 'individual', address: { line1: 'Test 1', city: 'Bucuresti', state: 'Bucuresti', postalCode: '010101', country: 'Romania' }, invoicePreferences: { sendEmail: false } }), buildBillingContextInput: () => ({}) }));
jest.mock('../../utils/billingAudit.mjs', () => ({ normalizeBillingContext: () => ({ validation: { ok: true }, normalizedClient: {} }), buildInvoiceDecision: () => ({ sendEInvoice: false }), logBillingAudit: () => {} }));
jest.mock('../../lib/userIdentitySync', () => ({ buildUserIdentityPatch: () => ({ patch: {} }) }));
const suite = process.env.RUN_STRIPE_CONSENT_TEST === '1' ? describe : describe.skip;
suite('real Stripe test subscription consent', () => {
 it('creates a disclosed Checkout session and pays a mobile test subscription with isolated evidence', async () => {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key?.startsWith('sk_test_')) throw new Error('Requires a Stripe test key; no live requests allowed');
  const Stripe = require('stripe').default || require('stripe'); const stripe = new Stripe(key, { maxNetworkRetries: 1 });
  let product, price, tax, session, subscription, customer;
  try {
   product = await stripe.products.create({ name: 'Isolated recurring-consent integration test' });
   price = await stripe.prices.create({ product: product.id, unit_amount: 500, currency: 'eur', tax_behavior: 'exclusive', recurring: { interval: 'month' } });
   tax = await stripe.taxRates.create({ display_name: 'Test VAT', percentage: 21, inclusive: false });
   process.env.CONSENT_INTEGRATION_PRICE_ID = price.id; process.env.CONSENT_INTEGRATION_TAX_ID = tax.id;
   const { getConsentQuote } = require('../../lib/subscriptionConsent'); const quote = await getConsentQuote(stripe, 'ro');
   const subscriptionConsent = { accepted: true, version: quote.version, locale: quote.locale, quoteId: quote.quoteId };
   const response = () => ({ setHeader: () => {}, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } });
   const req = { method: 'POST', body: { platform: 'android', billingDetails: {}, subscriptionConsent }, headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http' } };
   const web = require('../../pages/api/stripe/premium/create-checkout-session').default;
   const webRes = response(); await web(req, webRes); expect(webRes.code).toBe(200);
   session = await stripe.checkout.sessions.retrieve(new URL(webRes.data.url).pathname.split("/").pop());
   expect(session.livemode).toBe(false); expect(session.custom_text.submit.message).toBe(quote.text); expect(session.metadata.subscriptionConsentId).toBeTruthy();
   const mobile = require('../../pages/api/stripe/premium/mobile/create-payment-sheet').default;
   const mobileRes = response(); await mobile(req, mobileRes); expect(mobileRes.code).toBe(200);
   subscription = mobileRes.data.subscriptionId; customer = mobileRes.data.customerId;
   expect(subscription).toBeTruthy();
   const paid = await stripe.paymentIntents.confirm(mobileRes.data.paymentIntentId || mobileRes.data.paymentIntentClientSecret.split("_secret_")[0], { payment_method: 'pm_card_visa' });
   expect(paid.status).toBe('succeeded'); expect(paid.amount).toBe(605); expect(paid.livemode).toBe(false);
   const records = [...rows.values()].filter(row => row.channel && row.acceptedAt);
   expect(records).toHaveLength(2); expect(records.every(row => row.text === quote.text)).toBe(true);
  } finally {
   if (session?.id) await stripe.checkout.sessions.expire(session.id);
   if (subscription) await stripe.subscriptions.cancel(subscription);
   if (customer) await stripe.customers.del(customer);
   if (price) await stripe.prices.update(price.id, { active: false });
   if (product) await stripe.products.update(product.id, { active: false });
   if (tax) await stripe.taxRates.update(tax.id, { active: false });
  }
 }, 90000);
});
