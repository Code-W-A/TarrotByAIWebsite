import Header from "../Header";
import Footer from "../Footer";
import React from "react";
import styles from "./Catalog.module.css";
export default function EbookLayout({ children }) {
  return (
    <>
      <Header />
      <main className={styles.page}>
        {children}
      </main>
      <Footer />
    </>
  );
}
