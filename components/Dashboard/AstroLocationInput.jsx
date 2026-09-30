import React, { useEffect, useRef, useState } from "react";

export default function AstroLocationInput({ person, onChange, inputStyle }) {
  const [query, setQuery] = useState(null);
  const [results, setResults] = useState([]);
  const [provider, setProvider] = useState("geonames");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const request = async (body, signal) => {
    const response = await fetch("/api/astro/locations", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Căutarea nu este disponibilă.");
    return result;
  };
  useEffect(() => {
    const current = ++generation.current;
    setResults([]); setError(""); setLoading(false);
    if (query === null || query !== person.place || query.trim().length < 3) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await request({ action: "search", query: query.trim() }, controller.signal);
        if (current !== generation.current) return;
        setResults(data.results); setProvider(data.provider);
        if (!data.results.length) setError("Nu am găsit localitatea. Încearcă alt nume.");
      } catch (e) { if (!controller.signal.aborted && current === generation.current) setError(e.message); }
      finally { if (current === generation.current) setLoading(false); }
    }, 800);
    return () => { controller.abort(); clearTimeout(timer); generation.current += 1; };
  }, [query, person.place, retry]);
  const select = async (item) => {
    const current = ++generation.current;
    setLoading(true); setError("");
    try {
      const value = item.provider === "google" ? await request({ action: "details", id: item.id, provider: item.provider }) : item;
      if (current !== generation.current) return;
      setQuery(null); setResults([]);
      onChange({ ...person, place: value.label, lat: String(value.lat), lon: String(value.lon) });
    } catch (e) { if (current === generation.current) setError(e.message); }
    finally { if (current === generation.current) setLoading(false); }
  };
  return <div>
    <input style={inputStyle} aria-label="Locul nașterii" autoComplete="off" value={person.place}
      placeholder="Scrie localitatea și selectează din listă"
      onChange={(event) => {
        generation.current += 1; setQuery(event.target.value);
        onChange({ ...person, place: event.target.value, lat: "", lon: "" });
      }} />
    {loading && <p role="status">Se caută…</p>}
    {error && <div><p role="alert" style={{ color: "#a32020" }}>{error}</p>
      <button type="button" onClick={() => setRetry((value) => value + 1)}>Reîncearcă</button></div>}
    {results.length > 0 && <div aria-label="Localități găsite" style={{ border: "1px solid #ddd", background: "white" }}>
      {results.map((item) => <button type="button" key={`${item.provider}:${item.id}`} onClick={() => select(item)}
        style={{ display: "block", padding: 12, width: "100%", textAlign: "left", background: "white", border: "none", borderBottom: "1px solid #ddd", cursor: "pointer" }}>{item.label}</button>)}
    </div>}
    <a href={provider === "google" ? "https://maps.google.com" : "https://www.geonames.org"} target="_blank" rel="noreferrer" translate="no" style={{ fontSize: 12, color: "#5e5e5e", fontFamily: "sans-serif", whiteSpace: "nowrap" }}>
      {provider === "google" ? "Google Maps" : "Date geografice: GeoNames"}
    </a>
  </div>;
}
