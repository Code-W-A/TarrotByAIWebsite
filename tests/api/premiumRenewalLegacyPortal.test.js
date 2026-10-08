const retrieve = jest.fn(),
  portal = jest.fn();
let profile;
jest.mock("stripe", () => ({
  __esModule: true,
  default: jest.fn(() => ({
    subscriptions: { retrieve: (...args) => retrieve(...args) },
    billingPortal: { sessions: { create: (...args) => portal(...args) } },
  })),
}));
jest.mock("../../lib/requireAuth", () => ({
  requireAuth: async () => ({ uid: "alice" }),
}));
jest.mock("../../lib/firebaseAdmin", () => ({
  getAdminDb: () => ({
    collection: () => ({
      doc: () => ({ get: async () => ({ exists: true, data: () => profile }) }),
    }),
  }),
}));
jest.mock("../../lib/premiumServerUtils", () => ({
  resolvePremiumPublicBaseUrl: () => "https://example.com",
}));
import handler from "../../pages/api/stripe/premium/create-portal-session";
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
  jest.clearAllMocks();
  profile = { stripeCustomerId: "cus_one", stripeSubscriptionId: "sub_one" };
  portal.mockResolvedValue({ url: "https://billing.stripe.com/test" });
});
it("returns an explicit error instead of silently opening the general portal on cancellation failure", async () => {
  retrieve.mockRejectedValue(new Error("temporary"));
  const res = response();
  await handler({ method: "POST", body: { flow: "cancel" } }, res);
  expect(res.code).toBe(503);
  expect(portal).not.toHaveBeenCalled();
});
it("rejects a missing subscription for the legacy cancellation flow", async () => {
  delete profile.stripeSubscriptionId;
  const res = response();
  await handler({ method: "POST", body: { flow: "cancel" } }, res);
  expect(res.code).toBe(409);
  expect(portal).not.toHaveBeenCalled();
});
it("keeps the general portal available for invoices and cards", async () => {
  const res = response();
  await handler({ method: "POST", body: { flow: "default" } }, res);
  expect(res.code).toBe(200);
  expect(portal).toHaveBeenCalled();
});
