import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import CustomDrawer from "../../../components/Dashboard/CustomDrawer";
import LocalPasswordGate from "../../../components/Dashboard/LocalPasswordGate";
import {
  getAdsterraPlacementKey,
  getAdsterraScriptHost,
  isAdsterraEnabled,
  isAdsterraRouteEligible,
} from "../../../lib/ads/config";

function formatValue(value) {
  if (value === null || typeof value === "undefined" || value === "") return "not set";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function maskKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "not set";
  if (raw.length <= 6) return raw;
  return `${raw.slice(0, 4)}...${raw.slice(-3)}`;
}

function statusClass(value) {
  return value
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : "border-rose-200 bg-rose-50 text-rose-800";
}

export default function AdsOrchestrationDashboardPage() {
  const adsterraEnabled = isAdsterraEnabled();
  const scriptHost = useMemo(() => getAdsterraScriptHost(), []);
  const defaultKey = useMemo(() => getAdsterraPlacementKey("default"), []);
  const isProduction = process.env.NODE_ENV === "production";
  const [previewPath, setPreviewPath] = useState("/");

  const previewEligible = isAdsterraRouteEligible(previewPath);
  const shouldShowSlots =
    adsterraEnabled && previewEligible && Boolean(scriptHost) && Boolean(defaultKey);

  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      console.info("[ADS_DASHBOARD] preview", {
        previewPath,
        adsterraEnabled,
        previewEligible,
        shouldShowSlots,
      });
    }
  }, [previewPath, adsterraEnabled, previewEligible, shouldShowSlots]);

  const envRows = [
    ["NODE_ENV", process.env.NODE_ENV],
    ["NEXT_PUBLIC_ENABLE_ADSTERRA", process.env.NEXT_PUBLIC_ENABLE_ADSTERRA],
    ["NEXT_PUBLIC_ADSTERRA_SCRIPT_HOST", scriptHost || "not set"],
    ["NEXT_PUBLIC_ADSTERRA_KEY_DEFAULT", maskKey(defaultKey)],
    ["NEXT_PUBLIC_ADS_CONSENT_REQUIRED", process.env.NEXT_PUBLIC_ADS_CONSENT_REQUIRED],
  ];

  return (
    <>
      <Head>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <LocalPasswordGate>
        <CustomDrawer
          variant="admin"
          basePath="/administrare"
          selectedItem="Orchestrare Ads"
          drawerText="Orchestrare Ads"
        >
          <div className="min-h-screen bg-slate-100 p-4 md:p-6">
            <div className="mx-auto max-w-6xl space-y-6">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h1 className="text-xl font-bold text-slate-900">Dashboard Ads Orchestration</h1>
                <p className="mt-2 text-sm text-slate-600">
                  Status runtime pentru Adsterra Native Banner pe paginile publice allowlist.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <div className={`rounded-xl border p-4 text-sm ${statusClass(isProduction)}`}>
                  <p className="font-semibold">Environment</p>
                  <p className="mt-1">{isProduction ? "Production" : "Not production"}</p>
                </div>
                <div className={`rounded-xl border p-4 text-sm ${statusClass(adsterraEnabled)}`}>
                  <p className="font-semibold">Adsterra Enabled</p>
                  <p className="mt-1">{adsterraEnabled ? "Yes" : "No"}</p>
                </div>
                <div className={`rounded-xl border p-4 text-sm ${statusClass(previewEligible)}`}>
                  <p className="font-semibold">Route Eligible</p>
                  <p className="mt-1">{previewEligible ? "Yes" : "No"}</p>
                </div>
                <div className={`rounded-xl border p-4 text-sm ${statusClass(shouldShowSlots)}`}>
                  <p className="font-semibold">Would Show Slots</p>
                  <p className="mt-1">{shouldShowSlots ? "Yes" : "No"}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900">Route Simulator</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Introdu o rută (ex: <code>/</code>, <code>/news</code>, <code>/citire-personalizata</code>,
                  <code>/abonament</code>) și vezi dacă sloturile ar fi eligibile.
                </p>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <input
                    value={previewPath}
                    onChange={(event) => setPreviewPath(event.target.value || "/")}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    placeholder="/news"
                  />
                </div>
                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className={`rounded-lg border p-3 text-sm ${statusClass(previewEligible)}`}>
                    <p className="font-semibold">Eligible Route</p>
                    <p>{previewEligible ? "Yes" : "No"}</p>
                  </div>
                  <div
                    className={`rounded-lg border p-3 text-sm ${statusClass(Boolean(scriptHost && defaultKey))}`}
                  >
                    <p className="font-semibold">Host + Default Key</p>
                    <p>{Boolean(scriptHost && defaultKey) ? "Yes" : "No"}</p>
                  </div>
                  <div className={`rounded-lg border p-3 text-sm ${statusClass(shouldShowSlots)}`}>
                    <p className="font-semibold">Would Show (prod gates)</p>
                    <p>{shouldShowSlots ? "Yes" : "No"}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900">Environment Snapshot</h2>
                <div className="mt-4 overflow-auto">
                  <table className="min-w-full border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-700">
                        <th className="px-3 py-2 font-semibold">Variable</th>
                        <th className="px-3 py-2 font-semibold">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {envRows.map(([key, value]) => (
                        <tr key={key} className="border-b border-slate-100">
                          <td className="px-3 py-2 font-mono text-xs text-slate-700">{key}</td>
                          <td className="px-3 py-2 font-mono text-xs text-slate-900">{formatValue(value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 shadow-sm">
                <h2 className="text-base font-semibold">Adsterra subtle mode</h2>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>Native Banner: KEY_NATIVE + host effectivecpmnetwork (container-*).</li>
                  <li>Banner iframe: KEY_BANNER_1/2/3 + FORMAT=iframe + host highperformanceformat.com.</li>
                  <li>Max 3 sloturi/pagină; chei distincte; placementId=&quot;native&quot; pentru doar native.</li>
                  <li>Fără Popunder / Social Bar în panou Adsterra.</li>
                  <li>Production: reclama după 4 secunde pe pagină (fără scroll/cookies/limită sesiune).</li>
                  <li>AdSense este folosit pe paginile publice; configurația Adsterra de mai sus este inactivă.</li>
                  <li>Excluderi: abonament, meeting, settings, checkout cursuri.</li>
                </ul>
              </div>
            </div>
          </div>
        </CustomDrawer>
      </LocalPasswordGate>
    </>
  );
}
