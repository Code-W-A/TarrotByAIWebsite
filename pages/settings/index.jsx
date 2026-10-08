import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/router";
import { handleLogout } from "../../utils/authUtils";
import { useAuth } from "../../context/AuthContext";
import Header from "../../components/Header";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import { useTranslation } from "next-i18next";
import Head from "next/head";
import { getFirebaseBearerHeader } from "../../utils/firebaseAuthHeaders";
import PremiumRenewalControls from "../../components/settings/PremiumRenewalControls";

function Copyright() {
  return (
    <div style={styles.copyrightContainer}>
      <p style={styles.copyrightText}>
        {"Copyright © "}
        <span>Cristina Zurba</span> {new Date().getFullYear()}
        {"."}
      </p>
      <p style={styles.copyrightText}>
        {"dezvoltat de "}
        <Link href="https://webappdynamicx.ro/" style={styles.copyrightLink}>
          Web App Dynamicx
        </Link>{" "}
        {"."}
      </p>
    </div>
  );
}

function IconShieldUser({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 21s-8-4.434-8-11a8 8 0 0116 0c0 6.566-8 11-8 11z"
      />
      <circle cx="12" cy="10" r="2.75" />
    </svg>
  );
}

function IconDocument({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6M7 21h10a2 2 0 002-2V7l-4-4H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  );
}

function IconSpark({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2 8h8l-6 6 3 13-11-9-11 9 3-13z" />
    </svg>
  );
}

function IconCredit({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h5M7 18h10M7 21h13a4 4 0 004-4V7a4 4 0 00-4-4H7a4 4 0 00-4 4v13a4 4 0 004 4z" />
    </svg>
  );
}

function IconBook({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 20l-7-4V6l7 4 7-4v10l-7 4z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 12V4m0 8l7-4M5 16l7-4" />
    </svg>
  );
}

function IconClock({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <circle cx="12" cy="12" r="8.25" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l2.25 2.25" />
    </svg>
  );
}

function IconAcademic({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M4 11l8-5 8 5-8 5-8-5zM9 13v6l3 1 3-1v-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconStripe({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 11V7m4 14l-8-9v5H5l8 9v-5h4z" />
    </svg>
  );
}

const tileCardClass =
  "group flex h-full min-h-[132px] w-full flex-col items-start gap-3 rounded-2xl border border-slate-200/90 bg-white p-5 text-left shadow-sm outline-none ring-slate-200/80 transition hover:border-indigo-200 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600";

const iconWrapClass = "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700";

export async function getServerSideProps({ locale }) {
  return {
    props: {
      ...(await serverSideTranslations(locale, ["common"])),
    },
  };
}

export default function SettingsHubPage() {
  const {
    currentUser,
    isGuestUser,
    setAsGuestUser,
    setUserData,
    userData,
    setCurrentUser,
  } = useAuth();
  const [message, setMessage] = React.useState("");
  const [showSnackback, setShowSnackback] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [portalLoading, setPortalLoading] = React.useState(false);
  const { t } = useTranslation("common");
  const router = useRouter();

  const openBillingPortal = React.useCallback(
    async (flow = "default") => {
      setPortalLoading(true);
      try {
        const headers = await getFirebaseBearerHeader({ required: true });
        const res = await fetch("/api/stripe/premium/create-portal-session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...headers,
          },
          body: JSON.stringify({ flow }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || t("premiumManageError"));
        }
        if (data?.url) {
          window.location.href = data.url;
        } else {
          throw new Error(t("premiumManageError"));
        }
      } catch (err) {
        console.error("[settings] billing_portal", err);
        setMessage(err.message || t("premiumManageError"));
        setShowSnackback(true);
      } finally {
        setPortalLoading(false);
      }
    },
    [t],
  );

  const displayName = React.useMemo(() => {
    const fn = `${userData?.first_name || ""} ${userData?.last_name || ""}`.trim();
    if (fn) return fn;
    return currentUser?.displayName?.trim() || t("myAccount");
  }, [userData?.first_name, userData?.last_name, currentUser?.displayName, t]);

  const heroEmail = currentUser?.email || userData?.email || "";

  const profileInitial = React.useMemo(() => {
    const c = displayName.trim().charAt(0) || heroEmail.trim().charAt(0);
    return c ? c.toUpperCase() : "?";
  }, [displayName, heroEmail]);

  const handleSubmitGuest = (event) => {
    if (event) event.preventDefault();
  };

  const tileConfigs = React.useMemo(() => {
    const stripeOk = Boolean(userData?.stripeCustomerId);
    const list = [
      {
        id: "profile",
        type: "link",
        href: "/settings/cont",
        titleKey: "settingsTileProfileTitle",
        descKey: "settingsTileProfileDesc",
        Icon: IconShieldUser,
      },
      {
        id: "billing",
        type: "link",
        href: "/settings/facturare",
        titleKey: "settingsTileBillingTitle",
        descKey: "settingsTileBillingDesc",
        Icon: IconDocument,
      },
      {
        id: "premium",
        type: "link",
        href: "/premium",
        titleKey: "settingsTilePremiumZoneTitle",
        descKey: "settingsTilePremiumZoneDesc",
        Icon: IconSpark,
      },
      {
        id: "subscribe",
        type: "link",
        href: "/abonament",
        titleKey: "settingsTileSubscribeTitle",
        descKey: "settingsTileSubscribeDesc",
        Icon: IconCredit,
      },
      {
        id: "histPers",
        type: "link",
        href: "/istoric-citiri-personalizate",
        titleKey: "settingsTileHistoryPersTitle",
        descKey: "settingsTileHistoryPersDesc",
        Icon: IconBook,
      },
      {
        id: "histFuture",
        type: "link",
        href: "/istoric-citiri-viitor",
        titleKey: "settingsTileHistoryFutureTitle",
        descKey: "settingsTileHistoryFutureDesc",
        Icon: IconClock,
      },
      {
        id: "courses",
        type: "link",
        href: "/courses/purchased",
        titleKey: "settingsTileCoursesTitle",
        descKey: "settingsTileCoursesDesc",
        Icon: IconAcademic,
      },
    ];
    if (stripeOk) {
      list.push({
        id: "stripe",
        type: "stripe",
        titleKey: "settingsTileStripeTitle",
        descKey: "settingsTileStripeDesc",
        Icon: IconStripe,
      });
    }
    return list;
  }, [userData?.stripeCustomerId]);

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const visibleTiles = React.useMemo(() => {
    return tileConfigs.filter((tile) => {
      const title = t(tile.titleKey);
      const desc = t(tile.descKey);
      if (!normalizedQuery) return true;
      const hay = `${title} ${desc}`.toLowerCase();
      return hay.includes(normalizedQuery);
    });
  }, [tileConfigs, t, normalizedQuery]);

  const renderTile = (tile) => {
    const title = t(tile.titleKey);
    const desc = t(tile.descKey);
    const Icon = tile.Icon;
    const inner = (
      <>
        <span className={iconWrapClass}>
          <Icon className="h-6 w-6" />
        </span>
        <span className="font-semibold text-slate-900">{title}</span>
        <span className="text-sm leading-snug text-slate-600">{desc}</span>
      </>
    );
    if (tile.type === "link") {
      return (
        <Link key={tile.id} href={tile.href} className={tileCardClass}>
          {inner}
        </Link>
      );
    }
    return (
      <button
        key={tile.id}
        type="button"
        disabled={portalLoading}
        onClick={() => openBillingPortal("default")}
        className={tileCardClass + (portalLoading ? " cursor-wait opacity-70" : "")}
      >
        {inner}
      </button>
    );
  };

  return (
    <>
      <Head>
        <title>Setări Cont | Cristina Zurba</title>
        <meta
          name="description"
          content="Gestionează setările contului tău pentru consultațiile spirituale cu Cristina Zurba."
        />
        <meta name="robots" content="noindex,nofollow" />
      </Head>

      <div className="min-h-screen bg-slate-50/80">
        <section>
          <Header isOnlySettngs={true} />
        </section>

        <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-[5.25rem] sm:pb-36 sm:pt-24">
          <div className="mb-4">
            <Link
              href="/"
              className="text-sm font-medium text-indigo-600 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-800"
            >
              ← {t("home")}
            </Link>
          </div>

          {isGuestUser ? (
            <div style={styles.guestContainer}>
              <div style={styles.logoContainer}>
                <Image
                  src="/LogoPngTransparent.png"
                  width={140}
                  height={140}
                  alt="Cristina Zurba Logo"
                />
              </div>
              <h1 style={styles.guestTitle}>{t("createAccountCTA")}</h1>
              <p style={styles.guestMessage}>{t("createAccountCTAMessage")}</p>
              <form onSubmit={handleSubmitGuest} style={styles.guestForm}>
                <button
                  onClick={() => {
                    handleLogout().then(() => {
                      setCurrentUser(null);
                      setUserData(null);
                      setAsGuestUser(false);
                      router.push("/login");
                    });
                  }}
                  type="submit"
                  style={styles.registerButton}
                >
                  {t("register")}
                </button>
                <div style={styles.copyrightSection}>
                  <Copyright />
                </div>
              </form>
            </div>
          ) : (
            <>
              <section className="relative mb-10 overflow-hidden rounded-3xl border border-sky-100/80 bg-gradient-to-br from-sky-100/90 via-white to-indigo-50/95 px-5 py-8 shadow-sm sm:px-8 sm:py-10">
                <div
                  className="pointer-events-none absolute inset-0 opacity-[0.18]"
                  aria-hidden
                  style={{
                    backgroundImage:
                      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' fill='none' viewBox='0 0 80 80'%3E%3Cpath stroke='%2393c5fd' stroke-width='1' d='M0 60h80M60 80V0'/%3E%3C/svg%3E\")",
                  }}
                />
                <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex min-w-0 flex-1 gap-4 sm:gap-5">
                    {userData?.photoURL ? (
                      <img
                        src={userData.photoURL}
                        alt=""
                        className="h-16 w-16 shrink-0 rounded-full object-cover ring-4 ring-white shadow-md sm:h-[4.25rem] sm:w-[4.25rem]"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xl font-bold text-indigo-800 ring-4 ring-white shadow-md sm:h-[4.25rem] sm:w-[4.25rem] sm:text-2xl">
                        {profileInitial}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
                        {displayName}
                      </p>
                      <p className="mt-0.5 truncate text-sm text-slate-600">{heroEmail}</p>
                      <Link
                        href="/settings/cont"
                        className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-indigo-700 hover:text-indigo-900"
                      >
                        {t("settingsHubGoToAccount")} →
                      </Link>
                    </div>
                  </div>
                  <div className="w-full lg:max-w-md lg:flex-1">
                    <label htmlFor="settings-hub-search" className="sr-only">
                      {t("settingsHubSearchPlaceholder")}
                    </label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden>
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                      </span>
                      <input
                        id="settings-hub-search"
                        type="search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={t("settingsHubSearchPlaceholder")}
                        className="w-full rounded-2xl border border-slate-200/90 bg-white py-3 pl-11 pr-4 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                      />
                    </div>
                  </div>
                </div>
              </section>

              <h2 className="mb-6 text-xl font-semibold text-slate-900">{t("settingsHubTitle")}</h2>

              {visibleTiles.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-slate-200 bg-white py-12 text-center text-sm text-slate-500">
                  {t("settingsHubNoResults")}
                </p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{visibleTiles.map(renderTile)}</div>
              )}

              <PremiumRenewalControls />

              <div className="mt-12 flex justify-center">
                <Copyright />
              </div>
            </>
          )}
        </main>
      </div>

      {showSnackback ? (
        <div className="fixed bottom-6 left-1/2 z-[1000] -translate-x-1/2 px-4">
          <div className="rounded-lg bg-sky-50 px-5 py-3 text-sm font-medium text-sky-900 shadow-lg ring-1 ring-sky-200">
            {message}
          </div>
        </div>
      ) : null}
    </>
  );
}

const styles = {
  guestContainer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-start",
    width: "100%",
    paddingTop: "10%",
    maxWidth: "480px",
    margin: "0 auto",
  },
  logoContainer: {
    textAlign: "center",
    marginBottom: "2rem",
  },
  guestTitle: {
    fontSize: "1.5rem",
    fontWeight: "600",
    color: "#333",
    textAlign: "center",
    marginBottom: "1rem",
  },
  guestMessage: {
    fontSize: "1rem",
    color: "#666",
    textAlign: "center",
    marginBottom: "2rem",
  },
  guestForm: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  registerButton: {
    width: "100%",
    padding: "15px 24px",
    marginBottom: "2rem",
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    border: "none",
    color: "white",
    borderRadius: "25px",
    fontSize: "16px",
    fontWeight: "600",
    cursor: "pointer",
    boxShadow: "0 4px 15px rgba(0, 0, 0, 0.1)",
  },
  copyrightSection: {
    marginTop: "2rem",
  },
  copyrightContainer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "0.5rem",
  },
  copyrightText: {
    fontSize: "12px",
    color: "#666",
    margin: "0",
    textAlign: "center",
  },
  copyrightLink: {
    color: "#667eea",
    textDecoration: "none",
  },
};
