const names = {
  ar: "الكتب الرقمية",
  bg: "Дигитални книги",
  bs: "Digitalne knjige",
  cs: "Digitální knihy",
  de: "E-Books",
  el: "Ψηφιακά βιβλία",
  en: "Ebooks",
  es: "Libros digitales",
  fr: "Livres numériques",
  he: "ספרים דיגיטליים",
  hi: "डिजिटल किताबें",
  hr: "Digitalne knjige",
  hu: "Digitális könyvek",
  id: "Buku digital",
  it: "Libri digitali",
  ja: "電子書籍",
  ko: "전자책",
  mn: "Цахим ном",
  pl: "Książki cyfrowe",
  pt: "Livros digitais",
  ro: "Cărți digitale",
  ru: "Электронные книги",
  sk: "Digitálne knihy",
  sq: "Libra digjitale",
  sr: "Дигиталне књиге",
  tr: "Dijital kitaplar",
  zh: "數位書籍",
};

export function ebookSectionName(locale = "en") {
  const language = String(locale).toLowerCase().split("-")[0];
  return names[language] || names.en;
}
