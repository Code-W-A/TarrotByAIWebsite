jest.mock("../invoice", () => ({
  invoiceEbookStripe: jest.fn(async () => ({ created: true })),
}));
jest.mock("../../globalSettings", () => ({
  getVatPercentage: jest.fn(async () => 21),
}));
import { resolveEdition, publicBook, identifier, loadBooks } from "../content";
import { digest, recordPayment, hasAccess, sourceIsActive } from "../access";
import { processStripeEbookEvent } from "../billing";
class Db {
  constructor() {
    this.data = new Map();
  }
  collection(path) {
    const db = this;
    const makeRef = (key) => ({
      path: key,
      id: key.split("/").pop(),
      get: async () => db.snap(key),
      set: async (data, options) => db.write(key, data, options),
      collection: (name) => db.collection(`${key}/${name}`),
    });
    return {
      doc: (id) => makeRef(`${path}/${id}`),
      where: (field, op, value) => ({
        limit: () => ({
          get: async () => {
            const docs = [...db.data]
              .filter(
                ([k, v]) =>
                  k.startsWith(path + "/") &&
                  k.split("/").length === path.split("/").length + 1 &&
                  v[field] === value,
              )
              .map(([k]) => db.snap(k));
            return { empty: !docs.length, size: docs.length, docs };
          },
        }),
      }),
    };
  }
  snap(key) {
    const db = this;
    return {
      id: key.split("/").pop(),
      exists: db.data.has(key),
      data: () => db.data.get(key),
    };
  }
  write(key, data, opts) {
    this.data.set(
      key,
      opts?.merge ? { ...(this.data.get(key) || {}), ...data } : data,
    );
  }
  async runTransaction(fn) {
    const staged = [];
    const result = await fn({
      get: async (ref) => this.snap(ref.path),
      set: (ref, data, opts) => staged.push([ref.path, data, opts]),
    });
    for (const args of staged) this.write(...args);
    return result;
  }
}
const payment = {
  eventId: "first",
  sourceId: "stripe:s1",
  uid: "alice",
  ebookId: "book",
  status: "paid",
  revision: 1000,
  provider: "stripe",
};
beforeEach(() => {
  jest.clearAllMocks();
  process.env.EBOOKS_ENABLED = "true";
});
it("uses requested published edition, otherwise Romanian", () => {
  const editions = [{ language: "ro" }, { language: "es" }];
  expect(resolveEdition(editions, "es").fallback).toBe(false);
  expect(resolveEdition(editions, "fr").language).toBe("ro");
  expect(() => resolveEdition([{ language: "en" }], "fr")).toThrow();
});
it("rejects draft/path identifiers", () => {
  expect(() => identifier("drafts.book")).toThrow();
  expect(() => identifier("../secret")).toThrow();
});
it("public DTO never exposes body or internal revision", () => {
  const dto = publicBook(
    {
      _id: "book",
      price: 100,
      _rev: "secret",
      status: "published",
      editions: [
        {
          language: "ro",
          title: "Book",
          body: "secret",
          chapters: [{ _key: "c", title: "one" }],
        },
      ],
    },
    "es",
  );
  expect(dto.price).toBe(13.31);
  expect(dto.currency).toBe("EUR");
  expect(JSON.stringify(dto)).not.toContain("secret");
  expect(dto.fallback).toBe(true);
});
it("preserves independent paid sources across a refund and isolates accounts", async () => {
  const db = new Db();
  await recordPayment(db, payment);
  expect(await hasAccess(db, "bob", "book")).toBe(false);
  await recordPayment(db, {
    ...payment,
    eventId: "second-platform",
    sourceId: "stripe:s2",
  });
  await recordPayment(db, {
    ...payment,
    eventId: "refund",
    status: "refunded",
    revision: 2000,
  });
  expect(await hasAccess(db, "alice", "book")).toBe(true);
  await recordPayment(db, {
    ...payment,
    eventId: "refund-second-platform",
    sourceId: "stripe:s2",
    status: "refunded",
    revision: 2000,
  });
  expect(await hasAccess(db, "alice", "book")).toBe(false);
});
it("deduplicates and never transfers a transaction to another account", async () => {
  const db = new Db();
  await recordPayment(db, payment);
  expect(await recordPayment(db, payment)).toEqual({ duplicate: true });
  await expect(recordPayment(db, { ...payment, uid: "bob" })).rejects.toThrow(
    "altui cont",
  );
});
it("ignores delayed paid events after a newer refund", async () => {
  const db = new Db();
  await recordPayment(db, {
    ...payment,
    eventId: "refund",
    status: "refunded",
    revision: 2000,
  });
  await recordPayment(db, payment);
  expect(await hasAccess(db, "alice", "book")).toBe(false);
});
it("a refund wins when event timestamps are equal", async () => {
  const db = new Db();
  await recordPayment(db, {
    ...payment,
    eventId: "refund",
    status: "refunded",
  });
  await recordPayment(db, payment);
  expect(await hasAccess(db, "alice", "book")).toBe(false);
});
it("allows a later legitimate repurchase", async () => {
  const db = new Db();
  await recordPayment(db, {
    ...payment,
    eventId: "refund",
    status: "refunded",
    revision: 2000,
  });
  await recordPayment(db, {
    ...payment,
    eventId: "new-purchase",
    revision: 3000,
  });
  expect(await hasAccess(db, "alice", "book")).toBe(true);
});
it("does not grant access for pending or mismatched Stripe sessions", async () => {
  const db = new Db();
  db.data.set("ebookCheckouts/cs_1", {
    uid: "alice",
    ebookId: "book",
    expectedTotal: 12100,
    currency: "ron",
  });
  const session = {
    id: "cs_1",
    payment_status: "unpaid",
    metadata: { kind: "ebook", uid: "alice", ebookId: "book" },
  };
  const event = {
    id: "ev1",
    type: "checkout.session.completed",
    created: 1,
    data: { object: session },
  };
  expect(await processStripeEbookEvent(db, event)).toEqual({ pending: true });
  await expect(
    processStripeEbookEvent(db, {
      ...event,
      data: {
        object: {
          ...session,
          payment_status: "paid",
          amount_total: 100,
          currency: "ron",
          payment_intent: "pi_1",
        },
      },
    }),
  ).rejects.toThrow("verification");
  expect(await hasAccess(db, "alice", "book")).toBe(false);
});
it("grants a verified Stripe payment once and revokes only on full refund", async () => {
  const db = new Db();
  db.data.set("ebookCheckouts/cs_1", {
    uid: "alice",
    ebookId: "book",
    expectedTotal: 12100,
    currency: "ron",
  });
  await processStripeEbookEvent(db, {
    id: "ev1",
    type: "checkout.session.completed",
    created: 1,
    data: {
      object: {
        id: "cs_1",
        payment_status: "paid",
        metadata: { kind: "ebook", uid: "alice", ebookId: "book" },
        amount_total: 12100,
        currency: "ron",
        payment_intent: "pi_1",
      },
    },
  });
  expect(await hasAccess(db, "alice", "book")).toBe(true);
  await processStripeEbookEvent(db, {
    id: "r1",
    type: "charge.refunded",
    created: 2,
    data: { object: { payment_intent: "pi_1", refunded: false } },
  });
  expect(await hasAccess(db, "alice", "book")).toBe(true);
  await processStripeEbookEvent(db, {
    id: "r2",
    type: "charge.refunded",
    created: 3,
    data: { object: { payment_intent: "pi_1", refunded: true } },
  });
  expect(await hasAccess(db, "alice", "book")).toBe(false);
});
it("refuses public Sanity datasets even with a valid API token", async () => {
  process.env.SANITY_PROJECT_ID = "test-project";
  process.env.SANITY_DATASET = "production";
  process.env.SANITY_READ_TOKEN = "test-token";
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => [{ name: "production", aclMode: "public" }],
  }));
  await expect(loadBooks()).rejects.toThrow("privat");
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

// Promo entitlements use the same registry and access checks as Stripe.
import { redeemPromo, promoEnabled, assertCustomer } from "../promo";
const promoCode = "ExampleCaseSensitive!";
function enablePromo() {
  process.env.EBOOK_PROMO_ENABLED = "true";
  process.env.EBOOK_PROMO_CODE_HASH = digest(promoCode);
}
afterEach(() => {
  delete process.env.EBOOK_PROMO_ENABLED;
  delete process.env.EBOOK_PROMO_CODE_HASH;
});
it("grants selected book permanently, idempotently, without payment records", async () => {
  enablePromo();
  const db = new Db();
  expect(
    await redeemPromo(db, { uid: "alice" }, "book", `  ${promoCode}  `, 1000),
  ).toMatchObject({ owned: true, duplicate: false });
  const original = db.data.get("users/alice/ebookAccess/book");
  expect(
    await redeemPromo(db, { uid: "alice" }, "book", promoCode, 1100),
  ).toMatchObject({ owned: true, duplicate: true });
  expect(db.data.get("users/alice/ebookAccess/book")).toEqual(original);
  expect(await hasAccess(db, "alice", "book")).toBe(true);
  expect(await hasAccess(db, "bob", "book")).toBe(false);
  expect(await hasAccess(db, "alice", "another-book")).toBe(false);
  expect(
    [...db.data.keys()].some((k) =>
      /payments|Transactions|PaymentEvents/.test(k),
    ),
  ).toBe(false);
  expect(JSON.stringify([...db.data])).not.toContain(promoCode);
  process.env.EBOOK_PROMO_ENABLED = "false";
  expect(await hasAccess(db, "alice", "book")).toBe(true);
  await expect(
    redeemPromo(db, { uid: "bob" }, "book", promoCode),
  ).rejects.toMatchObject({ statusCode: 403 });
});
it("counts invalid attempts across books and blocks the sixth, resetting after 15 minutes", async () => {
  enablePromo();
  const db = new Db();
  for (let i = 0; i < 5; i++)
    await expect(
      redeemPromo(
        db,
        { uid: "alice" },
        `book${i}`,
        promoCode.toLowerCase(),
        1000 + i,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  await expect(
    redeemPromo(db, { uid: "alice" }, "book", promoCode, 1100),
  ).rejects.toMatchObject({ statusCode: 429 });
  expect(await hasAccess(db, "alice", "book")).toBe(false);
  expect(
    await redeemPromo(db, { uid: "bob" }, "book", promoCode, 1100),
  ).toMatchObject({ owned: true });
  expect(
    await redeemPromo(db, { uid: "alice" }, "book", promoCode, 901000),
  ).toMatchObject({ owned: true });
});
it("rejects missing or anonymous accounts, malformed code and unconfigured promo", async () => {
  enablePromo();
  const db = new Db();
  for (const user of [
    null,
    {},
    { uid: "anon", firebase: { sign_in_provider: "anonymous" } },
    { uid: "anon", isAnonymous: true },
  ])
    expect(() => assertCustomer(user)).toThrow();
  for (const code of [null, "", {}, "x".repeat(257)])
    await expect(
      redeemPromo(db, { uid: "alice" }, "book", code),
    ).rejects.toMatchObject({ statusCode: 400 });
  process.env.EBOOK_PROMO_CODE_HASH = "invalid";
  expect(promoEnabled()).toBe(false);
  await expect(
    redeemPromo(db, { uid: "alice" }, "book", promoCode),
  ).rejects.toMatchObject({ statusCode: 403 });
  expect(db.data.size).toBe(0);
});
it("preserves promo access through Stripe payment and refund", async () => {
  enablePromo();
  const db = new Db();
  await redeemPromo(db, { uid: "alice" }, "book", promoCode);
  await recordPayment(db, payment);
  await recordPayment(db, {
    ...payment,
    eventId: "refund",
    revision: 2000,
    status: "refunded",
  });
  expect(await hasAccess(db, "alice", "book")).toBe(true);
  expect(db.data.get("users/alice/ebookAccess/book").active).toBe(true);
  expect(
    Object.values(db.data.get("users/alice/ebookAccess/book").sources),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ provider: "promo", status: "granted" }),
      expect.objectContaining({ provider: "stripe", status: "refunded" }),
    ]),
  );
});
