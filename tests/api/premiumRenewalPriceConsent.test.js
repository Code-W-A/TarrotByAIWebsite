import {
  memoryDb,
  subscription,
  stripeFixture,
} from "../helpers/premiumRenewalFixtures";
let db, stripe;
jest.mock("stripe", () => ({
  __esModule: true,
  default: jest.fn(() => ({
    subscriptions: {
      retrieve: (...args) => stripe.subscriptions.retrieve(...args),
      update: (...args) => stripe.subscriptions.update(...args),
    },
    customers: { retrieve: (...args) => stripe.customers.retrieve(...args) },
  })),
}));
jest.mock("../../lib/requireAuth", () => ({
  requireAuth: async () => ({ uid: "alice" }),
}));
jest.mock("../../lib/firebaseAdmin", () => ({ getAdminDb: () => db }));
jest.mock("../../lib/stripeFixedVatServer", () => ({
  getFixedVatTaxRateId: async () => "tax_test",
}));
jest.mock("../../lib/stripeFixedVat", () => ({
  getFixedVatTaxRateId: async () => "tax_test",
}));
import handler from "../../pages/api/stripe/premium/accept-price-change";
import { migrateSubscriptionToExclusivePrice } from "../../lib/premiumPriceChangeConsent";
const response = () => ({
  setHeader() {},
  status(code) {
    this.code = code;
    return this;
  },
  json(data) {
    this.data = data;
    return this;
  },
});
beforeEach(() => {
  process.env.STRIPE_PREMIUM_PRICE_ID_EXCLUSIVE = "price_new";
  db = memoryDb({ "Users/alice": { stripeSubscriptionId: "sub_one" } });
  stripe = stripeFixture([
    subscription("sub_one", {
      cancel_at_period_end: true,
      items: { data: [{ id: "item_one", price: { id: "price_new" } }] },
    }),
  ]);
  stripe.customers.retrieve.mockResolvedValue({
    address: {
      line1: "Test 1",
      city: "Bucuresti",
      state: "Bucuresti",
      postal_code: "010101",
      country: "RO",
    },
  });
});
it("does not undo cancellation when accepting an already accepted price again", async () => {
  db.rows.set("Users/alice", {
    stripeSubscriptionId: "sub_one",
    premiumPriceChangeConsent: {
      version: "v1_6_05",
      status: "accepted",
      acceptedAt: true,
    },
  });
  const res = response();
  await handler({ method: "POST", body: { accepted: true } }, res);
  expect(res.code).toBe(200);
  expect(res.data.cancelAtPeriodEnd).toBe(true);
  expect(stripe.subscriptions.update).not.toHaveBeenCalled();
});
it("preserves cancellation when stamping a newly accepted current price", async () => {
  const res = response();
  await handler({ method: "POST", body: { accepted: true } }, res);
  expect(res.code).toBe(200);
  expect(res.data.cancelAtPeriodEnd).toBe(true);
  expect(stripe.subscriptions.update.mock.calls[0][1]).not.toHaveProperty(
    "cancel_at_period_end",
  );
});
it("migration omits cancellation fields so concurrent cancellation is preserved", async () => {
  await migrateSubscriptionToExclusivePrice(stripe, {
    subscription: stripe.rows.get("sub_one"),
    item: { id: "item_one" },
    destinationPriceId: "price_new",
    uid: "alice",
  });
  expect(stripe.subscriptions.update.mock.calls[0][1]).not.toHaveProperty(
    "cancel_at_period_end",
  );
  expect(stripe.rows.get("sub_one").cancel_at_period_end).toBe(true);
});
