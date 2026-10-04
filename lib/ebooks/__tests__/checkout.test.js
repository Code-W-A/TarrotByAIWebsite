jest.mock("../content", () => ({
  metadata: jest.fn(),
  assertEbooksEnabled: jest.fn(),
  identifier: (x) => x,
  ebookError: (message, statusCode = 400) =>
    Object.assign(new Error(message), { statusCode }),
}));
jest.mock("../access", () => ({
  hasAccess: jest.fn(),
  digest: jest.fn(),
  recordPayment: jest.fn(),
}));
jest.mock("../invoice", () => ({ invoiceEbookStripe: jest.fn() }));
jest.mock("../../stripeFixedVatServer", () => ({
  getFixedVatTaxRateId: async () => "txr_example",
}));
jest.mock("../../globalSettings", () => ({
  getVatPercentage: async () => 21,
  getGlobalSettings: jest.fn(),
}));
jest.mock("stripe", () => jest.fn());
import Stripe from "stripe";
import { checkout } from "../billing";
import { getGlobalSettings } from "../../globalSettings";
import { metadata } from "../content";
import { hasAccess } from "../access";
const billing = {
  billingType: "individual",
  firstName: "Ana",
  lastName: "Pop",
  email: "ana@example.com",
  phone: "0700000000",
  address: {
    line1: "Strada Exemplu 1",
    city: "Cluj-Napoca",
    state: "Cluj",
    country: "Romania",
  },
};
const create = jest.fn();
const set = jest.fn();
const db = { collection: () => ({ doc: () => ({ set }) }) };
beforeEach(() => {
  jest.clearAllMocks();
  getGlobalSettings.mockResolvedValue({ iosCoursesHidden: true });
  process.env.STRIPE_FIXED_VAT_TAX_RATE_ID = "txr_example";
  process.env.EBOOKS_STRIPE_ENABLED = "true";
  process.env.STRIPE_SECRET_KEY = "sk_test_example";
  process.env.NEXT_PUBLIC_SITE_URL = "https://example.com";
  hasAccess.mockResolvedValue(false);
  metadata.mockResolvedValue({
    book: { price: 10, currency: "RON" },
    safe: { title: "Carte", language: "ro" },
  });
  create.mockResolvedValue({
    id: "cs_example",
    url: "https://checkout.stripe.com/example",
  });
  Stripe.mockImplementation(() => ({ checkout: { sessions: { create } } }));
});
it("calculates price and VAT on the server and saves authenticated ownership", async () => {
  await checkout(db, { uid: "alice", email: billing.email }, "book", "ro", {
    ...billing,
    price: 1,
    uid: "mallory",
  });
  expect(create.mock.calls[0][0].line_items[0].price_data.unit_amount).toBe(
    1000,
  );
  expect(create.mock.calls[0][0].metadata.uid).toBe("alice");
  expect(set.mock.calls[0][0]).toMatchObject({
    uid: "alice",
    expectedTotal: 1210,
    ebookId: "book",
  });
});
it("refuses checkout without fiscal details", async () => {
  await expect(
    checkout(db, { uid: "alice" }, "book", "ro", {}),
  ).rejects.toThrow("facturare");
  expect(create).not.toHaveBeenCalled();
});
it("refuses buying a book already owned", async () => {
  hasAccess.mockResolvedValue(true);
  await expect(
    checkout(db, { uid: "alice" }, "book", "ro", billing),
  ).rejects.toThrow("deja");
  expect(create).not.toHaveBeenCalled();
});

it("uses current published dashboard price for new purchases", async () => {
  await checkout(db, { uid: "alice" }, "first", "ro", billing);
  metadata.mockResolvedValue({
    book: { price: 25, currency: "RON" },
    safe: { title: "Another book", language: "es" },
  });
  await checkout(db, { uid: "alice" }, "first", "es", billing, "android");
  expect(create.mock.calls[0][0].line_items[0].price_data.unit_amount).toBe(
    1000,
  );
  expect(create.mock.calls[1][0].line_items[0].price_data.unit_amount).toBe(
    2500,
  );
  expect(set.mock.calls[1][0].expectedTotal).toBe(3025);
  expect(set.mock.calls[0][0].expectedTotal).toBe(1210);
  metadata.mockResolvedValue({
    book: { price: 7, currency: "RON" },
    safe: { title: "Different book", language: "ro" },
  });
  await checkout(db, { uid: "alice" }, "second", "ro", billing, "android");
  expect(create.mock.calls[2][0].line_items[0].price_data.unit_amount).toBe(
    700,
  );
  expect(set.mock.calls[2][0]).toMatchObject({
    ebookId: "second",
    expectedTotal: 847,
  });
});
it("blocks iOS checkout by default, including an iOS header with a web body", async () => {
  await expect(
    checkout(db, { uid: "alice" }, "book", "ro", billing, "ios"),
  ).rejects.toMatchObject({ statusCode: 403 });
  await expect(
    checkout(db, { uid: "alice" }, "book", "ro", billing, "web", "ios"),
  ).rejects.toMatchObject({ statusCode: 403 });
  expect(create).not.toHaveBeenCalled();
});
it("uses Stripe on iOS when the ebook setting enables checkout", async () => {
  getGlobalSettings.mockResolvedValue({ iosCoursesHidden: true, iosEbooksStripeEnabled: true });
  const session = await checkout(
    db,
    { uid: "alice" },
    "book",
    "ro",
    billing,
    "ios",
  );
  expect(create.mock.calls[0][0].metadata.platform).toBe("ios");
  expect(session.returnUrlBase).toBe("https://example.com/ro/ebooks/book");
});
