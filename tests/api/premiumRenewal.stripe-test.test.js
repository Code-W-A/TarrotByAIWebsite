/** Opt-in real Stripe TEST flow. Firebase is in memory; emails are rendered into a local buffer. */
import { memoryDb } from "../helpers/premiumRenewalFixtures";
const db = memoryDb();
const mail = [];
const uid = `renewal-test-${Date.now()}`;
jest.mock("../../lib/firebaseAdmin", () => ({
  getAdminDb: () => db,
  getAdminAuth: () => ({
    getUser: async () => ({
      uid,
      email: "renewal-test@example.com",
      emailVerified: true,
      displayName: "Renewal Test",
    }),
  }),
}));
jest.mock("nodemailer", () => {
  const real = jest.requireActual("nodemailer");
  return {
    __esModule: true,
    default: {
      createTransport: () => {
        const sink = real.createTransport({
          streamTransport: true,
          buffer: true,
        });
        return {
          sendMail: async (options) => {
            const result = await sink.sendMail(options);
            mail.push({ options, raw: result.message.toString() });
            return result;
          },
        };
      },
    },
  };
});
import { changePremiumRenewal } from "../../lib/premiumRenewalService";
import { syncPremiumSubscriptionById } from "../../lib/stripePremiumSubscriptionSync";
const suite =
  process.env.RUN_STRIPE_RENEWAL_TEST === "1" ? describe : describe.skip;
suite("Stripe TEST renewal integration", () => {
  it("cancels two paid subscriptions, verifies access, safely retries and explicitly reactivates only one", async () => {
    if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_"))
      throw new Error(
        "A Stripe TEST key is mandatory; live requests are forbidden",
      );
    const Stripe = require("stripe").default || require("stripe");
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      timeout: 15000,
      maxNetworkRetries: 1,
    });
    process.env.EMAIL_USER = "confirmation@example.com";
    process.env.EMAIL_PASS = "local-sink-only";
    const customers = [],
      subscriptions = [];
    let product, price;
    try {
      product = await stripe.products.create({
        name: "Isolated premium renewal test",
        metadata: { testRun: uid },
      });
      price = await stripe.prices.create({
        product: product.id,
        unit_amount: 500,
        currency: "eur",
        recurring: { interval: "month" },
      });
      for (let n = 0; n < 2; n++) {
        const customer = await stripe.customers.create({
          email: "renewal-test@example.com",
          metadata: { uid, flow: "site_premium" },
          payment_method: "pm_card_visa",
          invoice_settings: { default_payment_method: "pm_card_visa" },
        });
        customers.push(customer);
        subscriptions.push(
          await stripe.subscriptions.create({
            customer: customer.id,
            items: [{ price: price.id }],
            metadata: { uid, flow: "site_premium" },
            payment_behavior: "error_if_incomplete",
          }),
        );
      }
      expect(subscriptions.every((sub) => sub.status === "active")).toBe(true);
      await db
        .collection("Users")
        .doc(uid)
        .set({
          stripeCustomerId: customers[0].id,
          stripeSubscriptionId: subscriptions[0].id,
        });
      const context = { db, stripe, uid };
      const cancel = {
        action: "cancel",
        requestId: `cancel_${Date.now()}_first`,
        confirmed: true,
        locale: "ro",
      };
      const result = await changePremiumRenewal({ ...context, input: cancel });
      expect(result.ok).toBe(true);
      expect(result.summary.subscriptions).toHaveLength(2);
      expect(result.emailStatus).toBe("sent");
      expect(
        db.rows.get(`Users/${uid}`).premiumSubscriptionCancelAtPeriodEnd,
      ).toBe(true);
      expect(db.rows.get(`Users/${uid}`).premiumSources.stripe.active).toBe(
        true,
      );
      expect(mail).toHaveLength(1);
      expect(mail[0].options.to).toBe("renewal-test@example.com");
      expect(
        (await changePremiumRenewal({ ...context, input: cancel })).ok,
      ).toBe(true);
      expect(mail).toHaveLength(1);
      const reactivate = await changePremiumRenewal({
        ...context,
        input: {
          action: "reactivate",
          subscriptionId: subscriptions[0].id,
          requestId: `reactivate_${Date.now()}`,
          confirmed: true,
        },
      });
      expect(reactivate.ok).toBe(true);
      expect(
        (await stripe.subscriptions.retrieve(subscriptions[0].id))
          .cancel_at_period_end,
      ).toBe(false);
      expect(
        (await stripe.subscriptions.retrieve(subscriptions[1].id))
          .cancel_at_period_end,
      ).toBe(true);
      // The same sync function used by the webhook must aggregate both subscriptions.
      await syncPremiumSubscriptionById(stripe, subscriptions[1].id);
      expect(
        db.rows.get(`Users/${uid}`).premiumSubscriptionCancelAtPeriodEnd,
      ).toBe(false);
      await stripe.subscriptions.cancel(subscriptions[1].id);
      await syncPremiumSubscriptionById(stripe, subscriptions[1].id);
      expect(db.rows.get(`Users/${uid}`).premiumSources.stripe.active).toBe(
        true,
      );
      expect(
        (
          await changePremiumRenewal({
            ...context,
            input: { ...cancel, requestId: `cancel_${Date.now()}_last` },
          })
        ).ok,
      ).toBe(true);
    } finally {
      for (const sub of subscriptions) {
        const current = await stripe.subscriptions.retrieve(sub.id);
        if (current.status !== "canceled")
          await stripe.subscriptions.cancel(sub.id);
      }
      for (const customer of customers) await stripe.customers.del(customer.id);
      if (price) await stripe.prices.update(price.id, { active: false });
      if (product) await stripe.products.update(product.id, { active: false });
    }
  }, 180000);
});
