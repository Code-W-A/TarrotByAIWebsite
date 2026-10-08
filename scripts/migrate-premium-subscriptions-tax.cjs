#!/usr/bin/env node
/* eslint-disable no-console */

const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
const Stripe = require("stripe");
const admin = require("firebase-admin");

dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });

const APPLY_CONFIRMATION = "MIGRATE_PREMIUM_TAX";
const ADDRESS_REPAIR_CONFIRMATION = "REPAIR_STRIPE_ADDRESSES";
const ADDRESS_GATE_CONFIRMATION = "MARK_PREMIUM_TAX_ADDRESS_REQUIRED";
const ROLLBACK_UNACCEPTED_CONFIRMATION = "ROLLBACK_UNACCEPTED_EXCLUSIVE";
const SCHEDULE_CANCEL_CONFIRMATION = "SCHEDULE_CANCEL_UNACCEPTED";
const REFUND_DECLINED_CONFIRMATION = "REFUND_DECLINED_605";
const FORCE_WITHOUT_CONSENT_CONFIRMATION = "FORCE_MIGRATE_WITHOUT_CONSENT";
const ALLOWED_STATUSES = new Set(["active", "trialing", "past_due"]);
const PORTAL_LOGIN_URL = "https://billing.stripe.com/p/login/eVq28r4Gyb8XgKz3cJbjW00";
const PREMIUM_ACCEPT_PAGE_URL = "https://www.cristinazurba.com/premium/accept-price";
const PREMIUM_TAX_MIGRATION_METADATA = "exclusive_v1";
const PREMIUM_PRICE_CHANGE_CONSENT_VERSION = "v1_6_05";
const PREMIUM_PRICE_CHANGE_CANCEL_REASON = "unaccepted_v1_6_05";
const PREMIUM_PRICE_CHANGE_FORCED_SOURCE = "forced_ops_v1";
const PREMIUM_NEW_TOTAL_CENTS = 605;

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseCsv(value) {
  return [...new Set(clean(value).split(",").map(clean).filter(Boolean))];
}

function getArg(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? clean(match.slice(prefix.length)) : "";
}

function maskStripeId(value) {
  const normalized = clean(value);
  if (normalized.length <= 12) return normalized || "unknown";
  return `${normalized.slice(0, 8)}...${normalized.slice(-4)}`;
}

function hasValidPriceChangeConsentFromUserData(data) {
  const consent = data?.premiumPriceChangeConsent;
  if (!consent || typeof consent !== "object") return false;
  if (clean(consent.version) !== PREMIUM_PRICE_CHANGE_CONSENT_VERSION) return false;
  if (clean(consent.status) !== "accepted") return false;
  return Boolean(consent.acceptedAt);
}

function classifyPriceChangeSegment({
  priceId,
  taxMigration,
  latestAmountPaid,
  exclusivePriceId,
  legacyPriceIds,
}) {
  const paid = latestAmountPaid == null ? null : Number(latestAmountPaid);
  if (paid === PREMIUM_NEW_TOTAL_CENTS) return "C_deja_605";
  // Prefer live Price ID over stale taxMigration metadata after rollback.
  if ((legacyPriceIds || []).includes(priceId)) return "A_nemigrat";
  const onExclusive =
    (exclusivePriceId && priceId === exclusivePriceId) ||
    (!(legacyPriceIds || []).includes(priceId) && taxMigration === PREMIUM_TAX_MIGRATION_METADATA);
  if (onExclusive) return "B_migrat_nefacturat_605";
  return "other";
}

function isEligibleForScheduleCancelUnaccepted({
  status,
  cancelAtPeriodEnd,
  hasConsent,
  segment,
}) {
  if (!ALLOWED_STATUSES.has(clean(status))) {
    return { ok: false, reason: `status_${clean(status) || "unknown"}` };
  }
  if (cancelAtPeriodEnd) return { ok: false, reason: "already_cancel_at_period_end" };
  if (hasConsent) return { ok: false, reason: "has_consent" };
  if (segment !== "A_nemigrat" && segment !== "C_deja_605") {
    return { ok: false, reason: "segment_not_ac" };
  }
  return { ok: true, reason: null };
}

function isEligibleForRefundDeclined605({
  status,
  cancelAtPeriodEnd,
  hasConsent,
  latestAmountPaid,
  amountRefunded,
}) {
  if (hasConsent) return { ok: false, reason: "has_consent" };
  if (Number(latestAmountPaid) !== PREMIUM_NEW_TOTAL_CENTS) {
    return { ok: false, reason: "not_605_invoice" };
  }
  const refunded = amountRefunded == null ? 0 : Number(amountRefunded);
  if (refunded >= PREMIUM_NEW_TOTAL_CENTS) return { ok: false, reason: "already_refunded" };
  if (!(cancelAtPeriodEnd || clean(status) === "canceled")) {
    return { ok: false, reason: "not_canceled_or_scheduled" };
  }
  return { ok: true, reason: null };
}

function priceChangeSegmentsCsv(rows) {
  const header = [
    "segment",
    "email",
    "nume",
    "subscription_id",
    "status",
    "price_id",
    "urmatoarea_reinnoire",
    "zile_ramase",
    "latest_amount_paid_cents",
    "has_consent",
    "link_accept",
    "link_anulare",
  ];
  return [
    header,
    ...rows.map((row) => [
      row.segment,
      row.email,
      row.name,
      row.subscriptionId,
      row.status,
      row.priceId,
      row.renewalAt,
      row.daysUntilRenewal,
      row.latestAmountPaid,
      row.hasConsent ? "yes" : "no",
      row.linkAccept,
      row.linkCancel,
    ]),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
}

function buildPortalLoginUrl(email) {
  const url = new URL(PORTAL_LOGIN_URL);
  const normalizedEmail = clean(email);
  if (normalizedEmail) url.searchParams.set("prefilled_email", normalizedEmail);
  return url.toString();
}

function csvCell(value) {
  let normalized = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(normalized)) normalized = `'${normalized}`;
  return `"${normalized.replace(/"/g, '""')}"`;
}

function addressEmailExportCsv(rows) {
  const header = ["email", "nume", "urmatoarea_reinnoire", "link_stripe"];
  return [header, ...rows.map((row) => [row.email, row.name, row.renewalAt, row.portalUrl])]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
}

function inferSubscriptionPlatform(subscription) {
  const meta = subscription?.metadata || {};
  const rawPlatform = clean(meta.platform || meta.appPlatform || meta.clientPlatform).toLowerCase();
  if (rawPlatform === "ios" || rawPlatform === "iphone" || rawPlatform === "ipad") {
    return { platform: "ios", confidence: "high", source: "subscription.metadata.platform" };
  }
  if (rawPlatform === "android") {
    return { platform: "android", confidence: "high", source: "subscription.metadata.platform" };
  }
  if (rawPlatform === "expo" || rawPlatform === "mobile") {
    return { platform: "expo_mobile", confidence: "medium", source: "subscription.metadata.platform" };
  }
  if (rawPlatform === "web" || rawPlatform === "next" || rawPlatform === "nextjs") {
    return { platform: "web", confidence: "high", source: "subscription.metadata.platform" };
  }

  // Web checkout stamps flow but historically omitted platform.
  // Mobile payment-sheet always stamps platform when created via the current Expo flow.
  const flow = clean(meta.flow).toLowerCase();
  if (flow && !rawPlatform) {
    return {
      platform: "unknown_likely_web_or_legacy",
      confidence: "low",
      source: "subscription.metadata.flow_without_platform",
    };
  }
  return {
    platform: "unknown_legacy",
    confidence: "low",
    source: "missing_platform_metadata",
  };
}

function renewalScheduleCsv(rows) {
  const header = [
    "email",
    "nume",
    "subscription_id",
    "status",
    "platform",
    "platform_confidence",
    "urmatoarea_reinnoire",
    "zile_ramase",
    "link_stripe",
  ];
  return [
    header,
    ...rows.map((row) => [
      row.email,
      row.name,
      row.subscriptionId,
      row.status,
      row.platform,
      row.platformConfidence,
      row.renewalAt,
      row.daysUntilRenewal,
      row.portalUrl,
    ]),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
}

function daysUntilIso(isoDate, nowMs = Date.now()) {
  const renewalMs = Date.parse(isoDate);
  if (!Number.isFinite(renewalMs)) return "";
  return Math.ceil((renewalMs - nowMs) / (24 * 60 * 60 * 1000));
}

function renewalUrgencyBucket(daysUntil) {
  if (!Number.isFinite(daysUntil)) return "unknown";
  if (daysUntil <= 0) return "overdue_or_today";
  if (daysUntil <= 7) return "within_7_days";
  if (daysUntil <= 14) return "within_8_14_days";
  if (daysUntil <= 30) return "within_15_30_days";
  return "after_30_days";
}

function customerIdFromSubscription(subscription) {
  return typeof subscription?.customer === "string"
    ? subscription.customer
    : clean(subscription?.customer?.id);
}

function periodEndFromSubscription(subscription) {
  const subscriptionEnd = Number(subscription?.current_period_end);
  if (Number.isFinite(subscriptionEnd) && subscriptionEnd > 0) return subscriptionEnd;
  const itemEnds = (subscription?.items?.data || [])
    .map((item) => Number(item?.current_period_end))
    .filter((value) => Number.isFinite(value) && value > 0);
  return itemEnds.length ? Math.max(...itemEnds) : null;
}

function hasUsableTaxAddress(customer) {
  const address = customer?.address || customer?.shipping?.address || {};
  const country = clean(address.country).toUpperCase();
  const postalCode = clean(address.postal_code);
  if (!country || !postalCode) return false;
  if (country === "RO") {
    return Boolean(clean(address.line1) && clean(address.city));
  }
  return true;
}

function hasUsableInvoiceIdentity(customer) {
  const address = customer?.address || customer?.shipping?.address || {};
  const country = clean(address.country).toUpperCase();
  return Boolean(
    clean(customer?.name) &&
      clean(customer?.email) &&
      hasUsableTaxAddress(customer) &&
      (country !== "RO" || clean(address.state))
  );
}

function normalizeCountryCode(value) {
  const normalized = clean(value);
  const upper = normalized.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  const simplified = normalized
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const known = {
    romania: "RO",
    germany: "DE",
    germania: "DE",
    france: "FR",
    franta: "FR",
    italy: "IT",
    italia: "IT",
    spain: "ES",
    spania: "ES",
    "united kingdom": "GB",
    "marea britanie": "GB",
    "united states": "US",
    sua: "US",
  };
  return known[simplified] || "";
}

function pickProfileValue(profile, paths) {
  for (const pathParts of paths) {
    let current = profile;
    for (const part of pathParts) current = current && typeof current === "object" ? current[part] : undefined;
    const value = clean(current);
    if (value) return value;
  }
  return "";
}

function buildStripeAddressFromPremiumProfile(profile) {
  if (!profile || typeof profile !== "object") return { ok: false, reason: "missing_premium_billing_profile" };
  const line1 = pickProfileValue(profile, [
    ["billing", "address", "line1"],
    ["billing", "company", "address"],
    ["normalizedBeforeCheckout", "address"],
    ["rawFormValues", "address"],
    ["rawFormValues", "billingAddress"],
  ]);
  const line2 = pickProfileValue(profile, [["billing", "address", "line2"]]);
  const city = pickProfileValue(profile, [
    ["billing", "address", "city"],
    ["normalizedBeforeCheckout", "city"],
    ["rawFormValues", "city"],
    ["rawFormValues", "billingCity"],
  ]);
  const state = pickProfileValue(profile, [
    ["billing", "address", "state"],
    ["billing", "address", "county"],
    ["normalizedBeforeCheckout", "state"],
    ["rawFormValues", "state"],
    ["rawFormValues", "county"],
    ["rawFormValues", "billingCounty"],
  ]);
  const postalCode = pickProfileValue(profile, [
    ["billing", "address", "postalCode"],
    ["billing", "address", "postal_code"],
    ["normalizedBeforeCheckout", "postalCode"],
    ["rawFormValues", "postalCode"],
    ["rawFormValues", "postal_code"],
  ]).replace(/\s+/g, "");
  const country = normalizeCountryCode(
    pickProfileValue(profile, [
      ["billing", "address", "country"],
      ["normalizedBeforeCheckout", "country"],
      ["rawFormValues", "country"],
      ["rawFormValues", "billingCountry"],
    ])
  );
  const reasons = [];
  if (!line1) reasons.push("firestore_address_missing_line1");
  if (!city) reasons.push("firestore_address_missing_city");
  if (!country) reasons.push("firestore_address_missing_or_unknown_country");
  if (!postalCode || postalCode === "000000") reasons.push("firestore_address_missing_postal_code");
  if (country === "RO" && !state) reasons.push("firestore_address_missing_romanian_county");
  if (country === "RO" && !/^\d{6}$/.test(postalCode)) reasons.push("firestore_address_invalid_romanian_postal_code");
  if (country !== "RO" && postalCode && postalCode.length < 3) reasons.push("firestore_address_invalid_postal_code");
  if (reasons.length) return { ok: false, reasons };
  return {
    ok: true,
    address: {
      line1,
      ...(line2 ? { line2 } : {}),
      city,
      ...(state ? { state } : {}),
      postal_code: postalCode,
      country,
    },
  };
}

function validateStripeAddressCandidate(rawAddress) {
  const source = rawAddress && typeof rawAddress === "object" ? rawAddress : {};
  const line1 = clean(source.line1 || source.address_line1);
  const line2 = clean(source.line2 || source.address_line2);
  const city = clean(source.city || source.address_city);
  const state = clean(source.state || source.address_state);
  const postalCode = clean(source.postal_code || source.postalCode || source.address_zip).replace(/\s+/g, "");
  const country = normalizeCountryCode(source.country || source.address_country);
  const reasons = [];
  if (!line1) reasons.push("payment_address_missing_line1");
  if (!city) reasons.push("payment_address_missing_city");
  if (!country) reasons.push("payment_address_missing_or_unknown_country");
  if (!postalCode || postalCode === "000000") reasons.push("payment_address_missing_postal_code");
  if (country === "RO" && !state) reasons.push("payment_address_missing_romanian_county");
  if (country === "RO" && !/^\d{6}$/.test(postalCode)) reasons.push("payment_address_invalid_romanian_postal_code");
  if (country !== "RO" && postalCode && postalCode.length < 3) reasons.push("payment_address_invalid_postal_code");
  if (reasons.length) return { ok: false, reasons };
  return {
    ok: true,
    address: {
      line1,
      ...(line2 ? { line2 } : {}),
      city,
      ...(state ? { state } : {}),
      postal_code: postalCode,
      country,
    },
  };
}

function paymentAddressFromObject(paymentObject) {
  if (!paymentObject || typeof paymentObject !== "object") return null;
  if (paymentObject.billing_details?.address) return paymentObject.billing_details.address;
  if (paymentObject.object === "card") {
    return {
      line1: paymentObject.address_line1,
      line2: paymentObject.address_line2,
      city: paymentObject.address_city,
      state: paymentObject.address_state,
      postal_code: paymentObject.address_zip,
      country: paymentObject.address_country,
    };
  }
  if (paymentObject.owner?.address) return paymentObject.owner.address;
  return null;
}

async function findCompleteStripePaymentAddress(stripe, subscription, customer) {
  const customerId = customerIdFromSubscription(subscription);
  const seen = new Set();
  const paymentObjects = [];
  const addPaymentObject = (value) => {
    if (!value || typeof value !== "object") return;
    const id = clean(value.id);
    if (id && seen.has(id)) return;
    if (id) seen.add(id);
    paymentObjects.push(value);
  };

  for (const candidate of [subscription?.default_payment_method, customer?.invoice_settings?.default_payment_method]) {
    if (candidate && typeof candidate === "object") {
      addPaymentObject(candidate);
    } else if (clean(candidate)) {
      try {
        addPaymentObject(await stripe.paymentMethods.retrieve(clean(candidate)));
      } catch (_) {
        // Continue with the Customer's attached payment methods.
      }
    }
  }

  if (customerId) {
    const attachedCards = stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 100 });
    for await (const paymentMethod of attachedCards) addPaymentObject(paymentMethod);

    const defaultSourceId =
      typeof customer?.default_source === "string" ? customer.default_source : clean(customer?.default_source?.id);
    if (customer?.default_source && typeof customer.default_source === "object") {
      addPaymentObject(customer.default_source);
    } else if (defaultSourceId) {
      try {
        addPaymentObject(await stripe.customers.retrieveSource(customerId, defaultSourceId));
      } catch (_) {
        // Legacy source may no longer be retrievable; attached PaymentMethods were already checked.
      }
    }
  }

  const reasonCounts = {};
  for (const paymentObject of paymentObjects) {
    const candidate = validateStripeAddressCandidate(paymentAddressFromObject(paymentObject));
    if (candidate.ok) return candidate;
    for (const reason of candidate.reasons || []) {
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    }
  }
  return {
    ok: false,
    reasons: paymentObjects.length
      ? Object.keys(reasonCounts)
      : ["stripe_payment_method_not_found"],
  };
}

function sumAmounts(values) {
  return (Array.isArray(values) ? values : []).reduce(
    (total, item) => total + (Number.isFinite(Number(item?.amount)) ? Number(item.amount) : 0),
    0
  );
}

function addReasonCounts(summary, reasons) {
  for (const reason of reasons) {
    summary.reasonCounts[reason] = (summary.reasonCounts[reason] || 0) + 1;
  }
}

function assessPreview(preview, customerCountry, destinationPrice) {
  const expectedNet = Number(destinationPrice?.unit_amount);
  const subtotal = Number(preview?.subtotal);
  const total = Number(preview?.total);
  const amountDue = Number(preview?.amount_due);
  const tax = sumAmounts(preview?.total_tax_amounts);
  const discounts = sumAmounts(preview?.total_discount_amounts);
  const taxStatus = clean(preview?.automatic_tax?.status);
  const reasons = [];

  if (subtotal !== expectedNet) reasons.push("subtotal_not_destination_price");
  if (discounts !== 0) reasons.push("discount_present");
  if (amountDue !== total) reasons.push("customer_balance_or_credit_present");
  if (total !== subtotal + tax) reasons.push("preview_total_breakdown_mismatch");
  if (!(subtotal === 500 && tax === 105 && total === 605)) {
    reasons.push("fixed_vat_total_must_be_605");
  }

  return {
    ok: reasons.length === 0,
    reasons,
    subtotal,
    tax,
    total,
    amountDue,
    taxStatus,
    currency: clean(preview?.currency).toUpperCase(),
  };
}

function validateDestinationPrice(price) {
  const reasons = [];
  if (!price?.active) reasons.push("destination_price_inactive");
  if (price?.tax_behavior !== "exclusive") reasons.push("destination_price_not_exclusive");
  if (clean(price?.currency).toLowerCase() !== "eur") reasons.push("destination_price_not_eur");
  if (Number(price?.unit_amount) !== 500) reasons.push("destination_price_not_500_cents");
  if (price?.recurring?.interval !== "month" || Number(price?.recurring?.interval_count || 1) !== 1) {
    reasons.push("destination_price_not_monthly");
  }
  return { ok: reasons.length === 0, reasons };
}

function subscriptionStructuralBlockers(subscription, legacyPriceIds) {
  const items = subscription?.items?.data || [];
  const legacyItems = items.filter((item) => legacyPriceIds.includes(clean(item?.price?.id)));
  const reasons = [];
  if (!ALLOWED_STATUSES.has(subscription?.status)) reasons.push(`status_${subscription?.status || "unknown"}`);
  if (subscription?.cancel_at_period_end) reasons.push("cancel_at_period_end");
  if (subscription?.pause_collection) reasons.push("pause_collection");
  if (subscription?.pending_update) reasons.push("pending_update");
  if (subscription?.schedule) reasons.push("subscription_schedule_present");
  if (subscription?.collection_method !== "charge_automatically") reasons.push("not_charge_automatically");
  if (items.length !== 1 || legacyItems.length !== 1) reasons.push("subscription_items_not_single_legacy_item");
  if (legacyItems[0] && Number(legacyItems[0].quantity || 1) !== 1) reasons.push("quantity_not_one");
  if ((subscription?.default_tax_rates || []).length) reasons.push("manual_default_tax_rates_present");
  if ((legacyItems[0]?.tax_rates || []).length) reasons.push("manual_item_tax_rates_present");
  return { ok: reasons.length === 0, reasons, item: legacyItems[0] || null };
}

function initFirestoreIfConfigured() {
  const projectId = clean(process.env.FIREBASE_PROJECT_ID);
  const clientEmail = clean(process.env.FIREBASE_CLIENT_EMAIL);
  const privateKey = clean(process.env.FIREBASE_PRIVATE_KEY).replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) return null;
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    });
  }
  return admin.firestore();
}

async function findPremiumUser(db, subscription, customerId) {
  if (!db) return { ok: false, reason: "firestore_not_configured" };

  const bySubscription = await db
    .collection("Users")
    .where("stripeSubscriptionId", "==", subscription.id)
    .limit(2)
    .get();
  let docs = bySubscription.docs;
  if (!docs.length && customerId) {
    const byCustomer = await db
      .collection("Users")
      .where("stripeCustomerId", "==", customerId)
      .limit(2)
      .get();
    docs = byCustomer.docs;
  }
  if (docs.length !== 1) {
    return { ok: false, reason: docs.length ? "multiple_firestore_users" : "firestore_user_not_found" };
  }
  const data = docs[0].data() || {};
  const hasBillingProfile = Boolean(
    data?.premiumBillingProfile?.billing && typeof data.premiumBillingProfile.billing === "object"
  );
  return {
    ok: true,
    uid: docs[0].id,
    hasBillingProfile,
    billingProfile: data?.premiumBillingProfile || null,
    hasPriceChangeConsent: hasValidPriceChangeConsentFromUserData(data),
    userData: data,
  };
}

async function listCandidates(stripe, legacyPriceIds, onlySubscriptionId) {
  if (onlySubscriptionId) {
    return [await stripe.subscriptions.retrieve(onlySubscriptionId, { expand: ["customer"] })];
  }
  const byId = new Map();
  for (const priceId of legacyPriceIds) {
    const subscriptions = stripe.subscriptions.list({ price: priceId, status: "all", limit: 100 });
    for await (const subscription of subscriptions) {
      byId.set(subscription.id, subscription);
    }
  }
  return [...byId.values()];
}

async function listCandidatesByPriceIds(stripe, priceIds, onlySubscriptionId) {
  if (onlySubscriptionId) {
    return [await stripe.subscriptions.retrieve(onlySubscriptionId, { expand: ["customer"] })];
  }
  const byId = new Map();
  for (const priceId of priceIds) {
    const subscriptions = stripe.subscriptions.list({ price: priceId, status: "all", limit: 100 });
    for await (const subscription of subscriptions) {
      byId.set(subscription.id, subscription);
    }
  }
  return [...byId.values()];
}

async function latestPaidInvoiceAmount(stripe, subscriptionId) {
  const invoice = await latestPaidInvoice(stripe, subscriptionId);
  return invoice ? Number(invoice.amount_paid) : null;
}

async function latestPaidInvoice(stripe, subscriptionId) {
  const invoices = await stripe.invoices.list({
    subscription: subscriptionId,
    status: "paid",
    limit: 5,
  });
  return (invoices.data || []).find((invoice) => Number(invoice.amount_paid) > 0) || null;
}

async function rollbackOne(stripe, subscription, item, legacyPriceId, uid) {
  const nextMeta = { ...(subscription.metadata || {}) };
  // Stripe clears metadata keys only when set to empty string.
  nextMeta.taxMigration = "";
  nextMeta.priceChangeConsentVersion = "";
  if (clean(uid)) nextMeta.uid = clean(uid);
  nextMeta.flow = nextMeta.flow || "site_premium";
  nextMeta.taxMigrationRollback = "unaccepted_exclusive_v1";
  return stripe.subscriptions.update(
    subscription.id,
    {
      automatic_tax: { enabled: false },
      billing_cycle_anchor: "unchanged",
      proration_behavior: "none",
      items: [{ id: item.id, price: legacyPriceId, quantity: 1 }],
      metadata: nextMeta,
    },
    { idempotencyKey: `premium-tax-rollback-unaccepted-v1-${subscription.id}-${legacyPriceId}` }
  );
}

async function discoverPremiumPrices(stripe) {
  const rows = [];
  const prices = stripe.prices.list({
    active: true,
    type: "recurring",
    limit: 100,
    expand: ["data.product"],
  });
  for await (const price of prices) {
    if (
      clean(price.currency).toLowerCase() !== "eur" ||
      Number(price.unit_amount) !== 500 ||
      price?.recurring?.interval !== "month" ||
      Number(price?.recurring?.interval_count || 1) !== 1
    ) {
      continue;
    }
    const statuses = {};
    let subscriptions = 0;
    const matching = stripe.subscriptions.list({ price: price.id, status: "all", limit: 100 });
    for await (const subscription of matching) {
      statuses[subscription.status] = (statuses[subscription.status] || 0) + 1;
      subscriptions += 1;
    }
    rows.push({
      priceId: price.id,
      taxBehavior: clean(price.tax_behavior) || "unspecified",
      productName:
        price.product && typeof price.product === "object"
          ? clean(price.product.name).slice(0, 120)
          : "",
      subscriptions,
      statuses,
      likelyRole:
        price.tax_behavior === "exclusive"
          ? "destination_new"
          : subscriptions > 0
            ? "legacy_candidate"
            : "other",
    });
  }
  return rows;
}

async function resolveCustomer(stripe, subscription) {
  if (subscription?.customer && typeof subscription.customer === "object") return subscription.customer;
  const customerId = customerIdFromSubscription(subscription);
  return customerId ? stripe.customers.retrieve(customerId) : null;
}

function customerCountry(customer) {
  return clean(customer?.address?.country || customer?.shipping?.address?.country).toUpperCase();
}

async function previewMigration(stripe, subscription, item, destinationPriceId) {
  const fixedVatTaxRateId = clean(process.env.STRIPE_FIXED_VAT_TAX_RATE_ID);
  if (!fixedVatTaxRateId) throw new Error("Missing STRIPE_FIXED_VAT_TAX_RATE_ID");
  return stripe.invoices.createPreview({
    customer: customerIdFromSubscription(subscription),
    subscription: subscription.id,
    automatic_tax: { enabled: false },
    subscription_details: {
      billing_cycle_anchor: "unchanged",
      proration_behavior: "none",
      default_tax_rates: [fixedVatTaxRateId],
      items: [
        {
          id: item.id,
          price: destinationPriceId,
          quantity: 1,
        },
      ],
    },
  });
}

async function migrateOne(stripe, subscription, item, destinationPriceId, uid, options = {}) {
  const forceWithoutConsent = Boolean(options.forceWithoutConsent);
  const fixedVatTaxRateId = clean(process.env.STRIPE_FIXED_VAT_TAX_RATE_ID);
  if (!fixedVatTaxRateId) throw new Error("Missing STRIPE_FIXED_VAT_TAX_RATE_ID");
  return stripe.subscriptions.update(
    subscription.id,
    {
      automatic_tax: { enabled: false },
      default_tax_rates: [fixedVatTaxRateId],
      billing_cycle_anchor: "unchanged",
      proration_behavior: "none",
      items: [{ id: item.id, price: destinationPriceId, quantity: 1 }],
      metadata: {
        ...(subscription.metadata || {}),
        flow: "site_premium",
        uid,
        taxMigration: PREMIUM_TAX_MIGRATION_METADATA,
        priceChangeConsentVersion: PREMIUM_PRICE_CHANGE_CONSENT_VERSION,
        ...(forceWithoutConsent
          ? { priceChangeConsentSource: PREMIUM_PRICE_CHANGE_FORCED_SOURCE }
          : {}),
      },
    },
    { idempotencyKey: `premium-tax-exclusive-v1-${subscription.id}-${destinationPriceId}` }
  );
}

function forceMigrateSkippedCsv(rows) {
  const header = [
    "email",
    "subscription_id",
    "status",
    "urmatoarea_reinnoire",
    "reasons",
  ];
  return [
    header,
    ...rows.map((row) => [
      row.email || "",
      row.subscriptionIdFull || "",
      row.status || "",
      row.renewalAt || "",
      Array.isArray(row.reasons) ? row.reasons.join("|") : "",
    ]),
  ]
    .map((line) => line.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

async function runAddressRepair({ stripe, db, candidates, legacyPriceIds, apply, summaryOnly }) {
  if (!db) throw new Error("Address repair requires Firebase Admin configuration");
  const summary = {
    scanned: candidates.length,
    renewingCandidates: 0,
    alreadyCompleteInStripe: 0,
    repairableFromFirestore: 0,
    unrepairableFromFirestore: 0,
    repaired: 0,
    failed: 0,
    ignoredNonRenewing: 0,
    reasonCounts: {},
  };

  console.log("[premium-address-repair] start", { mode: apply ? "APPLY" : "DRY_RUN" });
  for (const subscription of candidates) {
    const structural = subscriptionStructuralBlockers(subscription, legacyPriceIds);
    if (!structural.ok) {
      summary.ignoredNonRenewing += 1;
      addReasonCounts(summary, structural.reasons);
      continue;
    }
    summary.renewingCandidates += 1;
    const customerId = customerIdFromSubscription(subscription);
    try {
      const customer = await resolveCustomer(stripe, subscription);
      if (!customer || customer.deleted) {
        summary.unrepairableFromFirestore += 1;
        addReasonCounts(summary, ["customer_missing_or_deleted"]);
        continue;
      }
      if (hasUsableTaxAddress(customer)) {
        summary.alreadyCompleteInStripe += 1;
        continue;
      }
      const user = await findPremiumUser(db, subscription, customerId);
      if (!user.ok) {
        summary.unrepairableFromFirestore += 1;
        addReasonCounts(summary, [user.reason]);
        continue;
      }
      const repair = buildStripeAddressFromPremiumProfile(user.billingProfile);
      if (!repair.ok) {
        summary.unrepairableFromFirestore += 1;
        addReasonCounts(summary, repair.reasons || [repair.reason || "firestore_address_incomplete"]);
        continue;
      }
      summary.repairableFromFirestore += 1;
      if (!apply) continue;

      const updated = await stripe.customers.update(
        customerId,
        { address: repair.address },
        { idempotencyKey: `premium-address-repair-v1-${customerId}` }
      );
      if (!hasUsableTaxAddress(updated)) throw new Error("post_update_customer_address_validation_failed");
      summary.repaired += 1;
      if (!summaryOnly) {
        console.log("[premium-address-repair] repaired", { customerId: maskStripeId(customerId) });
      }
    } catch (error) {
      summary.failed += 1;
      console.error("[premium-address-repair] failed", {
        customerId: maskStripeId(customerId),
        message: clean(error?.message).slice(0, 300),
      });
    }
  }
  console.log(
    JSON.stringify({ event: "premium-address-repair.summary", mode: apply ? "APPLY" : "DRY_RUN", summary }, null, 2)
  );
  if (summary.failed) process.exitCode = 1;
}

async function runPaymentAddressRepair({ stripe, candidates, legacyPriceIds, apply, summaryOnly }) {
  const summary = {
    scanned: candidates.length,
    renewingCandidates: 0,
    alreadyCompleteInStripe: 0,
    repairableFromStripePayments: 0,
    unrepairableFromStripePayments: 0,
    repaired: 0,
    failed: 0,
    ignoredNonRenewing: 0,
    reasonCounts: {},
  };

  console.log("[premium-payment-address-repair] start", { mode: apply ? "APPLY" : "DRY_RUN" });
  for (const subscription of candidates) {
    const structural = subscriptionStructuralBlockers(subscription, legacyPriceIds);
    if (!structural.ok) {
      summary.ignoredNonRenewing += 1;
      addReasonCounts(summary, structural.reasons);
      continue;
    }
    summary.renewingCandidates += 1;
    const customerId = customerIdFromSubscription(subscription);
    try {
      const customer = await resolveCustomer(stripe, subscription);
      if (!customer || customer.deleted) {
        summary.unrepairableFromStripePayments += 1;
        addReasonCounts(summary, ["customer_missing_or_deleted"]);
        continue;
      }
      if (hasUsableTaxAddress(customer)) {
        summary.alreadyCompleteInStripe += 1;
        continue;
      }
      const repair = await findCompleteStripePaymentAddress(stripe, subscription, customer);
      if (!repair.ok) {
        summary.unrepairableFromStripePayments += 1;
        addReasonCounts(summary, repair.reasons || ["stripe_payment_address_incomplete"]);
        continue;
      }
      summary.repairableFromStripePayments += 1;
      if (!apply) continue;

      const updated = await stripe.customers.update(
        customerId,
        { address: repair.address },
        { idempotencyKey: `premium-payment-address-repair-v1-${customerId}` }
      );
      if (!hasUsableTaxAddress(updated)) throw new Error("post_update_customer_address_validation_failed");
      summary.repaired += 1;
      if (!summaryOnly) {
        console.log("[premium-payment-address-repair] repaired", { customerId: maskStripeId(customerId) });
      }
    } catch (error) {
      summary.failed += 1;
      console.error("[premium-payment-address-repair] failed", {
        customerId: maskStripeId(customerId),
        message: clean(error?.message).slice(0, 300),
      });
    }
  }
  console.log(
    JSON.stringify(
      { event: "premium-payment-address-repair.summary", mode: apply ? "APPLY" : "DRY_RUN", summary },
      null,
      2
    )
  );
  if (summary.failed) process.exitCode = 1;
}

async function runAddressGateMarking({ stripe, db, candidates, legacyPriceIds, apply, summaryOnly }) {
  if (!db) throw new Error("Address gate marking requires Firebase Admin configuration");
  const summary = {
    scanned: candidates.length,
    renewingCandidates: 0,
    addressAlreadyComplete: 0,
    eligibleForGate: 0,
    marked: 0,
    failed: 0,
    ignoredNonRenewing: 0,
    reasonCounts: {},
  };

  console.log("[premium-tax-address-gate] start", { mode: apply ? "APPLY" : "DRY_RUN" });
  for (const subscription of candidates) {
    const structural = subscriptionStructuralBlockers(subscription, legacyPriceIds);
    if (!structural.ok) {
      summary.ignoredNonRenewing += 1;
      addReasonCounts(summary, structural.reasons);
      continue;
    }
    summary.renewingCandidates += 1;
    const customerId = customerIdFromSubscription(subscription);
    try {
      const customer = await resolveCustomer(stripe, subscription);
      if (!customer || customer.deleted) {
        addReasonCounts(summary, ["customer_missing_or_deleted"]);
        continue;
      }
      if (hasUsableTaxAddress(customer)) {
        summary.addressAlreadyComplete += 1;
        continue;
      }
      const user = await findPremiumUser(db, subscription, customerId);
      if (!user.ok) {
        addReasonCounts(summary, [user.reason]);
        continue;
      }

      summary.eligibleForGate += 1;
      if (!apply) continue;
      await db.collection("Users").doc(user.uid).set(
        {
          premiumTaxAddressGate: {
            required: true,
            readyForMigration: false,
            reason: "stripe_tax_address_incomplete",
            subscriptionId: subscription.id,
            renewalAt: periodEndFromSubscription(subscription)
              ? new Date(periodEndFromSubscription(subscription) * 1000).toISOString()
              : null,
            markedAt: admin.firestore.FieldValue.serverTimestamp(),
            version: 1,
          },
        },
        { merge: true }
      );
      summary.marked += 1;
      if (!summaryOnly) {
        console.log("[premium-tax-address-gate] marked", {
          subscriptionId: maskStripeId(subscription.id),
        });
      }
    } catch (error) {
      summary.failed += 1;
      console.error("[premium-tax-address-gate] failed", {
        subscriptionId: maskStripeId(subscription.id),
        message: clean(error?.message).slice(0, 300),
      });
    }
  }

  console.log(
    JSON.stringify(
      { event: "premium-tax-address-gate.summary", mode: apply ? "APPLY" : "DRY_RUN", summary },
      null,
      2
    )
  );
  if (summary.failed) process.exitCode = 1;
}

async function exportRenewalSchedule({ stripe, candidates, legacyPriceIds, outputPath }) {
  const rows = [];
  const summary = {
    scanned: candidates.length,
    renewingCandidates: 0,
    addressIncomplete: 0,
    addressAlreadyComplete: 0,
    exported: 0,
    missingEmail: 0,
    ignoredNonRenewing: 0,
    failed: 0,
    platformCounts: {},
    urgencyBuckets: {
      overdue_or_today: 0,
      within_7_days: 0,
      within_8_14_days: 0,
      within_15_30_days: 0,
      after_30_days: 0,
      unknown: 0,
    },
    soonestRenewalAt: null,
    latestRenewalAt: null,
  };

  console.log("[premium-tax-renewal-schedule] start");
  const nowMs = Date.now();
  for (const subscription of candidates) {
    const structural = subscriptionStructuralBlockers(subscription, legacyPriceIds);
    if (!structural.ok) {
      summary.ignoredNonRenewing += 1;
      continue;
    }
    summary.renewingCandidates += 1;
    try {
      const customer = await resolveCustomer(stripe, subscription);
      if (!customer || customer.deleted) {
        summary.failed += 1;
        continue;
      }
      if (hasUsableTaxAddress(customer)) {
        summary.addressAlreadyComplete += 1;
        continue;
      }
      summary.addressIncomplete += 1;

      const periodEnd = periodEndFromSubscription(subscription);
      const renewalAt = periodEnd ? new Date(periodEnd * 1000).toISOString() : "";
      const daysUntilRenewal = renewalAt === "" ? "" : daysUntilIso(renewalAt, nowMs);
      const bucket = renewalUrgencyBucket(
        daysUntilRenewal === "" ? Number.NaN : Number(daysUntilRenewal)
      );
      summary.urgencyBuckets[bucket] = (summary.urgencyBuckets[bucket] || 0) + 1;
      if (renewalAt) {
        if (!summary.soonestRenewalAt || renewalAt < summary.soonestRenewalAt) {
          summary.soonestRenewalAt = renewalAt;
        }
        if (!summary.latestRenewalAt || renewalAt > summary.latestRenewalAt) {
          summary.latestRenewalAt = renewalAt;
        }
      }

      const email = clean(customer.email).toLowerCase();
      if (!email) {
        summary.missingEmail += 1;
      }
      const platformInfo = inferSubscriptionPlatform(subscription);
      summary.platformCounts[platformInfo.platform] =
        (summary.platformCounts[platformInfo.platform] || 0) + 1;
      rows.push({
        email: email || "",
        name: clean(customer.name),
        subscriptionId: subscription.id,
        status: clean(subscription.status),
        platform: platformInfo.platform,
        platformConfidence: platformInfo.confidence,
        renewalAt,
        daysUntilRenewal,
        portalUrl: buildPortalLoginUrl(email),
      });
    } catch (error) {
      summary.failed += 1;
      console.error("[premium-tax-renewal-schedule] failed", {
        subscriptionId: maskStripeId(subscription.id),
        message: clean(error?.message).slice(0, 300),
      });
    }
  }

  rows.sort(
    (a, b) =>
      String(a.renewalAt).localeCompare(String(b.renewalAt)) ||
      String(a.email).localeCompare(String(b.email))
  );
  summary.exported = rows.length;
  const resolvedOutputPath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  fs.writeFileSync(resolvedOutputPath, `${renewalScheduleCsv(rows)}\n`, { encoding: "utf8", mode: 0o600 });

  console.log(
    JSON.stringify(
      {
        event: "premium-tax-renewal-schedule.summary",
        summary,
        outputPath: resolvedOutputPath,
      },
      null,
      2
    )
  );
  if (summary.failed) process.exitCode = 1;
}

async function exportAddressRequiredEmails({ stripe, db, candidates, legacyPriceIds, outputPath }) {
  if (!db) throw new Error("Email export requires Firebase Admin configuration");
  const rows = [];
  const summary = {
    scanned: candidates.length,
    renewingCandidates: 0,
    stillAddressIncomplete: 0,
    exported: 0,
    missingEmail: 0,
    ignoredNonRenewing: 0,
    notMarked: 0,
    failed: 0,
  };

  console.log("[premium-tax-address-email-export] start");
  for (const subscription of candidates) {
    const structural = subscriptionStructuralBlockers(subscription, legacyPriceIds);
    if (!structural.ok) {
      summary.ignoredNonRenewing += 1;
      continue;
    }
    summary.renewingCandidates += 1;
    const customerId = customerIdFromSubscription(subscription);
    try {
      const customer = await resolveCustomer(stripe, subscription);
      if (!customer || customer.deleted || hasUsableTaxAddress(customer)) continue;
      summary.stillAddressIncomplete += 1;

      const user = await findPremiumUser(db, subscription, customerId);
      if (!user.ok) continue;
      const gateSnapshot = await db.collection("Users").doc(user.uid).get();
      if (gateSnapshot.data()?.premiumTaxAddressGate?.required !== true) {
        summary.notMarked += 1;
        continue;
      }

      const email = clean(customer.email).toLowerCase();
      if (!email) {
        summary.missingEmail += 1;
        continue;
      }
      const periodEnd = periodEndFromSubscription(subscription);
      rows.push({
        email,
        name: clean(customer.name),
        renewalAt: periodEnd ? new Date(periodEnd * 1000).toISOString() : "",
        portalUrl: buildPortalLoginUrl(email),
      });
    } catch (error) {
      summary.failed += 1;
      console.error("[premium-tax-address-email-export] failed", {
        subscriptionId: maskStripeId(subscription.id),
        message: clean(error?.message).slice(0, 300),
      });
    }
  }

  rows.sort((a, b) => a.renewalAt.localeCompare(b.renewalAt) || a.email.localeCompare(b.email));
  summary.exported = rows.length;
  const resolvedOutputPath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  fs.writeFileSync(resolvedOutputPath, `${addressEmailExportCsv(rows)}\n`, { encoding: "utf8", mode: 0o600 });

  console.log(
    JSON.stringify(
      {
        event: "premium-tax-address-email-export.summary",
        summary,
        outputPath: resolvedOutputPath,
      },
      null,
      2
    )
  );
  if (summary.failed || summary.missingEmail) process.exitCode = 1;
}

async function exportPriceChangeSegments({
  stripe,
  db,
  candidates,
  exclusivePriceId,
  legacyPriceIds,
  outputPath,
}) {
  const rows = [];
  const summary = {
    scanned: candidates.length,
    exported: 0,
    segmentCounts: {},
    ignoredNonRenewing: 0,
    missingEmail: 0,
    failed: 0,
  };
  const nowMs = Date.now();
  console.log("[premium-price-change-segments] start");

  for (const subscription of candidates) {
    const status = clean(subscription.status);
    if (!ALLOWED_STATUSES.has(status) || subscription.cancel_at_period_end) {
      summary.ignoredNonRenewing += 1;
      continue;
    }
    try {
      const customer = await resolveCustomer(stripe, subscription);
      if (!customer || customer.deleted) {
        summary.failed += 1;
        continue;
      }
      const priceId = clean(subscription?.items?.data?.[0]?.price?.id);
      const taxMigration = clean(subscription?.metadata?.taxMigration);
      const latestAmountPaid = await latestPaidInvoiceAmount(stripe, subscription.id);
      const segment = classifyPriceChangeSegment({
        priceId,
        taxMigration,
        latestAmountPaid,
        exclusivePriceId,
        legacyPriceIds,
      });
      if (segment === "other") {
        summary.ignoredNonRenewing += 1;
        continue;
      }

      const customerId = customerIdFromSubscription(subscription);
      const user = await findPremiumUser(db, subscription, customerId);
      const hasConsent = user.ok ? user.hasPriceChangeConsent : false;

      // Skip A if already consented (they'll migrate via Accept or mass migrate)
      if (segment === "A_nemigrat" && hasConsent) {
        summary.segmentCounts.A_accepted_pending = (summary.segmentCounts.A_accepted_pending || 0) + 1;
        continue;
      }
      // Skip B/C outreach rows that already consented (B shouldn't exist if consented+exclusive)
      if (hasConsent && segment !== "C_deja_605") {
        summary.segmentCounts.accepted_skip = (summary.segmentCounts.accepted_skip || 0) + 1;
        continue;
      }

      const periodEnd = periodEndFromSubscription(subscription);
      const renewalAt = periodEnd ? new Date(periodEnd * 1000).toISOString() : "";
      const email = clean(customer.email).toLowerCase();
      if (!email) summary.missingEmail += 1;

      summary.segmentCounts[segment] = (summary.segmentCounts[segment] || 0) + 1;
      rows.push({
        segment,
        email: email || "",
        name: clean(customer.name),
        subscriptionId: subscription.id,
        status,
        priceId,
        renewalAt,
        daysUntilRenewal: renewalAt ? daysUntilIso(renewalAt, nowMs) : "",
        latestAmountPaid: latestAmountPaid == null ? "" : latestAmountPaid,
        hasConsent,
        linkAccept: PREMIUM_ACCEPT_PAGE_URL,
        linkCancel: buildPortalLoginUrl(email),
      });
    } catch (error) {
      summary.failed += 1;
      console.error("[premium-price-change-segments] failed", {
        subscriptionId: maskStripeId(subscription.id),
        message: clean(error?.message).slice(0, 300),
      });
    }
  }

  rows.sort(
    (a, b) =>
      String(a.segment).localeCompare(String(b.segment)) ||
      String(a.renewalAt).localeCompare(String(b.renewalAt)) ||
      String(a.email).localeCompare(String(b.email))
  );
  summary.exported = rows.length;
  const resolvedOutputPath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  fs.writeFileSync(resolvedOutputPath, `${priceChangeSegmentsCsv(rows)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  console.log(
    JSON.stringify(
      { event: "premium-price-change-segments.summary", summary, outputPath: resolvedOutputPath },
      null,
      2
    )
  );
  if (summary.failed) process.exitCode = 1;
}

async function rollbackUnacceptedExclusive({
  stripe,
  db,
  candidates,
  exclusivePriceId,
  legacyPriceId,
  apply,
  summaryOnly,
}) {
  if (!legacyPriceId) throw new Error("Missing primary legacy price id for rollback");
  const summary = {
    scanned: candidates.length,
    considered: 0,
    eligible: 0,
    rolledBack: 0,
    skipped: 0,
    failed: 0,
    reasonCounts: {},
  };
  console.log("[premium-tax-rollback-unaccepted] start", { mode: apply ? "APPLY" : "DRY_RUN" });

  for (const subscription of candidates) {
    if (!ALLOWED_STATUSES.has(subscription.status) || subscription.cancel_at_period_end) {
      summary.skipped += 1;
      continue;
    }
    summary.considered += 1;
    try {
      const priceId = clean(subscription?.items?.data?.[0]?.price?.id);
      const taxMigration = clean(subscription?.metadata?.taxMigration);
      const onExclusive =
        priceId === exclusivePriceId || taxMigration === PREMIUM_TAX_MIGRATION_METADATA;
      if (!onExclusive) {
        summary.skipped += 1;
        addReasonCounts(summary, ["not_on_exclusive"]);
        continue;
      }
      const latestAmountPaid = await latestPaidInvoiceAmount(stripe, subscription.id);
      if (latestAmountPaid === PREMIUM_NEW_TOTAL_CENTS) {
        summary.skipped += 1;
        addReasonCounts(summary, ["already_charged_605"]);
        continue;
      }
      const customerId = customerIdFromSubscription(subscription);
      const user = await findPremiumUser(db, subscription, customerId);
      if (user.ok && user.hasPriceChangeConsent) {
        summary.skipped += 1;
        addReasonCounts(summary, ["has_consent"]);
        continue;
      }
      const item = subscription.items?.data?.[0];
      if (!item?.id) {
        summary.failed += 1;
        addReasonCounts(summary, ["missing_item"]);
        continue;
      }
      summary.eligible += 1;
      if (!apply) {
        if (!summaryOnly) {
          console.log("[premium-tax-rollback-unaccepted] eligible", {
            subscriptionId: maskStripeId(subscription.id),
          });
        }
        continue;
      }
      await rollbackOne(stripe, subscription, item, legacyPriceId, user.ok ? user.uid : "");
      summary.rolledBack += 1;
      if (!summaryOnly) {
        console.log("[premium-tax-rollback-unaccepted] rolled_back", {
          subscriptionId: maskStripeId(subscription.id),
        });
      }
    } catch (error) {
      summary.failed += 1;
      console.error("[premium-tax-rollback-unaccepted] failed", {
        subscriptionId: maskStripeId(subscription.id),
        message: clean(error?.message).slice(0, 300),
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        event: "premium-tax-rollback-unaccepted.summary",
        mode: apply ? "APPLY" : "DRY_RUN",
        summary,
      },
      null,
      2
    )
  );
  if (summary.failed) process.exitCode = 1;
}

async function scheduleCancelUnaccepted({
  stripe,
  db,
  candidates,
  exclusivePriceId,
  legacyPriceIds,
  apply,
  summaryOnly,
  outputPath,
  legacyOnly = false,
}) {
  const rows = [];
  const summary = {
    scanned: candidates.length,
    considered: 0,
    eligible: 0,
    scheduled: 0,
    skipped: 0,
    failed: 0,
    reasonCounts: {},
    segmentCounts: {},
    legacyOnly: Boolean(legacyOnly),
  };
  console.log("[premium-tax-schedule-cancel] start", {
    mode: apply ? "APPLY" : "DRY_RUN",
    legacyOnly: Boolean(legacyOnly),
  });

  for (const subscription of candidates) {
    summary.considered += 1;
    try {
      const priceId = clean(subscription?.items?.data?.[0]?.price?.id);
      const taxMigration = clean(subscription?.metadata?.taxMigration);
      const latestAmountPaid = await latestPaidInvoiceAmount(stripe, subscription.id);
      const segment = classifyPriceChangeSegment({
        priceId,
        taxMigration,
        latestAmountPaid,
        exclusivePriceId,
        legacyPriceIds,
      });
      if (legacyOnly && segment !== "A_nemigrat") {
        summary.skipped += 1;
        addReasonCounts(summary, ["not_legacy_segment_a"]);
        continue;
      }
      const customerId = customerIdFromSubscription(subscription);
      const user = await findPremiumUser(db, subscription, customerId);
      const hasConsent = user.ok ? user.hasPriceChangeConsent : false;
      const eligibility = isEligibleForScheduleCancelUnaccepted({
        status: subscription.status,
        cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
        hasConsent,
        segment,
      });
      if (!eligibility.ok) {
        summary.skipped += 1;
        addReasonCounts(summary, [eligibility.reason]);
        continue;
      }

      summary.eligible += 1;
      summary.segmentCounts[segment] = (summary.segmentCounts[segment] || 0) + 1;
      const customer = await resolveCustomer(stripe, subscription);
      const email = clean(customer?.email).toLowerCase();
      const periodEnd = periodEndFromSubscription(subscription);
      const renewalAt = periodEnd ? new Date(periodEnd * 1000).toISOString() : "";
      rows.push({
        segment,
        email: email || "",
        subscriptionId: subscription.id,
        status: clean(subscription.status),
        priceId,
        renewalAt,
        latestAmountPaid: latestAmountPaid == null ? "" : latestAmountPaid,
      });

      if (!apply) {
        if (!summaryOnly) {
          console.log("[premium-tax-schedule-cancel] eligible", {
            subscriptionId: maskStripeId(subscription.id),
            segment,
          });
        }
        continue;
      }

      await stripe.subscriptions.update(
        subscription.id,
        {
          cancel_at_period_end: true,
          metadata: {
            ...(subscription.metadata || {}),
            priceChangeCancelReason: PREMIUM_PRICE_CHANGE_CANCEL_REASON,
          },
        },
        {
          idempotencyKey: `premium-tax-schedule-cancel-v1-${subscription.id}-${PREMIUM_PRICE_CHANGE_CANCEL_REASON}`,
        }
      );
      summary.scheduled += 1;
      if (!summaryOnly) {
        console.log("[premium-tax-schedule-cancel] scheduled", {
          subscriptionId: maskStripeId(subscription.id),
          segment,
        });
      }
    } catch (error) {
      summary.failed += 1;
      console.error("[premium-tax-schedule-cancel] failed", {
        subscriptionId: maskStripeId(subscription.id),
        message: clean(error?.message).slice(0, 300),
      });
    }
  }

  let resolvedOutputPath = null;
  if (outputPath && rows.length) {
    const header = [
      "segment",
      "email",
      "subscription_id",
      "status",
      "price_id",
      "urmatoarea_reinnoire",
      "latest_amount_paid_cents",
    ];
    const csv = [
      header,
      ...rows.map((row) => [
        row.segment,
        row.email,
        row.subscriptionId,
        row.status,
        row.priceId,
        row.renewalAt,
        row.latestAmountPaid,
      ]),
    ]
      .map((line) => line.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    resolvedOutputPath = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
    fs.writeFileSync(resolvedOutputPath, `${csv}\n`, { encoding: "utf8", mode: 0o600 });
  }

  console.log(
    JSON.stringify(
      {
        event: "premium-tax-schedule-cancel.summary",
        mode: apply ? "APPLY" : "DRY_RUN",
        summary,
        outputPath: resolvedOutputPath,
      },
      null,
      2
    )
  );
  if (summary.failed) process.exitCode = 1;
}

async function refundDeclined605({
  stripe,
  db,
  candidates,
  exclusivePriceId,
  legacyPriceIds,
  apply,
  summaryOnly,
  outputPath,
}) {
  const rows = [];
  const summary = {
    scanned: candidates.length,
    considered: 0,
    eligible: 0,
    refunded: 0,
    skipped: 0,
    failed: 0,
    reasonCounts: {},
  };
  console.log("[premium-tax-refund-declined] start", { mode: apply ? "APPLY" : "DRY_RUN" });

  for (const subscription of candidates) {
    summary.considered += 1;
    try {
      const priceId = clean(subscription?.items?.data?.[0]?.price?.id);
      const taxMigration = clean(subscription?.metadata?.taxMigration);
      const invoice = await latestPaidInvoice(stripe, subscription.id);
      const latestAmountPaid = invoice ? Number(invoice.amount_paid) : null;
      const amountRefunded = invoice ? Number(invoice.amount_refunded || 0) : 0;
      const segment = classifyPriceChangeSegment({
        priceId,
        taxMigration,
        latestAmountPaid,
        exclusivePriceId,
        legacyPriceIds,
      });
      if (segment !== "C_deja_605") {
        summary.skipped += 1;
        addReasonCounts(summary, ["not_segment_c"]);
        continue;
      }

      const customerId = customerIdFromSubscription(subscription);
      const user = await findPremiumUser(db, subscription, customerId);
      const hasConsent = user.ok ? user.hasPriceChangeConsent : false;
      const eligibility = isEligibleForRefundDeclined605({
        status: subscription.status,
        cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
        hasConsent,
        latestAmountPaid,
        amountRefunded,
      });
      if (!eligibility.ok) {
        summary.skipped += 1;
        addReasonCounts(summary, [eligibility.reason]);
        continue;
      }

      const chargeId =
        typeof invoice.charge === "string" ? invoice.charge : clean(invoice.charge?.id);
      const paymentIntentId =
        typeof invoice.payment_intent === "string"
          ? invoice.payment_intent
          : clean(invoice.payment_intent?.id);
      if (!chargeId && !paymentIntentId) {
        summary.failed += 1;
        addReasonCounts(summary, ["missing_charge_or_payment_intent"]);
        continue;
      }

      summary.eligible += 1;
      const customer = await resolveCustomer(stripe, subscription);
      const email = clean(customer?.email).toLowerCase();
      rows.push({
        email: email || "",
        subscriptionId: subscription.id,
        invoiceId: invoice.id,
        amountPaid: latestAmountPaid,
        amountRefunded,
        status: clean(subscription.status),
        cancelAtPeriodEnd: subscription.cancel_at_period_end === true ? "yes" : "no",
      });

      if (!apply) {
        if (!summaryOnly) {
          console.log("[premium-tax-refund-declined] eligible", {
            subscriptionId: maskStripeId(subscription.id),
            invoiceId: maskStripeId(invoice.id),
          });
        }
        continue;
      }

      const refundParams = chargeId
        ? { charge: chargeId }
        : { payment_intent: paymentIntentId };
      await stripe.refunds.create(refundParams, {
        idempotencyKey: `premium-tax-refund-declined-605-v1-${invoice.id}`,
      });
      summary.refunded += 1;
      if (!summaryOnly) {
        console.log("[premium-tax-refund-declined] refunded", {
          subscriptionId: maskStripeId(subscription.id),
          invoiceId: maskStripeId(invoice.id),
        });
      }
    } catch (error) {
      summary.failed += 1;
      console.error("[premium-tax-refund-declined] failed", {
        subscriptionId: maskStripeId(subscription.id),
        message: clean(error?.message).slice(0, 300),
      });
    }
  }

  let resolvedOutputPath = null;
  if (outputPath && rows.length) {
    const header = [
      "email",
      "subscription_id",
      "invoice_id",
      "amount_paid_cents",
      "amount_refunded_cents",
      "status",
      "cancel_at_period_end",
    ];
    const csv = [
      header,
      ...rows.map((row) => [
        row.email,
        row.subscriptionId,
        row.invoiceId,
        row.amountPaid,
        row.amountRefunded,
        row.status,
        row.cancelAtPeriodEnd,
      ]),
    ]
      .map((line) => line.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    resolvedOutputPath = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
    fs.writeFileSync(resolvedOutputPath, `${csv}\n`, { encoding: "utf8", mode: 0o600 });
  }

  console.log(
    JSON.stringify(
      {
        event: "premium-tax-refund-declined.summary",
        mode: apply ? "APPLY" : "DRY_RUN",
        summary,
        outputPath: resolvedOutputPath,
        note: "Oblio credit notes are not created automatically; handle accounting manually if needed.",
      },
      null,
      2
    )
  );
  if (summary.failed) process.exitCode = 1;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const discover = process.argv.includes("--discover");
  const repairAddresses = process.argv.includes("--repair-addresses-from-firestore");
  const repairAddressesFromPayments = process.argv.includes("--repair-addresses-from-stripe-payments");
  const markAddressRequired = process.argv.includes("--mark-address-required-in-firestore");
  const exportAddressEmails = process.argv.includes("--export-address-required-emails");
  const exportRenewalScheduleFlag = process.argv.includes("--export-renewal-schedule");
  const exportPriceChangeSegmentsFlag = process.argv.includes("--export-price-change-segments");
  const rollbackUnacceptedFlag = process.argv.includes("--rollback-unaccepted-exclusive");
  const scheduleCancelUnacceptedFlag = process.argv.includes("--schedule-cancel-unaccepted");
  const scheduleCancelLegacyOnlyFlag = process.argv.includes("--legacy-only");
  const refundDeclined605Flag = process.argv.includes("--refund-declined-605");
  const forceWithoutConsentFlag = process.argv.includes("--force-without-consent");
  const anyAddressRepair = repairAddresses || repairAddressesFromPayments;
  const summaryOnly = process.argv.includes("--summary-only");
  const allowStripeInvoiceFallback = process.argv.includes("--allow-stripe-invoice-fallback");
  const confirmation = getArg("confirm");
  const onlySubscriptionId = getArg("subscription");
  const dueBeforeRaw = getArg("due-before");
  const exportPathDefaultName = forceWithoutConsentFlag
    ? `premium-force-migrate-skipped-${new Date().toISOString().slice(0, 10)}.csv`
    : scheduleCancelUnacceptedFlag
      ? `premium-schedule-cancel-${new Date().toISOString().slice(0, 10)}.csv`
      : refundDeclined605Flag
        ? `premium-refund-declined-605-${new Date().toISOString().slice(0, 10)}.csv`
        : exportPriceChangeSegmentsFlag
          ? `premium-price-change-segments-${new Date().toISOString().slice(0, 10)}.csv`
          : exportRenewalScheduleFlag
            ? `premium-tax-renewals-${new Date().toISOString().slice(0, 10)}.csv`
            : `premium-tax-address-${new Date().toISOString().slice(0, 10)}.csv`;
  const exportPath =
    getArg("export-path") || path.join(process.cwd(), "private-exports", exportPathDefaultName);
  const dueBeforeMs = dueBeforeRaw ? Date.parse(`${dueBeforeRaw}T23:59:59.999Z`) : null;
  const destinationPriceId = clean(process.env.STRIPE_PREMIUM_PRICE_ID_EXCLUSIVE);
  const legacyPriceIds = parseCsv(process.env.STRIPE_PREMIUM_LEGACY_PRICE_IDS);
  const secretKey = clean(process.env.STRIPE_SECRET_KEY);

  if (!secretKey) throw new Error("Missing STRIPE_SECRET_KEY");
  const stripe = new Stripe(secretKey);
  if (discover) {
    const prices = await discoverPremiumPrices(stripe);
    console.log(JSON.stringify({ event: "premium-tax-migration.discovery", prices }, null, 2));
    if (!prices.length) process.exitCode = 1;
    return;
  }
  if (
    !onlySubscriptionId &&
    !legacyPriceIds.length &&
    !exportPriceChangeSegmentsFlag &&
    !rollbackUnacceptedFlag &&
    !scheduleCancelUnacceptedFlag &&
    !refundDeclined605Flag
  ) {
    throw new Error("Set STRIPE_PREMIUM_LEGACY_PRICE_IDS or pass --subscription=sub_...");
  }
  if (apply) {
    if (markAddressRequired) {
      if (process.env.PREMIUM_TAX_ADDRESS_GATE_MARKING_ENABLED !== "true") {
        throw new Error(
          "Address gate marking is disabled. Set PREMIUM_TAX_ADDRESS_GATE_MARKING_ENABLED=true explicitly."
        );
      }
      if (confirmation !== ADDRESS_GATE_CONFIRMATION) {
        throw new Error(`Address gate apply requires --confirm=${ADDRESS_GATE_CONFIRMATION}`);
      }
    } else if (anyAddressRepair) {
      if (process.env.PREMIUM_STRIPE_ADDRESS_REPAIR_ENABLED !== "true") {
        throw new Error("Address repair apply is disabled. Set PREMIUM_STRIPE_ADDRESS_REPAIR_ENABLED=true explicitly.");
      }
      if (confirmation !== ADDRESS_REPAIR_CONFIRMATION) {
        throw new Error(`Address repair apply requires --confirm=${ADDRESS_REPAIR_CONFIRMATION}`);
      }
    } else if (rollbackUnacceptedFlag) {
      if (process.env.PREMIUM_TAX_ROLLBACK_UNACCEPTED_ENABLED !== "true") {
        throw new Error(
          "Rollback apply is disabled. Set PREMIUM_TAX_ROLLBACK_UNACCEPTED_ENABLED=true explicitly."
        );
      }
      if (confirmation !== ROLLBACK_UNACCEPTED_CONFIRMATION) {
        throw new Error(`Rollback apply requires --confirm=${ROLLBACK_UNACCEPTED_CONFIRMATION}`);
      }
    } else if (scheduleCancelUnacceptedFlag) {
      if (process.env.PREMIUM_TAX_SCHEDULE_CANCEL_ENABLED !== "true") {
        throw new Error(
          "Schedule-cancel apply is disabled. Set PREMIUM_TAX_SCHEDULE_CANCEL_ENABLED=true explicitly."
        );
      }
      if (confirmation !== SCHEDULE_CANCEL_CONFIRMATION) {
        throw new Error(`Schedule-cancel apply requires --confirm=${SCHEDULE_CANCEL_CONFIRMATION}`);
      }
    } else if (refundDeclined605Flag) {
      if (process.env.PREMIUM_TAX_REFUND_DECLINED_ENABLED !== "true") {
        throw new Error(
          "Refund-declined apply is disabled. Set PREMIUM_TAX_REFUND_DECLINED_ENABLED=true explicitly."
        );
      }
      if (confirmation !== REFUND_DECLINED_CONFIRMATION) {
        throw new Error(`Refund-declined apply requires --confirm=${REFUND_DECLINED_CONFIRMATION}`);
      }
    } else if (forceWithoutConsentFlag) {
      if (process.env.PREMIUM_TAX_FORCE_WITHOUT_CONSENT_ENABLED !== "true") {
        throw new Error(
          "Force-without-consent apply is disabled. Set PREMIUM_TAX_FORCE_WITHOUT_CONSENT_ENABLED=true explicitly."
        );
      }
      if (confirmation !== FORCE_WITHOUT_CONSENT_CONFIRMATION) {
        throw new Error(
          `Force-without-consent apply requires --confirm=${FORCE_WITHOUT_CONSENT_CONFIRMATION}`
        );
      }
    } else {
      if (process.env.PREMIUM_SUBSCRIPTION_TAX_MIGRATION_ENABLED !== "true") {
        throw new Error("Apply is disabled. Set PREMIUM_SUBSCRIPTION_TAX_MIGRATION_ENABLED=true explicitly.");
      }
      if (confirmation !== APPLY_CONFIRMATION) {
        throw new Error(`Apply requires --confirm=${APPLY_CONFIRMATION}`);
      }
    }
  }
  if (dueBeforeRaw && !Number.isFinite(dueBeforeMs)) throw new Error("Invalid --due-before date");

  const db = initFirestoreIfConfigured();

  if (exportPriceChangeSegmentsFlag) {
    if (apply) throw new Error("Price-change segment export is read-only; remove --apply");
    if (!destinationPriceId) throw new Error("Missing STRIPE_PREMIUM_PRICE_ID_EXCLUSIVE");
    if (!legacyPriceIds.length) throw new Error("Missing STRIPE_PREMIUM_LEGACY_PRICE_IDS");
    const priceIds = [...new Set([...legacyPriceIds, destinationPriceId])];
    const segmentCandidates = await listCandidatesByPriceIds(stripe, priceIds, onlySubscriptionId);
    await exportPriceChangeSegments({
      stripe,
      db,
      candidates: segmentCandidates,
      exclusivePriceId: destinationPriceId,
      legacyPriceIds,
      outputPath: exportPath,
    });
    return;
  }

  if (scheduleCancelUnacceptedFlag) {
    if (!destinationPriceId) throw new Error("Missing STRIPE_PREMIUM_PRICE_ID_EXCLUSIVE");
    if (!legacyPriceIds.length) throw new Error("Missing STRIPE_PREMIUM_LEGACY_PRICE_IDS");
    const priceIds = scheduleCancelLegacyOnlyFlag
      ? [...legacyPriceIds]
      : [...new Set([...legacyPriceIds, destinationPriceId])];
    const scheduleCandidates = await listCandidatesByPriceIds(stripe, priceIds, onlySubscriptionId);
    await scheduleCancelUnaccepted({
      stripe,
      db,
      candidates: scheduleCandidates,
      exclusivePriceId: destinationPriceId,
      legacyPriceIds,
      apply,
      summaryOnly,
      outputPath: exportPath,
      legacyOnly: scheduleCancelLegacyOnlyFlag,
    });
    return;
  }

  if (refundDeclined605Flag) {
    if (!destinationPriceId) throw new Error("Missing STRIPE_PREMIUM_PRICE_ID_EXCLUSIVE");
    if (!legacyPriceIds.length) throw new Error("Missing STRIPE_PREMIUM_LEGACY_PRICE_IDS");
    const refundCandidates = await listCandidatesByPriceIds(
      stripe,
      [destinationPriceId],
      onlySubscriptionId
    );
    await refundDeclined605({
      stripe,
      db,
      candidates: refundCandidates,
      exclusivePriceId: destinationPriceId,
      legacyPriceIds,
      apply,
      summaryOnly,
      outputPath: exportPath,
    });
    return;
  }

  if (rollbackUnacceptedFlag) {
    if (!destinationPriceId) throw new Error("Missing STRIPE_PREMIUM_PRICE_ID_EXCLUSIVE");
    if (!legacyPriceIds.length) throw new Error("Missing STRIPE_PREMIUM_LEGACY_PRICE_IDS");
    const exclusiveCandidates = await listCandidatesByPriceIds(
      stripe,
      [destinationPriceId],
      onlySubscriptionId
    );
    await rollbackUnacceptedExclusive({
      stripe,
      db,
      candidates: exclusiveCandidates,
      exclusivePriceId: destinationPriceId,
      legacyPriceId: legacyPriceIds[0],
      apply,
      summaryOnly,
    });
    return;
  }

  const candidates = await listCandidates(stripe, legacyPriceIds, onlySubscriptionId);
  if (repairAddresses) {
    await runAddressRepair({ stripe, db, candidates, legacyPriceIds, apply, summaryOnly });
    return;
  }
  if (repairAddressesFromPayments) {
    await runPaymentAddressRepair({ stripe, candidates, legacyPriceIds, apply, summaryOnly });
    return;
  }
  if (markAddressRequired) {
    await runAddressGateMarking({ stripe, db, candidates, legacyPriceIds, apply, summaryOnly });
    return;
  }
  if (exportRenewalScheduleFlag) {
    if (apply) throw new Error("Renewal schedule export is read-only; remove --apply");
    await exportRenewalSchedule({ stripe, candidates, legacyPriceIds, outputPath: exportPath });
    return;
  }
  if (exportAddressEmails) {
    if (apply) throw new Error("Email export is read-only; remove --apply");
    await exportAddressRequiredEmails({ stripe, db, candidates, legacyPriceIds, outputPath: exportPath });
    return;
  }
  if (!destinationPriceId) throw new Error("Missing STRIPE_PREMIUM_PRICE_ID_EXCLUSIVE");
  const destinationPrice = await stripe.prices.retrieve(destinationPriceId);
  const priceValidation = validateDestinationPrice(destinationPrice);
  if (!priceValidation.ok) {
    throw new Error(`Unsafe destination Price: ${priceValidation.reasons.join(", ")}`);
  }

  const summary = {
    scanned: candidates.length,
    considered: 0,
    eligible: 0,
    blocked: 0,
    migrated: 0,
    failed: 0,
    skippedAfterDueDate: 0,
    reasonCounts: {},
    previewTotals: {},
    billingSourceCounts: {},
    forceWithoutConsent: forceWithoutConsentFlag,
  };
  const skippedRows = [];

  console.log("[premium-tax-migration] start", {
    mode: apply ? "APPLY" : "DRY_RUN",
    destinationPriceId,
    legacyPriceIds,
    dueBefore: dueBeforeRaw || null,
    firestoreCheck: Boolean(db),
    requirePriceChangeConsent: !forceWithoutConsentFlag,
    forceWithoutConsent: forceWithoutConsentFlag,
  });

  for (const subscription of candidates) {
    const periodEnd = periodEndFromSubscription(subscription);
    if (dueBeforeMs && (!periodEnd || periodEnd * 1000 > dueBeforeMs)) {
      summary.skippedAfterDueDate += 1;
      continue;
    }
    summary.considered += 1;

    const explicitSubscriptionLegacyPrices = onlySubscriptionId
      ? (subscription?.items?.data || [])
          .map((item) => clean(item?.price?.id))
          .filter((priceId) => priceId && priceId !== destinationPriceId)
      : [];
    const candidateLegacyPriceIds = legacyPriceIds.length
      ? legacyPriceIds
      : explicitSubscriptionLegacyPrices;
    const structural = subscriptionStructuralBlockers(subscription, candidateLegacyPriceIds);
    const customerId = customerIdFromSubscription(subscription);
    const row = {
      subscriptionId: maskStripeId(subscription.id),
      subscriptionIdFull: subscription.id,
      renewalAt: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      status: subscription.status,
      email: "",
      reasons: [...structural.reasons],
    };

    const recordBlocked = () => {
      summary.blocked += 1;
      addReasonCounts(summary, row.reasons);
      skippedRows.push({
        email: row.email,
        subscriptionIdFull: row.subscriptionIdFull,
        status: row.status,
        renewalAt: row.renewalAt || "",
        reasons: row.reasons,
      });
      if (!summaryOnly) console.warn("[premium-tax-migration] blocked", row);
    };

    if (row.reasons.length) {
      recordBlocked();
      continue;
    }

    try {
      const customer = await resolveCustomer(stripe, subscription);
      row.email = clean(customer?.email).toLowerCase();
      if (!customer || customer.deleted) row.reasons.push("customer_missing_or_deleted");
      else if (!hasUsableTaxAddress(customer)) row.reasons.push("customer_tax_address_incomplete");

      const user = await findPremiumUser(db, subscription, customerId);
      if (!user.ok) row.reasons.push(user.reason);
      else if (!forceWithoutConsentFlag && !user.hasPriceChangeConsent) {
        row.reasons.push("missing_price_change_consent");
      } else if (!user.hasBillingProfile && !allowStripeInvoiceFallback) {
        row.reasons.push("missing_premium_billing_profile");
      } else if (!user.hasBillingProfile && !hasUsableInvoiceIdentity(customer)) {
        row.reasons.push("stripe_invoice_identity_incomplete");
      }
      row.billingSource = !user?.ok
        ? "unavailable"
        : user.hasBillingProfile
          ? "firestore_profile"
          : "stripe_invoice_snapshot";

      let previewAssessment = null;
      if (!row.reasons.length) {
        const preview = await previewMigration(stripe, subscription, structural.item, destinationPriceId);
        previewAssessment = assessPreview(preview, customerCountry(customer), destinationPrice);
        if (!previewAssessment.ok) row.reasons.push(...previewAssessment.reasons);
      }
      row.preview = previewAssessment;

      if (row.reasons.length) {
        recordBlocked();
        continue;
      }

      summary.eligible += 1;
      summary.billingSourceCounts[row.billingSource] =
        (summary.billingSourceCounts[row.billingSource] || 0) + 1;
      const previewKey = `${row.preview.currency}_${row.preview.subtotal}_${row.preview.tax}_${row.preview.total}`;
      summary.previewTotals[previewKey] = (summary.previewTotals[previewKey] || 0) + 1;
      if (!apply) {
        if (!summaryOnly) console.log("[premium-tax-migration] eligible", row);
        continue;
      }

      await migrateOne(stripe, subscription, structural.item, destinationPriceId, user.uid, {
        forceWithoutConsent: forceWithoutConsentFlag,
      });
      const updated = await stripe.subscriptions.retrieve(subscription.id);
      const updatedPriceId = clean(updated?.items?.data?.[0]?.price?.id);
      const updatedTaxRateIds = (updated?.default_tax_rates || []).map((rate) =>
        typeof rate === "string" ? rate : clean(rate?.id)
      );
      if (
        updatedPriceId !== destinationPriceId ||
        updated?.automatic_tax?.enabled === true ||
        updatedTaxRateIds.length !== 1 ||
        updatedTaxRateIds[0] !== clean(process.env.STRIPE_FIXED_VAT_TAX_RATE_ID)
      ) {
        throw new Error("post_update_subscription_validation_failed");
      }
      summary.migrated += 1;
      if (db && user?.ok) {
        try {
          const firestorePatch = {
            premiumTaxAddressGate: {
              required: false,
              readyForMigration: false,
              migrationCompleted: true,
              migratedAt: admin.firestore.FieldValue.serverTimestamp(),
              version: 1,
            },
          };
          if (forceWithoutConsentFlag || !user.hasPriceChangeConsent) {
            firestorePatch.premiumPriceChangeConsent = {
              version: PREMIUM_PRICE_CHANGE_CONSENT_VERSION,
              status: "accepted",
              source: forceWithoutConsentFlag
                ? PREMIUM_PRICE_CHANGE_FORCED_SOURCE
                : "migrated_ops_v1",
              consentText:
                "Migrare operațională la prețul 5 EUR + TVA (6,05 EUR pentru România / TVA 21%).",
              oldTotalCents: 500,
              newTotalCents: PREMIUM_NEW_TOTAL_CENTS,
              oldPriceId: clean(structural.item?.price?.id) || null,
              newPriceId: destinationPriceId,
              subscriptionId: subscription.id,
              renewalAt: row.renewalAt,
              uid: user.uid,
              acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
              noticeVersion: PREMIUM_PRICE_CHANGE_CONSENT_VERSION,
            };
          }
          await db.collection("Users").doc(user.uid).set(firestorePatch, { merge: true });
        } catch (gateError) {
          console.warn("[premium-tax-migration] gate_clear_failed", {
            subscriptionId: maskStripeId(subscription.id),
            message: clean(gateError?.message).slice(0, 300),
          });
        }
      }
      if (!summaryOnly) {
        console.log("[premium-tax-migration] migrated", {
          subscriptionId: maskStripeId(subscription.id),
          renewalAt: row.renewalAt,
          preview: row.preview,
          forced: forceWithoutConsentFlag,
        });
      }
    } catch (error) {
      summary.failed += 1;
      skippedRows.push({
        email: row.email,
        subscriptionIdFull: row.subscriptionIdFull,
        status: row.status,
        renewalAt: row.renewalAt || "",
        reasons: [`failed:${clean(error?.message).slice(0, 120)}`],
      });
      console.error("[premium-tax-migration] failed", {
        subscriptionId: maskStripeId(subscription.id),
        message: clean(error?.message).slice(0, 300),
      });
    }
  }

  let skippedOutputPath = null;
  if (forceWithoutConsentFlag && skippedRows.length) {
    skippedOutputPath = path.resolve(exportPath);
    fs.mkdirSync(path.dirname(skippedOutputPath), { recursive: true });
    fs.writeFileSync(skippedOutputPath, `${forceMigrateSkippedCsv(skippedRows)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }

  console.log(
    JSON.stringify(
      {
        event: "premium-tax-migration.summary",
        mode: apply ? "APPLY" : "DRY_RUN",
        summary,
        skippedOutputPath,
      },
      null,
      2
    )
  );
  if (summary.failed) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error("[premium-tax-migration] fatal", { message: clean(error?.message).slice(0, 500) });
    process.exitCode = 1;
  });
}

module.exports = {
  assessPreview,
  buildStripeAddressFromPremiumProfile,
  discoverPremiumPrices,
  hasUsableInvoiceIdentity,
  hasUsableTaxAddress,
  validateStripeAddressCandidate,
  parseCsv,
  periodEndFromSubscription,
  subscriptionStructuralBlockers,
  validateDestinationPrice,
  addressEmailExportCsv,
  renewalScheduleCsv,
  inferSubscriptionPlatform,
  daysUntilIso,
  renewalUrgencyBucket,
  buildPortalLoginUrl,
  classifyPriceChangeSegment,
  hasValidPriceChangeConsentFromUserData,
  isEligibleForScheduleCancelUnaccepted,
  isEligibleForRefundDeclined605,
  priceChangeSegmentsCsv,
  forceMigrateSkippedCsv,
  FORCE_WITHOUT_CONSENT_CONFIRMATION,
  PREMIUM_PRICE_CHANGE_FORCED_SOURCE,
};
