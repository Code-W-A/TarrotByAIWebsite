import { createHash, randomUUID } from "crypto";
import { getAdminAuth } from "./firebaseAdmin";
import {
  listOwnedPremiumSubscriptions,
  renewalError,
  renewalStopped,
  renewalSummary,
  RENEWABLE_STATUSES,
  stripeObjectId,
} from "./premiumRenewalSubscriptions";
import { syncPremiumSubscription } from "./stripePremiumSubscriptionSync";
import { sendPremiumRenewalEmail } from "./premiumRenewalEmail";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const requestRef = (db, uid, id) =>
  db.collection("premiumRenewalRequests").doc(hash(`${uid}:${id}`));
const lockRef = (db, uid) =>
  db.collection("premiumRenewalLocks").doc(hash(uid));
const LEASE_MS = 300000;

async function acquire(db, uid, input) {
  const lock = lockRef(db, uid);
  const ref = requestRef(db, uid, input.requestId);
  const token = randomUUID();
  let previous;
  await db.runTransaction(async (tx) => {
    const [ls, rs] = await Promise.all([tx.get(lock), tx.get(ref)]);
    const state = ls.data() || {};
    const record = rs.data();
    previous = record;
    if (state.until > Date.now()) throw renewalError("renewal_busy", 409);
    if (
      record &&
      (record.action !== input.action ||
        record.subscriptionId !== (input.subscriptionId || null))
    )
      throw renewalError("request_mismatch");
    if (
      record &&
      state.lastRequestId &&
      state.lastRequestId !== input.requestId
    )
      throw renewalError("request_superseded");
    tx.set(lock, {
      uid,
      token,
      until: Date.now() + LEASE_MS,
      lastRequestId: input.requestId,
    });
    tx.set(
      ref,
      {
        uid,
        requestId: input.requestId,
        action: input.action,
        subscriptionId: input.subscriptionId || null,
        locale: input.locale || "ro",
        createdAt: record?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        state: "processing",
      },
      { merge: true },
    );
  });
  return { lock, ref, token, previous };
}

async function renewLease(db, lease) {
  await db.runTransaction(async (tx) => {
    const row = (await tx.get(lease.lock)).data();
    if (row?.token !== lease.token) throw renewalError("renewal_busy");
    tx.set(lease.lock, { until: Date.now() + LEASE_MS }, { merge: true });
  });
}

async function release(db, lease) {
  await db.runTransaction(async (tx) => {
    if ((await tx.get(lease.lock)).data()?.token === lease.token)
      tx.set(lease.lock, { until: 0 }, { merge: true });
  });
}

export async function readPremiumRenewal({ db, stripe, uid }) {
  const user = (await db.collection("Users").doc(uid).get()).data() || {};
  const subscriptions = await listOwnedPremiumSubscriptions(stripe, uid, user);
  const last = (await lockRef(db, uid).get()).data()?.lastRequestId;
  const record = last ? (await requestRef(db, uid, last).get()).data() : null;
  return {
    ...renewalSummary(subscriptions),
    lastRequest: record
      ? {
          requestId: last,
          action: record.action,
          emailStatus: record.emailStatus || null,
          state: record.state,
          subscriptionId: record.subscriptionId,
          syncStatus: record.syncStatus || null,
        }
      : null,
  };
}

async function deliverEmail(ref, uid, record) {
  if (record.emailStatus === "sent") return "sent";
  // A send interrupted after SMTP acceptance cannot safely be automatically repeated.
  if (["sending", "unknown"].includes(record.emailStatus)) return "unknown";
  let accepted = false;
  try {
    const user = await getAdminAuth().getUser(uid);
    if (!user.email || !user.emailVerified) {
      await ref.set({ emailStatus: "unverified_address" }, { merge: true });
      return "unverified_address";
    }
    await ref.set({ emailStatus: "sending" }, { merge: true });
    await sendPremiumRenewalEmail({
      to: user.email,
      summary: record.summary,
      requestId: record.requestId,
      action: record.action,
      locale: record.locale,
    });
    accepted = true;
    await ref.set(
      { emailStatus: "sent", emailSentAt: new Date().toISOString() },
      { merge: true },
    );
    return "sent";
  } catch (error) {
    const status = accepted ? "unknown" : "failed";
    await ref.set({ emailStatus: status }, { merge: true }).catch(() => {});
    console.warn("[premium.renewal] email_failed", {
      requestId: record.requestId,
    });
    return status;
  }
}

export async function changePremiumRenewal({ db, stripe, uid, input }) {
  if (
    typeof input.requestId !== "string" ||
    !/^[a-zA-Z0-9_-]{16,80}$/.test(input.requestId)
  )
    throw renewalError("invalid_request_id", 400);
  if (!["cancel", "reactivate", "resend"].includes(input.action))
    throw renewalError("invalid_action", 400);
  if (input.confirmed !== true)
    throw renewalError("confirmation_required", 400);
  if (input.action === "reactivate" && typeof input.subscriptionId !== "string")
    throw renewalError("subscription_required", 400);

  // Resending reuses the original operation's binding and never touches Stripe.
  if (input.action === "resend") {
    const original = (await requestRef(db, uid, input.requestId).get()).data();
    if (!original || original.state !== "complete")
      throw renewalError("confirmation_unavailable");
    const lease = await acquire(db, uid, {
      ...input,
      action: original.action,
      subscriptionId: original.subscriptionId,
    });
    try {
      const emailStatus = await deliverEmail(lease.ref, uid, {
        ...original,
        emailStatus: ["sending", "unknown"].includes(original.emailStatus)
          ? "pending"
          : original.emailStatus,
      });
      await lease.ref.set({ state: "complete" }, { merge: true });
      return { ok: true, requestId: input.requestId, emailStatus };
    } finally {
      await release(db, lease);
    }
  }

  const lease = await acquire(db, uid, input);
  const results = [];
  let stripeVerified = false;
  let summary;
  try {
    const userData = (await db.collection("Users").doc(uid).get()).data() || {};
    const initialObservedAt = Date.now();
    const subscriptions = await listOwnedPremiumSubscriptions(
      stripe,
      uid,
      userData,
    );
    if (lease.previous?.state === "complete") {
      const current = renewalSummary(subscriptions);
      const stillApplied =
        input.action === "cancel"
          ? current.allStopped
          : current.subscriptions.some(
              (sub) => sub.id === input.subscriptionId && !sub.stopped,
            );
      await lease.ref.set({ state: "complete" }, { merge: true });
      if (!stillApplied) throw renewalError("request_superseded");
      if (lease.previous.syncStatus === "pending" && subscriptions.length) {
        try {
          await syncPremiumSubscription(
            {
              ...subscriptions[0],
              metadata: { ...subscriptions[0].metadata, uid },
            },
            { subscriptions, eventTimestampMs: initialObservedAt },
          );
          lease.previous.syncStatus = "synced";
          await lease.ref.set({ syncStatus: "synced" }, { merge: true });
        } catch (_) {}
      }
      const emailStatus = await deliverEmail(lease.ref, uid, lease.previous);
      return {
        ok: true,
        requestId: input.requestId,
        summary: current,
        results: lease.previous.results,
        syncStatus: lease.previous.syncStatus,
        emailStatus,
      };
    }
    let targets = subscriptions.filter((sub) =>
      RENEWABLE_STATUSES.has(sub.status),
    );
    if (input.action === "reactivate") {
      const target = targets.find((sub) => sub.id === input.subscriptionId);
      if (!target) throw renewalError("subscription_not_owned");
      if (targets.some((sub) => sub.id !== target.id && !renewalStopped(sub)))
        throw renewalError("another_subscription_renewing");
      if (
        target.schedule ||
        !["active", "trialing", "past_due"].includes(target.status)
      )
        throw renewalError("reactivation_unavailable");
      targets = [target];
    }
    await lease.ref.set(
      {
        targetIds: targets.map((sub) => sub.id),
        emailStatus: (await lease.ref.get()).data()?.emailStatus || "pending",
      },
      { merge: true },
    );
    for (const target of targets) {
      await renewLease(db, lease);
      let verified;
      let updateError;
      try {
        const current = await stripe.subscriptions.retrieve(target.id);
        if (
          stripeObjectId(current.customer) !==
            stripeObjectId(target.customer) ||
          (current.metadata?.uid && current.metadata.uid !== uid) ||
          current.metadata?.flow !== "site_premium"
        )
          throw renewalError("subscription_ownership_ambiguous");
        const needsUpdate =
          input.action === "cancel"
            ? !renewalStopped(current)
            : renewalStopped(current);
        if (needsUpdate) {
          const patch =
            input.action === "cancel"
              ? {
                  cancel_at_period_end: true,
                  proration_behavior: "none",
                  metadata: {
                    renewalCancellationSource: "site",
                    renewalRequestId: input.requestId,
                  },
                }
              : {
                  ...(current.cancel_at_period_end
                    ? { cancel_at_period_end: false }
                    : { cancel_at: "" }),
                  proration_behavior: "none",
                  metadata: {
                    renewalReactivationSource: "site_explicit",
                    renewalRequestId: input.requestId,
                    priceChangeCancelReason: "",
                  },
                };
          await stripe.subscriptions.update(current.id, patch, {
            idempotencyKey: `premium-renewal-${hash(`${uid}:${input.requestId}:${current.id}:${input.action}`)}`,
          });
        }
      } catch (error) {
        updateError = error;
        console.warn("[premium.renewal] stripe_update_failed", {
          requestId: input.requestId,
          code: error.code || "unknown",
          type: error.type || null,
          param: error.param || null,
        });
      }
      // Always read back, even after a timeout: Stripe may have committed the update.
      try {
        verified = await stripe.subscriptions.retrieve(target.id);
      } catch (_) {}
      const confirmed =
        verified &&
        (input.action === "cancel"
          ? renewalStopped(verified)
          : !renewalStopped(verified));
      results.push({
        subscriptionId: target.id,
        outcome: confirmed ? "confirmed" : verified ? "failed" : "unknown",
        error: confirmed
          ? null
          : updateError?.code === "subscription_ownership_ambiguous"
            ? updateError.code
            : "stripe_verification_failed",
      });
      await lease.ref.set(
        { results, updatedAt: new Date().toISOString() },
        { merge: true },
      );
    }
    const observedAt = Date.now();
    const refreshed = await listOwnedPremiumSubscriptions(
      stripe,
      uid,
      userData,
    );
    summary = renewalSummary(refreshed);
    stripeVerified =
      input.action === "cancel"
        ? summary.allStopped
        : Boolean(
            summary.subscriptions.find(
              (sub) => sub.id === input.subscriptionId && !sub.stopped,
            ),
          );
    let syncStatus = "synced";
    try {
      if (refreshed.length) {
        await syncPremiumSubscription(
          { ...refreshed[0], metadata: { ...refreshed[0].metadata, uid } },
          { subscriptions: refreshed, eventTimestampMs: observedAt },
        );
      }
    } catch (_) {
      syncStatus = "pending";
    }
    const state = stripeVerified ? "complete" : "partial";
    await lease.ref.set(
      {
        state,
        summary,
        results,
        syncStatus,
        completedAt: stripeVerified ? new Date().toISOString() : null,
      },
      { merge: true },
    );
    let emailStatus = "pending";
    if (stripeVerified)
      emailStatus = await deliverEmail(
        lease.ref,
        uid,
        (await lease.ref.get()).data(),
      );
    return {
      ok: stripeVerified,
      requestId: input.requestId,
      results,
      summary,
      syncStatus,
      emailStatus,
    };
  } catch (error) {
    if (lease.previous?.state === "complete") {
      await lease.ref
        .set(
          {
            state: "complete",
            lastReplayError: error.code || "renewal_verification_failed",
          },
          { merge: true },
        )
        .catch(() => {});
      throw error;
    }
    await lease.ref
      .set(
        {
          state: stripeVerified ? "complete" : "unknown",
          results,
          ...(summary ? { summary } : {}),
          error: error.code || "renewal_verification_failed",
        },
        { merge: true },
      )
      .catch(() => {});
    if (stripeVerified)
      return {
        ok: true,
        requestId: input.requestId,
        results,
        summary,
        syncStatus: "pending",
        emailStatus: "pending",
        historyStatus: "pending",
      };
    throw error;
  } finally {
    await release(db, lease).catch(() => {});
  }
}
