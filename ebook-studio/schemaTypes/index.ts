import { defineType, defineField } from "sanity";
import { languages } from "./languages";
import { EbookBookInput } from "../components/EbookBookInput";
export { languages } from "./languages";
const link = {
  name: "link",
  type: "object",
  fields: [
    defineField({
      name: "href",
      type: "url",
      validation: (r) => r.uri({ scheme: ["http", "https", "mailto"] }),
    }),
  ],
};
const ebook = defineType({
  name: "ebook",
  components: { input: EbookBookInput },
  title: "Carte",
  type: "document",
  fields: [
    defineField({
      name: "adminTitle",
      title: "Titlu administrare",
      type: "string",
      validation: (r) => r.required(),
    }),
    defineField({
      name: "status",
      title: "Stare în catalog",
      hidden: true,
      type: "string",
      initialValue: "draft",
      options: {
        list: [
          { title: "Draft", value: "draft" },
          { title: "Publicată", value: "published" },
          {
            title: "Arhivată — păstrează lectura cumpărătorilor",
            value: "archived",
          },
        ],
      },
      validation: (r) => r.required(),
    }),
    defineField({
      name: "cover",
      title: "Copertă",
      type: "image",
      options: { hotspot: true },
      fields: [{ name: "alt", type: "string", title: "Descriere imagine" }],
      validation: (r) => r.required(),
    }),
    defineField({
      name: "price",
      title: "Preț net (aceeași convenție ca la cursuri)",
      type: "number",
      validation: (r) => r.required().positive(),
    }),
    defineField({
      name: "currency",
      title: "Monedă",
      type: "string",
      initialValue: "RON",
      options: { list: ["RON", "EUR", "USD"] },
      validation: (r) => r.required(),
    }),
  ],
});
const ebookEdition = defineType({
  name: "ebookEdition",
  title: "Ediție pe limbă",
  type: "document",
  fields: [
    defineField({
      name: "book",
      title: "Carte",
      type: "reference",
      to: [{ type: "ebook" }],
      readOnly: true,
      validation: (r) => r.required(),
    }),
    defineField({
      name: "language",
      title: "Limbă",
      type: "string",
      options: {
        list: languages.map((l) => ({ title: l.title, value: l.id })),
      },
      readOnly: true,
      validation: (r) => r.required(),
    }),
    defineField({
      name: "title",
      title: "Titlu",
      type: "string",
      validation: (r) => r.required(),
    }),
    defineField({ name: "description", title: "Descriere", type: "text" }),
    defineField({
      name: "chapters",
      title: "Capitole",
      type: "array",
      validation: (r) =>
        r
          .required()
          .min(1)
          .custom(async (chapters, context) => {
            const id = context.document?._id?.replace(/^drafts\./, "");
            if (!id || !Array.isArray(chapters)) return true;
            const published = await context
              .getClient({ apiVersion: "2026-10-01" })
              .fetch<
                string[]
              >("*[_id == $id][0].chapters[]._key", { id }, { perspective: "published" });
            const keys = new Set(chapters.map((c: any) => c._key));
            return (
              (published || []).every((key) => keys.has(key)) ||
              "Capitolele publicate trebuie păstrate pentru cumpărători. Puteți edita sau reordona textul."
            );
          }),
      of: [
        {
          name: "chapter",
          type: "object",
          fields: [
            {
              name: "title",
              title: "Titlu capitol",
              type: "string",
              validation: (r) => r.required(),
            },
            {
              name: "body",
              title: "Text",
              type: "array",
              validation: (r) => r.required().min(1),
              of: [
                {
                  type: "block",
                  styles: [
                    { title: "Paragraf", value: "normal" },
                    { title: "Titlu", value: "h2" },
                    { title: "Subtitlu", value: "h3" },
                    { title: "Citat", value: "blockquote" },
                  ],
                  lists: [
                    { title: "Listă", value: "bullet" },
                    { title: "Numerotare", value: "number" },
                  ],
                  marks: {
                    decorators: [
                      { title: "Bold", value: "strong" },
                      { title: "Italic", value: "em" },
                      { title: "Subliniat", value: "underline" },
                    ],
                    annotations: [link],
                  },
                },
                {
                  type: "image",
                  fields: [
                    { name: "alt", type: "string", title: "Descriere imagine" },
                  ],
                  options: { hotspot: true },
                },
              ],
            },
          ],
        },
      ],
    }),
  ],
  preview: { select: { title: "title", subtitle: "language" } },
});
export const schemas = [ebook, ebookEdition];
