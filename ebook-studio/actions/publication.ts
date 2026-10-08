export const PUBLICATION_API_VERSION = "2026-10-01";
export type Validate = (document: any, bookId: string) => Promise<any[]>;
const canonical = (id: string) => id.replace(/^drafts\./, "");
export function editableContent(doc: any) {
  if (!doc) return "";
  const ordered = (value: any): any => Array.isArray(value) ? value.map(ordered) : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
  return JSON.stringify(ordered(Object.fromEntries(Object.entries(doc).filter(([key]) => !key.startsWith("_")))));
}
const errors = (markers: any[]) => markers.filter((m) => m.level === "error");

export async function inspectPublication(client: any, id: string, languages: string[], validate: Validate, localBook?: any) {
  const bookId = canonical(id);
  const docs: any[] = await client.fetch(
    '*[_id in $bookIds || (_type == "ebookEdition" && book._ref == $bookId)]',
    { bookIds: [bookId, `drafts.${bookId}`], bookId },
  );
  const published = docs.find((d) => d._id === bookId);
  const draft = docs.find((d) => d._id === `drafts.${bookId}`);
  const persisted = Boolean(draft || published);
  // A new, untouched form has an ID but is not stored until the first edit.
  // Validate it for guidance without creating or publishing any document.
  const book = draft || published || { _id: `drafts.${bookId}`, _type: "ebook", ...localBook };
  const bookErrors = errors(await validate({ ...book, status: "published" }, bookId));
  const editions = await Promise.all(languages.map(async (language) => {
    const editionId = `edition-${bookId}-${language}`;
    const p = docs.find((d) => d._id === editionId);
    const d = docs.find((doc) => doc._id === `drafts.${editionId}`);
    const document = d || p;
    const validation = document ? errors(await validate(document, bookId)) : [];
    return { language, document, draft: d, published: p, errors: validation,
      valid: Boolean(document) && validation.length === 0 };
  }));
  const romanian = editions.find((e) => e.language === "ro");
  return { bookId, book, draft, published, persisted, bookErrors, editions,
    canPublish: persisted && bookErrors.length === 0 && Boolean(romanian?.valid),
    candidates: editions.filter((e) => e.valid && e.draft),
  };
}

function clean(doc: any) {
  const { _rev, _createdAt, _updatedAt, ...rest } = doc;
  return rest;
}

async function publishBookState(client: any, inspection: any, status: string) {
  const { bookId, book, draft, published } = inspection;
  // Refuse concurrent edits; never replace a newer draft with our snapshot.
  const tx = client.transaction();
  if (draft) tx.patch(draft._id, (p: any) => p.ifRevisionId(draft._rev).set({ status }));
  else tx.create({ ...clean(book), _id: `drafts.${bookId}`, status });
  const result = await tx.commit({ visibility: "sync", returnDocuments: true });
  const updated = result.find((d: any) => d?._id === `drafts.${bookId}`);
  if (!updated?._rev) throw new Error("Nu putem confirma salvarea cărții. Reîncearcă.");
  await client.action({ actionType: "sanity.action.document.publish", draftId: `drafts.${bookId}`,
    publishedId: bookId, ifDraftRevisionId: updated._rev,
    ...(published ? { ifPublishedRevisionId: published._rev } : {}),
  });
}

export async function publishInspection(client: any, inspection: any, progress: (message: string) => void = () => {}) {
  if (!inspection.canPublish) throw new Error("Completează coperta, prețul și ediția românească înainte de publicare.");
  const completed: string[] = [];
  let rootPublished = false;
  try {
    progress("Se publică informațiile cărții…");
    await publishBookState(client, inspection, "published");
    rootPublished = true;
    const candidates = [...inspection.candidates].sort((a, b) => Number(b.language === "ro") - Number(a.language === "ro"));
    for (const edition of candidates) {
      progress(`Se publică ediția ${edition.language.toUpperCase()} (${completed.length + 1}/${candidates.length})…`);
      await client.action({ actionType: "sanity.action.document.publish", draftId: edition.draft._id,
        publishedId: canonical(edition.draft._id), ifDraftRevisionId: edition.draft._rev,
        ...(edition.published ? { ifPublishedRevisionId: edition.published._rev } : {}),
      });
      completed.push(edition.language);
    }
    return completed;
  } catch (error) {
    const remaining = inspection.candidates.filter((e: any) => !completed.includes(e.language)).map((e: any) => e.language.toUpperCase());
    throw new Error(`${rootPublished ? "Informațiile cărții au fost publicate." : "Publicarea cărții nu a fost confirmată."} Ediții publicate în această operație: ${completed.map(l => l.toUpperCase()).join(", ") || "niciuna"}. ${remaining.length ? `De reîncercat: ${remaining.join(", ")}.` : ""} ${error instanceof Error ? error.message : "Eroare Sanity."}`);
  }
}

export async function archiveInspection(client: any, inspection: any) {
  if (!inspection.published) throw new Error("Cartea nu este încă publicată.");
  if (inspection.bookErrors.length) throw new Error("Completează câmpurile cărții înainte de arhivare.");
  await publishBookState(client, inspection, "archived");
}
