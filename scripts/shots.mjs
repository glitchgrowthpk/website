/**
 * Captures review screenshots across viewports and motion preferences.
 *   node scripts/shots.mjs <outDir> [url]
 */
import { chromium } from "playwright";
import path from "node:path";
import { mkdirSync } from "node:fs";

const out = process.argv[2] ?? "./shots";
const URL = process.argv[3] ?? "http://localhost:3100";
mkdirSync(out, { recursive: true });

const SECTIONS = ["top", "studio", "roster", "portfolio", "arcade", "pipeline", "partner"];

const browser = await chromium.launch();

async function run(label, viewport, reducedMotion) {
  const page = await browser.newPage({ viewport, reducedMotion, deviceScaleFactor: 1 });
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);

  for (const id of SECTIONS) {
    await page.evaluate((s) => {
      const el = document.getElementById(s);
      window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 8, behavior: "instant" });
    }, id);
    await page.waitForTimeout(1500); // let reveal animations settle
    await page.screenshot({ path: path.join(out, `${label}-${id}.png`) });
  }

  // horizontal overflow is the classic responsive bug
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  console.log(`${label}: horizontal overflow = ${overflow}px`);
  await page.close();
  return overflow;
}

const a = await run("desktop", { width: 1440, height: 900 }, "no-preference");
const b = await run("mobile", { width: 390, height: 844 }, "no-preference");
const c = await run("reduced", { width: 1440, height: 900 }, "reduce");

await browser.close();
if (a > 1 || b > 1 || c > 1) {
  console.log("FAIL: horizontal overflow detected");
  process.exit(1);
}
console.log("no horizontal overflow at any breakpoint");
