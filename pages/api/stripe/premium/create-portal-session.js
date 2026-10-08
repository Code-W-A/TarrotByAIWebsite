import Stripe from "stripe";
import { getAdminDb } from "../../../../lib/firebaseAdmin";
import { requireAuth } from "../../../../lib/requireAuth";
import { resolvePremiumPublicBaseUrl } from "../../../../lib/premiumServerUtils";
import { PREMIUM_FLOW_METADATA } from "../../../../lib/premiumAccess";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function parseFlow(req) {
  const body = req.body;
  if (!body || typeof body !== "object") return "default";
  if (body.flow === "cancel") return "cancel";
  if (body.flow === "tax_address") return "tax_address";
  return "default";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  let authUser;
  try {
    authUser = await requireAuth(req);
  } catch (err) {
    const code = err.statusCode || 401;
    return res.status(code).json({ error: err.message || "Unauthorized" });
  }

  const baseUrl = resolvePremiumPublicBaseUrl(req);
  if (!baseUrl) {
    return res.status(500).json({ error: "Missing site URL configuration" });
  }

  const flow = parseFlow(req);
  const uid = authUser.uid;
  const db = getAdminDb();
  let stripeCustomerId = null;
  let stripeSubscriptionId = "";
  try {
    const snap = await db.collection("Users").doc(uid).get();
    if (snap.exists) {
      const data = snap.data() || {};
      const c = data.stripeCustomerId;
      if (typeof c === "string" && c.trim()) {
        stripeCustomerId = c.trim();
      }
      const s = data.stripeSubscriptionId;
      if (typeof s === "string" && s.trim()) {
        stripeSubscriptionId = s.trim();
      }
    }
  } catch (e) {
    console.warn("[premium.portal] user_read_failed", { message: e?.message });
  }

  if (!stripeCustomerId) {
    return res.status(400).json({
      error: "No Stripe customer on file. Subscribe first to manage billing.",
    });
  }

  const returnUrl = `${baseUrl}/settings`;
  const baseParams = { customer: stripeCustomerId, return_url: returnUrl };

  try {
    let portalSession;

    if (flow === "cancel") {
      if (!stripeSubscriptionId) return res.status(409).json({ error: "Cancellation unavailable. Open subscription settings to verify your subscriptions." });
      try {
        const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
        const subCustomer = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
        if (subCustomer === stripeCustomerId && sub.metadata?.flow === PREMIUM_FLOW_METADATA) {
          portalSession = await stripe.billingPortal.sessions.create({
            ...baseParams,
            flow_data: {
              type: "subscription_cancel",
              subscription_cancel: { subscription: stripeSubscriptionId },
            },
          });
        }
        if (!portalSession) return res.status(409).json({ error: "Could not verify the subscription for cancellation. Open subscription settings." });
      } catch (subErr) {
        console.warn("[premium.portal] cancel_flow_preflight_failed", { message: subErr?.message });
        return res.status(503).json({ error: "Cancellation was not completed. Try again from subscription settings." });
      }
    }

    if (!portalSession) {
      portalSession = await stripe.billingPortal.sessions.create(baseParams);
    }

    if (!portalSession?.url) {
      return res.status(500).json({ error: "Portal session missing URL" });
    }
    return res.status(200).json({ url: portalSession.url });
  } catch (err) {
    console.error("[premium.portal] stripe_error", { message: err?.message });
    return res.status(500).json({ error: "Could not open billing portal" });
  }
}
