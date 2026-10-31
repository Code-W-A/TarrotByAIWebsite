import { getArticleContent, splitArticleForAds } from "../lib/articles/adPlacements";

const signs = ["Berbec", "Taur", "Gemeni", "Rac", "Leu", "Fecioară", "Balanță", "Scorpion", "Săgetător", "Capricorn", "Vărsător", "Pești"];
const zodiacArticle = (text = "Previziuni pentru această zodie. ".repeat(30)) =>
  '<p>Introducere</p>' + signs.map((name) => `<h1><strong class="ql-size-large">${name}</strong></h1><p>${text}</p>`).join("");

it("inserts at complete zodiac boundaries after groups of three, preserving all HTML", () => {
  const html = zodiacArticle();
  const parts = splitArticleForAds(html);
  expect(parts).toHaveLength(4);
  expect(parts.join("")).toBe(html);
  ["Rac", "Balanță", "Capricorn"].forEach((name, i) => expect(parts[i + 1]).toMatch(new RegExp(`^<h1><strong[^>]*>${name}</strong></h1>`)));
});

it.each([
  "<h2>Articol fără zodii</h2><p>Descriere</p>",
  zodiacArticle("Scurt."),
  `<div>${zodiacArticle()}</div>`,
  `<a href='/test'>${zodiacArticle()}</a>`,
  `<div>${zodiacArticle()}`,
  "",
])("keeps short, nested or malformed articles intact", (html) => {
  expect(splitArticleForAds(html)).toEqual([html]);
});

it("does not confuse zodiac mentions in paragraphs with section headings", () => {
  const html = '<h2>Previziuni generale</h2><p>' + signs.join(" ").repeat(100) + '</p>';
  expect(splitArticleForAds(html)).toEqual([html]);
});

it("keeps locale aliases and Romanian fallback consistent with article rendering", () => {
  const article = { info: { ro: { content: 'RO' }, hu: { content: 'HU' }, ru: { content: 'RU' }, en: { content: 'EN' } } };
  expect(getArticleContent(article, 'hi')).toBe('HU');
  expect(getArticleContent(article, 'id')).toBe('RU');
  expect(getArticleContent(article, 'en')).toBe('EN');
  expect(getArticleContent(article, 'de')).toBe('RO');
  expect(getArticleContent(null, 'ro')).toBe('');
});
