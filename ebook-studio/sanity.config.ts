import { defineConfig } from "sanity";
import { structureTool } from "sanity/structure";
import { schemas, languages } from "./schemaTypes";
function PreviewAction(props: any) {
  const doc = props.draft || props.published;
  const bookId =
    doc?._type === "ebook"
      ? doc?._id?.replace(/^drafts\./, "")
      : doc?.book?._ref;
  if (!bookId) return null;
  return {
    label: "Previzualizează în site",
    onHandle: () => {
      window.open(
        `/ebooks/${encodeURIComponent(bookId)}/read?preview=1&locale=${doc.language || "ro"}`,
        "_blank",
        "noopener",
      );
      props.onComplete();
    },
  };
}
export default defineConfig({
  name: "ebooks",
  title: "Cristina Zurba — Ebookuri",
  projectId: process.env.SANITY_STUDIO_PROJECT_ID!,
  dataset: process.env.SANITY_STUDIO_DATASET!,
  basePath: "/",
  plugins: [
    structureTool({
      structure: (S) =>
        S.list()
          .title("Ebookuri")
          .items([
            S.listItem()
              .title("Cărți și ediții")
              .child(
                S.documentTypeList("ebook")
                  .title("Cărți")
                  .child((id) =>
                    S.list()
                      .title("Carte")
                      .items([
                        S.listItem()
                          .title("Copertă, preț și publicare")
                          .child(
                            S.document().schemaType("ebook").documentId(id),
                          ),
                        ...languages.map((language) =>
                          S.listItem()
                            .title(language.title)
                            .child(
                              S.document()
                                .schemaType("ebookEdition")
                                .documentId(`edition-${id}-${language.id}`)
                                .initialValueTemplate("edition", {
                                  bookId: id,
                                  language: language.id,
                                }),
                            ),
                        ),
                      ]),
                  ),
              ),
          ]),
    }),
  ],
  schema: {
    types: schemas,
    templates: (prev) => [
      ...prev,
      {
        id: "edition",
        title: "Ediție",
        schemaType: "ebookEdition",
        parameters: [
          { name: "bookId", type: "string" },
          { name: "language", type: "string" },
        ],
        value: ({ bookId, language }) => ({
          language,
          book: { _type: "reference", _ref: bookId },
        }),
      },
    ],
  },
  document: {
    actions: (prev, context) => [
      PreviewAction,
      ...prev.filter((action) => {
        // Published content is retained for existing purchasers. Archive the root book.
        if (
          ["ebook", "ebookEdition"].includes(context.schemaType) &&
          ["delete", "unpublish", "duplicate"].includes(action.action || "")
        )
          return false;
        return true;
      }),
    ],
  },
});
