import SubscriptionRecurringNotice from "../../components/VideoLibrary/SubscriptionRecurringNotice";
import * as React from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import Image from "next/image";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import { useTranslation } from "next-i18next";
import AuthFunnelShell from "../../components/auth/AuthFunnelShell";
import PublicVideoThumbnail from "../../components/VideoLibrary/PublicVideoThumbnail";
import VideoPremiumThumbBadge from "../../components/VideoLibrary/VideoPremiumThumbBadge";
import { useAuth } from "../../context/AuthContext";
import { handleGetUserInfoJobs } from "../../utils/handleFirebaseQuery";
import { hasPremiumAccess } from "../../lib/premiumAccess";

function formatDuration(seconds, fallback = "") {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 1) return fallback;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function PremiumZoneVideoSpotlight({ locale }) {
  const { t } = useTranslation("common");
  const { currentUser } = useAuth();
  const [videos, setVideos] = React.useState([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const lc = locale || "ro";
        const res = await fetch(
          `/api/premium/video-library?locale=${encodeURIComponent(lc)}&scope=premium_zone&client=web`,
          {
            headers: {
              Accept: "application/json",
            },
          },
        );
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && Array.isArray(data?.videos)) {
          setVideos(data.videos);
        } else if (!cancelled) {
          setVideos([]);
        }
      } catch {
        if (!cancelled) setVideos([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locale, currentUser?.uid]);

  return (
    <section className="mt-10 border-t border-slate-200 pt-10" aria-labelledby="premium-zone-videos-heading">
      <h2 id="premium-zone-videos-heading" className="text-lg font-semibold text-slate-900 sm:text-xl">
        {t("premiumZoneExclusiveVideosHeading")}
      </h2>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
        {t("premiumZoneExclusiveVideosLead")}
      </p>

      {loading ? (
        <div className="mt-8 flex items-center gap-3 text-sm text-slate-500">
          <span
            className="h-8 w-8 shrink-0 animate-spin rounded-full border-2 border-slate-200 border-t-sky-600"
            aria-hidden
          />
          {t("videoLibraryLoading")}
        </div>
      ) : videos.length === 0 ? (
        <p className="mt-8 text-sm text-slate-600">{t("premiumZoneExclusiveVideosEmpty")}</p>
      ) : (
        <ul className="mt-8 grid list-none gap-6 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map((v) => {
            const durationLabel =
              typeof v.durationSeconds === "number" ? formatDuration(v.durationSeconds, "") : "";
            return (
              <li key={v.id} className="min-w-0">
                <Link
                  href={`/videouri/${encodeURIComponent(v.id)}`}
                  className="group block text-left text-inherit no-underline"
                >
                  <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-slate-200">
                    <PublicVideoThumbnail
                      src={v.thumbnailUrl}
                      alt=""
                      imgClassName="h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
                      fallback={
                        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-slate-700 to-slate-900 text-slate-400">
                          <svg
                            className="h-12 w-12 opacity-50"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.25"
                            aria-hidden
                          >
                            <rect x="2" y="4" width="20" height="16" rx="2" />
                            <path d="M10 9l6 3-6 3V9z" fill="currentColor" stroke="none" />
                          </svg>
                        </div>
                      }
                    />
                    {v.isPremium ? (
                      <VideoPremiumThumbBadge label={t("videoLibraryPremiumCornerBadge")} />
                    ) : null}
                    {durationLabel ? (
                      <span className="absolute bottom-1.5 right-1.5 z-10 rounded bg-black/80 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
                        {durationLabel}
                      </span>
                    ) : null}
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition group-hover:opacity-100">
                      <span className="rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-slate-900 shadow-lg">
                        {t("videoLibraryPlay")}
                      </span>
                    </div>
                  </div>
                  <p className="mt-3 line-clamp-2 text-sm font-semibold leading-snug text-slate-900">{v.title}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-10">
        <VideoLibraryPrimaryCta
          label={t("premiumVideoLibraryBigCta")}
          hint={t("premiumVideoLibraryBigCtaHint")}
        />
      </div>
    </section>
  );
}

export async function getServerSideProps({ locale }) {
  return {
    props: {
      ...(await serverSideTranslations(locale, ["common"])),
    },
  };
}

function normalizeQuery(value) {
  if (Array.isArray(value)) return value[0] ?? "";
  return typeof value === "string" ? value : "";
}

function cn(...parts) {
  return parts.filter(Boolean).join(" ");
}

function normalizeTruthyQuery(param) {
  const v = normalizeQuery(param).toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** emerald / celebration */
function CelebrationConfetti() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl" aria-hidden>
      <span className="absolute left-[6%] top-[18%] h-2 w-2 rotate-12 rounded-sm bg-emerald-400/70" />
      <span className="absolute left-[14%] top-[8%] h-1.5 w-3 -rotate-45 rounded-sm bg-teal-400/60" />
      <span className="absolute right-[10%] top-[14%] h-2 w-2 rounded-full bg-lime-400/70" />
      <span className="absolute right-[20%] top-[22%] h-1 w-2 rotate-12 bg-emerald-500/50" />
      <span className="absolute bottom-[20%] left-[12%] h-2 w-2 rounded-full bg-green-400/60" />
      <span className="absolute bottom-[16%] right-[16%] h-1.5 w-4 rotate-45 rounded-sm bg-amber-400/50" />
      <span className="absolute left-1/3 top-[12%] h-1 w-1.5 bg-emerald-500/45" />
    </div>
  );
}

function SuccessBadgeIcon() {
  return (
    <div className="relative mb-5 flex justify-center">
      <div className="flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-600 shadow-lg shadow-emerald-400/35 ring-4 ring-white">
        <svg viewBox="0 0 24 24" className="h-9 w-9 text-white" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
    </div>
  );
}

function CelebrationPanel({ eyebrow, title, children }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-emerald-200/80 bg-gradient-to-b from-emerald-50/90 via-white to-white px-6 py-9 shadow-sm sm:px-10 sm:py-11">
      <CelebrationConfetti />
      <div className="relative mx-auto max-w-md text-center">
        <SuccessBadgeIcon />
        {eyebrow ? <p className="text-sm font-medium text-emerald-700/90">{eyebrow}</p> : null}
        <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{title}</h2>
        {children ? <div className="mt-5 space-y-4 text-center">{children}</div> : null}
      </div>
    </div>
  );
}

function AuthGatePanel({ title, description }) {
  return (
    <div className="rounded-2xl border border-sky-200/90 bg-gradient-to-b from-sky-50/50 to-white px-6 py-8 text-center shadow-sm sm:px-8 sm:py-9">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">{description}</p>
    </div>
  );
}

function SubscribeGatePanel({ title, description }) {
  return (
    <div className="rounded-2xl border border-violet-200/90 bg-gradient-to-b from-violet-50/40 to-white px-6 py-8 text-center shadow-sm sm:px-8 sm:py-9">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">{description}</p>
    </div>
  );
}

function ProblemPanel({ title, description, hint, variant }) {
  const isError = variant === "error";
  return (
    <div
      className={cn(
        "rounded-2xl border px-6 py-8 text-center shadow-sm sm:px-8 sm:py-9",
        isError
          ? "border-rose-200/90 bg-gradient-to-b from-rose-50/50 to-white"
          : "border-amber-200/90 bg-gradient-to-b from-amber-50/45 to-white",
      )}
    >
      <div
        className={cn(
          "mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl",
          isError ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800",
        )}
      >
        {isError ? (
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        )}
      </div>
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">{description}</p>
      {hint ? <p className="mt-3 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

function Divider() {
  return <div className="my-8 border-t border-dashed border-slate-200" />;
}

function VideoLibraryPrimaryCta({ label, hint }) {
  return (
    <Link
      href="/videouri"
      className="group flex w-full flex-col items-center justify-center gap-1.5 rounded-2xl bg-gradient-to-r from-emerald-600 via-emerald-600 to-teal-600 px-6 py-5 text-center shadow-lg shadow-emerald-900/15 ring-2 ring-white/30 transition hover:from-emerald-500 hover:via-emerald-500 hover:to-teal-500 hover:shadow-emerald-800/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 sm:py-6"
    >
      <span className="inline-flex items-center gap-2 text-base font-semibold tracking-tight text-white sm:text-lg">
      
        {label}
      </span>
      {hint ? (
        <span className="max-w-md px-1 text-sm font-medium leading-snug text-emerald-50/95">{hint}</span>
      ) : null}
    </Link>
  );
}

/** Section chrome + eyebrow accents by flow */
function sectionClassForVariant(v) {
  switch (v) {
    case "success":
      return "border-emerald-200/80 bg-gradient-to-br from-emerald-50/35 via-white to-white shadow-[0_1px_12px_-4px_rgb(16_185_129_/_0.2)]";
    case "auth":
      return "border-sky-200/70 bg-gradient-to-br from-sky-50/20 via-white to-white";
    case "subscribe":
      return "border-violet-200/75 bg-gradient-to-br from-violet-50/30 via-white to-white";
    case "cancelled":
      return "border-amber-200/80 bg-gradient-to-br from-amber-50/25 via-white to-white";
    case "error":
      return "border-rose-200/85 bg-gradient-to-br from-rose-50/30 via-white to-white";
    case "member":
    default:
      return "border-slate-200 bg-white";
  }
}

function eyebrowClassForVariant(v) {
  switch (v) {
    case "success":
      return "text-emerald-700";
    case "auth":
      return "text-sky-800";
    case "subscribe":
      return "text-violet-700";
    case "cancelled":
      return "text-amber-800";
    case "error":
      return "text-rose-700";
    case "member":
    default:
      return "text-indigo-600";
  }
}

function eyebrowLabelForVariant(v, t, { activationPending, guestSuccessPresentation }) {
  switch (v) {
    case "success":
      if (activationPending) return t("premiumUiTagWaiting");
      if (guestSuccessPresentation) return t("premiumCheckoutSuccessGuestEyebrow");
      return t("premiumUiTagSuccess");
    case "auth":
      return t("premiumUiTagSignIn");
    case "subscribe":
      return t("premiumUiTagSubscribe");
    case "cancelled":
    case "error":
      return t("premiumUiTagIssue");
    case "member":
    default:
      return t("premiumUiTagMember");
  }
}

export default function PremiumZonePage() {
  const { t } = useTranslation("common");
  const router = useRouter();
  const { currentUser, userData, loading, setUserData, isGuestUser } = useAuth();

  const [designPreviewHostsOk, setDesignPreviewHostsOk] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const h = window.location.hostname;
    setDesignPreviewHostsOk(h === "localhost" || h === "127.0.0.1");
  }, []);

  const checkout = normalizeQuery(router.query.checkout);
  const checkoutSuccess = checkout === "success";
  const checkoutCancel = checkout === "cancel";
  const errorQuery = normalizeQuery(router.query.error);
  const hasUrlError = Boolean(errorQuery && errorQuery.length > 0);

  const previewQueryEnabled =
    normalizeTruthyQuery(router.query.premiumSuccessPreview) ||
    normalizeTruthyQuery(router.query.preview);
  /** Local design preview: npm run dev, sau next start pe localhost, sau .env NEXT_PUBLIC_PREMIUM_SUCCESS_PREVIEW=true */
  const isPremiumSuccessDesignPreview =
    previewQueryEnabled &&
    (process.env.NODE_ENV === "development" ||
      designPreviewHostsOk ||
      process.env.NEXT_PUBLIC_PREMIUM_SUCCESS_PREVIEW === "true");
  const devForcedGuestSuccess = isPremiumSuccessDesignPreview && checkoutSuccess;

  React.useEffect(() => {
    if (!checkoutSuccess) return;
    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 12;
    const POLL_INTERVAL_MS = 2500;

    const poll = async () => {
      if (cancelled) return;
      attempts += 1;
      const profile = await handleGetUserInfoJobs();
      if (cancelled) return;
      if (profile) {
        setUserData(profile);
        if (hasPremiumAccess(profile)) return; // access confirmed — stop polling
      }
      if (attempts < MAX_ATTEMPTS) {
        setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    poll();
    return () => {
      cancelled = true;
    };
  }, [checkoutSuccess, setUserData]);

  const access = hasPremiumAccess(userData);
  const activationPending =
    checkoutSuccess && !devForcedGuestSuccess && currentUser && !isGuestUser && !access;
  const showLocked = currentUser && !isGuestUser && !access && !activationPending;
  const showGuest = !currentUser || isGuestUser;
  const guestSuccessPresentation = checkoutSuccess && (showGuest || devForcedGuestSuccess);
  const compactSuccessHero = access && checkoutSuccess && !devForcedGuestSuccess;

  let uiVariant = "member";
  if (!router.isReady) {
    uiVariant = "loading";
  } else if (loading && !devForcedGuestSuccess) {
    uiVariant = "loading";
  } else if (hasUrlError) {
    uiVariant = "error";
  } else if (checkoutCancel) {
    uiVariant = "cancelled";
  } else if (checkoutSuccess) {
    uiVariant = "success";
  } else if (showGuest) {
    uiVariant = "auth";
  } else if (showLocked) {
    uiVariant = "subscribe";
  }

  const loginHref = `/login?returnUrl=${encodeURIComponent(router.asPath || "/premium")}`;
  const sectionClass = sectionClassForVariant(uiVariant === "loading" ? "member" : uiVariant);
  const eyebrowClass = eyebrowClassForVariant(uiVariant === "loading" ? "member" : uiVariant);

  const leftEyebrow = eyebrowLabelForVariant(uiVariant === "loading" ? "member" : uiVariant, t, {
    activationPending,
    guestSuccessPresentation,
  });

  const leftTitleAndBody = (() => {
    if (uiVariant === "error") {
      return {
        title: t("premiumPageErrorTitle"),
        body: t("premiumPageErrorBody"),
      };
    }
    if (uiVariant === "cancelled") {
      return {
        title: t("premiumCheckoutCancelledTitle"),
        body: t("premiumCheckoutCancelledBody"),
      };
    }
    if (compactSuccessHero) {
      return {
        title: t("premiumZoneHeading"),
        body: t("premiumCheckoutSuccessActivated"),
      };
    }
    if (uiVariant === "success" && guestSuccessPresentation) {
      return {
        title: t("premiumCheckoutSuccessGuestTitle"),
        body: devForcedGuestSuccess
          ? t("premiumDesignPreviewPaidBody")
          : t("premiumCheckoutSuccessGuestBody"),
      };
    }
    if (uiVariant === "success" && activationPending) {
      return {
        title: t("premiumCheckoutSuccessTitle"),
        body: t("premiumCheckoutProcessing"),
      };
    }
    if (uiVariant === "success" && access) {
      return {
        title: t("premiumCheckoutSuccessTitle"),
        body: t("premiumCheckoutSuccessActivated"),
      };
    }
    if (uiVariant === "auth") {
      return {
        title: t("premiumLockedTitle"),
        body: t("premiumLoginPrompt"),
      };
    }
    if (uiVariant === "subscribe") {
      return {
        title: t("premiumLockedTitle"),
        body: t("premiumLockedDescription"),
      };
    }
    return {
      title: t("premiumZoneHeading"),
      body: t("premiumZoneDescription"),
    };
  })();

  return (
    <>
      <Head>
        <title>{t("premiumZoneTitle")} | Cristina Zurba</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>

      <AuthFunnelShell mainVerticalAlign="start" mainClassName="pb-10 sm:pb-12">
        {!router.isReady || (loading && !devForcedGuestSuccess) ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white py-16 text-center shadow-sm">
            <span className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-sky-600" aria-hidden />
            <p className="mt-4 text-sm font-medium text-slate-600">{t("premiumPageLoading")}</p>
          </div>
        ) : (
          <>
          <section
            className={cn(
              "rounded-2xl border px-6 py-8 shadow-sm sm:px-8 sm:py-10 lg:grid lg:grid-cols-2 lg:gap-x-10 lg:gap-y-6 lg:px-10 lg:py-10 xl:gap-x-14 xl:px-12",
              sectionClass,
            )}
          >
            <div
              className={cn(
                "flex flex-col",
                checkoutSuccess
                  ? "items-center text-center"
                  : "items-center text-center lg:items-start lg:text-left",
              )}
            >
              <Image
                src="/LogoPngTransparent.png"
                width={120}
                height={120}
                alt=""
                className="mb-4 h-20 w-20 object-contain sm:h-24 sm:w-24 lg:h-28 lg:w-28"
                priority
              />
              <p className={cn("text-xs font-semibold uppercase tracking-[0.18em]", eyebrowClass)}>{leftEyebrow}</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl lg:text-[1.65rem] xl:text-3xl">
                {leftTitleAndBody.title}
              </h1>
              <p
                className={cn(
                  "mt-3 max-w-md text-sm leading-relaxed text-slate-600",
                  checkoutSuccess ? "lg:mx-auto" : "lg:max-w-none",
                )}
              >
                {leftTitleAndBody.body}
              </p>
              {access && checkoutSuccess ? (
                <div className="mt-4 flex w-full max-w-md flex-col items-center gap-2 text-center text-sm leading-relaxed text-slate-600 lg:mx-auto">
                  <p>{t("premiumCheckoutSuccessActivatedHint")}</p>
                  <p>{t("premiumVideoLibraryIntro")}</p>
                </div>
              ) : null}
              {(uiVariant === "error" || uiVariant === "cancelled") && errorQuery ? (
                <p className="mt-3 break-all font-mono text-[11px] text-slate-400">
                  code: <span className="text-slate-600">{errorQuery}</span>
                </p>
              ) : null}
            </div>

            <div className="mt-8 min-h-0 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0">
              {uiVariant === "error" ? (
                <div className="space-y-4">
                  <ProblemPanel
                    variant="error"
                    title={t("premiumPageErrorTitle")}
                    description={t("premiumPageErrorBody")}
                  />
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <SubscriptionRecurringNotice />
                    <Link
                      href="/abonament"
                      className="flex flex-1 items-center justify-center rounded-xl bg-slate-900 px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-slate-800"
                    >
                      {t("premiumLockedCta")}
                    </Link>
                    <Link
                      href="/premium"
                      className="flex flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-center text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
                    >
                      {t("premiumZoneTitle")}
                    </Link>
                  </div>
                </div>
              ) : uiVariant === "cancelled" ? (
                <div className="space-y-4">
                  <ProblemPanel
                    variant="cancelled"
                    title={t("premiumCheckoutCancelledTitle")}
                    description={t("premiumCheckoutCancelledBody")}
                    hint={t("premiumCheckoutCancelledHint")}
                  />
                  <SubscriptionRecurringNotice />
                  <Link
                    href="/abonament"
                    className="flex w-full items-center justify-center rounded-xl bg-slate-900 px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-slate-800"
                  >
                    {t("premiumCheckoutCancelledBackCta")}
                  </Link>
                </div>
              ) : uiVariant === "auth" ? (
                <div className="space-y-5">
                  <AuthGatePanel title={t("premiumLockedTitle")} description={t("premiumLoginPrompt")} />
                  <Link
                    href={loginHref}
                    className="flex w-full items-center justify-center rounded-xl bg-sky-900 px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-800"
                  >
                    {t("premiumLoginCta")}
                  </Link>
                </div>
              ) : uiVariant === "subscribe" ? (
                <div className="space-y-5">
                  <SubscribeGatePanel title={t("premiumLockedTitle")} description={t("premiumLockedDescription")} />
                  <SubscriptionRecurringNotice />
                  <Link
                    href="/abonament"
                    className="flex w-full items-center justify-center rounded-xl bg-violet-700 px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-600"
                  >
                    {t("premiumLockedCta")}
                  </Link>
                </div>
              ) : uiVariant === "success" && guestSuccessPresentation ? (
                <div className="space-y-5">
                  <CelebrationPanel
                    eyebrow={t("premiumCheckoutSuccessGuestEyebrow")}
                    title={t("premiumCheckoutSuccessGuestTitle")}
                  />
                  {devForcedGuestSuccess ? (
                    <p className="text-center text-xs text-slate-500">{t("premiumDesignPreviewHint")}</p>
                  ) : (
                    <Link
                      href={loginHref}
                      className="flex w-full items-center justify-center rounded-xl bg-emerald-800 px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
                    >
                      {t("premiumLoginCta")}
                    </Link>
                  )}
                </div>
              ) : uiVariant === "success" && activationPending ? (
                <div className="space-y-5">
                  <CelebrationPanel
                    eyebrow={t("premiumCheckoutSuccessEyebrow")}
                    title={t("premiumCheckoutSuccessTitle")}
                  >
                    <p className="text-center text-sm leading-relaxed text-slate-600">{t("premiumCheckoutProcessing")}</p>
                    <button
                      type="button"
                      onClick={() => window.location.reload()}
                      className="mt-4 w-full rounded-xl border border-emerald-200/80 bg-white px-4 py-3 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-50/80"
                    >
                      {t("premiumReloadPageCta")}
                    </button>
                  </CelebrationPanel>
                </div>
              ) : access ? (
                <div className="space-y-0">
                  {checkoutSuccess ? (
                    <CelebrationPanel
                      eyebrow={t("premiumCheckoutSuccessEyebrow")}
                      title={t("premiumCheckoutSuccessTitle")}
                    />
                  ) : (
                    <p className="mb-6 border-b border-slate-100 pb-6 text-sm text-slate-600">{t("premiumZoneDescription")}</p>
                  )}
                </div>
              ) : null}
            </div>

            {access && !checkoutSuccess ? (
              <ul className="-mt-2 hidden flex-col gap-2 text-sm text-slate-600 lg:col-start-1 lg:row-start-2 lg:flex">
                <li className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" aria-hidden />
                  <span>{t("premiumVideoLibraryIntro")}</span>
                </li>
                <li className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" aria-hidden />
                  <span>{t("premiumZoneDescription")}</span>
                </li>
              </ul>
            ) : null}
          </section>
          {access ? <PremiumZoneVideoSpotlight locale={router.locale || "ro"} /> : null}
          </>
        )}
      </AuthFunnelShell>
    </>
  );
}
