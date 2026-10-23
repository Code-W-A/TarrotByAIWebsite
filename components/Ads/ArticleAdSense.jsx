import { useEffect, useRef, useState } from "react";
import { isAdsenseEnabled } from "../../lib/ads/config";
import GoogleAdSenseBanner from "./GoogleAdSenseBanner";
import GoogleAdSenseScript from "./GoogleAdSenseScript";
import { useAdsConsent } from "./useAdsConsent";

export default function ArticleAdSense({ article, locale }) {
  const containerRef = useRef(null);
  const [nearViewport, setNearViewport] = useState(false);
  const { hasConsent } = useAdsConsent();
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT_ID?.trim();
  const slot = process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_ARTICLE_SLOT_ID?.trim();
  // Match the article's existing locale selection, including its legacy aliases.
  const content = locale === "hi" ? article?.info?.hu?.content
    : locale === "id" ? article?.info?.ru?.content
    : article?.info?.[locale]?.content || article?.info?.ro?.content;
  const hasText = typeof content === "string" && Boolean(
    content.replace(/<[^>]*>/g, "").replace(/&nbsp;|&#160;|\u00a0/g, " ").trim()
  );
  const enabled = process.env.NEXT_PUBLIC_ENABLE_ARTICLE_ADSENSE === "true" &&
    isAdsenseEnabled() && Boolean(clientId && slot && article && hasText);

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
    <aside ref={containerRef} aria-label="Publicitate" style={{ padding: "32px 0" }}>
      <div style={{ height: 280 }}>
        <div style={{ height: 30, fontSize: 12, color: "#64748b", textAlign: "center" }}>
          Publicitate
        </div>
        <GoogleAdSenseScript clientId={clientId} shouldLoad={shouldRequest} />
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
