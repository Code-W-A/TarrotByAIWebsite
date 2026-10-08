import { universalProduct, recordEbookCredit, spendEbookCredit, creditIdFor, availableEbookCredits } from "./credits";
import { getBillingConfig, getStaticCourseProductMap, getStaticBundleProductMap, isRevenueCatFlowEnabled, normalizeRevenueCatProductId, platformFromRevenueCatStore } from "../billingConfig";
import { ebookError, identifier } from "./content";
import { recordPayment, hasAccess } from "./access";

export function nativeEbookAvailability() {
  const configured = process.env.EBOOKS_ENABLED === "true" && Boolean(process.env.REVENUECAT_SECRET_API_KEY);
  return { ios: configured && Boolean(universalProduct("ios")) && isRevenueCatFlowEnabled("ebooks", "ios"), android: configured && Boolean(universalProduct("android")) && isRevenueCatFlowEnabled("ebooks", "android") };
}
export async function resolveNativeEbookProduct(db, productId, platform, includeDisabled = false) {
  if (!["ios", "android"].includes(platform)) return null;
  const product = normalizeRevenueCatProductId(productId);
  if (!product) return null;
  const config = getBillingConfig()[platform];
  const reserved = [config.premium.productId, ...Object.values(config.analyses.productIds), ...Object.keys(getStaticCourseProductMap()), ...Object.keys(getStaticBundleProductMap())].filter(Boolean).map(normalizeRevenueCatProductId);
  if (reserved.includes(product)) {
    if (product === universalProduct(platform)) throw ebookError("Product is reserved for another billing domain", 409);
    return null;
  }
  if (product === universalProduct(platform)) return { kind: "ebook", universal: true, productId: product, platform };
  if (!includeDisabled && !isRevenueCatFlowEnabled("ebooks", platform)) return null;
  const field = platform === "ios" ? "appleProductId" : "googleProductId";
  const result = await db.collection("ebookRegistry").where(field, "==", product).limit(2).get();
  if (result.docs.length > 1) throw ebookError("Duplicate ebook product mapping", 409);
  const book = result.docs[0];
  if (book && !["published", "archived"].includes(book.data().status)) return null;
  return book ? { kind: "ebook", itemId: identifier(book.id), productId: product, platform } : null;
}
export async function processNativeEbookEvent(db, event, mapping) {
  if (platformFromRevenueCatStore(event.store) !== mapping.platform) throw ebookError("Purchase store mismatch", 409);
  if (event.environment === "SANDBOX" && process.env.REVENUECAT_EBOOKS_ALLOW_SANDBOX !== "true")
    return { skipped: true, reason: "sandbox_disabled" };
  const status = ["NON_RENEWING_PURCHASE", "INITIAL_PURCHASE"].includes(event.type) ? "paid"
    : ["REFUND", "CANCELLATION"].includes(event.type) ? "refunded" : null;
  if (!status) return { skipped: true, reason: "event_not_applicable" };
  if (!mapping.universal && status === "paid" && (process.env.EBOOKS_ENABLED !== "true" || !isRevenueCatFlowEnabled("ebooks", mapping.platform))) return { skipped: true, reason: "ebooks_disabled" };
  const transactionId = event.transaction_id;
  if (!transactionId || typeof transactionId !== "string" || transactionId.length > 500) throw ebookError("Missing store transaction", 400);
  const revision = status === "paid" ? Number(event.purchased_at_ms) : Number(event.event_timestamp_ms);
  if (!Number.isFinite(revision) || revision <= 0) throw ebookError("Invalid purchase timestamp");
  if (mapping.universal) return recordEbookCredit(db, { uid: event.app_user_id, platform: mapping.platform, transactionId, status, revision, eventId: event.id });
  return recordPayment(db, {
    eventId: event.id, sourceId: `revenuecat:${mapping.platform}:${transactionId}`,
    uid: event.app_user_id, ebookId: mapping.itemId, provider: "revenuecat", status, revision,
  });
}
async function subscriberFor(uid, fetchImpl) {
  const key = process.env.REVENUECAT_SECRET_API_KEY;
  if (!key) throw ebookError("Native billing is not configured", 503);
  const response = await fetchImpl(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(uid)}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw ebookError("Purchase verification unavailable", response.status === 404 ? 409 : 502);
  return (await response.json()).subscriber || {};
}
function storeTransaction(purchase) {
  return purchase.store_transaction_id || purchase.transaction_id;
}
async function grantVerified(db, uid, mapping, purchase) {
  const platform = platformFromRevenueCatStore(purchase.store);
  if (platform !== mapping.platform) throw ebookError("Purchase store mismatch", 409);
  if (!storeTransaction(purchase)) throw ebookError("Store transaction pending. Retry verification after the webhook.", 409);
  const revoked = purchase.refunded_at || purchase.refund_date || purchase.revocation_date || purchase.is_refunded;
  return processNativeEbookEvent(db, {
    id: `verify:${platform}:${storeTransaction(purchase)}:${revoked ? "refunded" : "paid"}`,
    store: purchase.store, app_user_id: uid, transaction_id: String(storeTransaction(purchase) || ""),
    type: revoked ? "REFUND" : "NON_RENEWING_PURCHASE",
    purchased_at_ms: Date.parse(purchase.purchase_date),
    event_timestamp_ms: Date.parse(purchase.refunded_at || purchase.refund_date || purchase.revocation_date || purchase.purchase_date),
    environment: purchase.is_sandbox ? "SANDBOX" : "PRODUCTION",
  }, mapping);
}
export async function confirmNativeEbook(db, user, id, body, fetchImpl = fetch) {
  if (!nativeEbookAvailability()[body.platform]) throw ebookError("Native ebook billing is unavailable", 503);
  const mapping = await resolveNativeEbookProduct(db, body.productId, body.platform);
  if (!mapping || (!mapping.universal && mapping.itemId !== id)) throw ebookError("Product does not match the selected book", 409);
  if (typeof body.transactionId !== "string" || !body.transactionId || body.transactionId.length > 500) throw ebookError("Invalid transaction ID");
  if (mapping.universal) {
    const intent = await db.collection("ebookPurchaseIntents").doc(identifier(body.intentId)).get();
    if (!intent.exists || intent.data().uid !== user.uid || intent.data().ebookId !== id || intent.data().platform !== body.platform) throw ebookError("Invalid purchase intent", 409);
    // A signed webhook may have arrived first; it is already authoritative.
    const creditId = creditIdFor(body.platform, body.transactionId);
    const credit = await db.collection("ebookCredits").doc(creditId).get();
    if (credit.exists) return spendEbookCredit(db, user, id, creditId, body.intentId);
  }
  const subscriber = await subscriberFor(user.uid, fetchImpl);
  if (mapping.universal && subscriber.original_app_user_id !== user.uid) throw ebookError("Purchase verification pending. Retry after the webhook.", 409);
  const entries = Object.entries(subscriber.non_subscriptions || {}).filter(([product]) => normalizeRevenueCatProductId(product) === mapping.productId);
  const purchase = entries.flatMap(([, purchases]) => Array.isArray(purchases) ? purchases : []).find(p =>
    [p.store_transaction_id, p.transaction_id, p.id].some(v => String(v || "") === body.transactionId));
  if (!purchase && await hasAccess(db, user.uid, id)) return {confirmed: true, owned: true};
  if (!purchase) throw ebookError("Se verifică achiziția. Reîncearcă.", 409);
  await grantVerified(db, user.uid, mapping, purchase);
  if (mapping.universal) return spendEbookCredit(db, user, id, creditIdFor(mapping.platform, String(storeTransaction(purchase))), body.intentId);
  return { confirmed: true, owned: await hasAccess(db, user.uid, id) };
}
export async function restoreNativeEbooks(db, user, platform, fetchImpl = fetch) {
  if (!nativeEbookAvailability()[platform]) throw ebookError("Native ebook billing is unavailable", 503);
  const subscriber = await subscriberFor(user.uid, fetchImpl);
  let restored = 0;
  let pending = 0;
  for (const [productId, purchases] of Object.entries(subscriber.non_subscriptions || {})) {
    const mapping = await resolveNativeEbookProduct(db, productId, platform);
    if (!mapping) continue;
    if (mapping.universal && subscriber.original_app_user_id !== user.uid) { pending++; continue; }
    for (const purchase of Array.isArray(purchases) ? purchases : []) {
      if (platformFromRevenueCatStore(purchase.store) !== platform) continue;
      if (storeTransaction(purchase)) await grantVerified(db, user.uid, mapping, purchase);
      else pending++;
      if (!mapping.universal && await hasAccess(db, user.uid, mapping.itemId)) restored++;
    }
  }
  const credits = await availableEbookCredits(db, user);
  return { restored, pending, credits };
}
