import React, { useState } from "react";
import LocalPasswordGate from "../../../components/Dashboard/LocalPasswordGate";
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
