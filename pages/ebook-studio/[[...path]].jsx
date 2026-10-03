import fs from "fs/promises";
import path from "path";
export default function StudioFallback() {
  return null;
}
export async function getServerSideProps({ res }) {
  const html = await fs
    .readFile(
      path.join(process.cwd(), "public/ebook-studio/index.html"),
      "utf8",
    )
    .catch(() => "<p>Studio nu a fost construit.</p>");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(html);
  return { props: {} };
}
