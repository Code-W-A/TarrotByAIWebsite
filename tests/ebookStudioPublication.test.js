import { archiveInspection, editableContent, inspectPublication, publishInspection } from "../ebook-studio/actions/publication";

const book = (id = "drafts.book") => ({ _id: id, _type: "ebook", _rev: "book-rev", adminTitle: "Test", price: 3, currency: "RON", status: "draft", cover: { asset: { _ref: "image-id" } } });
const edition = (lang, draft = true) => ({ _id: `${draft ? "drafts." : ""}edition-book-${lang}`, _type: "ebookEdition", _rev: `${lang}-rev`, language: lang, title: lang, book: { _ref: "book", _weak: true }, chapters: [{ _key: "one", _type: "chapter", title: "Intro", body: [{ _type: "block", children: [{ text: "Text" }] }] }] });
function mockClient(documents) {
  const patch = { ifRevisionId: jest.fn(() => patch), set: jest.fn(() => patch) };
  const tx = { patch: jest.fn((id, fn) => { fn(patch); return tx; }), create: jest.fn(() => tx), commit: jest.fn(async () => [{ ...book(), _rev: "new-rev", status: "published" }]) };
  return { fetch: jest.fn(async () => documents), transaction: jest.fn(() => tx), action: jest.fn(async () => ({})), tx, patch };
}
const validate = jest.fn(async doc => doc.invalid ? [{ level: "error", path: ["chapters"], message: "Required" }] : []);

it("treats an untouched new form as incomplete rather than a saving error, without creating it", async () => {
  const client = mockClient([]);
  const schemaValidate = jest.fn(async doc => !doc.adminTitle ? [{ level: "error", path: ["adminTitle"], message: "Required" }] : []);
  const state = await inspectPublication(client, "new-book", ["ro", "en"], schemaValidate);
  expect(state.persisted).toBe(false);
  expect(state.canPublish).toBe(false);
  expect(state.bookErrors[0].path).toEqual(["adminTitle"]);
  expect(client.transaction).not.toHaveBeenCalled();
  expect(client.action).not.toHaveBeenCalled();
});

it("picks up the first saved draft on reinspection, including its new field values", async () => {
  const client = mockClient([]);
  expect((await inspectPublication(client, "book", ["ro"], validate)).persisted).toBe(false);
  client.fetch.mockResolvedValueOnce([book(), edition("ro")]);
  const saved = await inspectPublication(client, "book", ["ro"], validate);
  expect(saved.persisted).toBe(true);
  expect(saved.canPublish).toBe(true);
});

it("validates the current root and each edition, requiring RO and skipping invalid translations", async () => {
  const client = mockClient([book(), edition("ro"), edition("en"), { ...edition("fr"), invalid: true }]);
  const plan = await inspectPublication(client, "drafts.book", ["ro", "en", "fr", "de"], validate);
  expect(plan.canPublish).toBe(true);
  expect(plan.candidates.map(e => e.language)).toEqual(["ro", "en"]);
  expect(plan.editions.find(e => e.language === "fr").errors).toHaveLength(1);
  expect(plan.editions.find(e => e.language === "de").document).toBeUndefined();
  expect(validate).toHaveBeenCalledWith(expect.objectContaining({ _type: "ebook", status: "published" }), "book");
});

it.each(["missing-ro", "invalid-ro", "missing-cover", "invalid-price"])("blocks publication for %s without mutations", async scenario => {
  const root = book(); const ro = edition("ro");
  if (scenario === "invalid-ro") ro.invalid = true;
  if (scenario === "missing-cover") delete root.cover;
  if (scenario === "invalid-price") root.price = -1;
  const client = mockClient([root, ...(scenario === "missing-ro" ? [] : [ro])]);
  const schemaValidate = async doc => doc._type === "ebook" && (!doc.cover || doc.price <= 0) ? [{ level: "error", message: "Invalid" }] : validate(doc);
  const plan = await inspectPublication(client, "book", ["ro"], schemaValidate);
  expect(plan.canPublish).toBe(false);
  await expect(publishInspection(client, plan)).rejects.toThrow("Completează");
  expect(client.transaction).not.toHaveBeenCalled();
});

it("uses native publishing with revision locks, publishes RO first, and preserves untouched published editions", async () => {
  const client = mockClient([book(), edition("en"), edition("ro"), edition("fr", false)]);
  const plan = await inspectPublication(client, "book", ["en", "ro", "fr"], validate);
  await expect(publishInspection(client, plan)).resolves.toEqual(["ro", "en"]);
  expect(client.patch.ifRevisionId).toHaveBeenCalledWith("book-rev");
  expect(client.patch.set).toHaveBeenCalledWith({ status: "published" });
  expect(client.action.mock.calls.map(([a]) => a.publishedId)).toEqual(["book", "edition-book-ro", "edition-book-en"]);
  expect(client.action.mock.calls[1][0]).toMatchObject({ actionType: "sanity.action.document.publish", ifDraftRevisionId: "ro-rev" });
});

it("creates a draft without overwriting concurrent drafts when updating a published-only root", async () => {
  const client = mockClient([book("book"), edition("ro", false)]);
  const plan = await inspectPublication(client, "book", ["ro"], validate);
  await publishInspection(client, plan);
  expect(client.tx.create).toHaveBeenCalledWith(expect.objectContaining({ _id: "drafts.book", status: "published" }));
  expect(client.tx.create.mock.calls[0][0]._rev).toBeUndefined();
  expect(client.action.mock.calls[0][0]).toMatchObject({ ifPublishedRevisionId: "book-rev", ifDraftRevisionId: "new-rev" });
});

it("reports confirmed editions and remaining languages after a partial failure", async () => {
  const client = mockClient([book(), edition("ro"), edition("en"), edition("es")]);
  client.action.mockResolvedValueOnce({}).mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("revision conflict"));
  const plan = await inspectPublication(client, "book", ["ro", "en", "es"], validate);
  await expect(publishInspection(client, plan)).rejects.toThrow("Ediții publicate în această operație: RO. De reîncercat: EN, ES.");
  expect(client.action).toHaveBeenCalledTimes(3);
});

it("does not publish editions after an unconfirmed book mutation", async () => {
  const client = mockClient([book(), edition("ro")]);
  client.tx.commit.mockRejectedValueOnce(new Error("revision conflict"));
  const plan = await inspectPublication(client, "book", ["ro"], validate);
  await expect(publishInspection(client, plan)).rejects.toThrow("Publicarea cărții nu a fost confirmată");
  expect(client.action).not.toHaveBeenCalled();
});

it("archives only the root and leaves the published editions available", async () => {
  const client = mockClient([book("book"), edition("ro", false)]);
  const plan = await inspectPublication(client, "book", ["ro"], validate);
  await archiveInspection(client, plan);
  expect(client.tx.create).toHaveBeenCalledWith(expect.objectContaining({ status: "archived" }));
  expect(client.action).toHaveBeenCalledTimes(1);
});

it("detects unsaved form changes without being sensitive to field order or metadata", () => {
  expect(editableContent({ title: "A", price: 3, _rev: "x" })).toBe(editableContent({ price: 3, title: "A", _rev: "y" }));
  expect(editableContent({ title: "B", price: 3 })).not.toBe(editableContent({ title: "A", price: 3 }));
});
