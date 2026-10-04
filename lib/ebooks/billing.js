import { invoiceEbookStripe } from "./invoice";
import {
  normalizeBillingDetails,
  buildBillingContextInput,
} from "../stripeBillingDetails";
import { normalizeBillingContext } from "../../utils/billingAudit.mjs";
import Stripe from "stripe";
import {
  metadata,
  ebookError,
  identifier,
  assertEbooksEnabled,
} from "./content";
import { recordPayment, hasAccess } from "./access";
import { getFixedVatTaxRateId } from "../stripeFixedVatServer";
import { getVatPercentage, getGlobalSettings } from "../globalSettings";
import { calculateFixedVatMinor } from "../stripeFixedVatCore";
export async function stripeAvailability() {
  const enabled =
    process.env.EBOOKS_STRIPE_ENABLED === "true" &&
    Boolean(
      process.env.STRIPE_SECRET_KEY &&
      (process.env.STRIPE_FIXED_VAT_TAX_RATE_ID ||
        process.env.STRIPE_FIXED_VAT_TAX_RATE_ID_TEST),
    );
  if (!enabled) return { web: false, android: false, ios: false };
  let iosEbooksStripeEnabled = false;
  try {
    iosEbooksStripeEnabled = (await getGlobalSettings()).iosEbooksStripeEnabled === true;
  } catch {}
  return { web: enabled, android: enabled, ios: enabled && iosEbooksStripeEnabled };
}
export function stripeClient() {
  if (!process.env.STRIPE_SECRET_KEY)
    throw ebookError("Plata nu este disponibilă", 503);
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}
export async function checkout(
  db,
  user,
  id,
  locale,
  rawBilling,
  platform = "web",
  headerPlatform,
) {
  assertEbooksEnabled();
  if (process.env.EBOOKS_STRIPE_ENABLED !== "true")
    throw ebookError("Plata nu este încă disponibilă", 503);
  if (!["web", "ios", "android"].includes(platform))
    throw ebookError("Invalid checkout platform");
  const availability = await stripeAvailability();
  if (
    (platform === "ios" || String(headerPlatform || "").trim().toLowerCase() === "ios") &&
    !availability.ios
  )
    throw ebookError("Checkoutul iOS nu este disponibil", 403);
  if (!availability[platform])
    throw ebookError("Plata nu este disponibilă", 503);
  if (await hasAccess(db, user.uid, id))
    throw ebookError("Cartea este deja cumpărată", 409);
  const { book, safe } = await metadata(id, locale);
  const stripe = stripeClient();
  const base = process.env.NEXT_PUBLIC_SITE_URL;
  if (!base || !/^https?:\/\//.test(base))
    throw ebookError("Site URL is not configured", 503);
  const billing = normalizeBillingDetails(rawBilling, user.email || "");
  const audit = normalizeBillingContext(
    buildBillingContextInput(billing, rawBilling, user.email || ""),
    { defaultCountry: "Romania", individualCnpOptional: true },
  );
  if (!billing || !audit.validation.ok)
    throw ebookError("Completează datele de facturare.");
  const amount = Math.round(book.price * 100);
  const expected = calculateFixedVatMinor(amount, await getVatPercentage());
  const url = `${base.replace(/\/$/, "")}/${safe.language}/ebooks/${id}`;
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: user.email || undefined,
    billing_address_collection: "required",
    phone_number_collection: { enabled: true },
    tax_id_collection: { enabled: true },
    line_items: [
      {
        price_data: {
          currency: (book.currency || "RON").toLowerCase(),
          unit_amount: amount,
          tax_behavior: "exclusive",
          product_data: { name: safe.title },
        },
        quantity: 1,
        tax_rates: [await getFixedVatTaxRateId(stripe)],
      },
    ],
    metadata: { kind: "ebook", uid: user.uid, ebookId: id, platform },
    success_url: `${url}?checkout=success`,
    cancel_url: `${url}?checkout=cancelled`,
  });
  await db
    .collection("ebookCheckouts")
    .doc(session.id)
    .set({
      uid: user.uid,
      ebookId: id,
      expectedTotal: expected.total,
      currency: (book.currency || "RON").toLowerCase(),
      createdAt: Date.now(),
      title: safe.title,
      billing,
      billingAudit: buildBillingContextInput(billing, null, user.email || ""),
    });
  return { url: session.url, returnUrlBase: url };
}
export async function processStripeEbookEvent(db, event, stripe) {
  if (
    [
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
    ].includes(event.type)
  ) {
    const session = event.data.object;
    if (session.metadata?.kind !== "ebook") return { skipped: true };
    const snap = await db.collection("ebookCheckouts").doc(session.id).get();
    const saved = snap.data();
    if (!saved) throw ebookError("Unknown checkout", 409);
    if (session.payment_status !== "paid") return { pending: true };
    if (
      session.metadata.uid !== saved.uid ||
      session.metadata.ebookId !== saved.ebookId ||
      session.amount_total !== saved.expectedTotal ||
      session.currency !== saved.currency
    )
      throw ebookError("Payment verification failed", 409);
    if (!session.payment_intent)
      throw ebookError("Missing payment intent", 409);
    await db
      .collection("ebookStripePayments")
      .doc(session.payment_intent)
      .set({ ...saved, sessionId: session.id }, { merge: true });
    const access = await recordPayment(db, {
      eventId: event.id,
      sourceId: `stripe:${session.id}`,
      uid: saved.uid,
      ebookId: saved.ebookId,
      status: "paid",
      revision: event.created * 1000,
      provider: "stripe",
    });
    const invoice = access.ignored
      ? { skipped: true }
      : await invoiceEbookStripe(db, session, saved);
    return { ...access, invoice };
  }
  if (event.type === "charge.refunded") {
    const charge = event.data.object;
    if (!charge.payment_intent) return { skipped: true };
    let snap = await db
      .collection("ebookStripePayments")
      .doc(charge.payment_intent)
      .get();
    if (!snap.exists) {
      const sessions = await stripe.checkout.sessions.list({
        payment_intent: charge.payment_intent,
        limit: 1,
      });
      const session = sessions.data[0];
      if (session?.metadata?.kind !== "ebook") return { skipped: true };
      const checkoutSnap = await db
        .collection("ebookCheckouts")
        .doc(session.id)
        .get();
      if (!checkoutSnap.exists)
        throw ebookError("Unknown refund checkout", 409);
      const saved = { ...checkoutSnap.data(), sessionId: session.id };
      await db
        .collection("ebookStripePayments")
        .doc(charge.payment_intent)
        .set(saved);
      snap = await db
        .collection("ebookStripePayments")
        .doc(charge.payment_intent)
        .get();
    }
    // A partial refund does not revoke the book.
    if (!charge.refunded) return { partialRefund: true };
    const saved = snap.data();
    return recordPayment(db, {
      eventId: event.id,
      sourceId: `stripe:${saved.sessionId}`,
      uid: saved.uid,
      ebookId: saved.ebookId,
      status: "refunded",
      revision: event.created * 1000,
      provider: "stripe",
    });
  }
  return { skipped: true };
}
