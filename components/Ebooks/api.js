export async function ebookRequest(path = "", user, options = {}) {
  const { timeoutMs = 0, ...fetchOptions } = options;
  const headers = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
  };
  if (user?.getIdToken)
    headers.Authorization = `Bearer ${await user.getIdToken()}`;
  const controller = timeoutMs ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(`/api/ebooks${path}`, {
      ...fetchOptions,
      ...(controller ? { signal: controller.signal } : {}),
      headers,
      credentials: "same-origin",
      cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Ebook service unavailable");
    return payload;
  } catch (error) {
    if (controller?.signal.aborted) {
      const timedOut = new Error("The ebook request timed out. Please retry.");
      timedOut.code = "EBOOK_TIMEOUT";
      throw timedOut;
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
export const ebookText = (locale, ro, en) => (locale === "ro" ? ro : en);
