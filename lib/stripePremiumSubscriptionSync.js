import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "./firebaseAdmin";
import {
  PREMIUM_FLOW_METADATA,
  computePremiumBoolean,
  mapStripeSubscriptionStatus,
} from "./premiumAccess";
import {
  buildUserIdentityPatch,
  resolveAuthIdentitySources,
} from "./userIdentitySync";
import { buildPremiumSourcePatch } from "./premiumSources";
import { listOwnedPremiumSubscriptions, accessEndSeconds, RENEWABLE_STATUSES, renewalStopped } from "./premiumRenewalSubscriptions";

export function getStripeCustomerIdFromSubscription(subscription) {
  const customer = subscription?.customer;
  if (typeof customer === "string") return customer;
  if (customer && typeof customer.id === "string") return customer.id;
  return null;
}

export function buildUserPremiumPayload(subscription) {
  const appStatus = mapStripeSubscriptionStatus(subscription.status);
  let endSec =
    typeof accessEndSeconds(subscription) === "number"
      ? accessEndSeconds(subscription)
      : null;
  const endedSec =
    typeof subscription.ended_at === "number" ? subscription.ended_at : null;

  if (appStatus === "canceled" && endedSec != null) {
    endSec = endSec == null ? endedSec : Math.min(endSec, endedSec);
  }

  const currentPeriodEnd =
    typeof endSec === "number" ? Timestamp.fromMillis(endSec * 1000) : null;
  const stripeCustomerId = getStripeCustomerIdFromSubscription(subscription);
  const fields = {
    subscriptionStatus: appStatus,
    stripeSubscriptionId: subscription.id,
    subscriptionProvider: "stripe",
    premiumSubscriptionCancelAtPeriodEnd:
      subscription.cancel_at_period_end === true,
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (currentPeriodEnd) {
    fields.currentPeriodEnd = currentPeriodEnd;
  }
  if (stripeCustomerId) {
    fields.stripeCustomerId = stripeCustomerId;
  }

  fields.premium = computePremiumBoolean({
    subscriptionStatus: appStatus,
    currentPeriodEnd: currentPeriodEnd || undefined,
    subscriptionProvider: "stripe",
  });

  return fields;
}

/** Aggregate every Stripe subscription so a canceled duplicate cannot revoke another one's access. */
export function buildUserPremiumAggregate(subscriptions) {
  const sorted = [...subscriptions].sort((a, b) => a.id.localeCompare(b.id));
  if (!sorted.length) return null;
  const active = sorted.filter(sub => buildUserPremiumPayload(sub).premium);
  const candidates = active.length ? active : sorted;
  const primary = [...candidates].sort((a, b) => (accessEndSeconds(b) || 0) - (accessEndSeconds(a) || 0))[0];
  const payload = buildUserPremiumPayload(primary);
  const renewable = sorted.filter(sub => RENEWABLE_STATUSES.has(sub.status));
  payload.premiumSubscriptionCancelAtPeriodEnd = renewable.length > 0 && renewable.every(renewalStopped);
  payload.stripeSubscriptionIds = sorted.map(sub => sub.id);
  payload.currentPeriodEnd = payload.currentPeriodEnd || null;
  return payload;
}

export async function syncPremiumSubscription(subscription, options = {}) {
  console.log("[syncPremiumSubscription] Starting sync", {
    subscriptionId: subscription?.id,
    metadataFlow: subscription?.metadata?.flow,
    metadataUid: subscription?.metadata?.uid,
    expectedFlow: PREMIUM_FLOW_METADATA,
  });
  
  if (!subscription?.metadata || subscription.metadata.flow !== PREMIUM_FLOW_METADATA) {
    console.log("[syncPremiumSubscription] Skipping - not site_premium flow", {
      actualFlow: subscription?.metadata?.flow,
    });
    return { skipped: true, reason: "not_site_premium" };
  }

  const uid = subscription.metadata.uid;
  if (!uid || typeof uid !== "string") {
    console.log("[syncPremiumSubscription] Skipping - missing uid");
    return { skipped: true, reason: "missing_uid" };
  }

  const revisionMs = Number.isFinite(Number(options.eventTimestampMs))
    ? Number(options.eventTimestampMs)
    : Date.now();
  const db = getAdminDb();
  const userRef = db.collection("Users").doc(uid);
  if (options.stripe && !options.subscriptions) {
    const profile = await userRef.get();
    options = { ...options, subscriptions: await listOwnedPremiumSubscriptions(options.stripe, uid, profile.data() || {}) };
  }
  const authIdentity = await resolveAuthIdentitySources(uid);
  let payload = null;
  const transactionResult = await db.runTransaction(async (transaction) => {
    const userSnap = await transaction.get(userRef);
    const userData = userSnap.exists ? userSnap.data() || {} : {};
    const existingRevisionMs = Number(
      userData?.premiumSources?.stripe?.eventTimestampMs || 0
    );
    if (existingRevisionMs > revisionMs) {
      return { skipped: true, reason: "stale_stripe_event", uid };
    }

    const stripePayload = buildUserPremiumAggregate(options.subscriptions || [subscription]);
    const { patch: identityPatch } = buildUserIdentityPatch(userData, {
      uid,
      authEmail: authIdentity.email,
      displayName: authIdentity.displayName,
    });
    payload = {
      ...identityPatch,
      ...stripePayload,
      ...buildPremiumSourcePatch(userData, "stripe", {
        active: stripePayload.premium === true,
        status: stripePayload.subscriptionStatus,
        expiresAt: stripePayload.currentPeriodEnd || null,
        subscriptionId: stripePayload.stripeSubscriptionId,
        cancelAtPeriodEnd: stripePayload.premiumSubscriptionCancelAtPeriodEnd,
        eventTimestampMs: revisionMs,
        updatedAt: FieldValue.serverTimestamp(),
      }),
    };
    transaction.set(userRef, payload, { merge: true });
    return { skipped: false };
  });
  if (transactionResult.skipped) return transactionResult;
  console.log("[syncPremiumSubscription] Built payload", {
    uid,
    subscriptionStatus: payload.subscriptionStatus,
    premium: payload.premium,
    stripeSubscriptionId: payload.stripeSubscriptionId,
    currentPeriodEnd: payload.currentPeriodEnd,
  });
  
  console.log("[syncPremiumSubscription] Wrote to user", { uid });
  
  return {
    skipped: false,
    uid,
    payload,
    premiumActive: payload.premium === true,
    subscriptionStatus: payload.subscriptionStatus,
  };
}

export async function syncPremiumSubscriptionById(stripe, subscriptionId, options = {}) {
  const observedAt = Date.now();
  let subscription = await stripe.subscriptions.retrieve(subscriptionId);
  if (subscription.metadata?.flow === PREMIUM_FLOW_METADATA && !subscription.metadata?.uid) {
    const customer = await stripe.customers.retrieve(getStripeCustomerIdFromSubscription(subscription));
    if (customer.metadata?.uid) subscription = { ...subscription, metadata: { ...subscription.metadata, uid: customer.metadata.uid } };
  }
  return syncPremiumSubscription(subscription, { ...options, eventTimestampMs: observedAt, stripe });
}
