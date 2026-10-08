import crypto from "crypto";
import { ebookError, identifier } from "./content";
export const digest = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
export function sourceIsActive(sources = {}) {
  return Object.values(sources).some(
    (s) =>
      s.status === "paid" || (s.provider === "promo" && s.status === "granted"),
  );
}
export async function hasAccess(db, uid, id) {
  const snap = await db
    .collection("users")
    .doc(uid)
    .collection("ebookAccess")
    .doc(identifier(id))
    .get();
  return snap.exists && sourceIsActive(snap.data().sources);
}
export async function requireEbookAccess(db, uid, id) {
  if (!(await hasAccess(db, uid, id)))
    throw ebookError("Cumpără ebookul pentru a-l putea citi", 403);
}
// A source is one provider transaction. Refunds only revoke that source.
export async function recordPayment(
  db,
  { eventId, sourceId, uid, ebookId, status, revision, provider },
) {
  identifier(ebookId);
  if (
    !uid ||
    uid.startsWith("$RCAnonymousID:") ||
    !sourceId ||
    !eventId ||
    !["stripe", "revenuecat"].includes(provider) ||
    !sourceId.startsWith(`${provider}:`) ||
    !["paid", "refunded"].includes(status) ||
    !Number.isFinite(revision)
  )
    throw ebookError("Invalid payment event");
  const key = digest(sourceId);
  const ledger = db.collection("ebookTransactions").doc(key);
  const event = db
    .collection("ebookPaymentEvents")
    .doc(digest(`${provider}:${eventId}`));
  const access = db
    .collection("users")
    .doc(uid)
    .collection("ebookAccess")
    .doc(ebookId);
  return db.runTransaction(async (tx) => {
    const [es, ls, as] = await Promise.all([
      tx.get(event),
      tx.get(ledger),
      tx.get(access),
    ]);
    if (ls.exists && (ls.data().uid !== uid || ls.data().ebookId !== ebookId))
      throw ebookError("Achiziția este asociată altui cont", 409);
    if (es.exists) return { duplicate: true };
    if (
      ls.exists &&
      (ls.data().revision > revision ||
        (ls.data().revision === revision && ls.data().status === "refunded"))
    ) {
      tx.set(event, { ignored: true, at: Date.now() });
      return { ignored: true };
    }
    const sources = {
      ...(as.data()?.sources || {}),
      [key]: { status, revision, provider },
    };
    tx.set(ledger, { uid, ebookId, status, revision, provider, sourceId });
    tx.set(
      access,
      {
        ebookId,
        sources,
        active: sourceIsActive(sources),
        updatedAt: Date.now(),
      },
      { merge: true },
    );
    const paymentId = provider === "stripe" ? sourceId.slice("stripe:".length) : `ebook_rc_${key}`;
    tx.set(
      db.collection("payments").doc(paymentId),
      {
        uid,
        ebookId,
        purchaseType: "ebook",
        provider,
        paymentStatus: status,
        entitlementGranted: sourceIsActive(sources),
        updatedAt: Date.now(),
      },
      { merge: true },
    );
    tx.set(event, { source: key, at: Date.now() });
    return { confirmed: true, entitlementGranted: sourceIsActive(sources) };
  });
}
