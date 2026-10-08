import crypto from "crypto";
import { digest, sourceIsActive } from "./access";
import { ebookError, identifier } from "./content";

export function universalProduct(platform) {
  if (!["ios", "android"].includes(platform)) return null;
  return process.env[`REVENUECAT_${platform.toUpperCase()}_EBOOK_CREDIT_PRODUCT_ID`] || null;
}
const accessRef = (db, uid, book) => db.collection("users").doc(uid).collection("ebookAccess").doc(book);
const creditRef = (db, platform, transactionId) => db.collection("ebookCredits").doc(digest(`revenuecat:${platform}:${transactionId}`));
function owner(uid) {
  if (!uid || uid.startsWith("$RCAnonymousID:")) throw ebookError("Invalid account", 403);
}
export async function createEbookIntent(db, user, ebookId, platform) {
  owner(user.uid); identifier(ebookId);
  if (!universalProduct(platform)) throw ebookError("Native billing is unavailable", 503);
  const id = crypto.randomUUID();
  await db.collection("ebookPurchaseIntents").doc(id).set({ uid: user.uid, ebookId, platform, createdAt: Date.now(), status: "pending" });
  return { intentId: id, productId: universalProduct(platform) };
}

// A verified store transaction creates exactly one durable credit. Refund tombstones
// prevent late purchase events or stale subscriber snapshots resurrecting it.
export async function recordEbookCredit(db, { uid, platform, transactionId, status, revision, eventId }) {
  owner(uid);
  if (!["ios", "android"].includes(platform) || typeof transactionId !== "string" || !transactionId || !["paid", "refunded"].includes(status) || !Number.isFinite(revision) || !eventId) throw ebookError("Invalid credit event");
  const ref = creditRef(db, platform, transactionId);
  const event = db.collection("ebookPaymentEvents").doc(digest(`credit:${eventId}`));
  return db.runTransaction(async tx => {
    const [cs, es] = await Promise.all([tx.get(ref), tx.get(event)]);
    const old = cs.data();
    if (old && old.uid !== uid) throw ebookError("Purchase belongs to another account", 409);
    if (es.exists) return { duplicate: true };
    if (old?.status === "refunded" || (old && old.revision > revision)) {
      tx.set(event, { ignored: true }); return { ignored: true };
    }
    const target = old?.ebookId ? accessRef(db, uid, old.ebookId) : null;
    const owned = target ? await tx.get(target) : null;
    const next = { ...old, uid, platform, transactionId, revision, status: status === "refunded" ? "refunded" : old?.status || "available" };
    tx.set(ref, next);
    if (target && status === "refunded") {
      const sources = { ...(owned.data()?.sources || {}), [ref.id || ref.path.split("/").pop()]: { provider: "revenuecat", status: "refunded", revision } };
      tx.set(target, { sources, active: sourceIsActive(sources), updatedAt: Date.now() }, { merge: true });
    }
    tx.set(event, { at: Date.now(), creditId: ref.id || ref.path.split("/").pop() });
    return { confirmed: true };
  });
}
export async function availableEbookCredits(db, user) {
  owner(user.uid);
  const snaps = await db.collection("ebookCredits").where("uid", "==", user.uid).get();
  return snaps.docs.filter(s => s.data().status === "available").map(s => s.id);
}
// All reads precede writes. Two devices cannot spend one credit twice, and
// concurrent Stripe grants leave this credit available instead of wasting it.
export async function spendEbookCredit(db, user, ebookId, creditId, intentId = null) {
  owner(user.uid); identifier(ebookId);
  if (!/^[a-f0-9]{64}$/.test(creditId)) throw ebookError("Invalid credit");
  const credit = db.collection("ebookCredits").doc(creditId);
  const access = accessRef(db, user.uid, ebookId);
  const intent = intentId ? db.collection("ebookPurchaseIntents").doc(identifier(intentId)) : null;
  return db.runTransaction(async tx => {
    const [cs, as, ins] = await Promise.all([tx.get(credit), tx.get(access), intent ? tx.get(intent) : null]);
    const row = cs.data();
    if (!row || row.uid !== user.uid) throw ebookError("Credit unavailable", 409);
    if (intent && (!ins.exists || ins.data().uid !== user.uid || ins.data().ebookId !== ebookId || ins.data().platform !== row.platform)) throw ebookError("Invalid purchase intent", 409);
    if (intent && ins.data().creditId && ins.data().creditId !== creditId) throw ebookError("Intent already completed", 409);
    if (row.status === "refunded") throw Object.assign(ebookError("Purchase refunded", 409), { code: "EBOOK_PURCHASE_REFUNDED" });
    if (row.status === "spent" && row.ebookId !== ebookId) throw Object.assign(ebookError("Credit already used", 409), { code: "EBOOK_CREDIT_SPENT" });
    if (sourceIsActive(as.data()?.sources)) return { confirmed: true, owned: true };
    if (row.status !== "available") throw ebookError("Credit unavailable", 409);
    const sources = { ...(as.data()?.sources || {}), [creditId]: { provider: "revenuecat", status: "paid", revision: row.revision } };
    tx.set(credit, { ...row, status: "spent", ebookId, spentAt: Date.now() });
    tx.set(access, { ebookId, sources, active: true, updatedAt: Date.now() }, { merge: true });
    if (intent) tx.set(intent, { status: "completed", creditId }, { merge: true });
    return { confirmed: true, owned: true };
  });
}
export const creditIdFor = (platform, transactionId) => digest(`revenuecat:${platform}:${transactionId}`);
