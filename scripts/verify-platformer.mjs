/**
 * Headless smoke test for the walk-the-page platformer and the arcade board.
 * Run with the dev (or prod) server already listening:
 *   node scripts/verify-platformer.mjs [url]
 */
import { chromium } from "playwright";

const URL = process.argv[2] ?? "http://localhost:3100";
const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
// Skip the first-visit boot screen: it deliberately swallows the first key
// press, which would eat the G below. verify-interactive.mjs covers the boot.
await context.addInitScript(() => {
  try {
    sessionStorage.setItem("glitch.booted", "1");
  } catch {}
});
const page = await context.newPage();

const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(String(e)));

await page.goto(URL, { waitUntil: "networkidle" });
// RevealObserver adds this class from an effect, so it marks hydration.
await page.waitForSelector("html.reveal-ready", { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(600);

/* ------------------------------------------------------------- helpers */

const read = () =>
  page.evaluate(() => {
    const el = document.querySelector(".z-40 > div");
    const m = el.style.transform.match(/translate3d\(([-\d.]+)px, ([-\d.]+)px/);
    return { x: +m[1], y: +m[2], scroll: window.scrollY };
  });

const hold = (dir, down) =>
  page.evaluate(
    ([d, v]) =>
      window.dispatchEvent(
        new CustomEvent("glitch:pad", { detail: { dir: d, down: v } }),
      ),
    [dir, down],
  );

/* ------------------------------------------------------------- 1. sprite */

const sprite = await page.evaluate(() => {
  const img = document.querySelector(".z-40 img");
  const cs = getComputedStyle(img);
  return { w: parseFloat(cs.width), h: parseFloat(cs.height), src: img.getAttribute("src") };
});
check(
  "walker sprite has real dimensions",
  sprite.w > 30 && sprite.h > 60,
  `${sprite.w}x${sprite.h} ${sprite.src}`,
);

/* -------------------------------------------------------- 2. take control */

await page.keyboard.press("g");
await page.waitForTimeout(250);
const isControlling = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("button")]
      .find((b) => /^Control/.test(b.textContent || ""))
      ?.getAttribute("aria-pressed") === "true",
  );
check("pressing G enables control mode", await isControlling());

/* ------------------------------------------------------------- 3. walking */

await page.evaluate(() => window.scrollTo(0, document.getElementById("portfolio").offsetTop + 260));
await page.waitForTimeout(500);
const a = await read();
await hold("right", true);
// Poll rather than trusting a fixed window: the physics clamps dt per frame,
// so a slow machine covers less ground per wall-clock second.
const t0 = Date.now();
let b = a;
while (Date.now() - t0 < 2500) {
  await page.waitForTimeout(100);
  b = await read();
  if (b.x - a.x > 120) break;
}
await hold("right", false);
await page.waitForTimeout(80);
check(
  "holding right walks the character",
  b.x - a.x > 120,
  `moved ${Math.round(b.x - a.x)}px in ${Date.now() - t0}ms`,
);

/* ---------------------------------------------------- 4. landing on a card */

// Jump repeatedly and assert the feet come to rest on the top edge of a real
// page element rather than falling through to the bottom of the document.
const restingOnPlatform = async () =>
  page.evaluate(() => {
    const el = document.querySelector(".z-40 > div");
    const m = el.style.transform.match(/translate3d\(([-\d.]+)px, ([-\d.]+)px/);
    const x = +m[1];
    const y = +m[2];
    const hit = [...document.querySelectorAll("[data-solid]")]
      .map((n) => n.getBoundingClientRect())
      .find(
        (r) =>
          r.width > 40 &&
          x >= r.left - 8 &&
          x <= r.right + 8 &&
          Math.abs(y - r.top) < 6,
      );
    return hit ? { x: Math.round(x), y: Math.round(y), top: Math.round(hit.top) } : null;
  });

let perched = null;
for (let i = 0; i < 14 && !perched; i++) {
  // Jump height is variable now, so hold for a full jump.
  await hold("up", true);
  await page.waitForTimeout(260);
  await hold("up", false);
  await page.waitForTimeout(140);
  perched = await restingOnPlatform();
  if (perched) break;
  await hold("right", true);
  await page.waitForTimeout(150);
  await hold("right", false);
  await page.waitForTimeout(420);
  perched = await restingOnPlatform();
}
check(
  "character can stand on a real page element",
  !!perched,
  perched ? `feet y=${perched.y} on element top ${perched.top}` : "never perched",
);

/* --------------------------------------------------- 5. camera follows */

// Yank the viewport away from the character; the camera band should scroll the
// page back so it never ends up off screen. This is what makes the whole
// document walkable rather than a treadmill.
const docY = await page.evaluate(() => {
  const el = document.querySelector(".z-40 > div");
  return +el.style.transform.match(/, ([-\d.]+)px, 0/)[1] + window.scrollY;
});
await page.evaluate((y) => window.scrollTo({ top: y - 30, behavior: "instant" }), docY);
await page.waitForTimeout(400);
const recovered = await read();
check(
  "camera scrolls the page to keep the character in frame",
  recovered.y > 150 && recovered.y < 820,
  `feet viewport y=${Math.round(recovered.y)} after the viewport was yanked away`,
);

// And it should still be resting on something solid afterwards.
await page.waitForTimeout(300);
check(
  "character stays inside the viewport",
  (await read()).y < 820,
  `feet viewport y=${Math.round((await read()).y)}`,
);

/* ------------------------------------------------------------ 6. esc frees */

await page.keyboard.press("Escape");
await page.waitForTimeout(200);
check("Escape releases control", !(await isControlling()));

/* ------------------------------------------------- 7. arrow keys scroll again */

const sBefore = await page.evaluate(() => window.scrollY);
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(500);
const sAfter = await page.evaluate(() => window.scrollY);
check(
  "arrow keys scroll normally once control is released",
  sAfter !== sBefore,
  `${Math.round(sBefore)} → ${Math.round(sAfter)}`,
);

/* --------------------------------------------------------- 8. arcade plays */

await page.evaluate(() => document.getElementById("arcade").scrollIntoView());
await page.waitForTimeout(700);
// exact: the "Press Start" achievement popup is also a button.
await page.getByRole("button", { name: "PRESS START", exact: true }).click();
await page.waitForTimeout(500);

const gemCount = await page.locator("[role=application] button[aria-label]").count();
check("arcade board fills 49 cells", gemCount === 49, `${gemCount} gems`);

const move = await page.evaluate(() => {
  const C = 7, R = 7;
  const g = Array(49).fill(null);
  const nodes = {};
  for (const b of document.querySelectorAll("[role=application] button[aria-label]")) {
    const m = b.getAttribute("aria-label").match(/row (\d+), column (\d+)/);
    const i = (+m[1] - 1) * C + (+m[2] - 1);
    g[i] = b.querySelector("img").getAttribute("src");
    nodes[i] = b;
  }
  const ix = (r, c) => r * C + c;
  const matches = (bd) => {
    const hit = new Set();
    for (let r = 0; r < R; r++) { let run = 1;
      for (let c = 1; c <= C; c++) { const p = bd[ix(r, c - 1)], cu = c < C ? bd[ix(r, c)] : null;
        if (cu && cu === p) run++; else { if (run >= 3) for (let k = c - run; k < c; k++) hit.add(ix(r, k)); run = 1; } } }
    for (let c = 0; c < C; c++) { let run = 1;
      for (let r = 1; r <= R; r++) { const p = bd[ix(r - 1, c)], cu = r < R ? bd[ix(r, c)] : null;
        if (cu && cu === p) run++; else { if (run >= 3) for (let k = r - run; k < r; k++) hit.add(ix(k, c)); run = 1; } } }
    return [...hit];
  };
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++)
    for (const [dr, dc] of [[0, 1], [1, 0]]) {
      const nr = r + dr, nc = c + dc;
      if (nr >= R || nc >= C) continue;
      const t = g.slice(); const i1 = ix(r, c), i2 = ix(nr, nc);
      [t[i1], t[i2]] = [t[i2], t[i1]];
      if (matches(t).length) {
        const b1 = nodes[i1].getBoundingClientRect(), b2 = nodes[i2].getBoundingClientRect();
        return { a: [b1.left + b1.width / 2, b1.top + b1.height / 2], b: [b2.left + b2.width / 2, b2.top + b2.height / 2] };
      }
    }
  return null;
});

check("a legal opening move exists", !!move);

if (move) {
  const hpBefore = await page.evaluate(() =>
    +document.body.innerText.match(/(\d+)\/260/)[1]);
  await page.mouse.click(move.a[0], move.a[1]);
  await page.mouse.click(move.b[0], move.b[1]);
  await page.waitForTimeout(1600);
  const hpAfter = await page.evaluate(() =>
    +document.body.innerText.match(/(\d+)\/260/)[1]);
  check("a match damages the boss", hpAfter < hpBefore, `${hpBefore} → ${hpAfter}`);
}

/* --------------------------------------------------------------- 9. coins */

await page.evaluate(() => document.getElementById("roster").scrollIntoView());
await page.waitForTimeout(500);
const coinsBefore = await page.evaluate(
  () => +document.body.innerText.match(/(\d+)\/12/)[1],
);
// The coin bobs forever, so Playwright never considers it "stable". Scroll to
// it and click it directly instead.
const clicked = await page.evaluate(async () => {
  const el = document.querySelector("button[data-coin]");
  if (!el) return false;
  el.scrollIntoView({ block: "center", behavior: "instant" });
  await new Promise((r) => setTimeout(r, 150));
  el.click();
  return true;
});
if (clicked) {
  await page.waitForTimeout(400);
  const coinsAfter = await page.evaluate(
    () => +document.body.innerText.match(/(\d+)\/12/)[1],
  );
  check(
    "clicking a coin increments the counter",
    coinsAfter === coinsBefore + 1,
    `${coinsBefore} -> ${coinsAfter}`,
  );
} else {
  check("a collectible coin is present", false);
}

check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
