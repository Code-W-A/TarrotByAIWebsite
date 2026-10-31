import { useEffect, useRef, useState } from "react";
import { getPublicAdsenseSlot, isAdsenseEnabled } from "../../lib/ads/config";
import GoogleAdSenseBanner from "./GoogleAdSenseBanner";
import { useAdsConsent } from "./useAdsConsent";
import { getArticleContent } from "../../lib/articles/adPlacements";

export default function ArticleAdSense({ article, locale, placement = "article" }) {
  const containerRef = useRef(null);
  const [nearViewport, setNearViewport] = useState(false);
  const { hasConsent } = useAdsConsent();
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT_ID?.trim();
  const slot = process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_ARTICLE_SLOT_ID?.trim() || getPublicAdsenseSlot();
  const content = getArticleContent(article, locale);
  const hasText = typeof content === "string" && Boolean(
    content.replace(/<[^>]*>/g, "").replace(/&nbsp;|&#160;|\u00a0/g, " ").trim()
  );
  const enabled = isAdsenseEnabled() && Boolean(clientId && slot && article && hasText);

  useEffect(() => {
    if (!enabled || !containerRef.current) return undefined;
    if (typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setNearViewport(true);
        observer.disconnect();
      }
    }, { rootMargin: "200px 0px" });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [enabled]);

  if (!enabled) return null;
  const shouldRequest = nearViewport && hasConsent && process.env.NODE_ENV === "production";

  return (
    <aside ref={containerRef} aria-label="Publicitate" data-adsense-placement={placement} style={{ padding: "32px 0" }}>
      <div style={{ height: 280 }}>
        <div style={{ height: 30, fontSize: 12, color: "#64748b", textAlign: "center" }}>
          Publicitate
        </div>
        <GoogleAdSenseBanner
          slot={slot}
          shouldRequest={shouldRequest}
          responsive={false}
          style={{ height: 250, minHeight: 250 }}
        />
      </div>
    </aside>
  );
}
