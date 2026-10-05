import {
  createDeleteBookConfirmation,
  deleteEbookDocuments,
  getEbookDocumentActions,
} from "../ebook-studio/actions/documentActions";

describe("ebook Studio deletion action", () => {
  const DeleteEbook = () => null;
  const Preview = () => null;
  const baseActions = [
    { action: "publish" },
    { action: "delete" },
    { action: "unpublish" },
    { action: "duplicate" },
    { action: "restore" },
  ];

  it("places a named delete action on the book, not its translations", () => {
    const bookActions = getEbookDocumentActions(
      baseActions,
      { schemaType: "ebook" },
      DeleteEbook,
      Preview,
    );
    expect(bookActions).toEqual([
      baseActions[0],
      baseActions[4],
      DeleteEbook,
      Preview,
    ]);

    const editionActions = getEbookDocumentActions(
      baseActions,
      { schemaType: "ebookEdition" },
      DeleteEbook,
      Preview,
    );
    expect(editionActions).toEqual([baseActions[0], baseActions[4], Preview]);

    const otherActions = getEbookDocumentActions(
      baseActions,
      { schemaType: "article" },
      DeleteEbook,
      Preview,
    );
    expect(otherActions).toEqual([...baseActions, Preview]);
  });

  it("deletes all linked published and draft editions with both root versions atomically", async () => {
    const deleted = [];
    const transaction = {
      delete: jest.fn((id) => {
        deleted.push(id);
        return transaction;
      }),
      commit: jest.fn(async () => ({ transactionId: "tx" })),
    };
    const client = {
      fetch: jest.fn(async () => [
        "book-1",
        "drafts.book-1",
        "edition-book-1-ro",
        "drafts.edition-book-1-ro",
        "edition-book-1-en",
        "drafts.edition-book-1-en",
        "edition-book-1-en",
      ]),
      transaction: jest.fn(() => transaction),
    };

    await expect(deleteEbookDocuments(client, "drafts.book-1")).resolves.toBe(
      6,
    );
    expect(client.fetch.mock.calls[0][1]).toEqual({
      bookIds: ["book-1", "drafts.book-1"],
    });
    expect(deleted).toEqual([
      "edition-book-1-ro",
      "drafts.edition-book-1-ro",
      "edition-book-1-en",
      "drafts.edition-book-1-en",
      "book-1",
      "drafts.book-1",
    ]);
    expect(transaction.commit).toHaveBeenCalledWith({ visibility: "sync" });
  });

  it("does not commit if the selected book no longer exists", async () => {
    const client = {
      fetch: jest.fn(async () => ["edition-book-1-ro"]),
      transaction: jest.fn(),
    };
    await expect(deleteEbookDocuments(client, "book-1")).rejects.toThrow(
      "Cartea nu mai există",
    );
    expect(client.transaction).not.toHaveBeenCalled();
  });

  it("warns clearly and cancellation does not trigger deletion", () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const dialog = createDeleteBookConfirmation(onConfirm, onCancel);

    expect(dialog).toMatchObject({
      type: "confirm",
      tone: "critical",
      confirmButtonText: "Șterge definitiv",
      cancelButtonText: "Păstrează cartea",
    });
    expect(dialog.message).toContain("Cumpărătorii nu vor mai putea citi");
    expect(dialog.message).toContain("Înregistrările de plată");

    dialog.onCancel();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("calls deletion only after the user confirms", async () => {
    const onConfirm = jest.fn(async () => {});
    const dialog = createDeleteBookConfirmation(onConfirm, jest.fn());
    await dialog.onConfirm();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
