import { useCallback, useEffect, useState } from "react";
export function useSubscriptionConsent(locale) {
  const [quote, setQuote] = useState(null);
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const reload = useCallback(async () => {
    setAccepted(false); setQuote(null); setLoading(true); setError(false);
    try {
      const res = await fetch(`/api/premium/subscription-consent?locale=${encodeURIComponent(locale || "ro")}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Consent unavailable");
      const value = await res.json();
      if (!value.quoteId || !value.text) throw new Error("Invalid consent quote");
      return value;
    } catch { setError(true); return null; }
    finally { setLoading(false); }
  }, [locale]);
  useEffect(() => {
    let active = true;
    reload().then(value => { if (active) setQuote(value); });
    return () => { active = false; };
  }, [reload]);
  const refresh = useCallback(async () => { const value = await reload(); setQuote(value); }, [reload]);
  useEffect(() => {
    if (!quote) return;
    const timer = setTimeout(() => { setAccepted(false); setQuote(null); setError(true); }, Math.max(0, quote.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [quote]);
  return { quote, accepted, setAccepted, loading, error, refresh };
}
