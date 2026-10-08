import { randomUUID } from "crypto";

// Dedicated mapping for one-time purchases; never changes Premium's customer.
export async function purchaseCustomer(stripe, db, uid, fields) {
  const mode = /^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY || "") ? "test" : "live";
  const ref = db.collection("billingStripeCustomers").doc(`${uid}_${mode}`);
  const mapping = await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    const data = snapshot.data() || {};
    if (data.customerId || data.creationKey) return data;
    const created = { creationKey: randomUUID() };
    tx.set(ref, created);
    return created;
  });
  let customerId = mapping.customerId;
  if (!customerId) {
    // Identical parameters and a persisted key deduplicate concurrent first purchases.
    const customer = await stripe.customers.create({ metadata: { uid, source: "purchase_checkout" } }, {
      idempotencyKey: `purchase-customer-${mapping.creationKey}`,
    });
    customerId = customer.id;
    await ref.set({ customerId }, { merge: true });
  }
  const existing = await stripe.customers.retrieve(customerId);
  if (existing.deleted || existing.metadata?.uid !== uid) throw new Error("Invalid purchase customer");
  await stripe.customers.update(customerId, fields);
  return customerId;
}
