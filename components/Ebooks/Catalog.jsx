import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { useAuth } from "../../context/AuthContext";
import { ebookRequest, ebookText as t } from "./api";
import EbookLayout from "./Layout";
export default function Catalog({ mine = false }) {
  const { locale } = useRouter();
  const { currentUser } = useAuth();
  const [books, setBooks] = useState([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setMessage("");
    setBooks([]);
    if (mine && !currentUser) {
      setLoading(false);
      setMessage(
        t(
          locale,
          "Autentifică-te pentru a vedea cărțile cumpărate.",
          "Sign in to see your purchased books.",
        ),
      );
      return;
    }
    ebookRequest(
      `${mine ? "/purchased" : ""}?locale=${locale || "ro"}`,
      mine ? currentUser : null,
    )
      .then((p) => {
        if (active) {
          setBooks(p.books);
          if (p.enabled === false)
            setMessage(
              t(
                locale,
                "Ebookurile vor fi disponibile în curând.",
                "Ebooks are coming soon.",
              ),
            );
        }
      })
      .catch((e) => {
        if (active) setMessage(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [locale, mine, currentUser?.uid]);
  return (
    <EbookLayout>
      <h1>{mine ? t(locale, "Cărțile mele", "My books") : "Ebookuri"}</h1>
      <p role="status">
        {loading ? t(locale, "Se încarcă…", "Loading…") : message}
      </p>
      {!loading && !message && !books.length && (
        <p>
          {t(locale, "Nu există cărți disponibile.", "No books available.")}
        </p>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
          gap: 24,
        }}
      >
        {books.map((book) => (
          <Link
            key={book.id}
            href={`/ebooks/${book.id}`}
            style={{
              border: "1px solid #ddd",
              borderRadius: 16,
              padding: 20,
              color: "inherit",
              textDecoration: "none",
            }}
          >
            {book.coverUrl && (
              <img
                src={book.coverUrl}
                alt=""
                style={{ height: 220, maxWidth: "100%", objectFit: "contain" }}
              />
            )}
            <h2>{book.title}</h2>
            <p>{book.description}</p>
            {!mine && (
              <p>
                {new Intl.NumberFormat(locale || "ro", {
                  style: "currency",
                  currency: book.currency,
                }).format(book.price)}
              </p>
            )}
            <small>{book.availableLanguages.join(" · ").toUpperCase()}</small>
          </Link>
        ))}
      </div>
    </EbookLayout>
  );
}
