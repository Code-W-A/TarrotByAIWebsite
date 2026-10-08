import {
  memoryDb,
  subscription,
  stripeFixture,
} from "../helpers/premiumRenewalFixtures";
const getUser = jest.fn();
const sync = jest.fn();
const sendEmail = jest.fn();
jest.mock("../../lib/firebaseAdmin", () => ({
  getAdminAuth: () => ({ getUser }),
}));
jest.mock("../../lib/stripePremiumSubscriptionSync", () => ({
  syncPremiumSubscription: (...args) => sync(...args),
}));
jest.mock("../../lib/premiumRenewalEmail", () => ({
  sendPremiumRenewalEmail: (...args) => sendEmail(...args),
}));
import {
  changePremiumRenewal,
  readPremiumRenewal,
} from "../../lib/premiumRenewalService";
import { listOwnedPremiumSubscriptions } from "../../lib/premiumRenewalSubscriptions";

let db, stripe;
const input = {
  requestId: "request_cancel_000001",
  action: "cancel",
  confirmed: true,
};
const change = (patch = {}) =>
  changePremiumRenewal({
    db,
    stripe,
    uid: "alice",
    input: { ...input, ...patch },
  });
const journal = () =>
  [...db.rows.entries()].filter(([key]) =>
    key.startsWith("premiumRenewalRequests/"),
  )[0]?.[1];
beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue({
    email: "alice@example.com",
    emailVerified: true,
  });
  sync.mockResolvedValue({});
  sendEmail.mockResolvedValue({});
  db = memoryDb({
    "Users/alice": {
      stripeCustomerId: "cus_one",
      stripeSubscriptionId: "sub_one",
    },
  });
  stripe = stripeFixture([subscription()]);
});

it("cancels all owned subscriptions across customers, pages and past_due statuses", async () => {
  stripe = stripeFixture(
    [
      subscription(),
      subscription("sub_two", { customer: "cus_two", status: "past_due" }),
      subscription("sub_other", {
        customer: "cus_other",
        metadata: { uid: "bob", flow: "site_premium" },
      }),
    ],
    1,
  );
  const result = await change();
  expect(result.ok).toBe(true);
  expect(stripe.subscriptions.update.mock.calls.map((call) => call[0])).toEqual(
    ["sub_one", "sub_two"],
  );
  expect(sync).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      subscriptions: expect.arrayContaining([
        expect.objectContaining({ id: "sub_two" }),
      ]),
    }),
  );
  expect(journal().state).toBe("complete");
  expect(sendEmail).toHaveBeenCalledWith(
    expect.objectContaining({ to: "alice@example.com" }),
  );
});
it("does not mutate already scheduled cancellations and safely repeats a completed request", async () => {
  stripe.rows.get("sub_one").cancel_at_period_end = true;
  await change();
  await change();
  expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  expect(sendEmail).toHaveBeenCalledTimes(1);
});
it("does not replay completed cancellation after an external reactivation", async () => {
  await change();
  stripe.rows.get("sub_one").cancel_at_period_end = false;
  await expect(change()).rejects.toMatchObject({ code: "request_superseded" });
  expect(stripe.subscriptions.update).toHaveBeenCalledTimes(1);
});
it("verifies a Stripe commit after an update timeout", async () => {
  stripe.subscriptions.update.mockImplementation(async (id) => {
    stripe.rows.get(id).cancel_at_period_end = true;
    throw new Error("timeout");
  });
  expect((await change()).ok).toBe(true);
});
it("reports partial failure and retries only the remaining subscription", async () => {
  stripe.rows.set("sub_two", subscription("sub_two"));
  const update = stripe.subscriptions.update.getMockImplementation();
  stripe.subscriptions.update.mockImplementation(async (...args) => {
    if (args[0] === "sub_two") throw new Error("network");
    return update(...args);
  });
  const partial = await change();
  expect(partial.ok).toBe(false);
  expect(partial.results.map((row) => row.outcome)).toEqual([
    "confirmed",
    "failed",
  ]);
  expect(sendEmail).not.toHaveBeenCalled();
  stripe.subscriptions.update.mockImplementation(update);
  expect((await change()).ok).toBe(true);
  expect(
    stripe.subscriptions.update.mock.calls.filter(
      (call) => call[0] === "sub_one",
    ),
  ).toHaveLength(1);
});
it("never declares success if final Stripe verification fails", async () => {
  stripe.subscriptions.list
    .mockResolvedValueOnce({ data: [subscription()], has_more: false })
    .mockRejectedValueOnce(new Error("timeout"));
  await expect(change()).rejects.toThrow("timeout");
  expect(sendEmail).not.toHaveBeenCalled();
  expect(journal().state).toBe("unknown");
});
it("serializes concurrent cancellation/reactivation attempts", async () => {
  let continueUpdate;
  stripe.subscriptions.update.mockImplementation(async (id) => {
    await new Promise((resolve) => {
      continueUpdate = resolve;
    });
    stripe.rows.get(id).cancel_at_period_end = true;
  });
  const first = change();
  while (!continueUpdate) await new Promise((resolve) => setImmediate(resolve));
  await expect(
    change({
      action: "reactivate",
      subscriptionId: "sub_one",
      requestId: "request_reactivate_01",
    }),
  ).rejects.toMatchObject({ code: "renewal_busy" });
  continueUpdate();
  expect((await first).ok).toBe(true);
});
it("rejects request ID reuse with a different action", async () => {
  await change();
  await expect(
    change({ action: "reactivate", subscriptionId: "sub_one" }),
  ).rejects.toMatchObject({ code: "request_mismatch" });
});
it("does not write to Stripe when journal persistence fails", async () => {
  db.runTransaction = jest
    .fn()
    .mockRejectedValue(new Error("firestore unavailable"));
  await expect(change()).rejects.toThrow();
  expect(stripe.subscriptions.update).not.toHaveBeenCalled();
});
it("reports confirmed Stripe cancellation even when profile synchronization fails", async () => {
  sync.mockRejectedValueOnce(new Error("firestore unavailable"));
  const result = await change();
  expect(result.ok).toBe(true);
  expect(result.syncStatus).toBe("pending");
});
it("keeps cancellation successful on mail failure and allows explicit resend", async () => {
  sendEmail.mockRejectedValueOnce(new Error("smtp"));
  const result = await change();
  expect(result.ok).toBe(true);
  expect(result.emailStatus).toBe("failed");
  expect((await change({ action: "resend" })).emailStatus).toBe("sent");
  expect(stripe.subscriptions.update).toHaveBeenCalledTimes(1);
});
it("never sends to an unverified Auth email or a client-provided destination", async () => {
  getUser.mockResolvedValueOnce({
    email: "alice@example.com",
    emailVerified: false,
  });
  const result = await change({ email: "attacker@example.com" });
  expect(result.ok).toBe(true);
  expect(result.emailStatus).toBe("unverified_address");
  expect(sendEmail).not.toHaveBeenCalled();
});
it("requires explicit confirmation and a stable request ID", async () => {
  await expect(change({ confirmed: false })).rejects.toMatchObject({
    code: "confirmation_required",
  });
  await expect(change({ requestId: "bad" })).rejects.toMatchObject({
    code: "invalid_request_id",
  });
  expect(stripe.subscriptions.update).not.toHaveBeenCalled();
});
it("rejects ambiguous ownership even if the profile points to that customer", async () => {
  stripe.rows.get("sub_one").metadata.uid = "bob";
  await expect(change()).rejects.toMatchObject({
    code: "subscription_ownership_ambiguous",
  });
  expect(stripe.subscriptions.update).not.toHaveBeenCalled();
});
it("requires server-owned metadata even for a saved legacy customer", async () => {
  stripe.rows.get("sub_one").metadata = { flow: "site_premium" };
  stripe.customers.retrieve.mockResolvedValue({ metadata: {} });
  await expect(change()).rejects.toMatchObject({
    code: "subscription_ownership_ambiguous",
  });
});
it("allows legacy subscription metadata when customer ownership is verified", async () => {
  stripe.rows.get("sub_one").metadata = { flow: "site_premium" };
  expect((await change()).ok).toBe(true);
});
it("does not accept arbitrary subscription or customer IDs from the client", async () => {
  await expect(
    change({
      action: "reactivate",
      subscriptionId: "sub_bob",
      customerId: "cus_bob",
    }),
  ).rejects.toMatchObject({ code: "subscription_not_owned" });
  expect(stripe.subscriptions.update).not.toHaveBeenCalled();
});
it("reactivates only the selected subscription and leaves duplicates stopped", async () => {
  stripe.rows.get("sub_one").cancel_at_period_end = true;
  stripe.rows.set(
    "sub_two",
    subscription("sub_two", { cancel_at_period_end: true }),
  );
  const result = await change({
    action: "reactivate",
    subscriptionId: "sub_two",
  });
  expect(result.ok).toBe(true);
  expect(stripe.rows.get("sub_one").cancel_at_period_end).toBe(true);
  expect(stripe.rows.get("sub_two").cancel_at_period_end).toBe(false);
});
it("blocks reactivation when another subscription already renews", async () => {
  stripe.rows.set(
    "sub_two",
    subscription("sub_two", { cancel_at_period_end: true }),
  );
  await expect(
    change({ action: "reactivate", subscriptionId: "sub_two" }),
  ).rejects.toMatchObject({ code: "another_subscription_renewing" });
});
it("reads actual Stripe state rather than stale profile flags", async () => {
  stripe.rows.get("sub_one").cancel_at_period_end = true;
  expect(
    (await readPremiumRenewal({ db, stripe, uid: "alice" })).allStopped,
  ).toBe(true);
});
it("fails closed when pagination cannot be completed", async () => {
  stripe.subscriptions.list.mockResolvedValue({ data: [], has_more: true });
  await expect(
    listOwnedPremiumSubscriptions(stripe, "alice"),
  ).rejects.toMatchObject({ code: "subscription_lookup_incomplete" });
});

it("treats a cancellation after the next renewal as still renewing and moves it to period end", async () => {
  stripe.rows.get("sub_one").cancel_at =
    stripe.rows.get("sub_one").current_period_end + 86400;
  expect(
    (await readPremiumRenewal({ db, stripe, uid: "alice" })).allStopped,
  ).toBe(false);
  expect((await change()).ok).toBe(true);
  expect(stripe.subscriptions.update).toHaveBeenCalledWith(
    "sub_one",
    expect.objectContaining({ cancel_at_period_end: true }),
    expect.anything(),
  );
});
it("uses only one Stripe cancellation parameter when explicitly reactivating", async () => {
  stripe.rows.get("sub_one").cancel_at_period_end = true;
  const result = await change({
    action: "reactivate",
    subscriptionId: "sub_one",
  });
  expect(result.ok).toBe(true);
  expect(stripe.subscriptions.update.mock.calls[0][1]).not.toHaveProperty(
    "cancel_at",
  );
});
it("retries a pending profile sync without sending duplicate email or Stripe changes", async () => {
  sync.mockRejectedValueOnce(new Error("temporary"));
  expect((await change()).syncStatus).toBe("pending");
  expect((await change()).syncStatus).toBe("synced");
  expect(sendEmail).toHaveBeenCalledTimes(1);
  expect(stripe.subscriptions.update).toHaveBeenCalledTimes(1);
});
it("does not lose the original completed evidence when a replay is superseded", async () => {
  await change();
  const summary = journal().summary;
  stripe.rows.get("sub_one").cancel_at_period_end = false;
  await expect(change()).rejects.toMatchObject({ code: "request_superseded" });
  expect(journal().state).toBe("complete");
  expect(journal().summary).toEqual(summary);
});
it("discovers legacy duplicates using Customer uid even when that customer is no longer saved in Firebase", async () => {
  stripe.rows.set(
    "sub_legacy",
    subscription("sub_legacy", {
      customer: "cus_legacy",
      metadata: { flow: "site_premium" },
    }),
  );
  const result = await change();
  expect(result.ok).toBe(true);
  expect(result.summary.subscriptions).toHaveLength(2);
  expect(stripe.rows.get("sub_legacy").cancel_at_period_end).toBe(true);
});
