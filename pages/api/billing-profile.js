import { getAdminDb } from "../../lib/firebaseAdmin";
import { requireAuth } from "../../lib/requireAuth";
import { inspectBillingProfile, saveBillingProfile } from "../../lib/billingProfile";
import { randomUUID } from "crypto";
export const config = { api: { bodyParser: { sizeLimit: "32kb" } } };

export default async function handler(req, res) {
  const headerId = req.headers?.["x-request-id"];
  const requestId = typeof headerId === "string" && /^bp-[a-z0-9]{6,16}-[a-z0-9]{1,12}$/.test(headerId) ? headerId : `bp-${randomUUID()}`;
  const started = Date.now();
  let stage = "method";
  const log = (event, extra = {}, failure = false) => {
    const metadata = { requestId, method: req.method, stage, durationMs: Date.now() - started, ...extra };
    (failure ? console.warn : console.info)(`[BillingProfile] ${event}`, metadata);
  };
  res.setHeader("X-Request-ID", requestId);
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (!["GET", "PUT"].includes(req.method)) {
    log("method_rejected", { status: 405 }, true);
    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    stage = "authentication";
    log("request_start");
    const user = await requireAuth(req);
    if (!user.uid || user.firebase?.sign_in_provider === "anonymous") {
      log("authentication_rejected", { status: 403, reason: "account_required" }, true);
      return res.status(403).json({ error: "Autentifică-te într-un cont pentru facturare." });
    }
    log("authentication_success");
    stage = "database_init";
    const db = getAdminDb();
    if (req.method === "GET") {
      stage = "firestore_read";
      const snapshot = await db.collection("billingProfiles").doc(user.uid).get();
      log("read_success", { exists: snapshot.exists });
      if (!snapshot.exists) {
        log("request_success", { status: 200, valid: false });
        return res.json({ billingDetails: null, valid: false });
      }
      stage = "validation";
      const { billingDetails, valid, diagnostics } = inspectBillingProfile(snapshot.data().billingDetails, user.email);
      log("validation_result", { valid, ...diagnostics }, !valid);
      log("request_success", { status: 200, valid });
      return res.json({ billingDetails, valid });
    }
    stage = "validation";
    const { billingDetails, valid, diagnostics } = inspectBillingProfile(req.body?.billingDetails, user.email);
    log("validation_result", { valid, ...diagnostics }, !valid);
    if (!valid) {
      log("request_failed", { status: 400, reason: "validation_failed" }, true);
      return res.status(400).json({ error: "Completează datele necesare facturării." });
    }
    stage = "firestore_write";
    log("write_start");
    await saveBillingProfile(db, user.uid, billingDetails);
    log("write_success");
    log("request_success", { status: 200 });
    return res.json({ billingDetails, valid });
  } catch (error) {
    const knownCodes = ["permission-denied", "unauthenticated", "unavailable", "deadline-exceeded", "internal", "invalid-argument", "not-found", "already-exists", "resource-exhausted", "failed-precondition", "aborted", "out-of-range", "unimplemented", "cancelled", "unknown"];
    const code = Number.isInteger(error.code) && error.code >= 0 && error.code <= 16 ? error.code : knownCodes.includes(error.code) ? error.code : "unknown";
    log("request_failed", { status: error.statusCode || 500, code }, true);
    return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Profilul de facturare nu a putut fi salvat sau încărcat." });
  }
}
