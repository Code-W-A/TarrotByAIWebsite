export async function ebookRequest(path = "", user, options = {}) {
  const headers = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
  };
  if (user?.getIdToken)
    headers.Authorization = `Bearer ${await user.getIdToken()}`;
  const response = await fetch(`/api/ebooks${path}`, {
    ...options,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(payload.error || "Ebook service unavailable");
  return payload;
}
export const ebookText = (locale, ro, en) => (locale === "ro" ? ro : en);
