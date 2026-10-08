import Stripe from "stripe";
import { requireAuth } from "../../../../lib/requireAuth";
import { getAdminDb } from "../../../../lib/firebaseAdmin";
import {
  changePremiumRenewal,
  readPremiumRenewal,
} from "../../../../lib/premiumRenewalService";

// Keep time for Stripe read-back and journaling; expired leases allow safe recovery.
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  try {
    const auth = await requireAuth(req);
    // The header is only an account-switch guard; ownership always comes from the token.
    const expectedUid = req.headers?.["x-premium-account-uid"];
    if (expectedUid && expectedUid !== auth.uid) {
      return res.status(409).json({ error: "account_changed" });
    }
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      timeout: 10000,
      maxNetworkRetries: 1,
    });
    const context = { db: getAdminDb(), stripe, uid: auth.uid };
    const result =
      req.method === "GET"
        ? await readPremiumRenewal(context)
        : await changePremiumRenewal({ ...context, input: req.body || {} });
    return res.status(200).json(result);
  } catch (error) {
    console.warn("[premium.renewal] request_failed", {
      code: error.code || "renewal_unavailable",
    });
    return res.status(error.statusCode || 503).json({
      error:
        error.statusCode === 401
          ? "unauthorized"
          : error.statusCode
            ? error.code
            : "renewal_unavailable",
    });
  }
}
