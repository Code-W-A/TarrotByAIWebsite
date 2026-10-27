import { useEffect, useRef } from "react";
import { useAdsConsent } from "./useAdsConsent";
import { isAdsenseEnabled } from "../../lib/ads/config";

const ADS_DEBUG =
  process.env.NODE_ENV === "development" ||
  process.env.NEXT_PUBLIC_ADS_DEBUG === "true";

function adsLog(...args) {
  if (ADS_DEBUG) console.info("[ADSENSE]", ...args);
}

export default function GoogleAdSenseBanner({
  slot,
  shouldRequest = false,
  format = "auto",
  responsive = true,
  requestStorageKey = "",
  className = "",
  style,
}) {
  const { hasConsent } = useAdsConsent();
  const hasRequestedAd = useRef(false);
  const insRef = useRef(null);
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT_ID || "";
  const adsenseEnabled = isAdsenseEnabled();

  useEffect(() => {
    if (
      !adsenseEnabled ||
      !clientId ||
      !slot ||
      !shouldRequest || !hasConsent || process.env.NODE_ENV !== "production" ||
      hasRequestedAd.current ||
      typeof window === "undefined"
    ) {
      return undefined;
    }

    if (
      requestStorageKey &&
      window.sessionStorage.getItem(requestStorageKey) === "requested"
    ) {
      hasRequestedAd.current = true;
      return undefined;
    }

    let rafId = null;
    let statusTimer = null;
    let cancelled = false;
    let widthAttempts = 0;
    const MAX_WIDTH_ATTEMPTS = 60; // ~1s @ 60fps before giving up (no permanent block)

    const logFinalStatus = () => {
      const ins = insRef.current;
      const iframe = ins?.querySelector("iframe");
      adsLog("final status", {
        adStatus: ins?.getAttribute("data-ad-status") || "(none)",
        insRect: ins?.getBoundingClientRect(),
        iframeRect: iframe?.getBoundingClientRect() || null,
        hasIframe: Boolean(iframe),
        slot,
        client: clientId,
      });
    };

    // Push only when the <ins> has a real width. Pushing at 0x0 makes AdSense
    // request a 0x0 unit (format=0x0) which always comes back "unfilled".
    const doPush = () => {
      if (cancelled || hasRequestedAd.current) return;
      const ins = insRef.current;
      if (!ins) return;

      const rect = ins.getBoundingClientRect();
      if (!rect || rect.width === 0) {
        widthAttempts += 1;
        if (widthAttempts > MAX_WIDTH_ATTEMPTS) {
          // Do NOT mark as requested: a later remount/resize can retry.
          adsLog("aborting push - element stayed 0 width", { widthAttempts, slot });
          return;
        }
        rafId = window.requestAnimationFrame(doPush);
        return;
      }

      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
        hasRequestedAd.current = true;
        if (requestStorageKey) {
          window.sessionStorage.setItem(requestStorageKey, "requested");
        }
        adsLog("push done", {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          slot,
          client: clientId,
        });
        statusTimer = window.setTimeout(logFinalStatus, 3000);
      } catch (error) {
        adsLog("push error", error);
      }
    };

    // Run push only after adsbygoogle.js is fully loaded.
    const script = document.getElementById("google-adsense");
    let onScriptLoaded = null;

    if (script?.dataset.loaded === "true") {
      adsLog("script already loaded - scheduling push", { slot });
      doPush();
    } else {
      adsLog("waiting for adsbygoogle.js to load", { slot, hasScriptTag: Boolean(script) });
      onScriptLoaded = () => doPush();
      window.addEventListener("adsense-script-loaded", onScriptLoaded, { once: true });
      if (script) script.addEventListener("load", onScriptLoaded, { once: true });
    }

    return () => {
      cancelled = true;
      if (rafId) window.cancelAnimationFrame(rafId);
      if (statusTimer) window.clearTimeout(statusTimer);
      if (onScriptLoaded) {
        script?.removeEventListener("load", onScriptLoaded);
        window.removeEventListener("adsense-script-loaded", onScriptLoaded);
      }
    };
  }, [adsenseEnabled, clientId, hasConsent, requestStorageKey, shouldRequest, slot]);

  if (!adsenseEnabled) return null;

  if (!clientId || !slot) {
    return (
      <div
        className={`rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 ${className}`.trim()}
      >
        Completeaza `NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT_ID` si
        `NEXT_PUBLIC_GOOGLE_ADSENSE_MAIN_DASHBOARD_SLOT_ID`.
      </div>
    );
  }

  return (
    <div className={className}>
      <ins
        ref={insRef}
        className="adsbygoogle"
        style={{
          display: "block",
          minHeight: "120px",
          width: "100%",
          ...style,
        }}
        data-ad-client={clientId}
        data-ad-slot={slot}
        data-ad-format={format}
        data-full-width-responsive={responsive ? "true" : "false"}
      />
    </div>
  );
}
