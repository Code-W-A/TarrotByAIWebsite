import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import BillingDetailsForm from "../../../components/BillingDetailsForm";
import {
  createInitialBillingFormValues,
  buildCourseBillingDetails,
} from "../../../utils/billingAddressData.mjs";
import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { useAuth } from "../../../context/AuthContext";
import styles from "../../../components/Ebooks/Detail.module.css";
import { ebookRequest, ebookText as t } from "../../../components/Ebooks/api";
export default function EbookDetail() {
  const router = useRouter();
  const { ebookId, checkout } = router.query;
  const { currentUser } = useAuth();
  const [book, setBook] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [promoEnabled, setPromoEnabled] = useState(false);
  const [code, setCode] = useState("");
  const [promoBusy, setPromoBusy] = useState(false);
  const [billingOpen, setBillingOpen] = useState(false);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const metadataVersion = useRef(0);
  const userRef = useRef(currentUser);
  userRef.current = currentUser;
  const customer = Boolean(currentUser && !currentUser.isAnonymous);
  function login() {
    const returnUrl = `${router.locale && router.locale !== "ro" ? "/" + router.locale : ""}${router.asPath}`;
    router.push({ pathname: "/login/videoteca", query: { returnUrl } });
  }
  useEffect(() => {
    let active = true;
    ebookRequest("/config")
      .then((c) => {
        if (active) {
          setBillingEnabled(c.enabled && c.websiteBilling);
          setPromoEnabled(Boolean(c.enabled && c.promoEnabled));
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const [billing, setBilling] = useState(() =>
    createInitialBillingFormValues(),
  );
  const [contact, setContact] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
  });
  async function reload() {
    if (!ebookId) return;
    const gen = generation.current;
    const version = ++metadataVersion.current;
    try {
      const p = await ebookRequest(
        `/${ebookId}?locale=${router.locale || "ro"}`,
        currentUser,
        { timeoutMs: 20000 },
      );
      if (
        gen !== generation.current ||
        version !== metadataVersion.current ||
        userRef.current?.uid !== currentUser?.uid
      )
        return null;
      setBook(p);
      return p;
    } catch (error) {
      if (gen === generation.current && version === metadataVersion.current)
        throw error;
      return null;
    }
  }

  useEffect(() => {
    let active = true;
    generation.current++;
    const version = ++metadataVersion.current;
    setCode("");
    setPromoBusy(false);
    setBillingOpen(false);
    setBusy(false);
    setBook(null);
    setMessage("");
    if (ebookId)
      ebookRequest(`/${ebookId}?locale=${router.locale || "ro"}`, currentUser, {
        timeoutMs: 20000,
      })
        .then((p) => {
          if (active && version === metadataVersion.current) setBook(p);
        })
        .catch((e) => {
          if (active) setMessage(e.message);
        });
    return () => {
      active = false;
      generation.current++;
    };
  }, [ebookId, router.locale, currentUser?.uid, currentUser?.isAnonymous]);
  useEffect(() => {
    if (checkout !== "success" || !currentUser || !ebookId) return;
    let active = true;
    let attempts = 0;
    let timer;
    async function poll() {
      try {
        const p = await reload();
        if (!active || !p) return;
        if (p.owned) {
          setMessage("");
          return;
        }
        setMessage(
          t(
            router.locale,
            "Se verifică achiziția. Poți reîncerca verificarea.",
            "Verifying your purchase. You can retry.",
          ),
        );
      } catch (e) {
        if (active) setMessage(e.message);
      }
      if (active && ++attempts < 6) timer = setTimeout(poll, 2000);
    }
    poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [checkout, currentUser?.uid, ebookId]);
  async function buy() {
    if (!customer) {
      login();
      setMessage(
        t(
          router.locale,
          "Autentifică-te înainte de cumpărare.",
          "Sign in before purchasing.",
        ),
      );
      return;
    }
    if (inFlight.current) return;
    if (!billingOpen) {
      setBillingOpen(true);
      return;
    }
    inFlight.current = true;
    const gen = generation.current;
    setBusy(true);
    try {
      const p = await ebookRequest(
        `/${ebookId}/checkout?locale=${router.locale || "ro"}`,
        currentUser,
        {
          method: "POST",
          timeoutMs: 20000,
          body: JSON.stringify({
            billingDetails: buildCourseBillingDetails({
              billingValues: billing,
              ...contact,
              email: contact.email || currentUser.email || "",
              individualAddress: billing.billingAddress,
            }),
          }),
        },
      );
      if (
        gen === generation.current &&
        userRef.current?.uid === currentUser.uid
      )
        window.location.assign(p.url);
    } catch (e) {
      if (gen === generation.current) setMessage(e.message);
    } finally {
      inFlight.current = false;
      if (gen === generation.current) setBusy(false);
    }
  }
  async function redeem(event) {
    event.preventDefault();
    if (!customer) {
      login();
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    const gen = generation.current;
    setPromoBusy(true);
    setMessage("");
    try {
      const result = await ebookRequest(
        `/${ebookId}/redeem?locale=${router.locale || "ro"}`,
        currentUser,
        { method: "POST", body: JSON.stringify({ code }), timeoutMs: 20000 },
      );
      if (
        gen !== generation.current ||
        userRef.current?.uid !== currentUser.uid
      )
        return;
      if (!result.owned) throw new Error("Accesul nu a fost confirmat.");
      metadataVersion.current++;
      setBook((previous) =>
        previous ? { ...previous, owned: true } : previous,
      );
      setCode("");
      setBillingOpen(false);
      setMessage(
        t(
          router.locale,
          "Acces activat. Poți citi cartea pe site și în aplicație.",
          "Access activated. Read on the website and in the app.",
        ),
      );
    } catch (error) {
      if (gen === generation.current) setMessage(error.message);
    } finally {
      inFlight.current = false;
      if (gen === generation.current) setPromoBusy(false);
    }
  }
  useEffect(() => {
    const refresh = () => {
      if (customer && document.visibilityState === "visible")
        reload().catch(() => {});
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [ebookId, router.locale, currentUser?.uid, currentUser?.isAnonymous]);
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/ebooks">← {t(router.locale, "Ebookuri", "Ebooks")}</Link>
        <Link href="/ebooks/mine">
          {t(router.locale, "Cărțile mele", "My books")}
        </Link>
      </header>
      <div className={styles.container}>
        {message && (
          <p className={styles.notice} role="status">
            {message}
          </p>
        )}
        {book ? (
          <>
            <section
              className={styles.hero}
              dir={["ar", "he"].includes(book.language) ? "rtl" : "ltr"}
            >
              <div className={styles.cover}>
                {book.coverUrl ? (
                  <img src={book.coverUrl} alt={book.title} />
                ) : (
                  <span aria-hidden="true">▤</span>
                )}
              </div>
              <div className={styles.info}>
                <span className={styles.eyebrow}>
                  {t(
                    router.locale,
                    "Biblioteca ta digitală",
                    "Your digital library",
                  )}
                </span>
                <h1>{book.title}</h1>
                <p className={styles.description}>{book.description}</p>
                {book.fallback && (
                  <p className={styles.muted}>
                    {t(
                      router.locale,
                      "Traducerea nu este încă publicată. Se afișează româna.",
                      "Translation unavailable. Showing Romanian.",
                    )}
                  </p>
                )}
                <p className={styles.price}>
                  {new Intl.NumberFormat(router.locale || "ro", {
                    style: "currency",
                    currency: book.currency,
                  }).format(book.price)}
                </p>
                <p className={styles.muted}>
                  {t(
                    router.locale,
                    "Aceeași carte, toate traducerile publicate, pe site și în aplicație.",
                    "One book, all published translations, on web and mobile.",
                  )}
                </p>
                {book.owned && customer ? (
                  <Link
                    className={styles.primary}
                    href={`/ebooks/${book.id}/read`}
                  >
                    {t(router.locale, "Citește cartea", "Read book")} →
                  </Link>
                ) : (
                  <button
                    className={styles.primary}
                    disabled={busy || promoBusy || !billingEnabled}
                    onClick={buy}
                  >
                    {billingEnabled
                      ? t(router.locale, "Cumpără ebookul", "Buy ebook")
                      : t(
                          router.locale,
                          "Plata nu este disponibilă",
                          "Purchase unavailable",
                        )}
                  </button>
                )}
                <button
                  className={styles.secondary}
                  disabled={busy || promoBusy}
                  onClick={() =>
                    customer
                      ? reload().catch((e) => setMessage(e.message))
                      : login()
                  }
                >
                  {t(router.locale, "Verifică accesul", "Check access")}
                </button>
                {!book.owned && promoEnabled && (
                  <section className={styles.promo}>
                    <h2>
                      {t(
                        router.locale,
                        "Ai un cod promoțional?",
                        "Have a promotional code?",
                      )}
                    </h2>
                    <p>
                      {t(
                        router.locale,
                        "Activează accesul la această carte în contul tău.",
                        "Activate this book in your account.",
                      )}
                    </p>
                    {customer ? (
                      <form onSubmit={redeem}>
                        <label htmlFor="ebook-promo">
                          {t(
                            router.locale,
                            "Cod promoțional",
                            "Promotional code",
                          )}
                        </label>
                        <div className={styles.codeRow}>
                          <input
                            id="ebook-promo"
                            type="text"
                            autoComplete="off"
                            autoCapitalize="none"
                            spellCheck={false}
                            maxLength={256}
                            value={code}
                            disabled={promoBusy || busy}
                            onChange={(e) => setCode(e.target.value)}
                            required
                          />
                          <button
                            className={styles.primary}
                            disabled={promoBusy || busy || !code.trim()}
                          >
                            {promoBusy
                              ? t(router.locale, "Se activează…", "Activating…")
                              : t(
                                  router.locale,
                                  "Activează accesul",
                                  "Activate access",
                                )}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <button className={styles.primary} onClick={login}>
                        {t(
                          router.locale,
                          "Autentifică-te pentru a introduce codul",
                          "Sign in to enter your code",
                        )}
                      </button>
                    )}
                  </section>
                )}
              </div>
            </section>
            {!book.owned && customer && billingEnabled && billingOpen ? (
              <section
                style={{
                  marginBlock: 24,
                  padding: 18,
                  border: "1px solid #ddd",
                  borderRadius: 12,
                }}
              >
                <h2>
                  {t(router.locale, "Date de facturare", "Billing details")}
                </h2>
                {["firstName", "lastName", "email", "phone"].map((field, i) => (
                  <label
                    key={field}
                    style={{ display: "block", marginBottom: 12 }}
                  >
                    {router.locale === "ro"
                      ? ["Prenume", "Nume", "Email", "Telefon"][i]
                      : ["First name", "Last name", "Email", "Phone"][i]}
                    <input
                      style={{ display: "block", padding: 10, width: "100%" }}
                      type={
                        field === "email"
                          ? "email"
                          : field === "phone"
                            ? "tel"
                            : "text"
                      }
                      value={contact[field]}
                      onChange={(e) =>
                        setContact((v) => ({ ...v, [field]: e.target.value }))
                      }
                    />
                  </label>
                ))}
                <BillingDetailsForm
                  billingValues={billing}
                  onBillingChange={(field, value) =>
                    setBilling((v) => ({ ...v, [field]: value }))
                  }
                  individualAddressValue={billing.billingAddress}
                  onIndividualAddressChange={(value) =>
                    setBilling((v) => ({ ...v, billingAddress: value }))
                  }
                  hidePersonalCnp
                  disabled={busy || promoBusy}
                />
              </section>
            ) : null}

            {!book.owned && customer && billingEnabled && billingOpen && (
              <button
                className={styles.primary}
                onClick={buy}
                disabled={busy || promoBusy}
              >
                {busy
                  ? t(
                      router.locale,
                      "Se pregătește plata…",
                      "Preparing checkout…",
                    )
                  : t(
                      router.locale,
                      "Continuă la plată",
                      "Continue to checkout",
                    )}
              </button>
            )}
            <section
              className={styles.contents}
              dir={["ar", "he"].includes(book.language) ? "rtl" : "ltr"}
            >
              <span className={styles.eyebrow}>
                {t(router.locale, "În această carte", "Inside this book")}
              </span>
              <h2>{t(router.locale, "Cuprins", "Contents")}</h2>
              <ol>
                {book.chapters.map((chapter, i) => (
                  <li key={chapter._key}>
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    {chapter.title}
                  </li>
                ))}
              </ol>
            </section>
          </>
        ) : (
          <p role="status">
            {message
              ? t(
                  router.locale,
                  "Cartea nu poate fi afișată.",
                  "This book could not be displayed.",
                )
              : t(router.locale, "Se încarcă…", "Loading…")}
          </p>
        )}
      </div>
    </main>
  );
}

export async function getServerSideProps({ locale }) {
  return {
    props: { ...(await serverSideTranslations(locale || "ro", ["common"])) },
  };
}
