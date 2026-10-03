import Header from "../Header";
import Footer from "../Footer";
import React from "react";
import Link from "next/link";
import { useRouter } from "next/router";
export default function EbookLayout({ children }) {
  const { locale } = useRouter();
  return (
    <>
      <Header />
      <main
        style={{
          maxWidth: 1000,
          margin: "30px auto",
          padding: "0 20px",
          color: "#25212d",
        }}
      >
        <nav style={{ display: "flex", gap: 24, marginBottom: 30 }}>
          <Link href="/">← {locale === "ro" ? "Acasă" : "Home"}</Link>
          <Link href="/ebooks">Ebookuri</Link>
          <Link href="/ebooks/mine">
            {locale === "ro" ? "Cărțile mele" : "My books"}
          </Link>
        </nav>
        {children}
      </main>
      <Footer />
    </>
  );
}
