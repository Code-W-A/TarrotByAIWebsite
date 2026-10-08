import { useState } from "react";
import { useRouter } from "next/router";
import { useAuth } from "../context/AuthContext";
import {
  PREMIUM_ACCEPT_PRICE_PATH,
  PREMIUM_PRICE_CHANGE_SITE_NOTICE_BODY_RO,
  PREMIUM_PRICE_CHANGE_SITE_NOTICE_HEADLINE_RO,
  PREMIUM_PRICE_CHANGE_SITE_NOTICE_VERSION,
  shouldShowPremiumPriceChangeSiteNotice,
} from "../lib/premiumPriceChangeConsent";

export default function PremiumPriceChangeBanner() {
  const router = useRouter();
  const { currentUser, userData, setUserData, loading, isGuestUser } = useAuth();
  const [acknowledging, setAcknowledging] = useState(false);
  const [openingSettings, setOpeningSettings] = useState(false);
  const [error, setError] = useState("");

  const path = typeof router?.asPath === "string" ? router.asPath.split("?")[0] : "";
  const onAcceptPage =
    path === PREMIUM_ACCEPT_PRICE_PATH || path.startsWith(`${PREMIUM_ACCEPT_PRICE_PATH}/`);

  const isAuthed = Boolean(currentUser && !currentUser.isAnonymous && !isGuestUser);
  const visible =
    !loading &&
    isAuthed &&
    !onAcceptPage &&
    shouldShowPremiumPriceChangeSiteNotice(userData);

  if (!visible) return null;

  async function authHeaders() {
    const token = await currentUser.getIdToken();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
  }

  async function acknowledgeNotice() {
    setAcknowledging(true);
    setError("");
    try {
      const response = await fetch("/api/stripe/premium/acknowledge-price-change-notice", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ source: "site_banner" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        setError(payload?.error || "Nu am putut salva confirmarea. Încearcă din nou.");
        return;
      }
      setUserData((previous) => ({
        ...(previous || {}),
        premiumPriceChangeNotice: {
          version: PREMIUM_PRICE_CHANGE_SITE_NOTICE_VERSION,
          acknowledgedAt: new Date().toISOString(),
          source: "site_banner",
        },
      }));
    } catch (_) {
      setError("Nu am putut salva confirmarea. Încearcă din nou.");
    } finally {
      setAcknowledging(false);
    }
  }

  async function openCancellationSettings() {
    setOpeningSettings(true);
    setError("");
    try {
      await router.push("/settings?renewal=cancel#premium-renewal");
    } catch (_) {
      setError("Nu am putut deschide setările abonamentului. Încearcă din nou.");
      setOpeningSettings(false);
    }
  }

  return (
    <div
      role="region"
      aria-label="Anunț actualizare preț Premium"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 1100,
        width: "100%",
        background: "#0f172a",
        color: "#f8fafc",
        borderBottom: "1px solid #1e293b",
        boxShadow: "0 8px 24px rgba(15, 23, 42, 0.18)",
      }}
    >
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "12px 16px",
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ flex: "1 1 280px", minWidth: 0 }}>
          <p
            style={{
              margin: 0,
              fontWeight: 700,
              fontSize: 15,
              lineHeight: 1.35,
              color: "#fff",
            }}
          >
            {PREMIUM_PRICE_CHANGE_SITE_NOTICE_HEADLINE_RO}
          </p>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 13,
              lineHeight: 1.45,
              color: "#cbd5e1",
            }}
          >
            {PREMIUM_PRICE_CHANGE_SITE_NOTICE_BODY_RO}
          </p>
          {error ? (
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "#fecaca" }}>{error}</p>
          ) : null}
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
            flex: "0 0 auto",
          }}
        >
          <button
            type="button"
            onClick={acknowledgeNotice}
            disabled={acknowledging || openingSettings}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "none",
              background: "#fff",
              color: "#0f172a",
              fontWeight: 700,
              fontSize: 13,
              cursor: acknowledging || openingSettings ? "not-allowed" : "pointer",
              opacity: acknowledging || openingSettings ? 0.7 : 1,
            }}
          >
            {acknowledging ? "Se salvează…" : "Continui la noul preț"}
          </button>
          <button
            type="button"
            onClick={openCancellationSettings}
            disabled={acknowledging || openingSettings}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #fca5a5",
              background: "transparent",
              color: "#fecaca",
              fontWeight: 700,
              fontSize: 13,
              cursor: acknowledging || openingSettings ? "not-allowed" : "pointer",
              opacity: acknowledging || openingSettings ? 0.7 : 1,
            }}
          >
            {openingSettings ? "Se deschide…" : "Oprește reînnoirea"}
          </button>
        </div>
      </div>
    </div>
  );
}
