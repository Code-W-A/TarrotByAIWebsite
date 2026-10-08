import { FieldValue } from "firebase-admin/firestore";
import { normalizeBillingDetails, buildBillingContextInput } from "./stripeBillingDetails";
import { normalizeBillingContext } from "../utils/billingAudit.mjs";

export function inspectBillingProfile(raw, email = "") {
  const billingDetails = normalizeBillingDetails(raw, email);
  const audit = normalizeBillingContext(buildBillingContextInput(billingDetails, raw, email), {
    defaultCountry: "Romania", individualCnpOptional: true,
  });
  const valid = Boolean(billingDetails && billingDetails.firstName && billingDetails.lastName &&
    /\S+@\S+\.\S+/.test(billingDetails.email) && audit.validation.ok &&
    (!billingDetails.phone || billingDetails.phone.replace(/[^\d]/g, "").length >= 7));
  const issues = audit.validation.blockingErrors.map(({ field, code }) => ({ field, code }));
  if (!billingDetails?.firstName) issues.push({ field: "firstName", code: "missing_first_name" });
  if (!billingDetails?.lastName) issues.push({ field: "lastName", code: "missing_last_name" });
  if (!/\S+@\S+\.\S+/.test(billingDetails?.email || "")) issues.push({ field: "email", code: "invalid_email" });
  if (billingDetails?.phone && billingDetails.phone.replace(/[^\d]/g, "").length < 7) issues.push({ field: "phone", code: "invalid_phone" });
  return { billingDetails, valid, diagnostics: { issues, present: {
    firstName: Boolean(billingDetails?.firstName), lastName: Boolean(billingDetails?.lastName),
    email: Boolean(billingDetails?.email), phone: Boolean(billingDetails?.phone),
    line1: Boolean(billingDetails?.address?.line1), city: Boolean(billingDetails?.address?.city),
    state: Boolean(billingDetails?.address?.state), country: Boolean(billingDetails?.address?.country),
  } } };
}

export function validateBillingProfile(raw, email = "") {
  const { billingDetails, valid } = inspectBillingProfile(raw, email);
  return { billingDetails, valid };
}

export async function saveBillingProfile(db, uid, billingDetails) {
  await db.collection("billingProfiles").doc(uid).set({
    billingDetails, updatedAt: FieldValue.serverTimestamp(),
  });
}
