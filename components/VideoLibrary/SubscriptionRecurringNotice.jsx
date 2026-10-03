import { useRouter } from "next/router";
import { useSubscriptionConsent } from "../../utils/useSubscriptionConsent";
export default function SubscriptionRecurringNotice() {
  const { locale } = useRouter();
  const { quote } = useSubscriptionConsent(locale);
  return quote ? <p className="my-3 text-sm font-medium" dir={locale === "ar" || locale === "he" ? "rtl" : "ltr"}>{quote.text}</p> : null;
}
