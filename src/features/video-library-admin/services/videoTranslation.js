import { splitTranslationText } from "../../../../lib/translationPayload";

export class VideoTranslationError extends Error {
  constructor(message, code = "TRANSLATION_FAILED") {
    super(message);
    this.code = code;
  }
}

export function retryDelay(value, attempt, now = Date.now()) {
  if (value) {
    const seconds = Number(value);
    const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
    if (Number.isFinite(ms)) return Math.max(0, ms);
  }
  return 1000 * 2 ** attempt;
}

function abortError() { return new DOMException("Traducere oprită", "AbortError"); }
function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const aborted = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", aborted); resolve(); }, ms);
    signal?.addEventListener("abort", aborted, { once: true });
  });
}

export async function requestVideoTranslation(text, target, { signal, quality = "nmt", fetchImpl = fetch } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal?.aborted) throw abortError();
    const controller = new AbortController();
    const aborted = () => controller.abort();
    signal?.addEventListener("abort", aborted, { once: true });
    const timer = setTimeout(() => controller.abort(), 30000);
    let delay = retryDelay(null, attempt);
    try {
      const response = await fetchImpl("/api/translate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, target, source: "ro", quality }), signal: controller.signal,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new VideoTranslationError(result?.details || result?.error || "Traducerea a eșuat.", result?.code);
        error.retryable = response.status === 429 || response.status >= 500;
        delay = retryDelay(response.headers.get("Retry-After"), attempt);
        throw error;
      }
      const translation = result?.translation || result?.trans;
      if (typeof translation !== "string" || !translation.trim()) throw new VideoTranslationError("Furnizorul a întors o traducere goală.");
      return translation.trim();
    } catch (error) {
      if (signal?.aborted) throw abortError();
      const retryable = error?.retryable || error?.name === "AbortError" || error instanceof TypeError;
      if (!retryable || attempt === 2) {
        if (error?.name === "AbortError") throw new VideoTranslationError("Furnizorul nu a răspuns în 30 de secunde, după trei încercări.", "TRANSLATION_TIMEOUT");
        throw error;
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
    }
    await wait(delay, signal);
  }
}

/** Session lives only in the mounted form. Successful fragments survive a retry. */
export function createVideoTranslationSession(title, description, languages, quality = "nmt") {
  return { key: JSON.stringify([title, description, languages, quality]), completed: {}, fragments: new Map(), quality };
}

export async function runVideoTranslationSession(session, { title, description, languages, signal, onProgress, onLocale, translate = requestVideoTranslation }) {
  for (const language of languages) {
    if (signal?.aborted) throw abortError();
    if (session.completed[language]) continue;
    let result;
    if (language === "ro") result = { title, description: description || undefined };
    else {
      const fields = { title: splitTranslationText(title, language, "ro", session.quality), description: splitTranslationText(description, language, "ro", session.quality) };
      const total = Object.values(fields).flat().filter(part => part.text).length;
      let current = 0;
      result = {};
      for (const field of ["title", "description"]) {
        const output = [];
        for (const [index, part] of fields[field].entries()) {
          if (part.text) {
            current++;
            onProgress?.({ language, current, total });
            const key = JSON.stringify([language, field, index]);
            if (!session.fragments.has(key)) {
              const translated = await translate(part.text, language, { signal, quality: session.quality });
              if (signal?.aborted) throw abortError();
              session.fragments.set(key, translated);
            }
            output.push(session.fragments.get(key));
          }
          output.push(part.separator);
        }
        result[field] = output.join("") || undefined;
      }
    }
    session.completed[language] = result;
    onLocale?.(language, result);
  }
  return session.completed;
}
