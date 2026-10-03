import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import React from "react";
import Catalog from "../../components/Ebooks/Catalog";
export default function Mine() {
  return <Catalog mine />;
}

export async function getServerSideProps({ locale }) {
  return {
    props: { ...(await serverSideTranslations(locale || "ro", ["common"])) },
  };
}
