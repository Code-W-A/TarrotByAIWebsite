import { useCallback, useEffect, useState } from "react";

export function useSubscriptionConsent(locale) {
  const [quote, setQuote] = useState(null);
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);

  const refresh = useCallback(() => {
    setAccepted(false);
    setQuote(null);
    setRevision(value => value + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setAccepted(false);
    setQuote(null);
    setLoading(true);
    setError(false);
    (async () => {
      try {
        const res = await fetch(`/api/premium/subscription-consent?locale=${encodeURIComponent(locale || "ro")}`, {
          cache: "no-store", signal: controller.signal,
        });
        if (!res.ok) throw new Error("Consent unavailable");
        const value = await res.json();
        if (!value.quoteId || !value.text) throw new Error("Invalid consent quote");
        if (!controller.signal.aborted) setQuote(value);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [locale, revision]);

  useEffect(() => {
    if (!quote) return;
    const timer = setTimeout(() => {
      setAccepted(false);
      setQuote(null);
      setError(true);
    }, Math.max(0, quote.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [quote]);

  return { quote, accepted, setAccepted, loading, error, refresh };
}
