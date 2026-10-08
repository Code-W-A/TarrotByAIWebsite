import { ebookSectionName } from "../../components/Ebooks/sectionName";

const expected = {
  ar: "الكتب الرقمية", bg: "Дигитални книги", bs: "Digitalne knjige",
  cs: "Digitální knihy", de: "E-Books", el: "Ψηφιακά βιβλία", en: "Ebooks",
  es: "Libros digitales", fr: "Livres numériques", he: "ספרים דיגיטליים",
  hi: "डिजिटल किताबें", hr: "Digitalne knjige", hu: "Digitális könyvek",
  id: "Buku digital", it: "Libri digitali", ja: "電子書籍", ko: "전자책",
  mn: "Цахим ном", pl: "Książki cyfrowe", pt: "Livros digitais",
  ro: "Cărți digitale", ru: "Электронные книги", sk: "Digitálne knihy",
  sq: "Libra digjitale", sr: "Дигиталне књиге", tr: "Dijital kitaplar",
  zh: "數位書籍",
};

it("returns the agreed title for all 27 site locales", () => {
  expect(Object.entries(expected).every(([locale, label]) => ebookSectionName(locale) === label)).toBe(true);
});

it("handles locale tags and defaults unsupported locales to English", () => {
  expect(ebookSectionName("ro-RO")).toBe("Cărți digitale");
  expect(ebookSectionName("en-US")).toBe("Ebooks");
  expect(ebookSectionName("unknown")).toBe("Ebooks");
});
