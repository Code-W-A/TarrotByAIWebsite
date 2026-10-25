import { MAX_TRANSLATION_BYTES, translationPayload, utf8Bytes } from "../../lib/translationPayload";

// Leave time to return the explicit 30-second provider timeout on Vercel as well.
export const config = { maxDuration: 40 };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { text, target, source, quality } = req.body || {};
  const trimmedText = typeof text === "string" ? text.trim() : "";
  const targetLang = typeof target === "string" ? target.trim() : "";
  const sourceLang = typeof source === "string" ? source.trim() : "auto";

  if (!trimmedText) {
    return res.status(400).json({ error: "Missing text" });
  }
  if (!targetLang) {
    return res.status(400).json({ error: "Missing target language" });
  }
  if (quality != null && !["nmt", "llm", "literal"].includes(quality)) {
    return res.status(400).json({ error: "Invalid translation quality", code: "INVALID_QUALITY" });
  }
  const payload = translationPayload(trimmedText, targetLang, sourceLang || "auto", quality || null);
  const body = JSON.stringify(payload);
  if (utf8Bytes(body) > MAX_TRANSLATION_BYTES) {
    return res.status(413).json({ error: "Textul depășește limita unei cereri de traducere.", code: "PAYLOAD_TOO_LARGE" });
  }

  const rapidApiKey = process.env.RAPIDAPI_TRANSLATE_KEY;
  const rapidApiHost =
    process.env.RAPIDAPI_TRANSLATE_HOST || "google-translate113.p.rapidapi.com";

  if (!rapidApiKey) {
    return res.status(500).json({ error: "Translation service is not configured" });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`https://${rapidApiHost}/api/v1/translator/text`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-RapidAPI-Key": rapidApiKey,
        "X-RapidAPI-Host": rapidApiHost,
      },
      body,
      signal: controller.signal,
    });

    const result = await response.json().catch(() => ({}));
    const translated =
      (typeof result?.trans === "string" && result.trans) ||
      (typeof result?.translation === "string" && result.translation) ||
      "";

    if (!response.ok || !translated) {
      const status = response.status === 413 ? 413 : response.status === 429 ? 429 : response.status === 504 ? 504 : response.status >= 500 ? 503 : 502;
      const providerDetail = [result?.message, result?.messages, result?.error]
        .find(value => typeof value === "string" && value.trim());
      const retryAfter = response.headers?.get("Retry-After");
      if (retryAfter && /^[\w\s,:+.-]+$/.test(retryAfter)) res.setHeader("Retry-After", retryAfter);
      return res.status(status).json({
        error: status === 504 ? "Furnizorul de traduceri nu a răspuns la timp. Reîncearcă mai târziu." :
          status === 429 ? "Limita serviciului de traducere a fost atinsă. Reîncearcă mai târziu." :
          status === 413 ? "Textul depășește limita unei cereri de traducere." : "Serviciul de traducere nu este disponibil. Reîncearcă mai târziu.",
        code: status === 413 ? "PAYLOAD_TOO_LARGE" : status === 429 ? "RATE_LIMITED" : status === 504 ? "TRANSLATION_TIMEOUT" : "PROVIDER_UNAVAILABLE",
        details: providerDetail || null,
      });
    }

    return res.status(200).json({
      translation: translated,
      trans: translated,
      target: targetLang,
      source: sourceLang || "auto",
      provider: "rapidapi",
    });
  } catch (error) {
    return res.status(controller.signal.aborted ? 504 : 503).json({
      error: controller.signal.aborted ? "Furnizorul nu a răspuns în 30 de secunde." : "Serviciul de traducere nu este disponibil.",
      code: controller.signal.aborted ? "TRANSLATION_TIMEOUT" : "PROVIDER_UNAVAILABLE",
    });
  } finally {
    clearTimeout(timeout);
  }
}
