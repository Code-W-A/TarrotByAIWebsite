import { DEFAULT_BILLING_POSTAL_CODE } from "./stripeBillingDetails";
import countriesList from "countries-list";
import { purchaseCustomer } from "./stripePurchaseCustomer";

function sanitizeString(value, maxLength = 255) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  if (!normalized) return "";
  return normalized.slice(0, maxLength);
}

/**
 * Convert app country labels (e.g. "Romania") to ISO-3166 alpha-2 for Stripe Tax.
 */
export function toStripeCountryCode(value) {
  const normalized = sanitizeString(value, 64);
  if (!normalized) return undefined;
  const lowered = normalized.toLowerCase();
  if (lowered === "romania" || lowered === "românia" || lowered === "ro") {
    return "RO";
  }
  if (normalized.length === 2 && countriesList.countries[normalized.toUpperCase()]) return normalized.toUpperCase();
  return Object.entries(countriesList.countries).find(([, country]) => country.name.toLowerCase() === lowered)?.[0];
}

function isPlaceholderPostalCode(value) {
  const normalized = sanitizeString(value, 32);
  if (!normalized) return true;
  if (normalized === DEFAULT_BILLING_POSTAL_CODE) return true;
  // Expo/mobile historically sends an all-zero placeholder unsuitable for Stripe Tax.
  return /^0+$/.test(normalized);
}

/**
 * Build a Stripe Customer address suitable for Automatic Tax.
 * Omits placeholder postal codes so Checkout can collect a real one.
 * @returns {object|null}
 */
export function buildStripeTaxAddress(billingAddress) {
  const country = toStripeCountryCode(billingAddress?.country);
  if (!country) return null;

  const address = { country };
  const line1 = sanitizeString(billingAddress?.line1, 255);
  const line2 = sanitizeString(billingAddress?.line2, 255);
  const city = sanitizeString(billingAddress?.city, 120);
  const state = sanitizeString(billingAddress?.state || billingAddress?.county, 120);
  const postalCode = sanitizeString(
    billingAddress?.postalCode || billingAddress?.postal_code,
    32
  );

  if (line1) address.line1 = line1;
  if (line2) address.line2 = line2;
  if (city) address.city = city;
  if (state) address.state = state;
  if (postalCode && !isPlaceholderPostalCode(postalCode)) {
    address.postal_code = postalCode;
  }

  return address;
}

/** Reuse the account's dedicated one-time purchase customer on mobile.
 * Web and failures retain the existing email-only behavior.
 */
export async function resolveCourseCheckoutTaxCustomerFields({
  stripe,
  db,
  sourcePlatform,
  isMobilePlatform,
  billingDetails,
  authEmail,
  uid,
}) {
  const email = sanitizeString(authEmail, 320);
  const emailFallback = email ? { customer_email: email } : {};

  if (typeof isMobilePlatform !== "function" || !isMobilePlatform(sourcePlatform)) {
    return emailFallback;
  }

  const address = buildStripeTaxAddress(billingDetails?.address);
  if (!address) {
    console.warn("[courses.checkout] tax_customer_skipped_missing_country", {
      uid: typeof uid === "string" ? uid : "unknown",
      sourcePlatform,
    });
    return emailFallback;
  }

  try {
    const name = [billingDetails?.firstName, billingDetails?.lastName]
      .map((part) => sanitizeString(part, 120))
      .filter(Boolean)
      .join(" ");
    const phone = sanitizeString(billingDetails?.phone, 64);
    const customerEmail =
      sanitizeString(billingDetails?.email, 320) || email || undefined;

    const fields = {
      ...(customerEmail ? { email: customerEmail } : {}),
      ...(name ? { name } : {}),
      ...(phone ? { phone } : {}),
      address,
    };
    const customer = db
      ? { id: await purchaseCustomer(stripe, db, uid, { ...fields, phone, address: { line1: "", line2: "", city: "", state: "", postal_code: "", ...address } }) }
      : await stripe.customers.create({ ...fields, metadata: { uid: sanitizeString(uid, 128), source: "courses_checkout" } });

    if (!customer?.id) {
      console.warn("[courses.checkout] tax_customer_missing_id", {
        uid: typeof uid === "string" ? uid : "unknown",
        sourcePlatform,
      });
      return emailFallback;
    }

    console.info("[courses.checkout] tax_customer_seeded", {
      uid: typeof uid === "string" ? uid : "unknown",
      sourcePlatform,
      customerId: customer.id,
      country: address.country,
      hasPostalCode: Boolean(address.postal_code),
    });

    return {
      customer: customer.id,
      customer_update: {
        address: "auto",
        name: "auto",
      },
    };
  } catch (error) {
    console.warn("[courses.checkout] tax_customer_seed_failed", {
      uid: typeof uid === "string" ? uid : "unknown",
      sourcePlatform,
      message: error?.message || "unknown_error",
    });
    return emailFallback;
  }
}
