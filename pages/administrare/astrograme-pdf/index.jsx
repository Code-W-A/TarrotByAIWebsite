import React, { useRef, useState } from "react";
import Head from "next/head";
import CustomDrawer from "../../../components/Dashboard/CustomDrawer";
import LocalPasswordGate from "../../../components/Dashboard/LocalPasswordGate";
import AstroLocationInput from "../../../components/Dashboard/AstroLocationInput";

const EMPTY_PERSON = {
  full_name: "",
  day: "",
  month: "",
  year: "",
  selectedTime: "",
  gender: "male",
  place: "",
  lat: "",
  lon: "",
};

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #ccc",
  fontSize: 14,
  boxSizing: "border-box",
};

const labelStyle = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  marginBottom: 4,
  color: "#333",
};

const fieldWrapStyle = { marginBottom: 12 };

function PersonForm({ title, person, onChange }) {
  const set = (field) => (e) => onChange({ ...person, [field]: e.target.value });

  return (
    <div
      style={{
        background: "#fafafa",
        border: "1px solid #eee",
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <h3 style={{ marginTop: 0, color: "#4CAF50" }}>{title}</h3>

      <div style={fieldWrapStyle}>
        <label style={labelStyle}>Nume complet</label>
        <input
          style={inputStyle}
          value={person.full_name}
          onChange={set("full_name")}
          placeholder="ex: Maria Popescu"
        />
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ ...fieldWrapStyle, flex: 1 }}>
          <label style={labelStyle}>Zi</label>
          <input style={inputStyle} value={person.day} onChange={set("day")} placeholder="26" />
        </div>
        <div style={{ ...fieldWrapStyle, flex: 1 }}>
          <label style={labelStyle}>Lună</label>
          <input style={inputStyle} value={person.month} onChange={set("month")} placeholder="4" />
        </div>
        <div style={{ ...fieldWrapStyle, flex: 1 }}>
          <label style={labelStyle}>An</label>
          <input style={inputStyle} value={person.year} onChange={set("year")} placeholder="1985" />
        </div>
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ ...fieldWrapStyle, flex: 1 }}>
          <label style={labelStyle}>Ora nașterii (HH:mm)</label>
          <input
            style={inputStyle}
            value={person.selectedTime}
            onChange={set("selectedTime")}
            placeholder="09:30"
          />
        </div>
        <div style={{ ...fieldWrapStyle, flex: 1 }}>
          <label style={labelStyle}>Gen</label>
          <select style={inputStyle} value={person.gender} onChange={set("gender")}>
            <option value="male">male</option>
            <option value="female">female</option>
          </select>
        </div>
      </div>

      <div style={fieldWrapStyle}>
        <label style={labelStyle}>Loc nașterii</label>
        <AstroLocationInput person={person} onChange={onChange} inputStyle={inputStyle} />
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ ...fieldWrapStyle, flex: 1 }}>
          <label style={labelStyle}>Latitudine</label>
          <input style={inputStyle} value={person.lat} onChange={set("lat")} placeholder="44.43" />
        </div>
        <div style={{ ...fieldWrapStyle, flex: 1 }}>
          <label style={labelStyle}>Longitudine</label>
          <input style={inputStyle} value={person.lon} onChange={set("lon")} placeholder="24.36" />
        </div>
      </div>
    </div>
  );
}

function AstrogramePdfTool() {
  const [tab, setTab] = useState("astrology"); // "astrology" | "synastry"
  const [language, setLanguage] = useState("ro");
  const [person, setPerson] = useState({ ...EMPTY_PERSON });
  const [person1, setPerson1] = useState({ ...EMPTY_PERSON });
  const [person2, setPerson2] = useState({ ...EMPTY_PERSON });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [html, setHtml] = useState("");
  const [resultName, setResultName] = useState("");
  const iframeRef = useRef(null);

  const callApi = async (payload) => {
    const response = await fetch("/api/admin/astro-pdf", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || "Eroare necunoscută.");
    }
    return data;
  };

  const handleGenerate = async () => {
    setError("");
    setHtml("");
    setResultName("");
    setLoading(true);
    try {
      let data;
      if (tab === "astrology") {
        data = await callApi({ mode: "astrology", language, person });
      } else {
        data = await callApi({ mode: "synastry", language, person1, person2 });
      }
      setHtml(data.html || "");
      setResultName(data.fullName || "raport");
    } catch (e) {
      setError(e.message || "Eroare la generare.");
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    const frame = iframeRef.current;
    if (!frame || !frame.contentWindow) {
      return;
    }
    frame.contentWindow.focus();
    frame.contentWindow.print();
  };

  const tabButtonStyle = (active) => ({
    padding: "10px 18px",
    borderRadius: 8,
    border: "none",
    cursor: "pointer",
    fontWeight: 700,
    background: active ? "#4CAF50" : "#e0e0e0",
    color: active ? "#fff" : "#333",
  });

  return (
    <div style={{ padding: 24, background: "#fff", minHeight: "100%" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <h1 style={{ color: "#333" }}>Generare manuală PDF (plasă de siguranță)</h1>
        <p style={{ color: "#666", marginTop: -8 }}>
          Generează manual interpretarea natală sau de sinastrie pentru un client,
          previzualizeaz-o și salveaz-o ca PDF (buton de print → „Save as PDF").
        </p>

        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <button style={tabButtonStyle(tab === "astrology")} onClick={() => setTab("astrology")}>
            Astrogramă natală
          </button>
          <button style={tabButtonStyle(tab === "synastry")} onClick={() => setTab("synastry")}>
            Sinastrie (2 persoane)
          </button>
        </div>

        <div style={{ ...fieldWrapStyle, maxWidth: 220 }}>
          <label style={labelStyle}>Limbă raport</label>
          <select
            style={inputStyle}
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          >
            <option value="ro">Română</option>
            <option value="en">English</option>
          </select>
        </div>

        {tab === "astrology" ? (
          <PersonForm
            title="Date persoană"
            person={person}
            onChange={setPerson}
          />
        ) : (
          <>
            <PersonForm
              title="Persoana 1"
              person={person1}
              onChange={setPerson1}
            />
            <PersonForm
              title="Persoana 2"
              person={person2}
              onChange={setPerson2}
            />
          </>
        )}

        {error && (
          <div
            style={{
              background: "#fdecea",
              color: "#b71c1c",
              border: "1px solid #f5c6cb",
              borderRadius: 8,
              padding: "10px 14px",
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 20 }}>
          <button
            onClick={handleGenerate}
            disabled={loading}
            style={{
              padding: "12px 24px",
              borderRadius: 8,
              border: "none",
              background: loading ? "#9e9e9e" : "#1976d2",
              color: "#fff",
              fontWeight: 700,
              cursor: loading ? "default" : "pointer",
            }}
          >
            {loading ? "Se generează… (poate dura 30-60s)" : "Generează raport"}
          </button>

          {html && (
            <button
              onClick={handlePrint}
              style={{
                padding: "12px 24px",
                borderRadius: 8,
                border: "none",
                background: "#4CAF50",
                color: "#fff",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Printează / Salvează PDF
            </button>
          )}
        </div>

        {html && (
          <div>
            <p style={{ color: "#666", fontWeight: 600 }}>
              Previzualizare: {resultName}
            </p>
            <iframe
              ref={iframeRef}
              srcDoc={html}
              title="preview"
              style={{
                width: "100%",
                height: 700,
                border: "1px solid #ddd",
                borderRadius: 8,
                background: "#fff",
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default function AstrogramePdfPage() {
  return (
    <>
      <Head>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <LocalPasswordGate>
        <CustomDrawer
          variant="admin"
          basePath="/administrare"
          selectedItem={"Astrograme PDF"}
          drawerText={"Astrograme PDF"}
        >
          <AstrogramePdfTool />
        </CustomDrawer>
      </LocalPasswordGate>
    </>
  );
}
