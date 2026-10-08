import React, { useCallback, useEffect, useState } from "react";
import Head from "next/head";
import Dialog from "@mui/material/Dialog";
import { useRouter } from "next/router";
import LocalPasswordGate from "../../../components/Dashboard/LocalPasswordGate";
import VideoCacheSettings from "../../../components/Dashboard/VideoCacheSettings";

function SettingsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [settings, setSettings] = useState({
    iosPremiumSubscriptionsEnabled: true,
    subscriptionSystemEnabled: true,
    iosBillingPremiumProvider: "disabled",
    iosBillingAnalysesProvider: "disabled",
    androidBillingPremiumProvider: "revenuecat",
    androidBillingAnalysesProvider: "stripe",
    iosCoursesHidden: true,
    iosEbooksStripeEnabled: false,
    mobileUpdatePromptEnabled: false,
    mobileForceUpdateEnabled: false,
    mobileMinAppVersionIos: "",
    mobileMinAppVersionAndroid: "",
    vatPercentage: 21,
  });
  const [pendingToggle, setPendingToggle] = useState(null);
  const [pendingIosCoursesToggle, setPendingIosCoursesToggle] = useState(null);
  const [pendingMobileToggle, setPendingMobileToggle] = useState(null);
  const [pendingMobileForceToggle, setPendingMobileForceToggle] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/dashboard/settings", {
        credentials: "same-origin", cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "load_failed");
      setSettings(
        data.settings || {
          iosPremiumSubscriptionsEnabled: true,
          subscriptionSystemEnabled: true,
          iosBillingPremiumProvider: "disabled",
          iosBillingAnalysesProvider: "disabled",
          androidBillingPremiumProvider: "revenuecat",
          androidBillingAnalysesProvider: "stripe",
          iosCoursesHidden: true,
          iosEbooksStripeEnabled: false,
          mobileUpdatePromptEnabled: false,
          mobileForceUpdateEnabled: false,
          mobileMinAppVersionIos: "",
          mobileMinAppVersionAndroid: "",
          vatPercentage: 21,
        }
      );
    } catch (e) {
      setError(e?.message || "Eroare la încărcare");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleToggleClick = (newValue) => {
    setPendingToggle(newValue);
  };

  const confirmToggle = async () => {
    if (pendingToggle === null) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/dashboard/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          iosBillingPremiumProvider: pendingToggle ? "revenuecat" : "disabled",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "save_failed");
      setSettings(data.settings);
      setSuccess(
        pendingToggle
          ? "Abonamentul App Store / RevenueCat a fost activat pe iOS."
          : "Achiziția Premium pe iOS a fost oprită. Conținutul rămâne blocat fără entitlement."
      );
      setPendingToggle(null);
    } catch (e) {
      setError(e?.message || "Eroare la salvare");
    } finally {
      setSaving(false);
    }
  };

  const cancelToggle = () => {
    setPendingToggle(null);
  };

  const handleIosCoursesToggleClick = (newValue) => {
    setPendingIosCoursesToggle(newValue);
  };

  const confirmIosCoursesToggle = async () => {
    if (pendingIosCoursesToggle === null) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/dashboard/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          iosCoursesHidden: pendingIosCoursesToggle,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "save_failed");
      setSettings(data.settings);
      setSuccess(
        pendingIosCoursesToggle
          ? "Cursurile sunt ascunse în aplicația iOS. Catalogul și plata Stripe nu mai apar."
          : "Cursurile sunt din nou vizibile în aplicația iOS."
      );
      setPendingIosCoursesToggle(null);
    } catch (e) {
      setError(e?.message || "Eroare la salvare");
    } finally {
      setSaving(false);
    }
  };

  const cancelIosCoursesToggle = () => {
    setPendingIosCoursesToggle(null);
  };

  const saveAndroidBillingProvider = async (field, provider) => {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/dashboard/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ [field]: provider }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "save_failed");
      setSettings(data.settings);
      setSuccess(
        field.startsWith("ios")
          ? provider === "revenuecat"
            ? "App Store / RevenueCat a fost activat pentru fluxul iOS selectat."
            : "Fluxul iOS a fost oprit; nu va reveni la Stripe."
          : provider === "revenuecat"
            ? "Google Play Billing a fost activat pentru fluxul Android selectat."
            : "Fluxul Android selectat a revenit la Stripe."
      );
    } catch (e) {
      setError(e?.message || "Eroare la salvare");
    } finally {
      setSaving(false);
    }
  };

  const handleMobileToggleClick = (newValue) => {
    setPendingMobileToggle(newValue);
  };

  const confirmMobileToggle = async () => {
    if (pendingMobileToggle === null) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/dashboard/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mobileUpdatePromptEnabled: pendingMobileToggle,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "save_failed");
      setSettings(data.settings);
      setSuccess(
        pendingMobileToggle
          ? "Modalul de actualizare este activat în aplicația mobilă (Tarot, Mesaje magice, Noroc)."
          : "Modalul de actualizare este dezactivat pe mobil."
      );
      setPendingMobileToggle(null);
    } catch (e) {
      setError(e?.message || "Eroare la salvare");
    } finally {
      setSaving(false);
    }
  };

  const cancelMobileToggle = () => {
    setPendingMobileToggle(null);
  };

  const handleMobileForceToggleClick = (newValue) => {
    setPendingMobileForceToggle(newValue);
  };

  const confirmMobileForceToggle = async () => {
    if (pendingMobileForceToggle === null) return;
    if (pendingMobileForceToggle && !canEnableForceUpdate()) {
      setError(
        "Setează versiunile minime iOS și Android (ex. 4 — număr build) înainte de a activa force update."
      );
      setPendingMobileForceToggle(null);
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/dashboard/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mobileForceUpdateEnabled: pendingMobileForceToggle,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "save_failed");
      setSettings(data.settings);
      setSuccess(
        pendingMobileForceToggle
          ? "Force update este activat. Aplicația mobilă este blocată până la actualizare."
          : "Force update este dezactivat. Promptul poate rămâne activ ca mod soft."
      );
      setPendingMobileForceToggle(null);
    } catch (e) {
      setError(e?.message || "Eroare la salvare");
    } finally {
      setSaving(false);
    }
  };

  const cancelMobileForceToggle = () => {
    setPendingMobileForceToggle(null);
  };

  const handleMinVersionChange = (field, value) => {
    setSettings((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const saveMinAppVersions = async () => {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/dashboard/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mobileMinAppVersionIos: settings.mobileMinAppVersionIos?.trim() || null,
          mobileMinAppVersionAndroid:
            settings.mobileMinAppVersionAndroid?.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "save_failed");
      setSettings(data.settings);
      setSuccess("Versiunile minime iOS/Android au fost salvate.");
    } catch (e) {
      setError(e?.message || "Eroare la salvare");
    } finally {
      setSaving(false);
    }
  };

  const saveVatPercentage = async () => {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/dashboard/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ vatPercentage: settings.vatPercentage }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "save_failed");
      setSettings(data.settings);
      setSuccess(
        `TVA-ul afișat a fost setat la ${data.settings?.vatPercentage}%. Prețurile publice de pe site și din aplicație se actualizează în câteva minute.`
      );
    } catch (e) {
      setError(e?.message || "Eroare la salvare");
    } finally {
      setSaving(false);
    }
  };

  const canEnableForceUpdate = () => {
    const ios = String(settings.mobileMinAppVersionIos || "").trim();
    const android = String(settings.mobileMinAppVersionAndroid || "").trim();
    return ios.length > 0 && android.length > 0;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Head>
        <meta name="robots" content="noindex,nofollow" />
      </Head>

      <div className="px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8 flex flex-wrap items-center gap-4">
          <button
            onClick={() => router.push("/administrare")}
            className="group flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:border-gray-400 hover:shadow"
          >
            <svg
              className="h-4 w-4 transition-transform group-hover:-translate-x-0.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 19l-7-7m0 0l7-7m-7 7h18"
              />
            </svg>
            Administrare
          </button>
          <div className="flex items-center gap-3">
            <div className="h-8 w-px bg-gray-300" />
            <h1 className="text-xl font-bold text-gray-900">Setări Globale</h1>
          </div>
        </div>

        <VideoCacheSettings />
        {/* Error */}
        {!loading && (
          <section className="mb-6 rounded-xl border bg-white p-5">
            <h2 className="font-semibold">Locul nașterii — astrograme și sinastrii</h2>
            <p className="my-2 text-sm text-gray-600">GeoNames este implicit. Poți activa Google dacă GeoNames nu este disponibil. Se aplică și generatoarelor PDF, la următoarea căutare.</p>
            <label className="flex items-center gap-3">
              <button type="button" role="switch" aria-label="Folosește Google pentru locațiile astro"
                aria-checked={settings.astroLocationProvider === "google"} disabled={saving}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${settings.astroLocationProvider === "google" ? "bg-emerald-500" : "bg-slate-400"}`}
                onClick={async () => {
                  const provider = settings.astroLocationProvider === "google" ? "geonames" : "google";
                  setSaving(true); setError(""); setSuccess("");
                  try {
                    const response = await fetch("/api/dashboard/settings", {
                      method: "POST", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ astroLocationProvider: provider }),
                    });
                    const result = await response.json();
                    if (!response.ok) throw new Error(result.error || "Eroare la salvare");
                    setSettings(result.settings);
                    setSuccess(`Furnizor locații: ${provider === "google" ? "Google" : "GeoNames"}.`);
                  } catch (e) { setError(e.message); } finally { setSaving(false); }
                }}>
                <span className={`inline-block h-5 w-5 rounded-full bg-white transition-transform ${settings.astroLocationProvider === "google" ? "translate-x-6" : "translate-x-1"}`} />
              </button>
              {settings.astroLocationProvider === "google" ? "Google activ" : "GeoNames activ"}
            </label>
          </section>
        )}
        {error && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800">
            {error}
            <button
              onClick={load}
              className="ml-3 rounded bg-red-700 px-3 py-1 text-xs text-white hover:bg-red-600"
            >
              Reîncearcă
            </button>
          </div>
        )}

        {/* Success */}
        {success && (
          <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-800">
            {success}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-3">
            <div className="h-32 animate-pulse rounded-xl bg-slate-200" />
            <div className="h-32 animate-pulse rounded-xl bg-slate-200" />
          </div>
        )}

        {/* Settings Card */}
        {!loading && (
          <>
          <div className="max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              Plăți iOS — App Store / RevenueCat
            </h2>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <p className="font-medium text-slate-900">
                    Sistemul de abonament este{" "}
                    <span
                      className={
                        settings.iosBillingPremiumProvider === "revenuecat"
                          ? "text-emerald-600"
                          : "text-amber-600"
                      }
                    >
                      {settings.iosBillingPremiumProvider === "revenuecat"
                        ? "ACTIVAT"
                        : "DEZACTIVAT"}
                    </span>
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {settings.iosBillingPremiumProvider === "revenuecat"
                      ? "Abonamentele noi sunt cumpărate nativ din App Store și sincronizate prin RevenueCat."
                      : "Achizițiile Premium noi sunt indisponibile pe iOS. Conținutul nu devine gratuit și Stripe nu este folosit ca fallback."}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    handleToggleClick(settings.iosBillingPremiumProvider !== "revenuecat")
                  }
                  disabled={
                    saving ||
                    pendingToggle !== null ||
                    pendingIosCoursesToggle !== null ||
                    pendingMobileToggle !== null
                  }
                  className={`relative inline-flex h-7 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 ${
                    settings.iosBillingPremiumProvider === "revenuecat"
                      ? "bg-emerald-500"
                      : "bg-slate-300"
                  }`}
                  role="switch"
                  aria-checked={settings.iosBillingPremiumProvider === "revenuecat"}
                >
                  <span
                    className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      settings.iosBillingPremiumProvider === "revenuecat"
                        ? "translate-x-7"
                        : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {/* Info boxes */}
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div
                  className={`rounded-lg border p-3 ${
                    settings.iosBillingPremiumProvider === "revenuecat"
                      ? "border-emerald-200 bg-emerald-50"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Când este activat
                  </p>
                  <ul className="mt-2 space-y-1 text-sm text-slate-700">
                    <li>• iOS cumpără abonamentul prin App Store</li>
                    <li>• Videourile premium sunt blocate fără abonament pe iOS</li>
                    <li>• Android și site-ul rămân neschimbate</li>
                  </ul>
                </div>

                <div
                  className={`rounded-lg border p-3 ${
                    settings.iosBillingPremiumProvider !== "revenuecat"
                      ? "border-amber-200 bg-amber-50"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Când este dezactivat
                  </p>
                  <ul className="mt-2 space-y-1 text-sm text-slate-700">
                    <li>• Plata Premium este afișată ca indisponibilă</li>
                    <li>• Conținutul Premium rămâne blocat fără entitlement</li>
                    <li>• Abonamentele Stripe existente rămân valabile</li>
                  </ul>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4">
                <div>
                  <p className="font-medium text-slate-900">Analize astrale</p>
                  <p className="text-sm text-slate-600">
                    {settings.iosBillingAnalysesProvider === "revenuecat"
                      ? "Produse consumabile App Store / RevenueCat"
                      : "Indisponibile pe iOS; fără fallback Stripe"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    saveAndroidBillingProvider(
                      "iosBillingAnalysesProvider",
                      settings.iosBillingAnalysesProvider === "revenuecat"
                        ? "disabled"
                        : "revenuecat"
                    )
                  }
                  disabled={saving}
                  className={`relative inline-flex h-7 w-14 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 ${
                    settings.iosBillingAnalysesProvider === "revenuecat"
                      ? "bg-emerald-500"
                      : "bg-slate-300"
                  }`}
                  role="switch"
                  aria-checked={settings.iosBillingAnalysesProvider === "revenuecat"}
                >
                  <span
                    className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow transition ${
                      settings.iosBillingAnalysesProvider === "revenuecat"
                        ? "translate-x-7"
                        : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            </div>

            {settings.updatedAt && (
              <p className="mt-4 text-xs text-slate-500">
                Ultima actualizare:{" "}
                {new Date(settings.updatedAt).toLocaleString("ro-RO")}
              </p>
            )}
          </div>

          <div className="mt-8 max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-2 text-lg font-semibold text-slate-900">
              Cursuri în aplicația iOS
            </h2>
            <p className="mb-4 text-sm text-slate-600">
              Când ascunderea este activată, secțiunile de cursuri dispar din
              aplicația iOS pentru toți utilizatorii, iar checkout-ul Stripe este
              blocat. Android și site-ul rămân neschimbate. Reactivează cursurile
              pe iOS doar după ce plata se face prin In-App Purchase.
            </p>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <p className="font-medium text-slate-900">
                    Ascunderea cursurilor iOS este{" "}
                    <span
                      className={
                        settings.iosCoursesHidden === true
                          ? "text-amber-600"
                          : "text-emerald-600"
                      }
                    >
                      {settings.iosCoursesHidden === true
                        ? "ACTIVATĂ"
                        : "DEZACTIVATĂ"}
                    </span>
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {settings.iosCoursesHidden === true
                      ? "Catalogul, prețurile și butoanele de cumpărare nu apar pe iOS."
                      : "Cursurile apar normal în Dashboard și în catalogul iOS."}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    handleIosCoursesToggleClick(!(settings.iosCoursesHidden === true))
                  }
                  disabled={
                    saving ||
                    pendingToggle !== null ||
                    pendingIosCoursesToggle !== null ||
                    pendingMobileToggle !== null
                  }
                  className={`relative inline-flex h-7 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 ${
                    settings.iosCoursesHidden === true
                      ? "bg-amber-500"
                      : "bg-slate-300"
                  }`}
                  role="switch"
                  aria-checked={settings.iosCoursesHidden === true}
                >
                  <span
                    className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      settings.iosCoursesHidden === true
                        ? "translate-x-7"
                        : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          <section className="mt-8 max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-2 text-lg font-semibold text-slate-900">Plăți cărți digitale</h2>
            <p className="text-sm text-slate-600">11 EUR + TVA pe site, prin Stripe. În aplicație se folosesc achizițiile App Store și Google Play; produsele se configurează în editorul cărții, la „Achiziții mobile”.</p>
          </section>

          <div className="mt-8 max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-2 text-lg font-semibold text-slate-900">TVA afișat</h2>
            <p className="mb-4 text-sm text-slate-600">
              Procentul folosit pentru prețurile afișate clienților pe site și în
              aplicație. Prețurile din administrare rămân fără TVA, iar acesta se
              adaugă la afișare și la plată. Procentul poate fi salvat numai dacă
              este identic cu cota configurată în Stripe, ca să nu apară diferențe
              între ce vede clientul și ce se încasează.
            </p>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <label className="block max-w-xs text-sm text-slate-700">
                <span className="mb-1 block font-medium">Procent TVA (%)</span>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="21"
                  value={settings.vatPercentage ?? ""}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      vatPercentage: event.target.value,
                    }))
                  }
                  disabled={saving}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </label>
              <button
                type="button"
                onClick={saveVatPercentage}
                disabled={saving}
                className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
              >
                Salvează TVA
              </button>
              <p className="mt-3 text-xs text-slate-500">
                Pentru a schimba procentul, creează mai întâi cota nouă în Stripe și
                pune-o în{" "}
                <code className="rounded bg-slate-100 px-1">
                  STRIPE_FIXED_VAT_TAX_RATE_ID
                </code>
                . Plățile prin Google Play și App Store nu sunt afectate, pentru că
                acolo taxele sunt gestionate de magazin.
              </p>
            </div>
          </div>

          <div className="mt-8 max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-2 text-lg font-semibold text-slate-900">
              Plăți Android
            </h2>
            <p className="mb-4 text-sm text-slate-600">
              Abonamentul premium Android rămâne permanent pe Google Play Billing.
              Configurația pentru analize rămâne separată.
            </p>
            <div className="space-y-3">
              {[
                ["androidBillingAnalysesProvider", "Analize astrale"],
              ].map(([field, label]) => {
                const revenueCatEnabled = settings[field] === "revenuecat";
                return (
                  <div
                    key={field}
                    className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-4"
                  >
                    <div>
                      <p className="font-medium text-slate-900">{label}</p>
                      <p className="text-sm text-slate-600">
                        {revenueCatEnabled ? "Google Play Billing" : "Stripe (fallback)"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        saveAndroidBillingProvider(
                          field,
                          revenueCatEnabled ? "stripe" : "revenuecat"
                        )
                      }
                      disabled={saving}
                      className={`relative inline-flex h-7 w-14 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 ${
                        revenueCatEnabled ? "bg-emerald-500" : "bg-slate-300"
                      }`}
                      role="switch"
                      aria-checked={revenueCatEnabled}
                    >
                      <span
                        className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow transition ${
                          revenueCatEnabled ? "translate-x-7" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
              <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <div>
                  <p className="font-medium text-slate-900">Abonament premium</p>
                  <p className="text-sm text-emerald-700">Google Play Billing / RevenueCat — activ permanent</p>
                </div>
                <span className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white">ACTIV</span>
              </div>
            </div>
          </div>

          <div className="mt-8 max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">
              Actualizare aplicație mobilă
            </h2>
            <p className="mb-4 text-sm text-slate-600">
              Controlează dacă utilizatorii văd modalul care îi îndeamnă să
              actualizeze aplicația și dacă actualizarea devine obligatorie.
              Același semnal ca documentul Firestore{" "}
              <code className="rounded bg-slate-100 px-1 text-xs">
                ShouldUpdate/unicde
              </code>{" "}
              — câmpurile <code className="rounded bg-slate-100 px-1 text-xs">update</code> și <code className="rounded bg-slate-100 px-1 text-xs">forceUpdate</code>.
            </p>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <p className="font-medium text-slate-900">
                    Modalul de actualizare este{" "}
                    <span
                      className={
                        settings.mobileUpdatePromptEnabled === true
                          ? "text-emerald-600"
                          : "text-slate-500"
                      }
                    >
                      {settings.mobileUpdatePromptEnabled === true
                        ? "ACTIVAT"
                        : "DEZACTIVAT"}
                    </span>
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {settings.mobileUpdatePromptEnabled === true
                      ? "Utilizatorii pot vedea promptul (respectă amânarea de pe telefon, ex. după respingere)."
                      : "Nu se mai afișează promptul de actualizare pe acele ecrane."}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    handleMobileToggleClick(
                      !(settings.mobileUpdatePromptEnabled === true)
                    )
                  }
                  disabled={
                    saving ||
                    pendingToggle !== null ||
                    pendingIosCoursesToggle !== null ||
                    pendingMobileToggle !== null ||
                    pendingMobileForceToggle !== null
                  }
                  className={`relative inline-flex h-7 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 ${
                    settings.mobileUpdatePromptEnabled === true
                      ? "bg-emerald-500"
                      : "bg-slate-300"
                  }`}
                  role="switch"
                  aria-checked={settings.mobileUpdatePromptEnabled === true}
                >
                  <span
                    className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      settings.mobileUpdatePromptEnabled === true
                        ? "translate-x-7"
                        : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <p className="font-medium text-slate-900">
                    Force update este{" "}
                    <span
                      className={
                        settings.mobileForceUpdateEnabled === true
                          ? "text-rose-600"
                          : "text-slate-500"
                      }
                    >
                      {settings.mobileForceUpdateEnabled === true
                        ? "ACTIVAT"
                        : "DEZACTIVAT"}
                    </span>
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {settings.mobileForceUpdateEnabled === true
                      ? "Utilizatorii cu versiunea sub minimul setat pe platforma lor (iOS sau Android) nu pot închide modalul până fac update. Cei deja la versiunea minimă sau mai nouă pe platforma lor nu văd modalul."
                      : "Modalul poate rămâne soft (închidere permisă), în funcție de toggle-ul de prompt."}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    handleMobileForceToggleClick(
                      !(settings.mobileForceUpdateEnabled === true)
                    )
                  }
                  disabled={
                    saving ||
                    pendingToggle !== null ||
                    pendingIosCoursesToggle !== null ||
                    pendingMobileToggle !== null ||
                    pendingMobileForceToggle !== null
                  }
                  className={`relative inline-flex h-7 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 ${
                    settings.mobileForceUpdateEnabled === true
                      ? "bg-rose-500"
                      : "bg-slate-300"
                  }`}
                  role="switch"
                  aria-checked={settings.mobileForceUpdateEnabled === true}
                >
                  <span
                    className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      settings.mobileForceUpdateEnabled === true
                        ? "translate-x-7"
                        : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-slate-900">
                Versiuni minime necesare
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                Compară versiunea instalată cu minimul de pe fiecare platformă
                (iOS folosește minim iOS, Android folosește minim Android).
                Utilizatorii la versiunea minimă sau mai nouă pe platforma lor{" "}
                <strong>nu</strong> văd modalul, chiar dacă force update rămâne
                activ. Setează numărul din{" "}
                <code className="rounded bg-slate-100 px-1 text-xs">
                  EXPO_PUBLIC_APP_UPDATE_VERSION
                </code>{" "}
                al build-ului publicat (ex. 4).
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block text-sm text-slate-700">
                  <span className="mb-1 block font-medium">Versiune minimă iOS</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="4"
                    value={settings.mobileMinAppVersionIos || ""}
                    onChange={(event) =>
                      handleMinVersionChange(
                        "mobileMinAppVersionIos",
                        event.target.value
                      )
                    }
                    disabled={saving}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                  />
                </label>
                <label className="block text-sm text-slate-700">
                  <span className="mb-1 block font-medium">
                    Versiune minimă Android
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="4"
                    value={settings.mobileMinAppVersionAndroid || ""}
                    onChange={(event) =>
                      handleMinVersionChange(
                        "mobileMinAppVersionAndroid",
                        event.target.value
                      )
                    }
                    disabled={saving}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={saveMinAppVersions}
                disabled={saving}
                className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
              >
                Salvează versiuni minime
              </button>
              {settings.mobileForceUpdateEnabled === true ? (
                <p className="mt-3 text-xs text-rose-700">
                  Force update este activ: doar utilizatorii sub versiunea minimă
                  vor fi blocați.
                </p>
              ) : null}
            </div>
          </div>
          </>
        )}

        {/* Confirmation Modal — abonament */}
        {pendingToggle !== null && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
          >
            <button
              type="button"
              className="absolute inset-0 bg-slate-900/50 backdrop-blur-[1px]"
              onClick={cancelToggle}
              aria-label="Închide"
            />
            <div className="relative z-10 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
              <h2 className="text-lg font-semibold text-slate-900">
                Confirmare modificare
              </h2>

              {pendingToggle ? (
                <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="font-medium text-emerald-900">
                    Activezi abonamentul App Store
                  </p>
                  <p className="mt-2 text-sm text-emerald-800">
                    Utilizatorii iOS vor putea cumpăra abonamentul nativ prin
                    RevenueCat. Activează numai după configurarea și testarea
                    produsului în App Store Connect.
                  </p>
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <p className="font-medium text-amber-900">
                    Oprești achizițiile Premium pe iOS
                  </p>
                  <p className="mt-2 text-sm text-amber-800">
                    Nu se va folosi Stripe ca fallback și conținutul nu devine
                    gratuit. Accesul existent rămâne determinat de entitlement-uri.
                  </p>
                </div>
              )}

              <div className="mt-6 flex justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={cancelToggle}
                  disabled={saving}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Anulează
                </button>
                <button
                  type="button"
                  onClick={confirmToggle}
                  disabled={saving}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition disabled:opacity-50 ${
                    pendingToggle
                      ? "bg-emerald-600 hover:bg-emerald-500"
                      : "bg-amber-600 hover:bg-amber-500"
                  }`}
                >
                  {saving
                    ? "Se salvează…"
                    : pendingToggle
                    ? "Activează"
                    : "Dezactivează"}
                </button>
              </div>
            </div>
          </div>
        )}



        {pendingIosCoursesToggle !== null && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
          >
            <button
              type="button"
              className="absolute inset-0 bg-slate-900/50 backdrop-blur-[1px]"
              onClick={cancelIosCoursesToggle}
              aria-label="Închide"
            />
            <div className="relative z-10 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
              <h2 className="text-lg font-semibold text-slate-900">
                Confirmare — cursuri iOS
              </h2>

              {pendingIosCoursesToggle ? (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <p className="font-medium text-amber-900">
                    Ascunzi cursurile în aplicația iOS
                  </p>
                  <p className="mt-2 text-sm text-amber-800">
                    Secțiunile de cursuri dispar pentru toți utilizatorii iOS, nu
                    doar pentru App Review. Checkout-ul Stripe pe iOS este blocat.
                    Site-ul și Android rămân neschimbate.
                  </p>
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="font-medium text-emerald-900">
                    Afișezi din nou cursurile pe iOS
                  </p>
                  <p className="mt-2 text-sm text-emerald-800">
                    Catalogul și plata revin în aplicație. Nu face asta cât timp
                    plata se face prin Stripe — Apple poate respinge din nou
                    aplicația.
                  </p>
                </div>
              )}

              <div className="mt-6 flex justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={cancelIosCoursesToggle}
                  disabled={saving}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Anulează
                </button>
                <button
                  type="button"
                  onClick={confirmIosCoursesToggle}
                  disabled={saving}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition disabled:opacity-50 ${
                    pendingIosCoursesToggle
                      ? "bg-amber-600 hover:bg-amber-500"
                      : "bg-emerald-600 hover:bg-emerald-500"
                  }`}
                >
                  {saving
                    ? "Se salvează…"
                    : pendingIosCoursesToggle
                    ? "Ascunde cursurile"
                    : "Afișează cursurile"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Confirmation Modal — actualizare mobil */}
        {pendingMobileToggle !== null && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
          >
            <button
              type="button"
              className="absolute inset-0 bg-slate-900/50 backdrop-blur-[1px]"
              onClick={cancelMobileToggle}
              aria-label="Închide"
            />
            <div className="relative z-10 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
              <h2 className="text-lg font-semibold text-slate-900">
                Confirmare — aplicație mobilă
              </h2>

              {pendingMobileToggle ? (
                <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="font-medium text-emerald-900">
                    Activezi modalul de actualizare
                  </p>
                  <p className="mt-2 text-sm text-emerald-800">
                    Pe ecranele Tarot, Mesaje magice și Noroc, utilizatorii pot
                    primi îndemnul să actualizeze aplicația (conform regulilor
                    de pe telefon, inclusiv amânarea după închidere).
                  </p>
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="font-medium text-slate-900">
                    Dezactivezi modalul de actualizare
                  </p>
                  <p className="mt-2 text-sm text-slate-700">
                    Nu se va mai afișa promptul de actualizare legat de acest
                    semnal din Firestore, până îl reactivezi.
                  </p>
                </div>
              )}

              <div className="mt-6 flex justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={cancelMobileToggle}
                  disabled={saving}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Anulează
                </button>
                <button
                  type="button"
                  onClick={confirmMobileToggle}
                  disabled={saving}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition disabled:opacity-50 ${
                    pendingMobileToggle
                      ? "bg-emerald-600 hover:bg-emerald-500"
                      : "bg-slate-600 hover:bg-slate-500"
                  }`}
                >
                  {saving
                    ? "Se salvează…"
                    : pendingMobileToggle
                    ? "Activează"
                    : "Dezactivează"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Confirmation Modal — force update mobil */}
        {pendingMobileForceToggle !== null && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
          >
            <button
              type="button"
              className="absolute inset-0 bg-slate-900/50 backdrop-blur-[1px]"
              onClick={cancelMobileForceToggle}
              aria-label="Închide"
            />
            <div className="relative z-10 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
              <h2 className="text-lg font-semibold text-slate-900">
                Confirmare — force update
              </h2>

              {pendingMobileForceToggle ? (
                <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4">
                  <p className="font-medium text-rose-900">
                    Activezi actualizare obligatorie
                  </p>
                  <p className="mt-2 text-sm text-rose-800">
                    Utilizatorii nu vor putea închide modalul de actualizare și
                    nu vor putea continua în aplicație până nu fac update.
                  </p>
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="font-medium text-slate-900">
                    Dezactivezi actualizare obligatorie
                  </p>
                  <p className="mt-2 text-sm text-slate-700">
                    Utilizatorii revin la modul soft (promptul se poate închide
                    dacă rămâne activ).
                  </p>
                </div>
              )}

              <div className="mt-6 flex justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={cancelMobileForceToggle}
                  disabled={saving}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Anulează
                </button>
                <button
                  type="button"
                  onClick={confirmMobileForceToggle}
                  disabled={saving}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition disabled:opacity-50 ${
                    pendingMobileForceToggle
                      ? "bg-rose-600 hover:bg-rose-500"
                      : "bg-slate-600 hover:bg-slate-500"
                  }`}
                >
                  {saving
                    ? "Se salvează…"
                    : pendingMobileForceToggle
                    ? "Activează"
                    : "Dezactivează"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SetariPage() {
  return (
    <>
      <Head>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <LocalPasswordGate redirectTo="/administrare/login">
        <SettingsScreen />
      </LocalPasswordGate>
    </>
  );
}
