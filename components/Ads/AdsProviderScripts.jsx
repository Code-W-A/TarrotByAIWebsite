import { useRouter } from "next/router";
import { isAdsenseRouteEligible } from "../../lib/ads/config";
import GoogleAdSenseScript from "./GoogleAdSenseScript";
import { useAdsConsent } from "./useAdsConsent";

// One script owner for all placements, including client-side navigation.
export default function AdsProviderScripts() {
  const router = useRouter();
  const { hasConsent } = useAdsConsent();
  return <GoogleAdSenseScript clientId={process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT_ID}
    shouldLoad={process.env.NODE_ENV === "production" && hasConsent && isAdsenseRouteEligible(router.pathname)} />;
}
