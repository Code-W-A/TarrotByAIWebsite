const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
require("@next/env").loadEnvConfig(process.cwd());
const out = path.join(process.cwd(), "public/ebook-studio");
if (!process.env.SANITY_PROJECT_ID || !process.env.SANITY_DATASET) {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(
    path.join(out, "index.html"),
    '<!doctype html><html lang="ro"><body><p>Sanity nu este încă configurat. Consultați EBOOKS_SETUP.md.</p></body></html>',
  );
} else {
  const cwd = path.join(process.cwd(), "ebook-studio");
  if (!fs.existsSync(path.join(cwd, "node_modules")))
    execFileSync("npm", ["ci"], { cwd, stdio: "inherit" });
  execFileSync("npm", ["run", "build"], {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      SANITY_STUDIO_PROJECT_ID: process.env.SANITY_PROJECT_ID,
      SANITY_STUDIO_DATASET: process.env.SANITY_DATASET,
    },
  });
}
