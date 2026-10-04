import React, { useEffect, useState } from "react";
import LocalPasswordGate from "../../../components/Dashboard/LocalPasswordGate";
function IosEbookPayments() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/dashboard/settings", {
          credentials: "same-origin", cache: "no-store", signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Setarea nu a putut fi încărcată.");
        if (controller.signal.aborted) return;
        setEnabled(payload.settings.iosEbooksStripeEnabled === true);
        setReady(true);
      } catch (error) {
        if (!controller.signal.aborted) setMessage(error.message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, []);
  async function toggle() {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/dashboard/settings", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ iosEbooksStripeEnabled: !enabled }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Setarea nu a putut fi salvată.");
      setEnabled(payload.settings.iosEbooksStripeEnabled === true);
      setMessage("Setarea a fost salvată. Actualizarea în aplicație poate dura până la 5 minute.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <section aria-label="Plăți ebookuri pe iOS" style={{ marginBottom: 24 }}>
      <h2>Plăți ebookuri pe iOS</h2>
      <p>Permite cumpărarea ebookurilor prin Stripe în aplicația pentru iPhone. Citirea cărților cumpărate este disponibilă în continuare.</p>
      <button type="button" role="switch" aria-checked={enabled} disabled={loading || !ready} onClick={toggle}>
        {loading ? "Se încarcă…" : enabled ? "Stripe iOS activat" : "Stripe iOS dezactivat"}
      </button>
      <p role="status">{message}</p>
    </section>
  );
}
export default function EbookDashboard() {
  const [message, setMessage] = useState("");
  async function sync() {
    setMessage("Se sincronizează…");
    try {
      const r = await fetch("/api/ebooks/admin-sync", {
        method: "POST",
        credentials: "same-origin",
      });
      const p = await r.json();
      if (!r.ok) throw new Error(p.error);
      setMessage(`${p.synced} cărți sincronizate`);
    } catch (e) {
      setMessage(e.message);
    }
  }
  return (
    <LocalPasswordGate>
      <main style={{ padding: 24 }}>
        <h1>Ebookuri</h1>
        <IosEbookPayments />
        <p>
          Alegeți cartea, apoi limba. Publicați fiecare ediție când este gata.
          Imaginile din Sanity sunt accesibile prin URL.
        </p>
        <button onClick={sync}>Sincronizează catalogul</button>
        <p role="status">{message}</p>
        <iframe
          title="Editor ebookuri Sanity"
          src="/ebook-studio/"
          style={{
            width: "100%",
            height: "80vh",
            border: "1px solid #ddd",
            borderRadius: 12,
          }}
        />
      </main>
    </LocalPasswordGate>
  );
}
