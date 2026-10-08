import { useCallback, useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import PremiumRenewalControls from "../../components/settings/PremiumRenewalControls";
import AuthFunnelShell from "../../components/auth/AuthFunnelShell";
import { useAuth } from "../../context/AuthContext";
import { getFirebaseBearerHeader } from "../../utils/firebaseAuthHeaders";
import {
  PREMIUM_PRICE_CHANGE_CONSENT_TEXT_RO,
  PREMIUM_PRICE_CHANGE_NEW_TOTAL_CENTS,
  PREMIUM_PRICE_CHANGE_OLD_TOTAL_CENTS,
  PREMIUM_PRICE_CHANGE_SITE_NOTICE_BODY_RO,
  PREMIUM_PRICE_CHANGE_SITE_NOTICE_HEADLINE_RO,
  PREMIUM_PRICE_CHANGE_SITE_NOTICE_VERSION,
} from "../../lib/premiumPriceChangeConsent";

export async function getServerSideProps({ locale }) {
  return {
    props: {
      ...(await serverSideTranslations(locale, ["common"])),
    },
  };
}

const REASON_LABELS = {
  missing_line1: "strada și numărul",
  missing_city: "localitatea",
  missing_country: "țara",
  missing_postal_code: "codul poștal",
  missing_romanian_county: "județul",
  invalid_romanian_postal_code: "un cod poștal românesc valid (6 cifre)",
};

function formatMoneyFromCents(cents) {
  const value = Number(cents);
  if (!Number.isFinite(value)) return "—";
  return `${(value / 100).toFixed(2).replace(".", ",")} EUR`;
}

function formatRenewal(iso) {
  if (!iso) return "finalul perioadei curente";
  try {
    return new Intl.DateTimeFormat("ro-RO", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "Europe/Bucharest",
    }).format(new Date(iso));
  } catch (_) {
    return iso;
  }
}

export default function PremiumAcceptPricePage() {
  const router = useRouter();
  const { currentUser, loading, isGuestUser, setUserData } = useAuth();
  const [status, setStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [message, setMessage] = useState("");
  const [noticeAcknowledged, setNoticeAcknowledged] = useState(false);
  const [addressReasons, setAddressReasons] = useState([]);

  const isAuthed = Boolean(currentUser && !currentUser.isAnonymous && !isGuestUser);

  const authHeaders = useCallback(async () => {
    const bearer = await getFirebaseBearerHeader({ required: true });
    return { "Content-Type": "application/json", ...bearer };
  }, []);

  const loadStatus = useCallback(async () => {
    if (!isAuthed) return;
    setStatusLoading(true);
    setStatusError("");
    try {
      const response = await fetch("/api/stripe/premium/accept-price-change", {
        method: "GET",
        headers: await authHeaders(),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatusError(payload?.error || "Nu am putut încărca detaliile abonamentului.");
        setStatus(null);
        return;
      }
      setStatus(payload);
      if (payload?.consentAccepted) setAccepted(true);
    } catch (_) {
      setStatusError("Nu am putut încărca detaliile abonamentului.");
    } finally {
      setStatusLoading(false);
    }
  }, [authHeaders, isAuthed]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  async function openPortal(flow) {
    setOpeningPortal(true);
    setMessage("");
    try {
      const response = await fetch("/api/stripe/premium/create-portal-session", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ flow }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.url) throw new Error("portal_unavailable");
      window.location.assign(payload.url);
    } catch (_) {
      setMessage("Nu am putut deschide portalul Stripe. Încearcă din nou.");
      setOpeningPortal(false);
    }
  }

  async function acknowledgeNotice() {
    setAcknowledging(true);
    setMessage("");
    try {
      // If cancel was scheduled but consent already exists, clear cancel via accept API.
      if (status?.cancelAtPeriodEnd && status?.consentAccepted) {
        const acceptResponse = await fetch("/api/stripe/premium/accept-price-change", {
          method: "POST",
          headers: await authHeaders(),
          body: JSON.stringify({ accepted: true }),
        });
        const acceptPayload = await acceptResponse.json().catch(() => ({}));
        if (acceptResponse.ok && acceptPayload?.ok) {
          setStatus(acceptPayload);
        }
      }

      const response = await fetch("/api/stripe/premium/acknowledge-price-change-notice", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ source: "accept_page" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        setMessage(payload?.error || "Nu am putut salva confirmarea. Încearcă din nou.");
        return;
      }
      setNoticeAcknowledged(true);
      setUserData((previous) => ({
        ...(previous || {}),
        premiumPriceChangeNotice: {
          version: PREMIUM_PRICE_CHANGE_SITE_NOTICE_VERSION,
          acknowledgedAt: new Date().toISOString(),
          source: "accept_page",
        },
      }));
      setMessage("Mulțumim. Abonamentul continuă la 5 EUR + TVA de la următoarea reînnoire.");
    } catch (_) {
      setMessage("Nu am putut salva confirmarea. Încearcă din nou.");
    } finally {
      setAcknowledging(false);
    }
  }

  async function submitAccept() {
    if (!accepted) {
      setMessage("Te rugăm să bifezi acordul înainte de a continua.");
      return;
    }
    setSubmitting(true);
    setMessage("");
    setAddressReasons([]);
    try {
      const response = await fetch("/api/stripe/premium/accept-price-change", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ accepted: true }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 409 && payload?.needsAddress) {
        setAddressReasons(Array.isArray(payload.reasons) ? payload.reasons : []);
        setMessage(
          "Adresa de facturare este incompletă. Completeaz-o în portal, apoi revino și confirmă."
        );
        return;
      }
      if (!response.ok || !payload?.ok) {
        setMessage(payload?.error || "Nu am putut salva confirmarea. Încearcă din nou.");
        return;
      }
      setStatus(payload);
      setUserData((previous) => ({
        ...(previous || {}),
        premiumPriceChangeConsent: {
          ...(previous?.premiumPriceChangeConsent || {}),
          status: "accepted",
          version: payload.consentVersion,
        },
        premiumTaxAddressGate: {
          ...(previous?.premiumTaxAddressGate || {}),
          required: false,
          readyForMigration: false,
          migrationCompleted: true,
        },
      }));
      // Also acknowledge site notice so the global banner does not reappear.
      try {
        await fetch("/api/stripe/premium/acknowledge-price-change-notice", {
          method: "POST",
          headers: await authHeaders(),
          body: JSON.stringify({ source: "accept_page" }),
        });
        setUserData((previous) => ({
          ...(previous || {}),
          premiumPriceChangeNotice: {
            version: PREMIUM_PRICE_CHANGE_SITE_NOTICE_VERSION,
            acknowledgedAt: new Date().toISOString(),
            source: "accept_page",
          },
        }));
        setNoticeAcknowledged(true);
      } catch (_) {
        // Non-blocking: accept already succeeded.
      }
      setMessage(
        payload.cancelAtPeriodEnd
          ? "Prețul a fost acceptat. Oprirea reînnoirii rămâne programată."
          : "Confirmarea a fost înregistrată. Abonamentul continuă la 5 EUR + TVA de la următoarea reînnoire."
      );
    } catch (_) {
      setMessage("Nu am putut salva confirmarea. Încearcă din nou.");
    } finally {
      setSubmitting(false);
    }
  }

  const consentText = status?.consentText || PREMIUM_PRICE_CHANGE_CONSENT_TEXT_RO;
  const oldTotal = formatMoneyFromCents(status?.oldTotalCents ?? PREMIUM_PRICE_CHANGE_OLD_TOTAL_CENTS);
  const newTotal = formatMoneyFromCents(status?.newTotalCents ?? PREMIUM_PRICE_CHANGE_NEW_TOTAL_CENTS);
  const renewalLabel = formatRenewal(status?.renewalAt);
  const missingLabels = addressReasons.map((reason) => REASON_LABELS[reason]).filter(Boolean);
  const alreadyOnNewPrice = Boolean(status?.onExclusivePrice);
  const cancelScheduled = Boolean(status?.cancelAtPeriodEnd);
  const busy = submitting || acknowledging || openingPortal;

  return (
    <>
      <Head>
        <title>Actualizare preț Premium | Cristina Zurba</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <AuthFunnelShell mainVerticalAlign="start">
        <div className="mx-auto w-full max-w-xl rounded-2xl border border-slate-200 bg-white px-6 py-6 shadow-sm sm:px-8 sm:py-7">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
            {alreadyOnNewPrice
              ? PREMIUM_PRICE_CHANGE_SITE_NOTICE_HEADLINE_RO
              : "Actualizare preț Premium"}
          </h1>
          <p className="mt-2 text-sm text-slate-600 sm:text-base">
            {alreadyOnNewPrice
              ? PREMIUM_PRICE_CHANGE_SITE_NOTICE_BODY_RO
              : "Confirmă noul preț (6,05 EUR/lună în România) sau oprește abonamentul. Fără confirmare, abonamentul se oprește la finalul perioadei deja plătite."}
          </p>

          {!loading && !isAuthed ? (
            <div style={{ padding: "24px 8px", textAlign: "center" }}>
              <p style={{ marginBottom: 16, color: "#334155", lineHeight: 1.5 }}>
                Pentru a vedea detaliile abonamentului, te rugăm să te autentifici.
              </p>
              <Link
                href={`/login?returnUrl=${encodeURIComponent(router.asPath || "/premium/accept-price")}`}
                style={{
                  display: "inline-block",
                  padding: "12px 20px",
                  borderRadius: 12,
                  background: "#0f172a",
                  color: "#fff",
                  textDecoration: "none",
                  fontWeight: 600,
                }}
              >
                Autentificare
              </Link>
            </div>
          ) : null}

          {isAuthed ? (
            <div style={{ padding: "8px 4px 8px" }}>
              {statusLoading ? <p style={{ color: "#64748b" }}>Se încarcă detaliile…</p> : null}
              {statusError ? (
                <p style={{ color: "#b91c1c", marginBottom: 16 }}>{statusError}</p>
              ) : null}

              {status ? (
                <>
                  <div
                    style={{
                      borderRadius: 16,
                      border: "1px solid #e2e8f0",
                      padding: 20,
                      marginBottom: 20,
                      background: "#f8fafc",
                    }}
                  >
                    <p style={{ margin: "0 0 8px", color: "#0f172a", fontSize: 18, fontWeight: 700 }}>
                      {alreadyOnNewPrice
                        ? `Preț curent: ${newTotal}/lună (TVA inclus)`
                        : `Preț anterior: ${oldTotal}/lună`}
                    </p>
                    {!alreadyOnNewPrice ? (
                      <p style={{ margin: "0 0 8px", color: "#0f172a", fontSize: 18, fontWeight: 700 }}>
                        Preț nou (România): {newTotal}/lună, TVA inclus
                      </p>
                    ) : null}
                    <p style={{ margin: 0, color: "#475569", lineHeight: 1.5 }}>
                      {alreadyOnNewPrice ? (
                        <>
                          Următoarea reînnoire: <strong>{renewalLabel}</strong>. Dacă nu doriți să
                          continuați, opriți abonamentul — accesul rămâne până la finalul perioadei
                          deja plătite.
                        </>
                      ) : (
                        <>
                          Dacă confirmi, noul preț intră în vigoare la reînnoirea din{" "}
                          <strong>{renewalLabel}</strong>. Dacă nu confirmi, abonamentul se oprește
                          atunci (fără taxă nouă). Nu se percep diferențe retroactiv.
                        </>
                      )}
                    </p>
                    {cancelScheduled ? (
                      <p style={{ margin: "12px 0 0", color: "#b45309", lineHeight: 1.45 }}>
                        {alreadyOnNewPrice
                          ? "Oprirea abonamentului este deja programată. Confirmarea prețului păstrează oprirea reînnoirii."
                          : "Oprirea abonamentului este deja programată. Pentru reactivare, folosește acțiunea separată de mai jos."}
                      </p>
                    ) : null}
                  </div>

                  {alreadyOnNewPrice ? (
                    <>
                      {!noticeAcknowledged ? (
                        <button
                          type="button"
                          onClick={acknowledgeNotice}
                          disabled={busy}
                          style={{
                            width: "100%",
                            padding: "14px 18px",
                            borderRadius: 12,
                            border: "none",
                            background: busy ? "#94a3b8" : "#0f172a",
                            color: "#fff",
                            fontWeight: 700,
                            cursor: busy ? "not-allowed" : "pointer",
                            marginBottom: 12,
                          }}
                        >
                          {acknowledging ? "Se salvează…" : "Continui la noul preț"}
                        </button>
                      ) : (
                        <p style={{ color: "#166534", fontWeight: 600, marginBottom: 16 }}>
                          Ați confirmat că continuați la noul preț. Mulțumim.
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <label
                        style={{
                          display: "flex",
                          gap: 12,
                          alignItems: "flex-start",
                          marginBottom: 20,
                          cursor: "pointer",
                          color: "#0f172a",
                          lineHeight: 1.45,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={accepted}
                          onChange={(event) => setAccepted(event.target.checked)}
                          style={{ marginTop: 4, width: 18, height: 18 }}
                        />
                        <span>{consentText}</span>
                      </label>

                      <button
                        type="button"
                        onClick={submitAccept}
                        disabled={submitting || !accepted || openingPortal}
                        style={{
                          width: "100%",
                          padding: "14px 18px",
                          borderRadius: 12,
                          border: "none",
                          background: submitting || !accepted ? "#94a3b8" : "#0f172a",
                          color: "#fff",
                          fontWeight: 700,
                          cursor: submitting || !accepted ? "not-allowed" : "pointer",
                          marginBottom: 12,
                        }}
                      >
                        {submitting ? "Se confirmă…" : cancelScheduled ? "Confirmă noul preț" : "Confirmă și continuă abonamentul"}
                      </button>

                      {!status.addressComplete ? (
                        <button
                          type="button"
                          onClick={() => openPortal("tax_address")}
                          disabled={busy}
                          style={{
                            width: "100%",
                            padding: "12px 18px",
                            borderRadius: 12,
                            border: "1px solid #cbd5e1",
                            background: "#fff",
                            color: "#0f172a",
                            fontWeight: 600,
                            cursor: busy ? "not-allowed" : "pointer",
                            marginBottom: 12,
                          }}
                        >
                          {openingPortal ? "Se deschide portalul…" : "Completează adresa de facturare"}
                        </button>
                      ) : null}
                    </>
                  )}
                </>
              ) : null}

              <PremiumRenewalControls onChanged={loadStatus} disabled={busy} />

              {missingLabels.length ? (
                <p style={{ marginTop: 16, color: "#b45309" }}>
                  Lipsesc: {missingLabels.join(", ")}.
                </p>
              ) : null}
              {message ? (
                <p style={{ marginTop: 16, color: "#0f172a", lineHeight: 1.45 }}>{message}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </AuthFunnelShell>
    </>
  );
}
