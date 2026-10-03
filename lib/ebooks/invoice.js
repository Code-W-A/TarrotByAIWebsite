import { createOlbioInvoiceFromPayload } from "../../utils/olbioClient";
import {
  getOblioVatSettings,
  resolveCheckoutSessionOblioTax,
  shouldSendOblioEInvoice,
} from "../../utils/oblioTax";
import {
  normalizeBillingContext,
  buildInvoiceDecision,
  buildOblioClientFromNormalized,
} from "../../utils/billingAudit.mjs";
export async function invoiceEbookStripe(db, session, saved) {
  const ref = db.collection("payments").doc(session.id);
  const acquired = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.data()?.oblio || snap.data()?.paymentStatus === "refunded")
      return false;
    tx.set(
      ref,
      {
        uid: saved.uid,
        ebookId: saved.ebookId,
        purchaseType: "ebook",
        provider: "stripe",
        paymentStatus: "paid",
        amountPaid: session.amount_total / 100,
        currency: session.currency,
        oblio: {
          status: "processing",
          requestId: `ebook_inv_${session.id}`,
          at: Date.now(),
        },
      },
      { merge: true },
    );
    return true;
  });
  if (!acquired) return { skipped: true };
  try {
    const cif = process.env.OBLIO_CIF || process.env.OBLIO_COMPANY_CIF;
    const series = process.env.OBLIO_SERIES;
    if (!cif || !series) throw new Error("Oblio not configured");
    const audit = normalizeBillingContext(saved.billingAudit, {
      defaultCountry: "Romania",
      individualCnpOptional: true,
    });
    if (!audit.validation?.ok)
      throw new Error("Billing requires fiscal review");
    const decision = buildInvoiceDecision(audit);
    const tax = resolveCheckoutSessionOblioTax(session, getOblioVatSettings());
    if (!tax.ok) throw new Error("Invoice tax total mismatch");
    const date = new Date().toISOString().slice(0, 10);
    const requestId = `ebook_inv_${session.id}`;
    const result = await createOlbioInvoiceFromPayload({
      requestId,
      invoicePayload: {
        cif,
        seriesName: series,
        issueDate: date,
        client: buildOblioClientFromNormalized(audit.normalizedClient),
        language: "RO",
        precision: 2,
        currency: session.currency.toUpperCase(),
        sendEmail: 1,
        sendEInvoice:
          decision.sendEInvoice && shouldSendOblioEInvoice() ? 1 : 0,
        products: [
          {
            name: saved.title,
            description: `Acces ebook (${saved.ebookId})`,
            price: tax.price,
            vatName: tax.vatName,
            vatPercentage: tax.vatPercentage,
            vatIncluded: tax.vatIncluded,
            quantity: 1,
            measuringUnit: "bucata",
            productType: "Serviciu",
          },
        ],
        mentions: `Stripe session: ${session.id}`,
        collect: {
          type: "Card",
          documentNumber: `STRIPE-${session.id}`,
          value: tax.total,
          issueDate: date,
        },
      },
    });
    if (result?.status !== 200 || !result.data)
      throw new Error("Invoice outcome requires manual review");
    await ref.set(
      {
        oblio: {
          status: "created",
          requestId,
          number: String(result.data.number || ""),
          seriesName: result.data.seriesName || series,
          link: result.data.link || null,
          documentId: result.data.documentId || null,
        },
        updatedAt: Date.now(),
      },
      { merge: true },
    );
    return { created: true };
  } catch (error) {
    // Do not repeat an ambiguous external invoice call: it may already have succeeded.
    await ref.set(
      {
        oblio: {
          status: "pending_manual",
          reason: error.message,
          requestId: `ebook_inv_${session.id}`,
        },
        updatedAt: Date.now(),
      },
      { merge: true },
    );
    return { pendingManual: true };
  }
}
