export function getArticleContent(article, locale) {
  if (locale === "hi") return article?.info?.hu?.content || "";
  if (locale === "id") return article?.info?.ru?.content || "";
  return article?.info?.[locale]?.content || article?.info?.ro?.content || "";
}

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const ZODIAC = /^(?:berbec|taur|gemeni|rac|leu|fecioara|balanta|scorpion|sagetator|capricorn|varsator|pesti)\b/;
const textLength = (html) => html.replace(/<[^>]*>/g, "").replace(/&[^;]+;/g, " ").trim().length;

// Split only at complete top-level headings, preserving the original HTML byte for byte.
// Nested/invalid markup stays intact rather than closing/reopening links, lists or wrappers.
export function splitArticleForAds(html) {
  if (typeof html !== "string" || !html) return [html || ""];
  const tags = /<!--[\s\S]*?-->|<\/?([a-z][\w:-]*)\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi;
  const stack = [];
  const boundaries = [];
  let heading = null;
  let match;
  while ((match = tags.exec(html))) {
    if (!match[1]) continue;
    const tag = match[1].toLowerCase();
    const closing = match[0].startsWith("</");
    if (closing) {
      if (stack.pop() !== tag) return [html];
      if (heading && stack.length === 0) {
        const label = html.slice(heading.end, match.index).replace(/<[^>]*>/g, "")
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
          .replace(/^[^a-z]+/, "").trim();
        if (ZODIAC.test(label)) boundaries.push(heading.start);
        heading = null;
      }
    } else if (!VOID_TAGS.has(tag) && !match[0].endsWith("/>")) {
      if (stack.length === 0 && /^h[1-6]$/.test(tag)) {
        heading = { start: match.index, end: tags.lastIndex };
      }
      stack.push(tag);
    }
  }
  if (stack.length) return [html];
  const parts = [];
  let start = 0;
  let lastZodiac = 0;
  for (let i = 3; i < boundaries.length && parts.length < 3; i += 1) {
    if (i - lastZodiac < 3) continue;
    const end = boundaries[i];
    if (textLength(html.slice(start, end)) < 1800 || textLength(html.slice(end)) < 600) continue;
    parts.push(html.slice(start, end));
    start = end;
    lastZodiac = i;
  }
  parts.push(html.slice(start));
  return parts;
}
