export const MAX_TRANSLATION_BYTES = 6144;

export function translationPayload(text, target, source = "ro", quality = "nmt") {
  return { from: source, to: target, text, ...(quality ? { quality } : {}) };
}

// TextEncoder is not available in every test/runtime; count Unicode UTF-8 bytes directly.
export function utf8Bytes(value) {
  return Array.from(value).reduce((size, char) => {
    const cp = char.codePointAt(0);
    return size + (cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4);
  }, 0);
}

export function payloadBytes(text, target, source = "ro", quality = "nmt") {
  return utf8Bytes(JSON.stringify(translationPayload(text, target, source, quality)));
}

const graphemes = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter("ro", { granularity: "grapheme" })
  : null;

/** Separators are copied locally, never translated or discarded. */
export function splitTranslationText(text, target, source = "ro", quality = "nmt") {
  const parts = [];
  for (const paragraph of text.split(/(\r?\n[\t \r]*\n(?:[\t \r]*\n)*)/)) {
    if (!paragraph) continue;
    if (!paragraph.trim()) {
      parts.push({ text: "", separator: paragraph });
      continue;
    }
    let remaining = paragraph;
    while (remaining) {
      const leading = remaining.match(/^\s+/)?.[0] || "";
      if (leading) {
        parts.push({ text: "", separator: leading });
        remaining = remaining.slice(leading.length);
        if (!remaining) break;
      }
      // Keep combined emoji and combining accents together whenever supported.
      const chars = graphemes
        ? Array.from(graphemes.segment(remaining), item => item.segment)
        : Array.from(remaining);
      let low = 0, high = chars.length;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (payloadBytes(chars.slice(0, mid).join(""), target, source, quality) <= MAX_TRANSLATION_BYTES) low = mid;
        else high = mid - 1;
      }
      if (!low) throw new Error("Parametrii traducerii depășesc limita cererii.");
      let candidate = chars.slice(0, low).join("");
      if (low < chars.length) {
        const sentences = [...candidate.matchAll(/[.!?…][”"')\]]*\s+/gu)];
        const lastSentence = sentences.at(-1);
        const whitespace = [...candidate.matchAll(/\s+/gu)].at(-1);
        const boundary = lastSentence || whitespace;
        if (boundary) candidate = candidate.slice(0, boundary.index + boundary[0].length);
      }
      const separator = candidate.match(/\s+$/)?.[0] || "";
      parts.push({ text: separator ? candidate.slice(0, -separator.length) : candidate, separator });
      remaining = remaining.slice(candidate.length);
    }
  }
  return parts;
}
