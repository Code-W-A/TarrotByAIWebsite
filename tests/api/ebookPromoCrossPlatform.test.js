jest.mock("../../lib/firebaseAdmin", () => ({ getAdminDb: jest.fn() }));
jest.mock("../../lib/requireAuth", () => ({
  requireAuth: jest.fn(),
  requireDashboardAccess: jest.fn(),
}));
jest.mock("../../lib/dashboardSession", () => ({
  readDashboardSession: () => null,
}));
jest.mock("../../lib/globalSettings", () => ({
  getVatPercentage: async () => 21,
}));
jest.mock("../../lib/ebooks/billing", () => ({
  stripeAvailability: async () => ({ web: false, ios: false, android: false }),
}));
jest.mock("../../lib/ebooks/content", () => ({
  assertEbooksEnabled: () => {},
  identifier: (x) => x,
  localeOf: (x) => x || "ro",
  ebookError: (message, statusCode = 400) =>
    Object.assign(new Error(message), { statusCode }),
  metadata: async (_id, locale) => ({
    safe: {
      id: "book",
      language: locale === "es" ? "es" : "ro",
      chapters: [{ _key: "first", title: "Chapter" }],
    },
  }),
  readChapter: async (_id, locale) => ({
    language: locale,
    chapter: { body: [{ text: "Private manuscript" }] },
  }),
  loadBooks: async () => [
    { _id: "book", editions: [{ language: "ro" }, { language: "es" }] },
  ],
  publicBook: (b) => ({ id: b._id, title: "Book" }),
}));
import handler from "../../pages/api/ebooks/[[...path]]";
import { getAdminDb } from "../../lib/firebaseAdmin";
import { requireAuth } from "../../lib/requireAuth";
import { digest } from "../../lib/ebooks/access";
class Db {
  data = new Map();
  snap(path) {
    return {
      id: path.split("/").pop(),
      exists: this.data.has(path),
      data: () => this.data.get(path),
    };
  }
  collection(path) {
    return {
      doc: (id) => ({
        path: `${path}/${id}`,
        get: async () => this.snap(`${path}/${id}`),
        set: async (v) => this.data.set(`${path}/${id}`, v),
        collection: (name) => this.collection(`${path}/${id}/${name}`),
      }),
      where: (field, _op, val) => ({
        get: async () => ({
          docs: [...this.data.keys()]
            .filter(
              (k) =>
                k.startsWith(path + "/") && this.data.get(k)[field] === val,
            )
            .map((k) => this.snap(k)),
        }),
      }),
    };
  }
  async runTransaction(fn) {
    const staged = [];
    const result = await fn({
      get: async (ref) => this.snap(ref.path),
      set: (ref, v) => staged.push([ref.path, v]),
    });
    staged.forEach(([k, v]) => this.data.set(k, v));
    return result;
  }
}
async function request(
  path,
  uid,
  platform,
  method = "GET",
  body = {},
  locale = "ro",
) {
  const req = {
    query: { path: path.split("/"), locale },
    method,
    headers: { authorization: uid, "x-app-platform": platform },
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
    json(v) {
      this.payload = v;
      return this;
    },
  };
  await handler(req, res);
  return res;
}
beforeEach(() => {
  const db = new Db();
  getAdminDb.mockReturnValue(db);
  requireAuth.mockImplementation(async (req) => {
    if (!req.headers.authorization)
      throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    return { uid: req.headers.authorization };
  });
  process.env.EBOOKS_ENABLED = "true";
  process.env.EBOOK_PROMO_ENABLED = "true";
  process.env.EBOOK_PROMO_CODE_HASH = digest("Example!");
});
afterEach(() => {
  delete process.env.EBOOK_PROMO_ENABLED;
  delete process.env.EBOOK_PROMO_CODE_HASH;
});
it.each([
  ["web", "ios"],
  ["android", "web"],
])(
  "shares %s grant with %s, translations and reading progress on the same UID",
  async (from, to) => {
    expect(
      (
        await request("book/redeem", "alice", from, "POST", {
          code: "Example!",
        })
      ).payload.owned,
    ).toBe(true);
    expect((await request("purchased", "alice", to)).payload.books).toEqual([
      { id: "book", title: "Book" },
    ]);
    expect(
      (await request("book/chapters/first", "alice", to, "GET", {}, "es"))
        .payload.language,
    ).toBe("es");
    expect(
      (
        await request(
          "book/progress",
          "alice",
          from,
          "PUT",
          { chapterId: "first", offset: 0.4, fontSize: 24 },
          "es",
        )
      ).code,
    ).toBe(200);
    expect(
      (await request("book/progress", "alice", to, "GET", {}, "es")).payload
        .progress,
    ).toMatchObject({ offset: 0.4, fontSize: 24, language: "es" });
    expect((await request("purchased", "bob", to)).payload.books).toEqual([]);
    expect((await request("book/chapters/first", "bob", to)).code).toBe(403);
    process.env.EBOOK_PROMO_ENABLED = "false";
    expect((await request("book/chapters/first", "alice", to)).code).toBe(200);
    expect(
      (await request("book/redeem", "bob", to, "POST", { code: "Example!" }))
        .code,
    ).toBe(403);
  },
);
it("rejects unauthenticated redemption and does not create a grant", async () => {
  expect(
    (await request("book/redeem", null, "web", "POST", { code: "Example!" }))
      .code,
  ).toBe(401);
  expect(getAdminDb().data.size).toBe(0);
});
