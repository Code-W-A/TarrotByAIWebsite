import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { useAuth } from "../../../context/AuthContext";
import EbookLayout from "../../../components/Ebooks/Layout";
import PortableText from "../../../components/Ebooks/PortableText";
import { ebookRequest, ebookText as t } from "../../../components/Ebooks/api";
export default function EbookReader() {
  const router = useRouter();
  const { ebookId, preview } = router.query;
  const { currentUser } = useAuth();
  const [language, setLanguage] = useState("");
  const [book, setBook] = useState(null);
  const [chapter, setChapter] = useState(null);
  const [chapterId, setChapterId] = useState("");
  const [font, setFont] = useState(18);
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const scroll = useRef(null);
  const position = useRef(0);
  const restoring = useRef(false);
  const resetPosition = useRef(false);
  const saves = useRef(Promise.resolve());
  const locale =
    language || String(router.query.locale || router.locale || "ro");
  const isPreview = preview === "1";
  useEffect(() => {
    let active = true;
    setBook(null);
    setChapter(null);
    setChapterId("");
    setLoaded(false);
    setMessage("");
    if (!ebookId) return;
    if (!isPreview && !currentUser) {
      setMessage(
        t(router.locale, "Autentifică-te pentru a citi.", "Sign in to read."),
      );
      return;
    }
    (async () => {
      try {
        const b = await ebookRequest(
          `${isPreview ? "/preview" : ""}/${ebookId}?locale=${locale}`,
          isPreview ? null : currentUser,
        );
        if (!active) return;
        setBook(b);
        const p = isPreview
          ? {}
          : await ebookRequest(
              `/${ebookId}/progress?locale=${b.language}`,
              currentUser,
            );
        if (!active) return;
        const id = b.chapters.some((c) => c._key === p.progress?.chapterId)
          ? p.progress.chapterId
          : b.chapters[0]?._key;
        position.current = p.progress?.offset || 0;
        setFont(p.progress?.fontSize || 18);
        setChapterId(id || "");
      } catch (e) {
        if (active) setMessage(e.message);
      }
    })();
    return () => {
      active = false;
    };
  }, [ebookId, locale, currentUser?.uid, isPreview]);
  useEffect(() => {
    let active = true;
    setLoaded(false);
    setChapter(null);
    if (!book || !chapterId) return;
    if (resetPosition.current) {
      position.current = 0;
      resetPosition.current = false;
    }
    ebookRequest(
      `${isPreview ? `/preview/${ebookId}/${chapterId}` : `/${ebookId}/chapters/${chapterId}`}?locale=${book.language}`,
      isPreview ? null : currentUser,
    )
      .then((p) => {
        if (!active) return;
        setChapter(p.chapter);
        setLoaded(true);
        restoring.current = true;
        requestAnimationFrame(() => {
          if (scroll.current) {
            scroll.current.scrollTop =
              position.current *
              Math.max(
                0,
                scroll.current.scrollHeight - scroll.current.clientHeight,
              );
          }
          restoring.current = false;
        });
      })
      .catch((e) => {
        if (active) setMessage(e.message);
      });
    return () => {
      active = false;
    };
  }, [ebookId, book, chapterId, currentUser?.uid, isPreview]);
  useEffect(() => {
    if (!loaded || !book || isPreview) return;
    let last = "";
    const save = () => {
      const data = { chapterId, offset: position.current, fontSize: font };
      const serialized = JSON.stringify(data);
      if (serialized === last) return;
      last = serialized;
      saves.current = saves.current
        .then(() =>
          ebookRequest(
            `/${ebookId}/progress?locale=${book.language}`,
            currentUser,
            { method: "PUT", body: serialized },
          ),
        )
        .then(() => {
          last = serialized;
        })
        .catch(() => {
          last = "";
        });
    };
    const timer = setInterval(save, 2500);
    const flush = () => {
      if (document.visibilityState === "hidden") save();
    };
    document.addEventListener("visibilitychange", flush);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", flush);
      save();
    };
  }, [loaded, book, chapterId, font, ebookId, currentUser?.uid, isPreview]);
  const choose = (id) => {
    if (id === chapterId) return;
    resetPosition.current = true;
    setChapterId(id);
    setMessage("");
  };
  const index = book?.chapters.findIndex((c) => c._key === chapterId) ?? -1;
  return (
    <EbookLayout>
      <p role="alert">{message}</p>
      {book && (
        <>
          <h1>{book.title}</h1>
          {isPreview && <p>Previzualizare admin — conținut nepublicat</p>}
          {book.fallback && (
            <p>
              {t(
                router.locale,
                "Traducerea nu este publicată; se afișează româna.",
                "Translation unavailable; showing Romanian.",
              )}
            </p>
          )}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              marginBottom: 16,
            }}
          >
            <label>
              {t(router.locale, "Limbă", "Language")}{" "}
              <select
                value={locale}
                onChange={(e) => setLanguage(e.target.value)}
              >
                {Array.from(new Set([locale, ...book.availableLanguages])).map(
                  (l) => (
                    <option key={l} value={l}>
                      {l.toUpperCase()}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              {t(router.locale, "Capitol", "Chapter")}{" "}
              <select
                value={chapterId}
                onChange={(e) => choose(e.target.value)}
              >
                {book.chapters.map((c) => (
                  <option key={c._key} value={c._key}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
            <button disabled={font <= 14} onClick={() => setFont((n) => n - 2)}>
              A−
            </button>
            <button disabled={font >= 30} onClick={() => setFont((n) => n + 2)}>
              A+
            </button>
          </div>
          <div
            ref={scroll}
            onScroll={(e) => {
              if (!restoring.current) {
                const el = e.currentTarget;
                position.current =
                  el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight);
              }
            }}
            style={{
              height: "65vh",
              overflowY: "auto",
              padding: 24,
              border: "1px solid #e2ddd2",
              borderRadius: 12,
              background: "#fffdf7",
            }}
          >
            {!loaded ? (
              <p>{t(router.locale, "Se încarcă…", "Loading…")}</p>
            ) : (
              <>
                <h2>{chapter.title}</h2>
                <PortableText
                  blocks={chapter.body}
                  fontSize={font}
                  rtl={["ar", "he"].includes(book.language)}
                />
              </>
            )}
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 16,
            }}
          >
            <button
              disabled={index <= 0}
              onClick={() => choose(book.chapters[index - 1]._key)}
            >
              ← {t(router.locale, "Anterior", "Previous")}
            </button>
            <button
              disabled={index < 0 || index >= book.chapters.length - 1}
              onClick={() => choose(book.chapters[index + 1]._key)}
            >
              {t(router.locale, "Următor", "Next")} →
            </button>
          </div>
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
