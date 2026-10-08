jest.mock("../../../utils/olbioClient", () => ({ createOlbioInvoiceFromPayload: jest.fn() }));
jest.mock("../../../utils/oblioTax", () => ({ getOblioVatSettings: () => ({}), shouldSendOblioEInvoice: () => false,
  resolveCheckoutSessionOblioTax: () => ({ ok: true, price: 10, total: 12.1, vatPercentage: 21, vatIncluded: 0 }) }));
import { invoiceEbookStripe } from "../invoice";
import { createOlbioInvoiceFromPayload } from "../../../utils/olbioClient";
import { normalizeBillingDetails, buildBillingContextInput } from "../../stripeBillingDetails";
it("invoices the checkout snapshot without phone even after the account profile changes, once only", async () => {
  process.env.OBLIO_CIF = "test"; process.env.OBLIO_SERIES = "TEST";
  createOlbioInvoiceFromPayload.mockResolvedValue({ status: 200, data: { number: "1" } });
  const billing = normalizeBillingDetails({ firstName: "Ana", lastName: "Pop", email: "ana@example.com", address: { country: "Romania", state: "Cluj", city: "Cluj-Napoca", line1: "Strada inițială 1" } });
  const saved = { uid: "alice", ebookId: "book", title: "Book", billingAudit: buildBillingContextInput(billing, null, billing.email) };
  let record = {};
  const ref = { set: async value => { record = { ...record, ...value }; } };
  const db = { collection: jest.fn(() => ({ doc: () => ref })), runTransaction: async fn => fn({ get: async () => ({ data: () => record }), set: (_, value) => ref.set(value) }) };
  const changedProfile = { ...billing, address: { ...billing.address, line1: "Altă adresă 2" } };
  const session = { id: "cs_test_snapshot", amount_total: 1210, currency: "ron" };
  await invoiceEbookStripe(db, session, saved); await invoiceEbookStripe(db, session, saved);
  expect(changedProfile.address.line1).not.toBe(billing.address.line1);
  expect(createOlbioInvoiceFromPayload).toHaveBeenCalledTimes(1);
  expect(createOlbioInvoiceFromPayload.mock.calls[0][0].invoicePayload.client).toMatchObject({ name: "Ana Pop", address: "Strada inițială 1", city: "Cluj-Napoca", phone: "" });
  expect(db.collection.mock.calls.every(([name]) => name === "payments")).toBe(true);
  expect(record.oblio.status).toBe("created");
});
