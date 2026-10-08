import { createEbookIntent, availableEbookCredits, spendEbookCredit, creditIdFor } from "../credits";
import { confirmNativeEbook, restoreNativeEbooks, processNativeEbookEvent, resolveNativeEbookProduct } from "../native";
import { recordPayment, hasAccess } from "../access";
import { processRevenueCatEvent } from "../../revenueCatBilling";
class Db {
  data = new Map();
  snap(path) { return { id: path.split("/").pop(), exists: this.data.has(path), data: () => this.data.get(path) }; }
  collection(path) {
    return {
      doc: id => ({ path: `${path}/${id}`, get: async () => this.snap(`${path}/${id}`), set: async data => this.data.set(`${path}/${id}`, data), collection: name => this.collection(`${path}/${id}/${name}`) }),
      where: (field, op, value) => ({ get: async () => ({ docs: [...this.data].filter(([key, data]) => key.startsWith(`${path}/`) && data[field] === value).map(([key]) => this.snap(key)) }), limit: count => ({ get: async () => ({ docs: [...this.data].filter(([key, data]) => key.startsWith(`${path}/`) && key.split("/").length === path.split("/").length + 1 && data[field] === value).slice(0, count).map(([key]) => this.snap(key)) }) }) }),
    };
  }
  async runTransaction(fn) {
    const writes = [];
    const result = await fn({ get: async ref => this.snap(ref.path), set: (ref, data, options) => writes.push([ref.path, data, options]) });
    for (const [path, data, options] of writes) this.data.set(path, options?.merge ? { ...this.data.get(path), ...data } : data);
    return result;
  }
}
let db;
const purchase = { id: "rc-internal", store_transaction_id: "tx", store: "APP_STORE", purchase_date: "2026-10-01T12:00:00Z", is_sandbox: false };
const body = { platform: "ios", productId: "book.ios", transactionId: "tx" };
const upstream = purchases => jest.fn(async () => ({ ok: true, json: async () => ({ subscriber: { non_subscriptions: purchases } }) }));
const event = overrides => ({ id: "paid", type: "NON_RENEWING_PURCHASE", product_id: "book.ios", app_user_id: "alice", transaction_id: "tx", store: "APP_STORE", purchased_at_ms: Date.parse(purchase.purchase_date), event_timestamp_ms: Date.parse(purchase.purchase_date), environment: "PRODUCTION", ...overrides });
beforeEach(() => {
  process.env.REVENUECAT_IOS_EBOOK_CREDIT_PRODUCT_ID = "ebook_credit_1"; process.env.REVENUECAT_ANDROID_EBOOK_CREDIT_PRODUCT_ID = "ebook_credit_1";
  process.env.EBOOKS_ENABLED = "true"; process.env.REVENUECAT_SECRET_API_KEY = "secret";
  process.env.IOS_BILLING_EBOOKS_ENABLED = "true"; process.env.ANDROID_BILLING_EBOOKS_ENABLED = "true";
  delete process.env.REVENUECAT_EBOOKS_ALLOW_SANDBOX;
  db = new Db(); db.data.set("ebookRegistry/book", { appleProductId: "book.ios", googleProductId: "book.android", status: "published" });
});
afterEach(() => { delete process.env.IOS_BILLING_EBOOKS_ENABLED; delete process.env.ANDROID_BILLING_EBOOKS_ENABLED; });
it("verifies the actual RevenueCat subscriber, binds access to the account, and writes no invoice", async () => {
  const fetch = upstream({ "book.ios": [purchase] });
  expect(await confirmNativeEbook(db, { uid: "alice" }, "book", body, fetch)).toEqual({ confirmed: true, owned: true });
  expect(fetch.mock.calls[0][0]).toContain("subscribers/alice");
  expect(await hasAccess(db, "alice", "book")).toBe(true);
  expect(await hasAccess(db, "bob", "book")).toBe(false);
  const payments = [...db.data].filter(([key]) => key.startsWith("payments/"));
  expect(payments).toHaveLength(1); expect(payments[0][1].provider).toBe("revenuecat"); expect(payments[0][1].oblio).toBeUndefined();
  await expect(confirmNativeEbook(db, { uid: "bob" }, "book", body, fetch)).rejects.toMatchObject({ statusCode: 409 });
});
it("rejects a different book, unverified transaction or wrong store", async () => {
  await expect(confirmNativeEbook(db, { uid: "alice" }, "other", body, upstream({}))).rejects.toMatchObject({ statusCode: 409 });
  await expect(confirmNativeEbook(db, { uid: "alice" }, "book", body, upstream({}))).rejects.toMatchObject({ statusCode: 409 });
  await expect(confirmNativeEbook(db, { uid: "alice" }, "book", body, upstream({ "book.ios": [{ ...purchase, store: "PLAY_STORE" }] }))).rejects.toMatchObject({ statusCode: 409 });
  expect(await hasAccess(db, "alice", "book")).toBe(false);
});
it("processes webhook duplicates once and prevents refunded receipts from granting access again", async () => {
  await processRevenueCatEvent(db, event());
  expect((await processRevenueCatEvent(db, event())).duplicate).toBe(true);
  await processRevenueCatEvent(db, event({ id: "refund", type: "CANCELLATION", event_timestamp_ms: Date.parse(purchase.purchase_date) + 1000 }));
  expect(await hasAccess(db, "alice", "book")).toBe(false);
  const result = await confirmNativeEbook(db, { uid: "alice" }, "book", body, upstream({ "book.ios": [purchase] }));
  expect(result.owned).toBe(false);
});
it("keeps independent Stripe and promo access when native purchase is refunded", async () => {
  await recordPayment(db, { eventId: "stripe", sourceId: "stripe:payment", uid: "alice", ebookId: "book", provider: "stripe", status: "paid", revision: 1 });
  const access = db.data.get("users/alice/ebookAccess/book");
  access.sources.promo = { provider: "promo", status: "granted" };
  await processRevenueCatEvent(db, event());
  await processRevenueCatEvent(db, event({ id: "refund", type: "REFUND", event_timestamp_ms: Date.parse(purchase.purchase_date) + 1000 }));
  expect(await hasAccess(db, "alice", "book")).toBe(true);
  expect(Object.values(db.data.get("users/alice/ebookAccess/book").sources).map(s => s.status).sort()).toEqual(["granted", "paid", "refunded"]);
});
it("restores mapped books and skips unrelated products and platforms", async () => {
  expect(await restoreNativeEbooks(db, { uid: "alice" }, "ios", upstream({ "book.ios": [purchase], premium: [purchase], "book.android": [{ ...purchase, store: "PLAY_STORE" }] }))).toMatchObject({ restored: 1 });
  expect(await hasAccess(db, "alice", "book")).toBe(true);
});
it("does not grant sandbox or disabled-flow purchases and rejects duplicate mapping", async () => {
  const mapping = await resolveNativeEbookProduct(db, "book.ios", "ios");
  expect((await processNativeEbookEvent(db, event({ environment: "SANDBOX" }), mapping)).skipped).toBe(true);
  expect(await hasAccess(db, "alice", "book")).toBe(false);
  db.data.set("ebookRegistry/duplicate", { appleProductId: "book.ios" });
  await expect(resolveNativeEbookProduct(db, "book.ios", "ios")).rejects.toMatchObject({ statusCode: 409 });
  process.env.IOS_BILLING_EBOOKS_ENABLED = "false";
  await expect(confirmNativeEbook(db, { uid: "alice" }, "book", body, upstream({}))).rejects.toMatchObject({ statusCode: 503 });
});

it("rejects unknown webhook stores", async () => {
  const mapping = await resolveNativeEbookProduct(db, "book.ios", "ios");
  await expect(processNativeEbookEvent(db, event({ store: "UNKNOWN" }), mapping)).rejects.toMatchObject({ statusCode: 409 });
  expect(await hasAccess(db, "alice", "book")).toBe(false);
});

it("never creates a source from a RevenueCat internal ID without a store transaction", async () => {
  const receipt = {...purchase}; delete receipt.store_transaction_id;
  await expect(confirmNativeEbook(db, {uid: "alice"}, "book", {...body, transactionId: "rc-internal"}, upstream({"book.ios": [receipt]}))).rejects.toMatchObject({statusCode: 409});
  expect(await restoreNativeEbooks(db, {uid: "alice"}, "ios", upstream({"book.ios": [receipt]}))).toMatchObject({restored: 0, pending: 1});
  expect(await hasAccess(db, "alice", "book")).toBe(false);
});

it("processes refunds even after new ebook purchases are disabled", async () => {
  await processRevenueCatEvent(db, event());
  process.env.IOS_BILLING_EBOOKS_ENABLED = "false"; process.env.EBOOKS_ENABLED = "false";
  await processRevenueCatEvent(db, event({id: "late-refund", type: "CANCELLATION", event_timestamp_ms: Date.parse(purchase.purchase_date) + 2000}));
  expect(await hasAccess(db, "alice", "book")).toBe(false);
});

it("rejects native product collisions with other billing domains", async () => {
  process.env.REVENUECAT_IOS_PREMIUM_PRODUCT_ID = "book.ios";
  try { await expect(confirmNativeEbook(db, {uid: "alice"}, "book", body, upstream({"book.ios": [purchase]}))).rejects.toMatchObject({statusCode: 409}); }
  finally { delete process.env.REVENUECAT_IOS_PREMIUM_PRODUCT_ID; }
});

const universalEvent = (overrides = {}) => event({product_id: "ebook_credit_1", ...overrides});
it("one universal SKU grants separate credits for separate books and cannot be reused", async () => {
  await processRevenueCatEvent(db, universalEvent());
  const [credit] = await availableEbookCredits(db, {uid: "alice"});
  expect(await hasAccess(db, "alice", "book")).toBe(false);
  const intent = await createEbookIntent(db, {uid: "alice"}, "book", "ios");
  await confirmNativeEbook(db, {uid: "alice"}, "book", {...body, productId: "ebook_credit_1", intentId: intent.intentId}, upstream({}));
  expect(await hasAccess(db, "alice", "book")).toBe(true);
  expect(await availableEbookCredits(db, {uid: "alice"})).toEqual([]);
  await expect(spendEbookCredit(db, {uid: "alice"}, "other", credit)).rejects.toMatchObject({statusCode: 409});
  await processRevenueCatEvent(db, universalEvent({id: "second", transaction_id: "tx2"}));
  await spendEbookCredit(db, {uid: "alice"}, "other", creditIdFor("ios", "tx2"));
  expect(await hasAccess(db, "alice", "other")).toBe(true);
});
it("recovers a verified credit after interruption and rejects account reassignment", async () => {
  await processRevenueCatEvent(db, universalEvent());
  await expect(spendEbookCredit(db, {uid: "bob"}, "book", creditIdFor("ios", "tx"))).rejects.toMatchObject({statusCode: 409});
  await expect(processRevenueCatEvent(db, universalEvent({id: "reassign", app_user_id: "bob"}))).rejects.toMatchObject({statusCode: 409});
  expect(await availableEbookCredits(db, {uid: "alice"})).toHaveLength(1);
  expect((await processRevenueCatEvent(db, universalEvent())).duplicate).toBe(true);
});
it("refunds a spent credit while preserving independent Stripe access", async () => {
  await processRevenueCatEvent(db, universalEvent());
  await spendEbookCredit(db, {uid: "alice"}, "book", creditIdFor("ios", "tx"));
  await recordPayment(db, {eventId:"stripe", sourceId:"stripe:test", uid:"alice", ebookId:"book", provider:"stripe", status:"paid", revision:1});
  await processRevenueCatEvent(db, universalEvent({id:"refund",type:"CANCELLATION",event_timestamp_ms:Date.now()}));
  expect(await hasAccess(db, "alice", "book")).toBe(true);
  expect(await availableEbookCredits(db, {uid:"alice"})).toEqual([]);
});
it("a refund arriving before purchase prevents a credit from being resurrected", async () => {
  await processRevenueCatEvent(db, universalEvent({id:"refund",type:"CANCELLATION",event_timestamp_ms:Date.now()}));
  await processRevenueCatEvent(db, universalEvent());
  expect(await availableEbookCredits(db, {uid:"alice"})).toEqual([]);
});
it("does not spend a credit when the account already owns the book through Stripe", async () => {
  await recordPayment(db, {eventId:"stripe",sourceId:"stripe:test",uid:"alice",ebookId:"book",provider:"stripe",status:"paid",revision:1});
  await processRevenueCatEvent(db, universalEvent());
  await spendEbookCredit(db, {uid:"alice"}, "book", creditIdFor("ios","tx"));
  expect(await availableEbookCredits(db, {uid:"alice"})).toHaveLength(1);
});
