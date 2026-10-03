import Stripe from "stripe";
import { getConsentQuote } from "../../../lib/subscriptionConsent";
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "Method not allowed" }); }
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    return res.status(200).json(await getConsentQuote(stripe, req.query.locale));
  } catch {
    return res.status(503).json({ error: "SUBSCRIPTION_CONSENT_UNAVAILABLE" });
  }
}
