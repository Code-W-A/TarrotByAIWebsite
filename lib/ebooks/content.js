import { calculateFixedVatMajor } from "../stripeFixedVatCore";
import { getVatPercentage } from "../globalSettings";
export function ebookError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}
export function identifier(value) {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9_.-]{1,180}$/.test(value) ||
    value.startsWith("drafts.")
  )
    throw ebookError("Invalid identifier");
  return value;
}
export function localeOf(value) {
  return typeof value === "string" && /^[a-z]{2}(?:-[A-Za-z]{2})?$/.test(value)
    ? value.split("-")[0]
    : "ro";
}
export function resolveEdition(editions, locale) {
  const requested = localeOf(locale);
  const edition =
    editions.find((e) => e.language === requested) ||
    editions.find((e) => e.language === "ro");
  if (!edition) throw ebookError("Ediția nu este disponibilă", 404);
  return {
    edition,
    requestedLanguage: requested,
    language: edition.language,
    fallback: edition.language !== requested,
  };
}
export function assertEbooksEnabled() {
  if (
    process.env.EBOOKS_ENABLED !== "true" ||
    !process.env.SANITY_PROJECT_ID ||
    !process.env.SANITY_DATASET ||
    !process.env.SANITY_READ_TOKEN
  )
    throw ebookError("Ebookurile nu sunt încă disponibile", 503);
  if (
    !/^[a-z0-9-]+$/.test(process.env.SANITY_PROJECT_ID) ||
    !/^[a-z0-9_-]+$/.test(process.env.SANITY_DATASET)
  )
    throw ebookError("Invalid CMS configuration", 503);
}
let privacyCheck = { key: "", expires: 0 };
export async function sanityQuery(
  query,
  params = {},
  perspective = "published",
) {
  assertEbooksEnabled();
  const base = `https://${process.env.SANITY_PROJECT_ID}.api.sanity.io/v2026-10-01`;
  const headers = { Authorization: `Bearer ${process.env.SANITY_READ_TOKEN}` };
  const key = `${base}/${process.env.SANITY_DATASET}`;
  if (privacyCheck.key !== key || Date.now() > privacyCheck.expires) {
    const r = await fetch(`${base}/datasets`, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw ebookError("Nu putem verifica datasetul privat", 503);
    const list = await r.json();
    if (
      !Array.isArray(list) ||
      list.find((d) => d.name === process.env.SANITY_DATASET)?.aclMode !==
        "private"
    )
      throw ebookError("Ebookurile necesită un dataset Sanity privat", 503);
    privacyCheck = { key, expires: Date.now() + 60000 };
  }
  const search = new URLSearchParams({ query, perspective });
  for (const [k, v] of Object.entries(params))
    search.set(`$${k}`, JSON.stringify(v));
  const r = await fetch(
    `${base}/data/query/${process.env.SANITY_DATASET}?${search}`,
    { headers, signal: AbortSignal.timeout(20000) },
  );
  if (!r.ok) throw ebookError("Conținutul nu poate fi încărcat momentan", 502);
  return (await r.json()).result;
}
const fields = `_id,_rev,status,price,currency,"coverUrl":cover.asset->url`;
const editionFields = `_id,language,title,description,"chapters":chapters[]{_key,title}`;
export async function loadBooks(id, perspective = "published") {
  const filter = id ? " && _id==$id" : "";
  return sanityQuery(
    `*[_type=="ebook"${filter}]{${fields},"editions":*[_type=="ebookEdition" && book._ref==^._id]{${editionFields}}}`,
    id ? { id: identifier(id) } : {},
    perspective,
  );
}
export function publicBook(book, locale, vat = 21) {
  const resolved = resolveEdition(book.editions || [], locale);
  return {
    id: book._id,
    title: resolved.edition.title,
    description: resolved.edition.description || "",
    coverUrl: book.coverUrl || null,
    price: calculateFixedVatMajor(book.price, vat),
    currency: book.currency || "RON",
    status: book.status,
    availableLanguages: book.editions.map((e) => e.language),
    language: resolved.language,
    fallback: resolved.fallback,
    chapters: resolved.edition.chapters || [],
  };
}
export async function metadata(id, locale, allowArchived = false) {
  const book = (await loadBooks(id))[0];
  if (!book || (!allowArchived && book.status !== "published"))
    throw ebookError("Cartea nu este disponibilă", 404);
  return { book, safe: publicBook(book, locale, await getVatPercentage()) };
}
export async function syncRegistry(db) {
  const books = await loadBooks();
  for (const b of books) {
    identifier(b._id);
    if (!Number.isFinite(b.price) || b.price <= 0)
      throw ebookError("Invalid ebook price");
  }
  for (const b of books) {
    await db
      .collection("ebookRegistry")
      .doc(b._id)
      .set(
        {
          sanityId: b._id,
          status: b.status || "draft",
          price: b.price,
          currency: b.currency || "RON",
          revision: b._rev,
          updatedAt: Date.now(),
        },
        { merge: true },
      );
  }
  return books.length;
}
export async function readChapter(id, locale, chapterId, preview = false) {
  identifier(id);
  identifier(chapterId);
  const editions = await sanityQuery(
    `*[_type=="ebookEdition" && book._ref==$id]{language,title,"chapters":chapters[]{_key,title,"body":body[]{...,_type=="image"=>{"url":asset->url}}}}`,
    { id },
    preview ? "drafts" : "published",
  );
  const resolved = resolveEdition(editions, locale);
  const chapter = resolved.edition.chapters?.find((c) => c._key === chapterId);
  if (!chapter) throw ebookError("Capitolul nu este disponibil", 404);
  // Portable Text is rendered with an allowlist, never inserted as HTML.
  return { language: resolved.language, fallback: resolved.fallback, chapter };
}
