import { isValidSignature } from "@sanity/webhook";
import { getAdminDb } from "../../../lib/firebaseAdmin";
import { requireAuth, requireDashboardAccess } from "../../../lib/requireAuth";
import { readDashboardSession } from "../../../lib/dashboardSession";
import {
  assertEbooksEnabled,
  ebookError,
  identifier,
  localeOf,
  loadBooks,
  publicBook,
  metadata,
  readChapter,
  syncRegistry,
} from "../../../lib/ebooks/content";
import { hasAccess, requireEbookAccess } from "../../../lib/ebooks/access";
import {
  checkout,
  stripeClient,
  processStripeEbookEvent,
  stripeAvailability,
} from "../../../lib/ebooks/billing";
import { getVatPercentage } from "../../../lib/globalSettings";
import {
  assertCustomer,
  promoEnabled,
  redeemPromo,
} from "../../../lib/ebooks/promo";
export const config = { api: { bodyParser: false } };
async function rawBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk.toString();
    if (Buffer.byteLength(raw) > 1048576)
      throw ebookError("Request too large", 413);
  }
  return raw;
}
function method(req, expected) {
  if (req.method !== expected) throw ebookError("Method not allowed", 405);
}
async function configInfo() {
  const availability = await stripeAvailability();
  return {
    enabled:
      process.env.EBOOKS_ENABLED === "true" &&
      Boolean(
        process.env.SANITY_PROJECT_ID &&
        process.env.SANITY_DATASET &&
        process.env.SANITY_READ_TOKEN,
      ),
    websiteBilling: availability.web,
    promoEnabled: process.env.EBOOKS_ENABLED === "true" && promoEnabled(),
    mobileBilling: availability,
  };
}
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  const path = req.query.path || [];
  const [first, second, third, fourth] = path;
  try {
    if (first === "config") {
      method(req, "GET");
      return res.json(await configInfo());
    }
    const raw = await rawBody(req);
    if (first === "sanity-webhook") {
      method(req, "POST");
      assertEbooksEnabled();
      if (
        !process.env.SANITY_EBOOK_WEBHOOK_SECRET ||
        !(await isValidSignature(
          raw,
          String(req.headers["sanity-webhook-signature"] || ""),
          process.env.SANITY_EBOOK_WEBHOOK_SECRET,
        ))
      )
        throw ebookError("Invalid signature", 401);
      return res.json({ synced: await syncRegistry(getAdminDb()) });
    }
    if (first === "stripe-webhook") {
      method(req, "POST");
      if (!process.env.STRIPE_EBOOK_WEBHOOK_SECRET)
        throw ebookError("Webhook not configured", 503);
      const stripe = stripeClient();
      let event;
      try {
        event = stripe.webhooks.constructEvent(
          raw,
          req.headers["stripe-signature"],
          process.env.STRIPE_EBOOK_WEBHOOK_SECRET,
        );
      } catch {
        throw ebookError("Invalid signature", 401);
      }
      return res.json(
        await processStripeEbookEvent(getAdminDb(), event, stripe),
      );
    }
    req.body = raw ? JSON.parse(raw) : {};
    if (!path.length) {
      method(req, "GET");
      if (!(await configInfo()).enabled)
        return res.json({ enabled: false, books: [] });
      const vat = await getVatPercentage();
      const books = await loadBooks();
      return res.json({
        enabled: true,
        books: books
          .filter(
            (b) =>
              b.status === "published" &&
              b.editions?.some((e) => e.language === "ro"),
          )
          .map((b) => publicBook(b, req.query.locale, vat)),
      });
    }
    assertEbooksEnabled();
    const db = getAdminDb();
    const locale = localeOf(req.query.locale);
    if (first === "admin-sync") {
      method(req, "POST");
      requireDashboardAccess(req);
      return res.json({ synced: await syncRegistry(db) });
    }
    if (first === "preview") {
      method(req, "GET");
      requireDashboardAccess(req);
      if (!third) {
        const books = await loadBooks(identifier(second), "drafts");
        if (!books[0]) throw ebookError("Not found", 404);
        return res.json(publicBook(books[0], locale, await getVatPercentage()));
      }
      return res.json(
        await readChapter(identifier(second), locale, identifier(third), true),
      );
    }
    const admin = readDashboardSession(req);
    if (first === "purchased") {
      method(req, "GET");
      const user = assertCustomer(await requireAuth(req));
      const access = await db
        .collection("users")
        .doc(user.uid)
        .collection("ebookAccess")
        .where("active", "==", true)
        .get();
      const vat = await getVatPercentage();
      const books = await loadBooks();
      const owned = new Set(access.docs.map((d) => d.id));
      return res.json({
        books: books
          .filter(
            (b) =>
              owned.has(b._id) && b.editions?.some((e) => e.language === "ro"),
          )
          .map((b) => publicBook(b, locale, vat)),
      });
    }
    const id = identifier(first);
    if (!second) {
      method(req, "GET");
      let owned = false;
      // An invalid optional token cannot change ownership or expose chapters.
      if (req.headers.authorization) {
        const user = await requireAuth(req);
        if (user.firebase?.sign_in_provider !== "anonymous")
          owned = await hasAccess(db, user.uid, id);
      }
      const { safe } = await metadata(id, locale, owned || Boolean(admin));
      return res.json({ ...safe, owned });
    }
    if (second === "redeem") {
      method(req, "POST");
      const user = assertCustomer(await requireAuth(req));
      // New promo grants require a published, visible book (never a draft or archive).
      await metadata(id, locale, false);
      return res.json(await redeemPromo(db, user, id, req.body.code));
    }
    if (second === "checkout") {
      method(req, "POST");
      const user = assertCustomer(await requireAuth(req));
      return res.json(
        await checkout(
          db,
          user,
          id,
          locale,
          req.body.billingDetails,
          req.body.platform || "web",
          req.headers["x-app-platform"],
        ),
      );
    }
    const user = assertCustomer(await requireAuth(req));
    await requireEbookAccess(db, user.uid, id);
    if (second === "chapters") {
      method(req, "GET");
      if (fourth) throw ebookError("Not found", 404);
      return res.json(await readChapter(id, locale, identifier(third)));
    }
    if (second === "progress") {
      const { safe } = await metadata(id, locale, true);
      if (req.method === "GET") {
        const snap = await db
          .collection("users")
          .doc(user.uid)
          .collection("ebookProgress")
          .doc(`${id}__${safe.language}`)
          .get();
        return res.json({
          language: safe.language,
          progress: snap.data() || null,
        });
      }
      method(req, "PUT");
      const { chapterId, offset, fontSize } = req.body;
      if (
        !safe.chapters.some((c) => c._key === chapterId) ||
        !Number.isFinite(offset) ||
        offset < 0 ||
        offset > 1 ||
        !Number.isFinite(fontSize) ||
        fontSize < 14 ||
        fontSize > 30
      )
        throw ebookError("Invalid progress");
      const value = {
        chapterId,
        offset,
        fontSize,
        language: safe.language,
        updatedAt: Date.now(),
      };
      await db
        .collection("users")
        .doc(user.uid)
        .collection("ebookProgress")
        .doc(`${id}__${safe.language}`)
        .set(value);
      return res.json({ progress: value });
    }
    throw ebookError("Not found", 404);
  } catch (error) {
    const status =
      error.statusCode || (error instanceof SyntaxError ? 400 : 500);
    if (status >= 500)
      console.error("[ebooks]", { status, message: error.message });
    return res.status(status).json({
      error:
        status === 500
          ? "Serviciul ebookurilor nu este disponibil momentan"
          : error.message,
    });
  }
}
