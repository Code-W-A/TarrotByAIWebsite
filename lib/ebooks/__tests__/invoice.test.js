jest.mock("../../../utils/olbioClient", () => ({
  createOlbioInvoiceFromPayload: jest.fn(),
}));
jest.mock("../../../utils/oblioTax", () => ({
  getOblioVatSettings: jest.fn(),
  resolveCheckoutSessionOblioTax: jest.fn(() => ({
    ok: true,
    price: 10,
    total: 12.1,
    vatPercentage: 21,
    vatIncluded: 0,
  })),
  shouldSendOblioEInvoice: () => false,
}));
jest.mock("../../../utils/billingAudit.mjs", () => ({
  normalizeBillingContext: () => ({
    validation: { ok: true },
    normalizedClient: {},
  }),
  buildInvoiceDecision: () => ({ sendEInvoice: false }),
  buildOblioClientFromNormalized: () => ({ name: "Customer" }),
}));
import { invoiceEbookStripe } from "../invoice";
import { createOlbioInvoiceFromPayload } from "../../../utils/olbioClient";
function database() {
  let data = {};
  const ref = {
    get: async () => ({ data: () => data }),
    set: async (value) => {
      data = { ...data, ...value };
    },
  };
  return {
    collection: () => ({ doc: () => ref }),
    runTransaction: async (fn) =>
      fn({ get: ref.get, set: (_, value) => ref.set(value) }),
    value: () => data,
  };
}
const session = { id: "cs_test_ebook", amount_total: 1210, currency: "ron" };
const saved = {
  uid: "alice",
  ebookId: "book",
  title: "Book",
  billingAudit: {},
};
beforeEach(() => {
  jest.clearAllMocks();
  process.env.OBLIO_CIF = "example";
  process.env.OBLIO_SERIES = "TEST";
});
it("issues the invoice once when payment webhooks repeat", async () => {
  const db = database();
  createOlbioInvoiceFromPayload.mockResolvedValue({
    status: 200,
    data: { number: "1" },
  });
  await invoiceEbookStripe(db, session, saved);
  await invoiceEbookStripe(db, session, saved);
  expect(createOlbioInvoiceFromPayload).toHaveBeenCalledTimes(1);
  expect(db.value().oblio.status).toBe("created");
});
it("retains payment and marks ambiguous invoice failures for manual review without retry", async () => {
  const db = database();
  createOlbioInvoiceFromPayload.mockRejectedValue(new Error("Connection lost"));
  await invoiceEbookStripe(db, session, saved);
  await invoiceEbookStripe(db, session, saved);
  expect(createOlbioInvoiceFromPayload).toHaveBeenCalledTimes(1);
  expect(db.value().paymentStatus).toBe("paid");
  expect(db.value().oblio.status).toBe("pending_manual");
});
it("records missing fiscal configuration without attempting an invoice", async () => {
  delete process.env.OBLIO_SERIES;
  const db = database();
  await invoiceEbookStripe(db, session, saved);
  expect(createOlbioInvoiceFromPayload).not.toHaveBeenCalled();
  expect(db.value().oblio.status).toBe("pending_manual");
});
