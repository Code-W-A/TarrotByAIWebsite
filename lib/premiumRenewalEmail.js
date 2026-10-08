import nodemailer from "nodemailer";

/** Only an Auth-verified destination is accepted by the caller. Never let mail failure undo cancellation. */
export async function sendPremiumRenewalEmail({
  to,
  summary,
  requestId,
  locale = "ro",
  action,
}) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS)
    throw new Error("email_not_configured");
  const ro = locale === "ro";
  const date = summary.accessUntil
    ? new Intl.DateTimeFormat(ro ? "ro-RO" : "en-GB", {
        dateStyle: "long",
        timeZone: "Europe/Bucharest",
      }).format(new Date(summary.accessUntil))
    : null;
  const title =
    action === "reactivate"
      ? ro
        ? "Reînnoirea Premium a fost reactivată"
        : "Premium renewal has been reactivated"
      : ro
        ? "Reînnoirea Premium a fost oprită"
        : "Premium renewal has been stopped";
  const lines = [
    title,
    action === "cancel"
      ? ro
        ? "Reînnoirea automată a tuturor abonamentelor Premium Stripe identificate pe cont a fost oprită."
        : "Automatic renewal of all Premium Stripe subscriptions identified on your account has been stopped."
      : ro
        ? "Ai confirmat reactivarea unui abonament Premium."
        : "You confirmed reactivation of one Premium subscription.",
    date
      ? ro
        ? `Acces Premium până la: ${date}.`
        : `Premium access until: ${date}.`
      : "",
    `${ro ? "Referință" : "Reference"}: ${requestId}`,
  ];
  const transporter = nodemailer.createTransport({
    service: process.env.PREMIUM_SMTP_SERVICE || "gmail",
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    connectionTimeout: 10000,
    socketTimeout: 10000,
  });
  return transporter.sendMail({
    from: `"Cristina Zurba" <${process.env.EMAIL_USER}>`,
    to,
    subject: `${title} | Cristina Zurba`,
    text: lines.filter(Boolean).join("\n\n"),
  });
}
