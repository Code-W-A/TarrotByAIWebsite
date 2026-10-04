import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { useAuth } from "../../../context/AuthContext";
import PortableText from "../../../components/Ebooks/PortableText";
import { ebookRequest, ebookText as t } from "../../../components/Ebooks/api";
import styles from "../../../components/Ebooks/Reader.module.css";

const request = (path, user, options = {}) => ebookRequest(path, user, { ...options, timeoutMs: 20000 });
const clampFont = (value) => Math.min(30, Math.max(14, Number(value) || 18));
export function hasReadableContent(body = []) {
  return Array.isArray(body) && body.some((block) => (block._type === "image" && block.url) ||
    (block._type === "block" && block.children?.some((span) => span._type === "span" && span.text?.trim())));
}

export default function EbookReader() {
  const router = useRouter();
  const { ebookId, preview } = router.query;
  const { currentUser, loading: authLoading } = useAuth();
  const [language, setLanguage] = useState(null);
  const [book, setBook] = useState(null);
  const [chapter, setChapter] = useState(null);
  const [chapterId, setChapterId] = useState("");
  const [font, setFont] = useState(18);
  const [bookStatus, setBookStatus] = useState("loading");
  const [chapterStatus, setChapterStatus] = useState("loading");
  const [message, setMessage] = useState("");
  const [progressWarning, setProgressWarning] = useState(false);
  const [retryBook, setRetryBook] = useState(0);
  const [retryChapter, setRetryChapter] = useState(0);
  const [tocOpen, setTocOpen] = useState(false);
  const scroll = useRef(null);
  const toc = useRef(null);
  const position = useRef(0);
  const restoring = useRef(false);
  const resetPosition = useRef(false);
  const saves = useRef(Promise.resolve());
  const locale = (language?.bookId === ebookId ? language.value : "") || String(router.query.locale || router.locale || "ro");
  const isPreview = preview === "1";
  const ui = (ro, en) => t(router.locale, ro, en);
  const errorText = (error) => error.code === "EBOOK_TIMEOUT"
    ? t(router.locale, "Încărcarea a durat prea mult. Încearcă din nou.", "Loading took too long. Please retry.") : error.message;

  useEffect(() => {
    let active = true;
    setBook(null); setChapter(null); setChapterId("");
    setBookStatus("loading"); setChapterStatus("loading"); setMessage("");
    setProgressWarning(false); setTocOpen(false);
    if (!ebookId || (!isPreview && authLoading)) return;
    if (!isPreview && !currentUser) { setBookStatus("login"); return; }
    (async () => {
      try {
        const b = await request(`${isPreview ? "/preview" : ""}/${ebookId}?locale=${encodeURIComponent(locale)}`, isPreview ? null : currentUser);
        if (!active) return;
        let progress = {};
        if (!isPreview) {
          try {
            const response = await request(`/${ebookId}/progress?locale=${b.language}`, currentUser);
            progress = response.progress || {};
          } catch { if (active) setProgressWarning(true); }
        }
        if (!active) return;
        const id = b.chapters.some((c) => c._key === progress.chapterId) ? progress.chapterId : b.chapters[0]?._key;
        position.current = Math.min(1, Math.max(0, Number(progress.offset) || 0));
        resetPosition.current = false;
        setFont(clampFont(progress.fontSize)); setBook(b); setChapterId(id || ""); setBookStatus("ready");
      } catch (error) { if (active) { setMessage(errorText(error)); setBookStatus("error"); } }
    })();
    return () => { active = false; };
  }, [ebookId, locale, currentUser?.uid, authLoading, isPreview, retryBook]);

  useEffect(() => {
    let active = true;
    let frame;
    setChapterStatus("loading"); setChapter(null);
    if (!book || !chapterId) return;
    if (resetPosition.current) { position.current = 0; resetPosition.current = false; }
    setMessage("");
    request(`${isPreview ? `/preview/${ebookId}/${chapterId}` : `/${ebookId}/chapters/${chapterId}`}?locale=${book.language}`, isPreview ? null : currentUser)
      .then((payload) => {
        if (!active) return;
        if (!payload.chapter) throw new Error(t(router.locale, "Capitolul nu este disponibil.", "This chapter is unavailable."));
        setChapter(payload.chapter); setChapterStatus("ready"); restoring.current = true;
        frame = requestAnimationFrame(() => {
          if (active && scroll.current) scroll.current.scrollTop = position.current * Math.max(0, scroll.current.scrollHeight - scroll.current.clientHeight);
          restoring.current = false;
        });
      })
      .catch((error) => { if (active) { setMessage(errorText(error)); setChapterStatus("error"); } });
    return () => { active = false; if (frame !== undefined) cancelAnimationFrame(frame); restoring.current = false; };
  }, [ebookId, book, chapterId, currentUser?.uid, isPreview, retryChapter]);

  useEffect(() => {
    if (chapterStatus !== "ready" || !book || isPreview) return;
    let last = "";
    const save = () => {
      const serialized = JSON.stringify({ chapterId, offset: position.current, fontSize: font });
      if (serialized === last) return;
      last = serialized;
      saves.current = saves.current.then(() => request(`/${ebookId}/progress?locale=${book.language}`, currentUser, { method: "PUT", body: serialized }))
        .catch(() => { last = ""; });
    };
    const timer = setInterval(save, 2500);
    const flush = () => { if (document.visibilityState === "hidden") save(); };
    document.addEventListener("visibilitychange", flush);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", flush); save(); };
  }, [chapterStatus, book, chapterId, font, ebookId, currentUser?.uid, isPreview]);

  useEffect(() => {
    if (!tocOpen) return;
    const previous = document.activeElement;
    const panel = toc.current;
    const focusable = () => Array.from(panel?.querySelectorAll("button, a[href]") || []);
    focusable()[0]?.focus();
    const keydown = (event) => {
      if (event.key === "Escape") setTocOpen(false);
      if (event.key !== "Tab") return;
      const items = focusable(); const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); previous?.focus(); };
  }, [tocOpen]);

  const choose = (id) => {
    setTocOpen(false);
    if (id === chapterId) return;
    resetPosition.current = true; setChapterId(id); setMessage("");
  };
  const index = book?.chapters.findIndex((c) => c._key === chapterId) ?? -1;
  const rtl = ["ar", "he"].includes(book?.language);
  const ready = bookStatus === "ready";
  const retry = () => bookStatus === "error" ? setRetryBook((n) => n + 1) : setRetryChapter((n) => n + 1);

  return (
    <main className={styles.root}>
      <header className={styles.header}>
        <Link href="/ebooks" className={styles.back}>← {ui("Ebookuri", "Ebooks")}</Link>
        <div className={styles.bookHeading}><span className={styles.eyebrow}>{ui("În lectură", "Now reading")}</span><h1>{book?.title || ui("Cititor ebook", "Ebook reader")}</h1></div>
        {book ? <label className={styles.language}>{ui("Limbă", "Language")}<select value={locale} onChange={(e) => setLanguage({ bookId: ebookId, value: e.target.value })}>
          {Array.from(new Set([locale, ...book.availableLanguages])).map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
        </select></label> : null}
      </header>
      <div className={styles.workspace}>
        <div className={styles.notices} aria-live="polite">
          {isPreview ? <span className={styles.badge}>{ui("Previzualizare admin · Conținut nepublicat", "Admin preview · Unpublished content")}</span> : null}
          {book?.fallback ? <p>{ui("Traducerea nu este publicată; se afișează româna.", "Translation unavailable; showing Romanian.")}</p> : null}
          {progressWarning ? <p>{ui("Progresul nu a putut fi încărcat. Lectura începe cu primul capitol.", "Your progress could not be loaded. Starting at the first chapter.")}</p> : null}
        </div>
        <div className={styles.grid}>
          {tocOpen ? <button className={styles.backdrop} aria-label={ui("Închide cuprinsul", "Close contents")} tabIndex={-1} onClick={() => setTocOpen(false)} /> : null}
          <aside id="reader-toc" ref={toc} className={`${styles.toc} ${tocOpen ? styles.tocOpen : ""}`} role={tocOpen ? "dialog" : undefined} aria-modal={tocOpen ? true : undefined} aria-labelledby="reader-toc-title">
            <div className={styles.tocHeading}><h2 id="reader-toc-title">{ui("Cuprins", "Contents")}</h2><button className={styles.closeToc} aria-label={ui("Închide cuprinsul", "Close contents")} onClick={() => setTocOpen(false)}>×</button></div>
            <nav aria-label={ui("Capitole", "Chapters")}>
              {book?.chapters.map((c, n) => <button key={c._key} aria-current={c._key === chapterId ? "location" : undefined} className={`${styles.chapterLink} ${c._key === chapterId ? styles.selected : ""}`} onClick={() => choose(c._key)}><span>{String(n + 1).padStart(2, "0")}</span><span>{c.title}</span></button>)}
            </nav>
            {ready && !book.chapters.length ? <p className={styles.muted}>{ui("Nu există capitole încă.", "No chapters yet.")}</p> : null}
          </aside>
          <section className={styles.reader} aria-label={ui("Zona de lectură", "Reading area")}>
            <div className={styles.toolbar}>
              <button className={styles.tocButton} aria-controls="reader-toc" aria-expanded={tocOpen} onClick={() => setTocOpen(true)}>☰ {ui("Cuprins", "Contents")}</button>
              <span className={styles.chapterLabel}>{index >= 0 ? `${ui("Capitolul", "Chapter")} ${index + 1} / ${book.chapters.length}` : ui("Lectură", "Reading")}</span>
              <div className={styles.fontControls} role="group" aria-label={ui("Mărimea textului", "Text size")}>
                <button aria-label={ui("Micșorează textul", "Decrease text size")} disabled={font <= 14} onClick={() => setFont((n) => Math.max(14, n - 2))}>A−</button>
                <span aria-live="polite">{font} px</span>
                <button aria-label={ui("Mărește textul", "Increase text size")} disabled={font >= 30} onClick={() => setFont((n) => Math.min(30, n + 2))}>A+</button>
              </div>
            </div>
            <div ref={scroll} className={styles.paper} tabIndex={0} aria-label={ui("Conținutul capitolului", "Chapter content")} aria-busy={bookStatus === "loading" || (ready && book.chapters.length > 0 && chapterStatus === "loading")} onScroll={(e) => {
              if (!restoring.current) { const el = e.currentTarget; position.current = el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight); }
            }}>
              {bookStatus === "loading" || (ready && book.chapters.length > 0 && chapterStatus === "loading") ? <div className={styles.skeleton} role="status" aria-label={ui("Se încarcă ebookul", "Loading ebook")}><div className={styles.skeletonTitle} />{Array.from({ length: 9 }, (_, n) => <div key={n} className={styles.skeletonLine} />)}</div>
              : bookStatus === "login" ? <div className={styles.empty}><h2>{ui("Autentifică-te pentru a citi", "Sign in to read")}</h2><p>{ui("Cartea este disponibilă în contul cu care ai cumpărat-o.", "Use the account you purchased this book with.")}</p><Link href="/ebooks/mine" className={styles.primary}>{ui("Cărțile mele", "My books")}</Link></div>
              : bookStatus === "error" || chapterStatus === "error" ? <div className={styles.empty} role="alert"><h2>{ui("Lectura nu poate fi încărcată", "Could not load your book")}</h2><p>{message}</p><button className={styles.primary} onClick={retry}>{ui("Reîncearcă", "Retry")}</button></div>
              : ready && !book.chapters.length ? <div className={styles.empty}><span className={styles.emptyIcon}>◇</span><h2>{ui("Cartea nu are capitole încă", "This book has no chapters yet")}</h2><p>{ui("Capitolele vor apărea aici după ce sunt adăugate.", "Chapters will appear here once added.")}</p></div>
              : chapter ? <article className={styles.article} style={{ fontSize: font }} dir={rtl ? "rtl" : "ltr"} lang={book.language}>
                <span className={styles.eyebrow}>{ui("Capitolul", "Chapter")} {index + 1}</span><h2 className={styles.chapterTitle}>{chapter.title}</h2><div className={styles.divider} />
                {hasReadableContent(chapter.body) ? <PortableText blocks={chapter.body} fontSize={font} rtl={rtl} /> : <p className={styles.muted}>{ui("Acest capitol nu are text încă.", "This chapter has no text yet.")}</p>}
              </article> : null}
            </div>
            <footer className={styles.navigation}>
              <button disabled={!ready || index <= 0} onClick={() => choose(book.chapters[index - 1]._key)}>← {ui("Anterior", "Previous")}</button>
              <span>{index >= 0 ? `${ui("Capitolul", "Chapter")} ${index + 1} ${ui("din", "of")} ${book.chapters.length}` : "—"}</span>
              <button disabled={!ready || index < 0 || index >= book.chapters.length - 1} onClick={() => choose(book.chapters[index + 1]._key)}>{ui("Următor", "Next")} →</button>
            </footer>
          </section>
        </div>
      </div>
    </main>
  );
}
export async function getServerSideProps({ locale }) {
  return { props: { ...(await serverSideTranslations(locale || "ro", ["common"])) } };
}
