import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { getPublicAdsenseSlot, isAdsenseEnabled, isAdsenseRouteEligible } from "../../lib/ads/config";
import GoogleAdSenseBanner from "./GoogleAdSenseBanner";

function Placement({ placementId, className, slot }) {
  const ref = useRef(null);
  const [nearViewport, setNearViewport] = useState(false);
  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setNearViewport(true);
        observer.disconnect();
      }
    }, { rootMargin: "200px 0px" });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return (
    <aside ref={ref} className={`my-8 w-full px-4 ${className}`.trim()}
      aria-label="Publicitate" data-adsense-placement={placementId} style={{ paddingTop: 32, paddingBottom: 32 }}>
      <div className="mx-auto w-full max-w-4xl" style={{ minHeight: 280 }}>
        <p className="text-center text-xs text-slate-500" style={{ height: 30, margin: 0 }}>Publicitate</p>
        <GoogleAdSenseBanner slot={slot} shouldRequest={nearViewport} responsive={false}
          style={{ height: 250, minHeight: 250 }} />
      </div>
    </aside>
  );
}

export default function AdPlacementShell({ placementId = "default", className = "" }) {
  const router = useRouter();
  const slot = getPublicAdsenseSlot();
  if (!isAdsenseEnabled() || !isAdsenseRouteEligible(router.pathname) ||
      !process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT_ID || !slot) return null;
  return <Placement key={`${router.locale}:${router.asPath.split(/[?#]/)[0]}:${placementId}`}
    placementId={placementId} className={className} slot={slot} />;
}
