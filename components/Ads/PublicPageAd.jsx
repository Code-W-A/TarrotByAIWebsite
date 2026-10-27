import { useRouter } from "next/router";
import { PUBLIC_ADS_FALLBACK_ROUTES } from "../../lib/ads/config";
import AdPlacementShell from "./AdPlacementShell";

export default function PublicPageAd() {
  const router = useRouter();
  return PUBLIC_ADS_FALLBACK_ROUTES.includes(router.pathname)
    ? <AdPlacementShell placementId="public-footer" /> : null;
}
