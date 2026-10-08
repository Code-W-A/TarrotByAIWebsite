jest.mock("../../lib/firebaseAdmin", () => ({ getAdminDb: jest.fn() }));
jest.mock("../../lib/requireAuth", () => ({ requireAuth: jest.fn() }));
import handler from "../../pages/api/billing-profile";
import { getAdminDb } from "../../lib/firebaseAdmin";
import { requireAuth } from "../../lib/requireAuth";
const details = { firstName: "Ana", lastName: "Pop", email: "ana@example.com", address: { country: "RO", state: "Cluj", city: "Cluj-Napoca", line1: "Strada 1" } };
let records;
async function request(method, body = {}, headers = {}) {
  const res = { code: 200, setHeader: jest.fn(), status(code) { this.code = code; return this; }, json(data) { this.body = data; return this; } };
  await handler({ method, headers, body, query: { uid: "bob" } }, res);
  return res;
}
beforeEach(() => {
  records = new Map(); jest.clearAllMocks();
  jest.spyOn(console, "info").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  requireAuth.mockResolvedValue({ uid: "alice", email: details.email });
  getAdminDb.mockReturnValue({ collection: () => ({ doc: uid => ({
    get: async () => ({ exists: records.has(uid), data: () => records.get(uid) }),
    set: async value => records.set(uid, value),
  }) }) });
});
afterEach(() => jest.restoreAllMocks());
it("saves without a phone, reads the authenticated account and never trusts requested UID", async () => {
  expect((await request("PUT", { uid: "bob", billingDetails: details })).code).toBe(200);
  expect(records.has("alice")).toBe(true); expect(records.has("bob")).toBe(false);
  expect((await request("GET")).body).toMatchObject({ valid: true, billingDetails: { phone: "", firstName: "Ana" } });
  requireAuth.mockResolvedValue({ uid: "bob" });
  expect((await request("GET")).body).toEqual({ billingDetails: null, valid: false });
});
it("rejects missing invoice address and leaves the last valid profile intact", async () => {
  await request("PUT", { billingDetails: details });
  expect((await request("PUT", { billingDetails: { ...details, address: {} } })).code).toBe(400);
  expect((await request("GET")).body.billingDetails.address.line1).toBe("Strada 1");
});
it("accepts a foreign address without county", async () => {
  const result = await request("PUT", { billingDetails: { ...details, address: { country: "France", city: "Paris", line1: "Rue 1" } } });
  expect(result.code).toBe(200);
});
it("blocks anonymous and missing authentication", async () => {
  requireAuth.mockResolvedValue({ uid: "anon", firebase: { sign_in_provider: "anonymous" } });
  expect((await request("GET")).code).toBe(403);
  requireAuth.mockRejectedValue(Object.assign(new Error("Unauthorized"), { statusCode: 401 }));
  expect((await request("PUT", { billingDetails: details })).code).toBe(401);
  expect(records.size).toBe(0);
});
it("returns an error on storage failure without leaking billing data", async () => {
  getAdminDb.mockImplementation(() => { throw new Error("private database error"); });
  const response = await request("GET");
  expect(response.code).toBe(500); expect(response.body.error).not.toContain("private");
});

it("correlates successful writes and logs safe validation diagnostics", async () => {
  const requestId = "bp-abcdefgh-12345678";
  const result = await request("PUT", { billingDetails: details }, { "x-request-id": requestId });
  expect(result.setHeader).toHaveBeenCalledWith("X-Request-ID", requestId);
  expect(console.info).toHaveBeenCalledWith("[BillingProfile] write_success", expect.objectContaining({ requestId, stage: "firestore_write" }));
  expect(console.info).toHaveBeenCalledWith("[BillingProfile] authentication_success", expect.objectContaining({ requestId }));
  await request("PUT", { billingDetails: { ...details, address: {} } }, { "x-request-id": requestId });
  expect(console.warn).toHaveBeenCalledWith("[BillingProfile] validation_result", expect.objectContaining({ valid: false, present: expect.objectContaining({ line1: false }), issues: expect.arrayContaining([expect.objectContaining({ code: "missing_address" })]) }));
  const logs = JSON.stringify([console.info.mock.calls, console.warn.mock.calls]);
  for (const privateValue of [details.firstName, details.lastName, details.email, details.address.line1, details.address.city, "alice", "bob"]) expect(logs).not.toContain(`"${privateValue}"`);
});

it("logs authentication failure without printing the token or exception message", async () => {
  requireAuth.mockRejectedValue(Object.assign(new Error("PRIVATE_AUTH_ERROR"), { statusCode: 401 }));
  await request("PUT", { billingDetails: details }, { authorization: "Bearer PRIVATE_TOKEN" });
  expect(console.warn).toHaveBeenCalledWith("[BillingProfile] request_failed", expect.objectContaining({ stage: "authentication", status: 401 }));
  expect(JSON.stringify(console.warn.mock.calls)).not.toMatch(/PRIVATE_AUTH_ERROR|PRIVATE_TOKEN/);
});

it("reports the Firestore code and write stage without logging its sensitive message", async () => {
  getAdminDb.mockReturnValue({ collection: () => ({ doc: () => ({ set: async () => { throw Object.assign(new Error("PRIVATE_FIRESTORE_DATA"), { code: 7 }); } }) }) });
  expect((await request("PUT", { billingDetails: details })).code).toBe(500);
  expect(console.warn).toHaveBeenCalledWith("[BillingProfile] request_failed", expect.objectContaining({ stage: "firestore_write", status: 500, code: 7 }));
  expect(JSON.stringify(console.warn.mock.calls)).not.toContain("PRIVATE_FIRESTORE_DATA");
});

it("replaces invalid correlation headers and preserves the response contract", async () => {
  const result = await request("GET", {}, { "x-request-id": "private@example.com\nunsafe" });
  expect(result.body).toEqual({ billingDetails: null, valid: false });
  expect(result.setHeader).toHaveBeenCalledWith("X-Request-ID", expect.stringMatching(/^bp-/));
  expect(JSON.stringify(console.info.mock.calls)).not.toContain("private@example.com");
});
