const auth = jest.fn();
const read = jest.fn();
const change = jest.fn();
jest.mock("stripe", () => ({ __esModule: true, default: jest.fn(() => ({})) }));
jest.mock("../../lib/requireAuth", () => ({
  requireAuth: (...args) => auth(...args),
}));
jest.mock("../../lib/firebaseAdmin", () => ({ getAdminDb: () => ({}) }));
jest.mock("../../lib/premiumRenewalService", () => ({
  readPremiumRenewal: (...args) => read(...args),
  changePremiumRenewal: (...args) => change(...args),
}));
import handler from "../../pages/api/stripe/premium/renewal";
const response = () => ({
  setHeader: jest.fn(),
  status(code) {
    this.code = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});
beforeEach(() => {
  jest.clearAllMocks();
  auth.mockResolvedValue({ uid: "alice" });
  read.mockResolvedValue({ allStopped: true });
  change.mockResolvedValue({ ok: true });
});
it.each(["GET", "POST"])("requires authentication for %s", async (method) => {
  auth.mockRejectedValue({ statusCode: 401 });
  const res = response();
  await handler({ method, body: {} }, res);
  expect(res.code).toBe(401);
  expect(read).not.toHaveBeenCalled();
  expect(change).not.toHaveBeenCalled();
});
it("gets ownership only from the verified token and disables caching", async () => {
  const res = response();
  await handler(
    { method: "POST", body: { uid: "bob", customerId: "cus_bob" } },
    res,
  );
  expect(change).toHaveBeenCalledWith(
    expect.objectContaining({ uid: "alice" }),
  );
  expect(res.setHeader).toHaveBeenCalledWith(
    "Cache-Control",
    "private, no-store",
  );
});
it("rejects other HTTP methods", async () => {
  const res = response();
  await handler({ method: "DELETE" }, res);
  expect(res.code).toBe(405);
});
it("does not expose Stripe errors or secrets", async () => {
  read.mockRejectedValue(new Error("secret details"));
  const res = response();
  await handler({ method: "GET" }, res);
  expect(res.body).toEqual({ error: "renewal_unavailable" });
});
it("rejects an account switch between UI confirmation and token retrieval", async () => {
  const res = response();
  await handler(
    { method: "POST", headers: { "x-premium-account-uid": "bob" }, body: {} },
    res,
  );
  expect(res.code).toBe(409);
  expect(change).not.toHaveBeenCalled();
});
