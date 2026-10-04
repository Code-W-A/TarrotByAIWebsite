import React, { useEffect, useState } from "react";

const statusLabels = { running: "În curs", success: "Reușită", error: "Eșuată", unknown: "Necunoscut" };
const formatDate = (value) => value ? new Date(value).toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" }) : "—";

export default function VideoCacheSettings() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function request(path, method = "GET") {
    const token = window.localStorage.getItem("dashboard_access_token");
    const response = await fetch(`/api/admin/video-library-cache/${path}`, {
      method, credentials: "same-origin", cache: "no-store",
      headers: { Accept: "application/json", ...(token ? { "X-Dashboard-Access": token } : {}) },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Operațiunea a eșuat.");
    return data;
  }

  useEffect(() => {
    let active = true;
    request("status").then(data => { if (active) setState(data); })
      .catch(err => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function rebuild() {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const data = await request("rebuild", "POST");
      setSuccess(`Cache-ul a fost reconstruit: ${data.rowCount} videouri publicate.`);
    } catch (err) {
      setError(err.message);
    } finally {
      try { setState(await request("status")); }
      catch (err) { setError(err.message); }
      setBusy(false);
    }
  }

  return (
    <section className="mb-6 rounded-xl border bg-white p-5" aria-labelledby="video-cache-title">
      <h2 id="video-cache-title" className="text-lg font-semibold">Cache video</h2>
      <p className="my-2 text-sm text-gray-600">Se actualizează automat când salvezi videouri. Poți reîncerca actualizarea manual.</p>
      {loading ? <p>Se încarcă...</p> : state && (
        <dl className="my-3 text-sm">
          <dt>Videouri publicate în cache</dt><dd>{state.available ? state.rowCount : "Cache indisponibil"}</dd>
          <dt>Ultima actualizare</dt><dd>{formatDate(state.updatedAt)}</dd>
          <dt>Ultima reconstruire</dt><dd>{statusLabels[state.lastRebuild?.status] || "—"}</dd>
          {state.lastRebuild?.error && <dd className="text-red-700">{state.lastRebuild.error}</dd>}
        </dl>
      )}
      {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
      {success && <p role="status" className="mb-3 text-sm text-emerald-700">{success}</p>}
      <button type="button" onClick={rebuild} disabled={busy || loading}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {busy ? "Se reconstruiește..." : "Reconstruiește cache-ul video"}
      </button>
    </section>
  );
}
