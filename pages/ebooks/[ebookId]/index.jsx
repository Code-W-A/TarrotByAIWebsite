import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import BillingDetailsForm from "../../../components/BillingDetailsForm";
import {
  createInitialBillingFormValues,
  buildCourseBillingDetails,
} from "../../../utils/billingAddressData.mjs";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { useAuth } from "../../../context/AuthContext";
import EbookLayout from "../../../components/Ebooks/Layout";
import { ebookRequest, ebookText as t } from "../../../components/Ebooks/api";
export default function EbookDetail() {
  const router = useRouter();
  const { ebookId, checkout } = router.query;
  const { currentUser } = useAuth();
  const [book, setBook] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [billingEnabled, setBillingEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    ebookRequest("/config")
      .then((c) => {
        if (active) setBillingEnabled(c.enabled && c.websiteBilling);
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
    const p = await ebookRequest(
      `/${ebookId}?locale=${router.locale || "ro"}`,
      currentUser,
    );
    setBook(p);
    return p;
  }
  useEffect(() => {
    let active = true;
    setBook(null);
    setMessage("");
    if (ebookId)
      ebookRequest(`/${ebookId}?locale=${router.locale || "ro"}`, currentUser)
        .then((p) => {
          if (active) setBook(p);
        })
        .catch((e) => {
          if (active) setMessage(e.message);
        });
    return () => {
      active = false;
    };
  }, [ebookId, router.locale, currentUser?.uid]);
  useEffect(() => {
    if (checkout !== "success" || !currentUser || !ebookId) return;
    let active = true;
    let attempts = 0;
    let timer;
    async function poll() {
      try {
        const p = await reload();
        if (!active) return;
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
    if (!currentUser) {
      setMessage(
        t(
          router.locale,
          "Autentifică-te înainte de cumpărare.",
          "Sign in before purchasing.",
        ),
      );
      return;
    }
    setBusy(true);
    try {
      const p = await ebookRequest(
        `/${ebookId}/checkout?locale=${router.locale || "ro"}`,
        currentUser,
        {
          method: "POST",
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
      window.location.assign(p.url);
    } catch (e) {
      setMessage(e.message);
      setBusy(false);
    }
  }
  return (
    <EbookLayout>
      <p role="status">{message}</p>
      {book && (
        <>
          <img
            src={book.coverUrl || undefined}
            alt=""
            style={{ maxHeight: 320, maxWidth: "100%" }}
          />
          <h1>{book.title}</h1>
          <p>{book.description}</p>
          {book.fallback && (
            <p>
              {t(
                router.locale,
                "Traducerea nu este încă publicată. Se afișează româna.",
                "This translation is not published yet. Showing Romanian.",
              )}
            </p>
          )}
          <p>
            {new Intl.NumberFormat(router.locale || "ro", {
              style: "currency",
              currency: book.currency,
            }).format(book.price)}
          </p>
          {!book.owned && currentUser && billingEnabled ? (
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
                disabled={busy}
              />
            </section>
          ) : null}
          {book.owned ? (
            <Link href={`/ebooks/${book.id}/read`}>
              {t(router.locale, "Citește cartea", "Read book")}
            </Link>
          ) : (
            <button disabled={busy || !billingEnabled} onClick={buy}>
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
            onClick={() => reload().catch((e) => setMessage(e.message))}
            style={{ marginInlineStart: 16 }}
          >
            {t(router.locale, "Verifică accesul", "Check access")}
          </button>
          <h2>{t(router.locale, "Cuprins", "Contents")}</h2>
          <ol>
            {book.chapters.map((c) => (
              <li key={c._key}>{c.title}</li>
            ))}
          </ol>
        </>
      )}
    </EbookLayout>
  );
}

export async function getServerSideProps({ locale }) {
  return {
    props: { ...(await serverSideTranslations(locale || "ro", ["common"])) },
  };
}
