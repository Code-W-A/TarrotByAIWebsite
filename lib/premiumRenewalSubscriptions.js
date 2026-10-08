import { PREMIUM_FLOW_METADATA } from "./premiumAccess";

export const RENEWABLE_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "paused",
  "incomplete",
]);
export const stripeObjectId = (value) =>
  typeof value === "string" ? value : value?.id || "";
export const periodEndSeconds = (sub) =>
  sub.current_period_end || sub.items?.data?.[0]?.current_period_end || null;
export const renewalStopped = (sub) =>
  !RENEWABLE_STATUSES.has(sub.status) ||
  sub.cancel_at_period_end === true ||
  (Number(sub.cancel_at) > 0 && Number(sub.cancel_at) <= periodEndSeconds(sub));
export const accessEndSeconds = (sub) =>
  sub.cancel_at > 0
    ? Math.min(sub.cancel_at, periodEndSeconds(sub) || sub.cancel_at)
    : periodEndSeconds(sub);

export function renewalError(code, statusCode = 409) {
  return Object.assign(new Error(code), { code, statusCode });
}

/** No email matching or client-supplied customer IDs. List pagination avoids Search's delayed index. */
export async function listOwnedPremiumSubscriptions(
  stripe,
  uid,
  userData = {},
) {
  const customerId = userData.stripeCustomerId || "";
  const savedId =
    userData.stripeSubscriptionId ||
    userData.premiumSources?.stripe?.subscriptionId ||
    "";
  const found = new Map();
  const customers = new Map();
  let startingAfter;
  do {
    const page = await stripe.subscriptions.list({
      status: "all",
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const sub of page.data) {
      if (sub.metadata?.flow !== PREMIUM_FLOW_METADATA) continue;
      let relevant =
        sub.metadata?.uid === uid ||
        (customerId && stripeObjectId(sub.customer) === customerId) ||
        sub.id === savedId;
      // Legacy subscriptions may carry the owner only on their Stripe Customer.
      if (!relevant && !sub.metadata?.uid) {
        const id = stripeObjectId(sub.customer);
        if (!customers.has(id))
          customers.set(id, await stripe.customers.retrieve(id));
        relevant = customers.get(id).metadata?.uid === uid;
      }
      if (!relevant) continue;
      found.set(sub.id, sub);
    }
    if (!page.has_more) break;
    const next = page.data.at(-1)?.id;
    if (!next || next === startingAfter)
      throw renewalError("subscription_lookup_incomplete", 503);
    startingAfter = next;
  } while (true);

  // A missing saved reference must not turn a failed lookup into an apparent successful cancellation.
  if (savedId && !found.has(savedId)) {
    const sub = await stripe.subscriptions.retrieve(savedId);
    if (sub.metadata?.flow !== PREMIUM_FLOW_METADATA)
      throw renewalError("subscription_ownership_ambiguous");
    found.set(sub.id, sub);
  }
  for (const sub of found.values()) {
    const id = stripeObjectId(sub.customer);
    if (!customers.has(id))
      customers.set(id, await stripe.customers.retrieve(id));
    const customer = customers.get(id);
    const subUid = sub.metadata?.uid;
    const customerUid = customer.metadata?.uid;
    if (
      (subUid && subUid !== uid) ||
      (customerUid && customerUid !== uid) ||
      (!subUid && customerUid !== uid)
    ) {
      throw renewalError("subscription_ownership_ambiguous");
    }
  }
  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function renewalSummary(subscriptions) {
  const relevant = subscriptions.filter((sub) =>
    RENEWABLE_STATUSES.has(sub.status),
  );
  const accessEnds = subscriptions
    .filter((sub) => ["active", "trialing", "past_due"].includes(sub.status))
    .map(accessEndSeconds)
    .filter((value) => Number.isFinite(value) && value * 1000 > Date.now());
  return {
    subscriptions: relevant.map((sub) => ({
      id: sub.id,
      status: sub.status,
      stopped: renewalStopped(sub),
      periodEnd: accessEndSeconds(sub)
        ? new Date(accessEndSeconds(sub) * 1000).toISOString()
        : null,
      canReactivate:
        renewalStopped(sub) &&
        ["active", "trialing", "past_due"].includes(sub.status) &&
        !sub.schedule,
      amount: sub.items?.data?.[0]?.price?.unit_amount ?? null,
      currency: sub.items?.data?.[0]?.price?.currency || null,
      interval: sub.items?.data?.[0]?.price?.recurring?.interval || null,
    })),
    allStopped: relevant.every(renewalStopped),
    accessUntil: accessEnds.length
      ? new Date(Math.max(...accessEnds) * 1000).toISOString()
      : null,
  };
}
