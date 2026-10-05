const REMOVE_DEFAULT_ACTIONS = new Set(["delete", "unpublish", "duplicate"]);

export function createDeleteBookConfirmation(
  onConfirm: () => void,
  onCancel: () => void,
) {
  return {
    type: "confirm" as const,
    tone: "critical" as const,
    message:
      "Ștergerea este definitivă și elimină cartea împreună cu toate edițiile și traducerile ei. Cumpărătorii nu vor mai putea citi cartea. Înregistrările de plată și fișierele media rămân păstrate.",
    confirmButtonText: "Șterge definitiv",
    cancelButtonText: "Păstrează cartea",
    onConfirm,
    onCancel,
  };
}

export function getEbookDocumentActions(
  previous: any[],
  context: { schemaType: string },
  _deleteEbookAction: any,
  previewAction: any,
) {
  const actions = previous.filter((action) => {
    if (
      ["ebook", "ebookEdition"].includes(context.schemaType) &&
      REMOVE_DEFAULT_ACTIONS.has(action.action || "")
    )
      return false;
    return true;
  });

  // Book operations are visible buttons inside the form, not overflow actions.
  if (context.schemaType === "ebook") return actions.filter((action) => action.action !== "publish");
  return [...actions, previewAction];
}

export async function deleteEbookDocuments(client: any, ebookId: string) {
  const bookId = ebookId.replace(/^drafts\./, "");
  const bookIds = [bookId, `drafts.${bookId}`];
  const ids: string[] = await client.fetch(
    `*[_id in $bookIds || (_type == "ebookEdition" && book._ref in $bookIds)]._id`,
    { bookIds },
  );
  const uniqueIds = [...new Set(ids)];

  if (!uniqueIds.some((id) => bookIds.includes(id))) {
    throw new Error("Cartea nu mai există sau nu poate fi găsită.");
  }

  const transaction = client.transaction();
  uniqueIds
    .filter((id) => !bookIds.includes(id))
    .concat(uniqueIds.filter((id) => bookIds.includes(id)))
    .forEach((id) => transaction.delete(id));

  await transaction.commit({ visibility: "sync" });
  return uniqueIds.length;
}
