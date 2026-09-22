/**
 * Bundles the exported site into a single zip ready to upload to Bluehost.
 * Run `npm run deploy` (which builds first).
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, rmSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "out");
const zip = path.join(root, "glitchtech-site.zip");

if (!existsSync(out)) {
  console.error("No out/ directory — run `npm run build` first.");
  process.exit(1);
}

// Apache config travels with the site.
copyFileSync(path.join(root, "deploy", ".htaccess"), path.join(out, ".htaccess"));

// Build-time manifests that Apache has no use for.
for (const f of readdirSync(out)) {
  if (f.startsWith("__next.") && f.endsWith(".txt")) {
    rmSync(path.join(out, f));
  }
}

if (existsSync(zip)) rmSync(zip);

// Compress-Archive skips dotfiles, so zip the *contents* explicitly.
execFileSync(
  "powershell",
  [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Compress-Archive -Path '${out}\\*' -DestinationPath '${zip}' -Force`,
  ],
  { stdio: "inherit" },
);

const bytes = (p) =>
  readdirSync(p, { withFileTypes: true }).reduce(
    (n, d) =>
      n +
      (d.isDirectory()
        ? bytes(path.join(p, d.name))
        : statSync(path.join(p, d.name)).size),
    0,
  );

console.log(`\nout/          ${(bytes(out) / 1024 / 1024).toFixed(2)} MB uncompressed`);
console.log(`${path.basename(zip)}  ${(statSync(zip).size / 1024 / 1024).toFixed(2)} MB — upload this to public_html`);
