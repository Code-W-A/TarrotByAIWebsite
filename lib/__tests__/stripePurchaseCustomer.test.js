import { purchaseCustomer } from "../stripePurchaseCustomer";
it("reuses one purchase customer across courses and ebooks, independently of other accounts", async () => {
  const documents = new Map();
  const db = { collection: () => ({ doc: key => ({ key, set: async value => documents.set(key, { ...documents.get(key), ...value }) }) }),
    runTransaction: async callback => callback({ get: async ref => ({ data: () => documents.get(ref.key) }), set: (ref, value) => documents.set(ref.key, value) }) };
  const customers = new Map();
  const stripe = { customers: {
    create: jest.fn(async params => { const value = { ...params, id: `cus_${customers.size}` }; customers.set(value.id, value); return value; }),
    retrieve: jest.fn(async id => customers.get(id)),
    update: jest.fn(async () => ({})),
  } };
  const first = await purchaseCustomer(stripe, db, "alice", { name: "Ana", address: { country: "RO" } });
  expect(await purchaseCustomer(stripe, db, "alice", { name: "Ana", address: { country: "FR" } })).toBe(first);
  expect(await purchaseCustomer(stripe, db, "bob", { name: "Bob" })).not.toBe(first);
  expect(stripe.customers.create).toHaveBeenCalledTimes(2);
  expect(stripe.customers.create.mock.calls[0][1].idempotencyKey).toMatch(/^purchase-customer-/);
});
it("rejects a customer belonging to another UID", async () => {
  const stripe = { customers: { retrieve: jest.fn(async () => ({ metadata: { uid: "bob" } })), update: jest.fn() } };
  const db = { collection: () => ({ doc: () => ({}) }), runTransaction: async callback => callback({ get: async () => ({ data: () => ({ customerId: "cus_bob" }) }) }) };
  await expect(purchaseCustomer(stripe, db, "alice", {})).rejects.toThrow("Invalid purchase customer");
  expect(stripe.customers.update).not.toHaveBeenCalled();
});
