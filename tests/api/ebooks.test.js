jest.mock("../../lib/ebooks/promo", () => ({
  ...jest.requireActual("../../lib/ebooks/promo"),
  redeemPromo: jest.fn(),
}));
jest.mock("../../lib/firebaseAdmin", () => ({
  getAdminDb: jest.fn(() => ({})),
}));
jest.mock("../../lib/requireAuth", () => ({
  requireAuth: jest.fn(),
  requireDashboardAccess: jest.fn(),
}));
jest.mock("../../lib/dashboardSession", () => ({
  readDashboardSession: jest.fn(() => null),
}));
jest.mock("../../lib/ebooks/access", () => ({
  requireEbookAccess: jest.fn(),
  hasAccess: jest.fn(() => false),
}));
jest.mock("../../lib/ebooks/content", () => ({
  assertEbooksEnabled: jest.fn(),
  identifier: (x) => x,
  localeOf: (x) => x || "ro",
  loadBooks: jest.fn(),
  publicBook: jest.fn(),
  metadata: jest.fn(),
  readChapter: jest.fn(),
  syncRegistry: jest.fn(),
  ebookError: (m, s = 400) => Object.assign(new Error(m), { statusCode: s }),
}));
jest.mock("../../lib/ebooks/billing", () => ({
  stripeAvailability: jest.fn(async () => ({
    web: false,
    ios: false,
    android: false,
  })),
  checkout: jest.fn(),
  stripeClient: jest.fn(),
  processStripeEbookEvent: jest.fn(),
}));
jest.mock("../../lib/globalSettings", () => ({
  getVatPercentage: async () => 21,
}));
import handler from "../../pages/api/ebooks/[[...path]]";
import { requireAuth, requireDashboardAccess } from "../../lib/requireAuth";
import { requireEbookAccess } from "../../lib/ebooks/access";
import { readChapter, metadata } from "../../lib/ebooks/content";
async function request(path, method = "GET", body = {}) {
  const req = {
    query: { path: path.split("/").filter(Boolean), locale: "es" },
    method,
    headers: {},
    async *[Symbol.asyncIterator]() {
      if (method !== "GET") yield Buffer.from(JSON.stringify(body));
    },
  };
  const res = {
    code: 200,
    setHeader: jest.fn(),
    status(n) {
      this.code = n;
      return this;
    },
    json(p) {
      this.payload = p;
      return this;
    },
  };
  await handler(req, res);
  return res;
}
beforeEach(() => {
  jest.clearAllMocks();
  process.env.EBOOKS_ENABLED = "true";
  process.env.SANITY_PROJECT_ID = "test";
  process.env.SANITY_DATASET = "production";
  process.env.SANITY_READ_TOKEN = "test";
  requireAuth.mockResolvedValue({ uid: "alice" });
  requireEbookAccess.mockResolvedValue();
});
it("denies chapter access without authentication", async () => {
  requireAuth.mockRejectedValue(
    Object.assign(new Error("Unauthorized"), { statusCode: 401 }),
  );
  const r = await request("book/chapters/c1");
  expect(r.code).toBe(401);
  expect(readChapter).not.toHaveBeenCalled();
});
it("denies chapter access without purchase", async () => {
  requireEbookAccess.mockRejectedValue(
    Object.assign(new Error("No access"), { statusCode: 403 }),
  );
  const r = await request("book/chapters/c1");
  expect(r.code).toBe(403);
  expect(readChapter).not.toHaveBeenCalled();
});
it("uses authenticated UID, not a supplied UID", async () => {
  readChapter.mockResolvedValue({ chapter: { body: [{ text: "private" }] } });
  const r = await request("book/chapters/c1");
  expect(r.code).toBe(200);
  expect(requireEbookAccess).toHaveBeenCalledWith({}, "alice", "book");
  expect(r.setHeader).toHaveBeenCalledWith(
    "Cache-Control",
    "private, no-store, max-age=0",
  );
});
it("requires admin authorization for draft preview", async () => {
  requireDashboardAccess.mockImplementation(() => {
    throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  });
  const r = await request("preview/book/c1");
  expect(r.code).toBe(401);
  expect(readChapter).not.toHaveBeenCalled();
});
it("rejects malformed reading progress", async () => {
  metadata.mockResolvedValue({
    safe: { language: "ro", chapters: [{ _key: "c1" }] },
  });
  const r = await request("book/progress", "PUT", {
    chapterId: "other",
    offset: Infinity,
    fontSize: 18,
  });
  expect(r.code).toBe(400);
});
it("requires a signed Sanity webhook before updating registry", async () => {
  delete process.env.SANITY_EBOOK_WEBHOOK_SECRET;
  const r = await request("sanity-webhook", "POST", {});
  expect(r.code).toBe(401);
});

import { redeemPromo } from "../../lib/ebooks/promo";
it("redeems only authenticated UID after validating a published book", async () => {
  metadata.mockResolvedValue({ safe: { id: "book" } });
  redeemPromo.mockResolvedValue({ owned: true });
  const r = await request("book/redeem", "POST", {
    code: "example",
    uid: "bob",
  });
  expect(r.code).toBe(200);
  expect(metadata).toHaveBeenCalledWith("book", "es", false);
  expect(redeemPromo).toHaveBeenCalledWith(
    {},
    { uid: "alice" },
    "book",
    "example",
  );
  expect(r.payload).toEqual({ owned: true });
});
it.each([
  "book/redeem",
  "book/checkout",
  "book/chapters/c1",
  "book/progress",
  "purchased",
])("rejects anonymous account at %s", async (path) => {
  requireAuth.mockResolvedValue({
    uid: "anon",
    firebase: { sign_in_provider: "anonymous" },
  });
  const r = await request(path, /redeem|checkout/.test(path) ? "POST" : "GET", {
    code: "example",
  });
  expect(r.code).toBe(401);
  expect(redeemPromo).not.toHaveBeenCalled();
  expect(readChapter).not.toHaveBeenCalled();
});
it("does not grant promo for missing, draft or archived book", async () => {
  metadata.mockRejectedValue(
    Object.assign(new Error("Not found"), { statusCode: 404 }),
  );
  const r = await request("book/redeem", "POST", { code: "example" });
  expect(r.code).toBe(404);
  expect(redeemPromo).not.toHaveBeenCalled();
});
it("config exposes only promo availability", async () => {
  process.env.EBOOK_PROMO_ENABLED = "true";
  process.env.EBOOK_PROMO_CODE_HASH = "a".repeat(64);
  const r = await request("config");
  expect(r.payload.promoEnabled).toBe(true);
  expect(JSON.stringify(r.payload)).not.toContain("a".repeat(64));
  process.env.EBOOK_PROMO_ENABLED = "false";
  expect((await request("config")).payload.promoEnabled).toBe(false);
  delete process.env.EBOOK_PROMO_ENABLED;
  delete process.env.EBOOK_PROMO_CODE_HASH;
});
