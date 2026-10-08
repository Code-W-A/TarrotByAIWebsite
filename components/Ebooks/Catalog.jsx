import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { BookOpen, Search, Globe2, ArrowRight, ShoppingBag, Eye, Library, RotateCcw } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { ebookRequest, ebookText as t } from "./api";
import EbookLayout from "./Layout";
import styles from "./Catalog.module.css";
import { ebookSectionName } from "./sectionName";
const rtlLanguages = new Set(["ar", "he"]);
function languageName(language, locale) {
  try { return new Intl.DisplayNames([locale || "ro"], { type: "language" }).of(language); }
  catch { return language.toUpperCase(); }
}
const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
function Skeleton() {
  return <div className={styles.card} aria-hidden="true"><div className={styles.cardTop}>
    <div className={`${styles.skeleton} ${styles.skeletonCover}`} />
    <div className={styles.info}><div className={`${styles.skeleton} ${styles.skeletonLine} ${styles.skeletonTitle}`} />
      {[1, 2, 3].map(i => <div key={i} className={`${styles.skeleton} ${styles.skeletonLine}`} />)}
      <div className={`${styles.skeleton} ${styles.skeletonPrice}`} /></div>
  </div></div>;
}
export default function Catalog({ mine = false }) {
  const router = useRouter();
  const locale = router.locale || "ro";
  const { currentUser } = useAuth();
  const customer = Boolean(currentUser?.uid && !currentUser.isAnonymous);
  const [books, setBooks] = useState([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState("");
  useEffect(() => { setSearch(""); setLanguage(""); }, [locale, mine, currentUser?.uid]);
  useEffect(() => {
    let active = true;
    setLoading(true); setMessage(""); setFailed(false); setEnabled(true); setBooks([]);
    if (mine && !customer) { setLoading(false); return; }
    ebookRequest(`${mine ? "/purchased" : ""}?locale=${locale}`, mine ? currentUser : null, { timeoutMs: 20000 })
      .then(p => { if (active) { setBooks(p.books || []); setEnabled(p.enabled !== false); } })
      .catch(e => { if (active) { setFailed(true); setMessage(e.code === "EBOOK_TIMEOUT" ? t(locale, "Încărcarea a durat prea mult. Încearcă din nou.", "Loading took too long. Please retry.") : e.message); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [locale, mine, currentUser?.uid, currentUser?.isAnonymous, retry]);
  const languages = useMemo(() => [...new Set(books.flatMap(b => b.availableLanguages || []))].sort(), [books]);
  const filtered = useMemo(() => books.filter(b =>
    (!language || b.availableLanguages?.includes(language)) &&
    normalize(`${b.title} ${b.description}`).includes(normalize(search.trim()))), [books, search, language]);
  const returnUrl = `${locale !== "ro" ? "/" + locale : ""}${router.asPath || "/ebooks/mine"}`;
  const empty = !loading && !failed && enabled && !(mine && !customer) && !books.length;
  const noMatches = !loading && !failed && books.length > 0 && !filtered.length;
  return <EbookLayout>
    <section className={styles.hero} dir={rtlLanguages.has(locale) ? "rtl" : "ltr"}>
      <div className={styles.heroInner}><div>
        <div className={styles.eyebrow}><BookOpen size={16} aria-hidden="true" />{t(locale, "Bibliotecă digitală", "Digital library")}</div>
        <h1>{mine ? t(locale, "Biblioteca mea", "My library") : ebookSectionName(locale)}</h1>
        <p>{mine ? t(locale, "Cărțile tale, într-un singur loc. Continuă lectura pe site sau în aplicație, cu același cont.", "Your books in one place. Continue reading on the website or in the app with the same account.") : t(locale, "Descoperă cărți despre tarot, astrologie și autocunoaștere. Alege o carte și citește-o online, în limba ta, pe site sau în aplicație.", "Discover books about tarot, astrology and self-discovery. Choose a book and read online in your language, on the website or in the app.")}</p>
      </div><Link className={styles.heroLink} href={mine ? "/ebooks" : "/ebooks/mine"}>
        <Library size={18} aria-hidden="true" />{mine ? t(locale, "Vezi catalogul", "View catalog") : t(locale, "Cărțile mele", "My books")}<ArrowRight size={16} aria-hidden="true" />
      </Link></div>
    </section>
    <div className={styles.container} dir={rtlLanguages.has(locale) ? "rtl" : "ltr"}>
      {!loading && !failed && books.length > 0 && <div className={styles.toolbar}>
        <label className={styles.search}><Search size={19} aria-hidden="true" />
          <input aria-label={t(locale, "Caută cărți", "Search books")} placeholder={t(locale, "Caută după titlu sau descriere…", "Search by title or description…")} value={search} onChange={e => setSearch(e.target.value)} type="search" />
        </label><label className={styles.select}><Globe2 size={18} aria-hidden="true" />
          <select aria-label={t(locale, "Limbă disponibilă", "Available language")} value={language} onChange={e => setLanguage(e.target.value)}>
            <option value="">{t(locale, "Toate limbile", "All languages")}</option>
            {languages.map(l => <option key={l} value={l}>{languageName(l, locale)}</option>)}
          </select></label>
        <span className={styles.count} role="status">{filtered.length} {t(locale, filtered.length === 1 ? "carte" : "cărți", filtered.length === 1 ? "book" : "books")}</span>
      </div>}
      {loading ? <><p role="status" className={styles.reading}>{t(locale, "Se încarcă biblioteca…", "Loading library…")}</p><div className={styles.grid}><Skeleton /><Skeleton /></div></> : null}
      {!loading && (failed || !enabled || empty || noMatches || (mine && !customer)) && <section className={styles.empty} role={failed ? "alert" : "status"}>
        <BookOpen size={38} aria-hidden="true" />
        <h2>{failed ? t(locale, "Biblioteca nu s-a putut încărca", "Unable to load the library") : !enabled ? t(locale, "În curând, aici", "Coming soon") : mine && !customer ? t(locale, "Cărțile tale te așteaptă", "Your books are waiting") : noMatches ? t(locale, "Nicio carte găsită", "No matching books") : mine ? t(locale, "Biblioteca ta începe aici", "Your library starts here") : t(locale, "Pregătim primele cărți", "We are preparing our first books")}</h2>
        <p>{failed ? message : !enabled ? t(locale, "Cărțile digitale vor fi disponibile în curând.", "Digital books will be available soon.") : mine && !customer ? t(locale, "Autentifică-te pentru a vedea cărțile din contul tău.", "Sign in to see the books in your account.") : noMatches ? t(locale, "Încearcă alt titlu sau schimbă limba disponibilă.", "Try another title or available language.") : mine ? t(locale, "Cărțile cumpărate sau activate în cont vor apărea în această bibliotecă.", "Books purchased or activated in your account will appear in this library.") : t(locale, "Revino curând pentru a descoperi titlurile disponibile.", "Come back soon to explore available titles.")}</p>
        {failed && <button className={styles.secondary} onClick={() => setRetry(v => v + 1)}><RotateCcw size={16} aria-hidden="true" />{t(locale, "Reîncearcă", "Retry")}</button>}
        {mine && !customer && <Link className={styles.primary} href={{ pathname: "/login/videoteca", query: { returnUrl } }}>{t(locale, "Autentifică-te", "Sign in")}</Link>}
        {mine && customer && empty && <Link href="/ebooks" className={styles.primary}>{t(locale, "Vezi catalogul", "View catalog")}</Link>}
        {noMatches && <button className={styles.secondary} onClick={() => { setSearch(""); setLanguage(""); }}>{t(locale, "Resetează filtrele", "Reset filters")}</button>}
      </section>}
      {!loading && !failed && enabled && <div className={styles.grid}>{filtered.map(book => {
        const bookUrl = `/ebooks/${encodeURIComponent(book.id)}`;
        const publishedLanguages = [...new Set(book.availableLanguages || [])];
        const visibleLanguages = publishedLanguages.slice(0, 6);
        return <article key={book.id} className={styles.card}>
          <div className={styles.cardTop}>
            <Link href={bookUrl} className={styles.cover} aria-label={book.title}>{book.coverUrl ? <img src={book.coverUrl} alt={book.title} loading="lazy" width="240" height="360" /> : <BookOpen size={62} aria-hidden="true" />}</Link>
            <div className={styles.info}>
              <span className={styles.format}><BookOpen size={12} aria-hidden="true" />{t(locale, "CARTE DIGITALĂ", "DIGITAL BOOK")}</span>
              <h2 className={styles.title} dir="auto"><Link href={bookUrl}>{book.title}</Link></h2>
              <p className={styles.description} dir="auto">{book.description}</p>
              {!mine && <p className={styles.price}>{new Intl.NumberFormat(locale, { style: "currency", currency: book.currency || "RON" }).format(book.price)}</p>}
              <p className={styles.reading}><BookOpen size={14} aria-hidden="true" />{t(locale, "Lectură online în cont", "Read online in your account")}</p>
              <div className={styles.actions}><Link className={styles.secondary} href={bookUrl}><Eye size={16} aria-hidden="true" />{t(locale, "Vezi detalii", "View details")}</Link>
                <Link className={styles.primary} href={mine ? `${bookUrl}/read` : `${bookUrl}?buy=1`}>{mine ? <BookOpen size={16} aria-hidden="true" /> : <ShoppingBag size={16} aria-hidden="true" />}{mine ? t(locale, "Citește", "Read") : t(locale, "Cumpără", "Buy")}</Link>
              </div>
            </div>
          </div>
          <div className={styles.languages}><span className={styles.languageLabel}><Globe2 size={15} aria-hidden="true" />{t(locale, `Disponibil în ${publishedLanguages.length} ${publishedLanguages.length === 1 ? "limbă" : "limbi"}:`, `Available in ${publishedLanguages.length} ${publishedLanguages.length === 1 ? "language" : "languages"}:`)}</span>
            {visibleLanguages.map(l => <span key={l} className={styles.chip} title={languageName(l, locale)}>{l.toUpperCase()}</span>)}
            {publishedLanguages.length > 6 && <Link className={styles.chip} href={bookUrl} aria-label={t(locale, "Vezi toate limbile disponibile", "See all available languages")}>+{publishedLanguages.length - 6}</Link>}
          </div>
        </article>;
      })}</div>}
    </div>
  </EbookLayout>;
}
