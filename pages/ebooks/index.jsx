import { serverSideTranslations } from "next-i18next/serverSideTranslations";
export { default } from "../../components/Ebooks/Catalog";

export async function getServerSideProps({ locale }) {
  return {
    props: { ...(await serverSideTranslations(locale || "ro", ["common"])) },
  };
}
