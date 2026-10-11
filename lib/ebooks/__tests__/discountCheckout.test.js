jest.mock("stripe", () => jest.fn());
jest.mock("../content", () => ({ assertEbooksEnabled: jest.fn(), metadata: jest.fn(async () => ({safe: {title: "Book", language: "ro"}})), ebookError: (m,s=400) => Object.assign(new Error(m), {statusCode:s}) }));
jest.mock("../access", () => ({hasAccess: jest.fn(async () => false)}));
jest.mock("../promo", () => ({resolveDiscount: jest.fn(async () => ({total:300,currency:"ron"}))}));
jest.mock("../invoice", () => ({invoiceEbookStripe: jest.fn()}));
jest.mock("../../globalSettings", () => ({getVatPercentage: async () => 21}));
jest.mock("../../stripeFixedVatServer", () => ({getFixedVatTaxRateId: async () => "txr_exclusive"}));
jest.mock("../../stripeCourseCheckoutTax", () => ({resolveCourseCheckoutTaxCustomerFields: async () => ({customer:"cus_shared"})}));
import Stripe from "stripe";
import {checkout} from "../billing";
import {resolveDiscount} from "../promo";
const billing = {firstName:"Ana",lastName:"Pop",email:"ana@example.com", address:{country:"Romania",state:"Cluj",city:"Cluj-Napoca",line1:"Strada 1"}};
let stripe, saved, db;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.EBOOKS_STRIPE_ENABLED="true"; process.env.STRIPE_SECRET_KEY="test";
  process.env.STRIPE_FIXED_VAT_TAX_RATE_ID="txr_exclusive"; process.env.NEXT_PUBLIC_SITE_URL="https://example.com";
  stripe={taxRates:{create:jest.fn(async () => ({id:"txr_inclusive"}))},checkout:{sessions:{create:jest.fn(async () => ({id:"cs_test",url:"https://checkout.example.com"}))}}};
  Stripe.mockImplementation(() => stripe);
  saved={}; db={collection: () => ({doc: () => ({set:async data => {saved=data;}})})};
});
it("charges exactly 300 bani inclusive, snapshots tax/currency, and uses a shared customer", async () => {
  await checkout(db,{uid:"alice",email:billing.email},"book","ro",billing,"web",undefined,"authorization");
  expect(resolveDiscount).toHaveBeenCalledWith(db,expect.objectContaining({uid:"alice"}),"book","authorization");
  const session=stripe.checkout.sessions.create.mock.calls[0][0];
  expect(session.customer).toBe("cus_shared");
  expect(session.line_items[0]).toMatchObject({price_data:{currency:"ron",unit_amount:300,tax_behavior:"inclusive"},tax_rates:["txr_inclusive"]});
  expect(saved).toMatchObject({expectedTotal:300,expectedTax:52,currency:"ron",vatIncluded:true,vatPercentage:21});
});
it("keeps normal purchases at 11 EUR plus VAT", async () => {
  await checkout(db,{uid:"alice",email:billing.email},"book","ro",billing);
  expect(resolveDiscount).not.toHaveBeenCalled();
  expect(stripe.taxRates.create).not.toHaveBeenCalled();
  expect(stripe.checkout.sessions.create.mock.calls[0][0].line_items[0]).toMatchObject({price_data:{currency:"eur",unit_amount:1100,tax_behavior:"exclusive"}});
  expect(saved).toMatchObject({expectedTotal:1331,currency:"eur"});
});
it("does not start Stripe checkout when authorization validation fails", async () => {
  resolveDiscount.mockRejectedValueOnce(new Error("Expired"));
  await expect(checkout(db,{uid:"alice",email:billing.email},"book","ro",billing,"web",undefined,"forged")).rejects.toThrow("Expired");
  expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
});
