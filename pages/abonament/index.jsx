import { useSubscriptionConsent } from "../../utils/useSubscriptionConsent";
import * as React from "react";
import Head from "next/head";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/router";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import { useTranslation } from "next-i18next";
import AuthFunnelShell from "../../components/auth/AuthFunnelShell";
import BillingDetailsForm from "../../components/BillingDetailsForm";
import { useAuth } from "../../context/AuthContext";
import { getFirebaseBearerHeader } from "../../utils/firebaseAuthHeaders";
import {
  buildBillingAuditInput,
  buildCourseBillingDetails,
  billingValuesIndividualFrom,
  createInitialBillingFormValues,
  hydrateBillingUiFromPremiumProfile,
  INDIVIDUAL_BILLING_AUDIT_OPTS,
  mapBillingAuditErrorsToForm,
} from "../../utils/billingAddressData.mjs";
import {
  buildInvoiceDecision,
  logBillingAudit,
  normalizeBillingContext,
} from "../../utils/billingAudit.mjs";
import { hasPremiumAccess } from "../../lib/premiumAccess";
import { PREMIUM_ALREADY_ACTIVE_ERROR } from "../../lib/premiumSubscriptionGuard";

export async function getServerSideProps({ locale }) {
  return {
    props: {
      ...(await serverSideTranslations(locale, ["common"])),
    },
  };
}

const WIZARD_TOTAL_STEPS = 3;

function splitDisplayName(displayName = "") {
  const normalized = typeof displayName === "string" ? displayName.trim() : "";
  if (!normalized) {
    return { firstName: "", lastName: "" };
  }
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "" };
  }
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts.slice(-1).join(" "),
  };
}

function collectContactErrors(billingContact, t) {
  const nextErrors = {};
  if (!billingContact.firstName.trim()) {
    nextErrors.firstName = t("coursesBillingFirstNameRequired", {
      defaultValue: "Prenumele este obligatoriu pentru facturare.",
    });
  }
  if (!billingContact.lastName.trim()) {
    nextErrors.lastName = t("coursesBillingLastNameRequired", {
      defaultValue: "Numele este obligatoriu pentru facturare.",
    });
  }
  if (!billingContact.email.trim()) {
    nextErrors.email = t("coursesBillingEmailRequired", {
      defaultValue: "Email-ul este obligatoriu pentru facturare.",
    });
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billingContact.email.trim())) {
    nextErrors.email = t("coursesBillingEmailInvalid", {
      defaultValue: "Email-ul introdus nu este valid.",
    });
  }
  if (!billingContact.phone.trim()) {
    nextErrors.phone = t("coursesBillingPhoneRequired", {
      defaultValue: "Telefonul este obligatoriu pentru facturare.",
    });
  }
  return nextErrors;
}

function collectFullBillingErrors(billingContact, billingForm, t) {
  const billingValuesIndividual = billingValuesIndividualFrom(billingForm);
  const nextErrors = { ...collectContactErrors(billingContact, t) };

  const rawBillingInput = buildBillingAuditInput({
    billingValues: billingValuesIndividual,
    firstName: billingContact.firstName,
    lastName: billingContact.lastName,
    fullName: `${billingContact.firstName} ${billingContact.lastName}`.trim(),
    email: billingContact.email,
    phone: billingContact.phone,
    individualAddress: billingValuesIndividual.billingAddress,
  });

  const billingAudit = normalizeBillingContext(rawBillingInput, INDIVIDUAL_BILLING_AUDIT_OPTS);

  if (!billingAudit.validation.ok) {
    Object.assign(
      nextErrors,
      mapBillingAuditErrorsToForm(billingAudit.validation.errorsByField, {
        billingType: "individual",
      }),
    );
  }

  return nextErrors;
}

function firstWizardStepForErrors(errors) {
  if (!errors || typeof errors !== "object") return 1;
  if (["firstName", "lastName", "email", "phone"].some((k) => errors[k])) return 1;
  return 2;
}

function fieldInputClass(hasError) {
  return [
    "w-full rounded-xl border bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-100 disabled:opacity-60",
    hasError ? "border-red-300 focus:border-red-400 focus:ring-red-50" : "border-slate-200",
  ].join(" ");
}

const stepDotClass = (active, done) =>
  [
    "h-2 w-2 shrink-0 rounded-full transition",
    done || active ? "bg-indigo-600" : "bg-slate-200",
    active ? "ring-2 ring-indigo-200 ring-offset-2 ring-offset-white" : "",
  ]
    .filter(Boolean)
    .join(" ");

export default function AbonamentPage() {
  const { t } = useTranslation("common");
  const router = useRouter();
  const { currentUser, loading, isGuestUser, userData } = useAuth();
  const recurring = useSubscriptionConsent(router.locale);
  const premiumPriceText = recurring.quote?.priceText || "—";
  const [checkoutLoading, setCheckoutLoading] = React.useState(false);
  const [portalLoading, setPortalLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [formErrors, setFormErrors] = React.useState({});
  const [wizardStep, setWizardStep] = React.useState(1);

  const [billingContact, setBillingContact] = React.useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
  });
  const [billingForm, setBillingForm] = React.useState(createInitialBillingFormValues());
  const [premiumLegalConsentAccepted, setPremiumLegalConsentAccepted] = React.useState(false);
  const profileHydratedRef = React.useRef(false);
  const alreadyPremium = hasPremiumAccess(userData);

  const openBillingPortal = React.useCallback(async () => {
    setPortalLoading(true);
    setError("");
    try {
      const headers = await getFirebaseBearerHeader({ required: true });
      const res = await fetch("/api/stripe/premium/create-portal-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({ flow: "default" }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.error === "SUBSCRIPTION_CONSENT_STALE") { await recurring.refresh(); setError(t("premiumRecurringExpired")); return; }
      if (!res.ok) {
        throw new Error(data?.error || t("premiumManageError"));
      }
      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error(t("premiumManageError"));
      }
    } catch (err) {
      console.error("[abonament] billing_portal", err);
      setError(err.message || t("premiumManageError"));
    } finally {
      setPortalLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    profileHydratedRef.current = false;
  }, [currentUser?.uid]);

  React.useEffect(() => {
    setWizardStep(1);
    setFormErrors({});
    setError("");
    setPremiumLegalConsentAccepted(false);
  }, [currentUser?.uid]);

  React.useEffect(() => {
    if (wizardStep !== 3) {
      setPremiumLegalConsentAccepted(false);
    }
  }, [wizardStep]);

  React.useEffect(() => {
    const derivedName = splitDisplayName(currentUser?.displayName || "");
    const fromProfile = hydrateBillingUiFromPremiumProfile(userData?.premiumBillingProfile);
    if (fromProfile && !profileHydratedRef.current) {
      setBillingContact(fromProfile.billingContact);
      setBillingForm(fromProfile.billingForm);
      profileHydratedRef.current = true;
      return;
    }

    if (profileHydratedRef.current) return;

    setBillingContact((prev) => ({
      firstName: prev.firstName || userData?.first_name || derivedName.firstName,
      lastName: prev.lastName || userData?.last_name || derivedName.lastName,
      email: prev.email || userData?.email || currentUser?.email || "",
      phone:
        prev.phone ||
        userData?.telefon ||
        userData?.phoneNumber ||
        currentUser?.phoneNumber ||
        "",
    }));
  }, [
    currentUser?.displayName,
    currentUser?.email,
    currentUser?.phoneNumber,
    userData?.email,
    userData?.first_name,
    userData?.last_name,
    userData?.phoneNumber,
    userData?.telefon,
    userData?.premiumBillingProfile,
  ]);

  React.useEffect(() => {
    setBillingForm((prev) =>
      prev.billingType !== "corporate"
        ? prev
        : {
            ...prev,
            billingType: "individual",
            companyName: "",
            companyVAT: "",
            companyReg: "",
            companyAddress: "",
          },
    );
  }, [currentUser?.uid, userData?.premiumBillingProfile]);

  const points = React.useMemo(
    () => [
      t("premiumSubscribePoint2", {
        defaultValue:
          "Secure payment via Stripe; Romanian county and locality use Oblio-compliant lists.",
      }),
      t("premiumSubscribePoint3", {
        defaultValue: "You can cancel your subscription anytime in the Stripe customer portal.",
      }),
      t("premiumSubscribePoint4", {
        defaultValue: "If you cancel, you keep premium access until the paid period ends.",
      }),
    ],
    [t],
  );

  const handleBillingContactChange = (field, value) => {
    setBillingContact((prev) => ({
      ...prev,
      [field]: value,
    }));
    setFormErrors((prev) => ({ ...prev, [field]: false }));
    setError("");
  };

  const handleBillingFieldChange = (field, value) => {
    setBillingForm((prev) => ({
      ...prev,
      [field]: value,
    }));
    setFormErrors((prev) => ({ ...prev, [field]: false }));
    setError("");
  };

  const handleWizardNext = () => {
    setError("");
    setCheckoutLoading(false);

    if (wizardStep === 1) {
      const nextErrors = collectContactErrors(billingContact, t);
      if (Object.keys(nextErrors).length > 0) {
        setFormErrors(nextErrors);
        setError(
          Object.values(nextErrors)[0] ||
            t("coursesBillingFormInvalid", {
              defaultValue: "Completeaza datele de facturare inainte de a continua.",
            }),
        );
        return;
      }
      setFormErrors({});
      setWizardStep(2);
      return;
    }

    if (wizardStep === 2) {
      const nextErrors = collectFullBillingErrors(billingContact, billingForm, t);
      if (Object.keys(nextErrors).length > 0) {
        setFormErrors(nextErrors);
        setError(
          Object.values(nextErrors)[0] ||
            t("coursesBillingFormInvalid", {
              defaultValue: "Completeaza datele de facturare inainte de a continua.",
            }),
        );
        setWizardStep(firstWizardStepForErrors(nextErrors));
        return;
      }
      setFormErrors({});
      setWizardStep(3);
    }
  };

  const handleWizardBack = () => {
    setError("");
    setFormErrors({});
    setWizardStep((s) => Math.max(1, s - 1));
  };

  const startCheckout = async () => {
    setError("");
    if (!recurring.accepted || !recurring.quote) { setError(t("premiumRecurringRequired")); return; }
    if (!premiumLegalConsentAccepted) {
      setError(t("premiumSubscribeLegalConsentRequired"));
      return;
    }
    setCheckoutLoading(true);

    try {
      if (!currentUser || isGuestUser) {
        setError(t("premiumLoginPrompt"));
        return;
      }

      const billingValuesIndividual = billingValuesIndividualFrom(billingForm);

      const nextErrors = collectFullBillingErrors(billingContact, billingForm, t);

      if (Object.keys(nextErrors).length > 0) {
        setFormErrors(nextErrors);
        setWizardStep(firstWizardStepForErrors(nextErrors));
        setError(
          Object.values(nextErrors)[0] ||
            t("coursesBillingFormInvalid", {
              defaultValue: "Completeaza datele de facturare inainte de a continua.",
            }),
        );
        return;
      }

      const billingAuditInput = buildBillingAuditInput({
        billingValues: billingValuesIndividual,
        firstName: billingContact.firstName,
        lastName: billingContact.lastName,
        fullName: `${billingContact.firstName} ${billingContact.lastName}`.trim(),
        email: billingContact.email,
        phone: billingContact.phone,
        individualAddress: billingValuesIndividual.billingAddress,
      });
      const billingAudit = normalizeBillingContext(billingAuditInput, INDIVIDUAL_BILLING_AUDIT_OPTS);
      const invoiceDecision = buildInvoiceDecision(billingAudit);

      logBillingAudit({
        flow: "premium_subscription",
        stage: "ui_submit",
        raw: billingAuditInput,
        normalized: billingAudit.normalizedClient,
        decision: invoiceDecision,
      });

      const billingDetails = buildCourseBillingDetails({
        billingValues: billingValuesIndividual,
        firstName: billingContact.firstName,
        lastName: billingContact.lastName,
        email: billingContact.email,
        phone: billingContact.phone,
        individualAddress: billingValuesIndividual.billingAddress,
      });

      const headers = await getFirebaseBearerHeader({ required: true });
      const res = await fetch("/api/stripe/premium/create-checkout-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({ billingDetails, subscriptionConsent: { accepted: true, version: recurring.quote.version, locale: recurring.quote.locale, quoteId: recurring.quote.quoteId } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409 && data?.error === PREMIUM_ALREADY_ACTIVE_ERROR) {
          const msg =
            typeof data?.message === "string" && data.message.trim()
              ? data.message
              : t("premiumAlreadyActiveMessage", {
                  defaultValue:
                    "Ai deja un abonament premium activ. Nu este nevoie de o nouă plată.",
                });
          setError(msg);
          if (typeof data?.portalUrl === "string" && data.portalUrl.trim()) {
            window.location.href = data.portalUrl.trim();
            return;
          }
          return;
        }
        if (Array.isArray(data?.details) && data.details.length) {
          throw new Error(data.details[0].message || data?.error || t("premiumSubscribeError"));
        }
        throw new Error(data?.message || data?.error || t("premiumSubscribeError"));
      }
      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error(t("premiumSubscribeError"));
      }
    } catch (err) {
      console.error("[abonament] checkout", err);
      setError(err.message || t("premiumSubscribeError"));
    } finally {
      setCheckoutLoading(false);
    }
  };

  const stepTitle = React.useMemo(() => {
    switch (wizardStep) {
      case 1:
        return t("premiumSubscribeWizardContactTitle");
      case 2:
        return t("premiumSubscribeWizardBillingTitle");
      case 3:
        return t("premiumSubscribeWizardReviewTitle");
      default:
        return "";
    }
  }, [t, wizardStep]);

  const billingValuesIndividual = billingValuesIndividualFrom(billingForm);
  const showCompactHero = wizardStep > 1;

  return (
    <>
      <Head>
        <title>{t("premiumSubscribePageTitle")} | Cristina Zurba</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>

      <AuthFunnelShell
        mainVerticalAlign="start"
        topSlot={
          <Link
            href="/videouri"
            className="mx-auto mb-4 inline-flex w-full max-w-6xl shrink-0 items-center gap-2 text-sm font-medium text-slate-600 transition hover:text-slate-900 lg:mb-3 xl:max-w-7xl"
          >
            <span aria-hidden>←</span>
            {t("premiumSubscribeBackLink", { defaultValue: "Back to premium area" })}
          </Link>
        }
      >
        <div className="w-full pb-4 pt-3 sm:pt-6 lg:pb-10 lg:pt-6">
          <section className="rounded-2xl border border-slate-200 bg-white px-6 py-6 shadow-sm sm:px-8 sm:py-7 lg:grid lg:grid-cols-2 lg:gap-x-10 lg:gap-y-5 lg:px-10 lg:py-8 xl:gap-x-14 xl:px-12">
          <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
            <Image
              src="/LogoPngTransparent.png"
              width={120}
              height={120}
              alt=""
              className={`mb-3 object-contain sm:mb-4 lg:mb-2 ${
                showCompactHero
                  ? "h-14 w-14 sm:h-16 sm:w-16 lg:h-[4.5rem] lg:w-[4.5rem]"
                  : "h-[88px] w-[88px] sm:h-24 sm:w-24 lg:h-28 lg:w-28 xl:h-32 xl:w-32"
              }`}
              priority
            />
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl lg:text-2xl">
              {t("premiumSubscribeHeading")}
            </h1>
            <p className="mt-1 text-lg font-semibold text-indigo-700 lg:text-xl">
              {t("premiumSubscribePriceLine", { price: premiumPriceText })}
            </p>
            <p className="mt-3 text-sm font-semibold" dir={router.locale === "ar" || router.locale === "he" ? "rtl" : "ltr"}>{recurring.quote?.text || (recurring.error ? t("premiumRecurringUnavailable") : "")}</p>
            <p
              className={`mt-2 max-w-md text-sm leading-relaxed text-slate-600 lg:mt-1.5 lg:max-w-none lg:text-sm lg:leading-snug ${
                showCompactHero ? "line-clamp-2 lg:line-clamp-3" : ""
              }`}
            >
              {t("premiumSubscribeDescription")}
            </p>
          </div>

          <ul
            className={`mt-4 space-y-2 text-left text-sm text-slate-600 lg:col-start-1 lg:row-start-2 lg:mt-0 lg:space-y-1.5 lg:self-start lg:text-sm ${
              showCompactHero ? "hidden" : ""
            }`}
          >
            {points.map((line, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500 lg:mt-1.5" aria-hidden />
                <span className="leading-snug">{line}</span>
              </li>
            ))}
          </ul>

          <div className="mt-6 min-h-0 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0">
            {loading ? (
              <p className="text-center text-sm text-slate-600 lg:text-left">{t("coursesPurchasedLoading")}</p>
            ) : !currentUser || isGuestUser ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-5 py-8 text-center">
                <p className="text-sm text-slate-600">{t("premiumLoginPrompt")}</p>
                <Link
                  href={`/login?returnUrl=${encodeURIComponent(router.asPath || "/abonament")}`}
                  className="mt-6 inline-flex w-full max-w-xs justify-center rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
                >
                  {t("premiumLoginCta")}
                </Link>
              </div>
            ) : alreadyPremium ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 px-5 py-8 text-center lg:text-left">
                <p className="text-sm font-medium text-emerald-900">
                  {t("premiumAlreadyActiveTitle", {
                    defaultValue: "Abonamentul tău premium este deja activ",
                  })}
                </p>
                <p className="mt-2 text-sm text-emerald-800/90">
                  {t("premiumAlreadyActiveMessage", {
                    defaultValue:
                      "Nu este nevoie de o nouă plată. Poți gestiona abonamentul din setări sau din portalul Stripe.",
                  })}
                </p>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center lg:justify-start">
                  <Link
                    href="/settings"
                    className="inline-flex justify-center rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
                  >
                    {t("premiumManageSubscription")}
                  </Link>
                  <button
                    type="button"
                    onClick={openBillingPortal}
                    disabled={portalLoading}
                    className="inline-flex justify-center rounded-xl border border-emerald-300 bg-white px-6 py-3 text-sm font-semibold text-emerald-900 shadow-sm transition hover:bg-emerald-50 disabled:cursor-wait disabled:opacity-70"
                  >
                    {portalLoading ? t("premiumManageLoading") : t("settingsPremiumOpenBillingPortal")}
                  </button>
                </div>
                <Link
                  href="/videouri"
                  className="mt-4 inline-block text-sm font-medium text-emerald-800 underline-offset-2 hover:underline"
                >
                  {t("premiumSubscribeBackLink", { defaultValue: "Înapoi la videoclipuri" })}
                </Link>
              </div>
            ) : (
              <div className="flex min-h-0 flex-col space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 gap-y-1">
                  <p className="text-xs font-medium text-slate-500">
                    {t("premiumSubscribeWizardProgress", {
                      step: wizardStep,
                      total: WIZARD_TOTAL_STEPS,
                    })}
                  </p>
                  <div className="flex items-center gap-1.5" aria-hidden>
                    {Array.from({ length: WIZARD_TOTAL_STEPS }, (_, i) => (
                      <span
                        key={i}
                        className={stepDotClass(wizardStep === i + 1, wizardStep > i + 1)}
                      />
                    ))}
                  </div>
                </div>

                <h2 className="text-base font-semibold text-slate-900">{stepTitle}</h2>

                {error ? (
                  <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800">
                    {error}
                  </div>
                ) : null}

                {wizardStep === 1 ? (
                  <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {t("coursesBillingFirstNameLabel", { defaultValue: "Prenume" })}
                      </label>
                      <input
                        type="text"
                        value={billingContact.firstName}
                        onChange={(e) => handleBillingContactChange("firstName", e.target.value)}
                        className={fieldInputClass(Boolean(formErrors.firstName))}
                        disabled={checkoutLoading}
                      />
                      {typeof formErrors.firstName === "string" ? (
                        <p className="text-xs font-medium text-red-600">{formErrors.firstName}</p>
                      ) : null}
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {t("coursesBillingLastNameLabel", { defaultValue: "Nume" })}
                      </label>
                      <input
                        type="text"
                        value={billingContact.lastName}
                        onChange={(e) => handleBillingContactChange("lastName", e.target.value)}
                        className={fieldInputClass(Boolean(formErrors.lastName))}
                        disabled={checkoutLoading}
                      />
                      {typeof formErrors.lastName === "string" ? (
                        <p className="text-xs font-medium text-red-600">{formErrors.lastName}</p>
                      ) : null}
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {t("coursesBillingEmailLabel", { defaultValue: "Email facturare" })}
                      </label>
                      <input
                        type="email"
                        value={billingContact.email}
                        onChange={(e) => handleBillingContactChange("email", e.target.value)}
                        className={fieldInputClass(Boolean(formErrors.email))}
                        disabled={checkoutLoading}
                      />
                      {typeof formErrors.email === "string" ? (
                        <p className="text-xs font-medium text-red-600">{formErrors.email}</p>
                      ) : null}
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {t("coursesBillingPhoneLabel", { defaultValue: "Telefon" })}
                      </label>
                      <input
                        type="tel"
                        value={billingContact.phone}
                        onChange={(e) => handleBillingContactChange("phone", e.target.value)}
                        className={fieldInputClass(Boolean(formErrors.phone))}
                        disabled={checkoutLoading}
                      />
                      {typeof formErrors.phone === "string" ? (
                        <p className="text-xs font-medium text-red-600">{formErrors.phone}</p>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {wizardStep === 2 ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
                    <BillingDetailsForm
                      variant="tailwind"
                      fieldGroup="all"
                      individualBillingOnly
                      hidePersonalCnp
                      title=""
                      description={t("premiumSubscribeWizardBillingBlurb", {
                        defaultValue:
                          "Enter your street address, then country and — for Romania — county and locality from Oblio-compliant lists.",
                      })}
                      billingValues={billingForm}
                      onBillingChange={handleBillingFieldChange}
                      errors={formErrors}
                      individualAddressValue={billingForm.billingAddress}
                      onIndividualAddressChange={(value) => handleBillingFieldChange("billingAddress", value)}
                      disabled={checkoutLoading}
                    />
                  </div>
                ) : null}

                {wizardStep === 3 ? (
                  <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700 sm:px-5">
                    <dl className="grid gap-3 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {t("coursesBillingFirstNameLabel", { defaultValue: "Prenume" })} /{" "}
                          {t("coursesBillingLastNameLabel", { defaultValue: "Nume" })}
                        </dt>
                        <dd className="mt-0.5 font-medium text-slate-900">
                          {billingContact.firstName} {billingContact.lastName}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {t("coursesBillingEmailLabel", { defaultValue: "Email" })}
                        </dt>
                        <dd className="mt-0.5 break-all font-medium">{billingContact.email}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {t("coursesBillingPhoneLabel", { defaultValue: "Telefon" })}
                        </dt>
                        <dd className="mt-0.5 font-medium">{billingContact.phone}</dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {t("coursesBillingCardTitle", { defaultValue: "Adresă" })}
                        </dt>
                        <dd className="mt-0.5 font-medium text-slate-900">{billingForm.billingAddress || "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {t("premiumSubscribeReviewCountryLabel", { defaultValue: "Country" })}
                        </dt>
                        <dd className="mt-0.5 font-medium">{billingValuesIndividual.billingCountry || "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {t("premiumSubscribeReviewCountyLabel", { defaultValue: "County" })}
                        </dt>
                        <dd className="mt-0.5 font-medium">{billingValuesIndividual.billingCounty || "—"}</dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {t("premiumSubscribeReviewLocalityLabel", { defaultValue: "Locality" })}
                        </dt>
                        <dd className="mt-0.5 font-medium">{billingValuesIndividual.billingCity || "—"}</dd>
                      </div>
                    </dl>
                    <div className="border-t border-slate-200 pt-4" dir={router.locale === "ar" || router.locale === "he" ? "rtl" : "ltr"}>
                      <p className="mb-3 font-semibold text-slate-900">{recurring.quote?.text}</p>
                      {recurring.error ? <button type="button" onClick={recurring.refresh} className="mb-3 text-indigo-700 underline">{t("premiumRecurringExpired")}</button> : null}
                      <label className="mb-4 flex items-start gap-3 text-sm text-slate-900">
                        <input type="checkbox" checked={recurring.accepted} onChange={e => recurring.setAccepted(e.target.checked)} disabled={checkoutLoading || !recurring.quote} className="mt-1 h-4 w-4 shrink-0" />
                        <span>{t("premiumRecurringConsent")}</span>
                      </label>
                      <div className="flex gap-3">
                        <input
                          id="premium-subscribe-legal-consent"
                          type="checkbox"
                          checked={premiumLegalConsentAccepted}
                          onChange={(e) => {
                            setPremiumLegalConsentAccepted(e.target.checked);
                            setError("");
                          }}
                          disabled={checkoutLoading}
                          className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                        />
                        <label
                          htmlFor="premium-subscribe-legal-consent"
                          className="text-sm leading-snug text-slate-700"
                        >
                          {t("premiumSubscribeLegalConsentBefore")}
                          <Link
                            href="/politica-platforma"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-indigo-700 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-900"
                          >
                            {t("premiumSubscribeLegalLinkPlatform")}
                          </Link>
                          {t("premiumSubscribeLegalConsentBetween")}
                          <Link
                            href="/privacypolicy"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-indigo-700 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-900"
                          >
                            {t("premiumSubscribeLegalLinkPrivacy")}
                          </Link>
                          {t("premiumSubscribeLegalConsentAfter")}
                        </label>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between sm:pt-2">
                  {wizardStep > 1 ? (
                    <button
                      type="button"
                      onClick={handleWizardBack}
                      disabled={checkoutLoading}
                      className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
                    >
                      {t("premiumSubscribeWizardBack")}
                    </button>
                  ) : (
                    <span className="hidden shrink-0 sm:inline sm:w-24" aria-hidden />
                  )}
                  {wizardStep < WIZARD_TOTAL_STEPS ? (
                    <button
                      type="button"
                      onClick={handleWizardNext}
                      disabled={checkoutLoading}
                      className="w-full rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50 sm:w-auto sm:min-w-[9rem]"
                    >
                      {t("premiumSubscribeWizardNext")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startCheckout()}
                      disabled={checkoutLoading || !premiumLegalConsentAccepted || !recurring.accepted || !recurring.quote}
                      className={`w-full rounded-xl px-6 py-3 text-sm font-semibold text-white shadow-sm transition sm:ml-auto sm:w-auto sm:min-w-[12rem] ${
                        checkoutLoading || !premiumLegalConsentAccepted || !recurring.accepted || !recurring.quote
                          ? "cursor-not-allowed bg-slate-400"
                          : "bg-slate-900 hover:bg-slate-800"
                      }`}
                    >
                      {checkoutLoading ? (
                        <span className="inline-flex items-center justify-center gap-2">
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                          {t("premiumSubscribeLoading")}
                        </span>
                      ) : (
                        t("premiumSubscribeCta")
                      )}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
        </div>
      </AuthFunnelShell>
    </>
  );
}
