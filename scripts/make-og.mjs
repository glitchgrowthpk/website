/**
 * Renders public/og.png (1200x630) from a throwaway HTML page so the social
 * card uses the real brand fonts and the real character art.
 *   node scripts/make-og.mjs
 */
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Inlined as data URIs: a setContent page has an about:blank origin and cannot
// load file:// subresources, and pointing it at the dev server would let the
// Next.js bundle re-render over this markup.
const asset = (p) =>
  "data:image/webp;base64," +
  readFileSync(path.join(root, "public", p)).toString("base64");

const CAST = ["skeleton", "reaper", "swordknight", "dino", "chili"];

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Archivo:wght@400;600&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:1200px;height:630px;background:#06060a;color:#f2f3f7;
       font-family:Archivo,sans-serif;overflow:hidden;position:relative}
  .bg{position:absolute;inset:0;background:radial-gradient(120% 90% at 50% 0%,#1a1030 0%,#0a0a12 46%,#06060a 100%)}
  .grid{position:absolute;inset:0;
    background-image:linear-gradient(to right,rgba(0,229,255,.09) 1px,transparent 1px),
                     linear-gradient(to bottom,rgba(139,92,246,.09) 1px,transparent 1px);
    background-size:60px 60px;
    mask-image:linear-gradient(to top,#000 0%,transparent 70%)}
  .wrap{position:relative;z-index:2;padding:58px 64px;height:100%;display:flex;flex-direction:column}
  .kicker{font-family:'JetBrains Mono',monospace;font-size:17px;letter-spacing:.24em;
          text-transform:uppercase;color:#8a8fa3;display:flex;align-items:center;gap:12px}
  .dot{width:9px;height:9px;border-radius:99px;background:#c8ff2e}
  h1{font-family:Anton,sans-serif;font-size:138px;line-height:.84;letter-spacing:.005em;margin-top:22px}
  .g2{background:linear-gradient(90deg,#c8ff2e,#00e5ff 55%,#8b5cf6);
      -webkit-background-clip:text;background-clip:text;color:transparent}
  .sub{margin-top:20px;font-size:25px;color:#c8cad6;max-width:610px;line-height:1.35}
  .stats{display:flex;gap:16px;margin-top:auto;margin-bottom:6px}
  .stat{border:1px solid #2a2a3d;border-radius:12px;padding:14px 20px 12px;
        background:linear-gradient(180deg,#12121d,#0b0b13);position:relative;overflow:hidden;min-width:168px}
  .stat i{position:absolute;left:0;top:0;bottom:0;width:4px}
  .stat b{font-family:Anton,sans-serif;font-size:40px;line-height:1;display:block;font-weight:400}
  .stat span{font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:.18em;
             text-transform:uppercase;color:#8a8fa3;display:block;margin-top:7px}
  .cast{position:absolute;z-index:1;right:44px;bottom:0;display:flex;align-items:flex-end;gap:6px}
  .cast img{height:var(--h);filter:drop-shadow(0 8px 14px rgba(0,0,0,.6))}
  .mark{position:absolute;right:60px;top:52px;height:74px}
  .floor{position:absolute;left:0;right:0;bottom:0;height:2px;
         background:linear-gradient(90deg,transparent,#00e5ff,transparent);opacity:.65}
</style></head><body>
<div class="bg"></div><div class="grid"></div>
<img class="mark" src="${asset("logo-mark.webp")}">
<div class="cast">
  ${CAST.map((c, i) => `<img src="${asset(`characters/${c}.webp`)}" style="--h:${126 + ((i * 29) % 56)}px">`).join("")}
</div>
<div class="wrap">
  <div class="kicker"><span class="dot"></span>Hybrid-casual &amp; puzzle studio</div>
  <h1>GLITCH<br><span class="g2">GAMES</span></h1>
  <div class="sub">12 titles shipped. 400+ original characters. Everything made in house — and there is a playable match-3 boss fight on the site.</div>
  <div class="stats">
    <div class="stat"><i style="background:#00e5ff"></i><b>12</b><span>Titles shipped</span></div>
    <div class="stat"><i style="background:#ff2d77"></i><b>220K+</b><span>Total installs</span></div>
    <div class="stat"><i style="background:#c8ff2e"></i><b>400+</b><span>Characters</span></div>
  </div>
</div>
<div class="floor"></div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 1,
});
await page.setContent(html, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(root, "public", "og.png") });
await browser.close();
console.log("wrote public/og.png");
