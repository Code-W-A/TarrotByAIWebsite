import crypto from "crypto";
import { digest, sourceIsActive } from "./access";
import { ebookError, identifier } from "./content";

export function promoEnabled() {
  return (
    process.env.EBOOK_PROMO_ENABLED === "true" &&
    /^[a-f0-9]{64}$/i.test(process.env.EBOOK_PROMO_CODE_HASH || "")
  );
}
export function discountEnabled() {
  return process.env.EBOOK_DISCOUNT_ENABLED === "true" &&
    /^[a-f0-9]{64}$/i.test(process.env.EBOOK_DISCOUNT_CODE_HASH || "");
}
export function anyPromoEnabled() { return promoEnabled() || discountEnabled(); }
function matchesHash(code, hash) {
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(digest(code), "hex"));
}
export async function resolveDiscount(db, user, ebookId, token, now = Date.now()) {
  assertCustomer(user);
  if (!discountEnabled()) throw ebookError("Reducerea nu este disponibilă momentan.", 403);
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
    throw ebookError("Reaplică codul promoțional.", 400);
  const grant = (await db.collection("ebookDiscountAuthorizations").doc(digest(token)).get()).data();
  if (!grant || grant.uid !== user.uid || grant.ebookId !== ebookId ||
      !Number.isFinite(grant.expiresAt) || grant.expiresAt <= now || grant.codeHash !== process.env.EBOOK_DISCOUNT_CODE_HASH)
    throw ebookError("Reducerea a expirat sau nu este validă. Reaplică codul.", 403);
  return { total: 300, currency: "ron" };
}
export function assertCustomer(user) {
  if (
    !user?.uid ||
    user.firebase?.sign_in_provider === "anonymous" ||
    user.isAnonymous === true
  )
    throw ebookError(
      "Autentifică-te într-un cont pentru a accesa cartea.",
      401,
    );
  return user;
}

export async function redeemPromo(db, user, ebookId, code, now = Date.now()) {
  assertCustomer(user);
  identifier(ebookId);
  if (!anyPromoEnabled())
    throw ebookError("Promoția nu este disponibilă momentan.", 403);
  if (typeof code !== "string" || !code.trim() || code.length > 256)
    throw ebookError("Introdu un cod promoțional valid.");
  const matches = promoEnabled() && matchesHash(code.trim(), process.env.EBOOK_PROMO_CODE_HASH);
  const discounted = !matches && discountEnabled() && matchesHash(code.trim(), process.env.EBOOK_DISCOUNT_CODE_HASH);
  const token = crypto.randomBytes(32).toString("hex");
  const attempts = db.collection("ebookPromoAttempts").doc(digest(user.uid));
  const access = db
    .collection("users")
    .doc(user.uid)
    .collection("ebookAccess")
    .doc(ebookId);
  const sourceKey = digest("promo:ebook-access-v1");
  // Return validation errors after committing the attempt counter.
  const result = await db.runTransaction(async (tx) => {
    const [attemptSnap, accessSnap] = await Promise.all([
      tx.get(attempts),
      tx.get(access),
    ]);
    const prior = attemptSnap.data() || {};
    const withinWindow =
      Number.isFinite(prior.startedAt) &&
      now - prior.startedAt < 15 * 60 * 1000;
    const count = withinWindow ? prior.count || 0 : 0;
    if (count >= 5) return { limited: true };
    tx.set(attempts, {
      startedAt: withinWindow ? prior.startedAt : now,
      count: count + 1,
    });
    if (discounted) {
      const expiresAt = now + 30 * 60 * 1000;
      tx.set(db.collection("ebookDiscountAuthorizations").doc(digest(token)), {
        uid: user.uid, ebookId, expiresAt, codeHash: process.env.EBOOK_DISCOUNT_CODE_HASH,
      });
      return { type: "discount", authorization: token, expiresAt, price: 3, currency: "RON", vatIncluded: true };
    }
    if (!matches) return { invalid: true };
    const sources = accessSnap.data()?.sources || {};
    if (
      sources[sourceKey]?.provider === "promo" &&
      sources[sourceKey]?.status === "granted"
    )
      return { owned: true, duplicate: true };
    const next = {
      ...sources,
      [sourceKey]: { provider: "promo", status: "granted", grantedAt: now },
    };
    tx.set(
      access,
      { ebookId, sources: next, active: sourceIsActive(next), updatedAt: now },
      { merge: true },
    );
    return { owned: true, duplicate: false };
  });
  if (result.limited)
    throw ebookError("Prea multe încercări. Reîncearcă după 15 minute.", 429);
  if (result.invalid) throw ebookError("Codul promoțional nu este valid.", 400);
  return result;
}
