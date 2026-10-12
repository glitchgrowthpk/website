/**
 * Headless checks for the interactive layer: boot screen, pause menu,
 * settings, achievements, coins, level tracking, scroll reveal, cursor,
 * reduced motion and small screens.
 * Run with the dev (or prod) server already listening:
 *   node scripts/verify-interactive.mjs [url]
 */
import { chromium } from "playwright";

const URL = process.argv[2] ?? "http://localhost:3100";
const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch();

/** A fresh visitor: empty storage, so the boot screen plays. */
async function freshPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  return { ctx, page, errors };
}

const stored = (page, key) =>
  page.evaluate((k) => {
    try {
      return JSON.parse(localStorage.getItem(k) || "null");
    } catch {
      return null;
    }
  }, key);

const bootVisible = (page) =>
  page.evaluate(() => {
    // The boot overlay is the only fixed, full-viewport element at z-80.
    return [...document.querySelectorAll("body *")].some((el) => {
      const cs = getComputedStyle(el);
      if (cs.position !== "fixed" || cs.zIndex !== "80") return false;
      if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity < 0.05) return false;
      const r = el.getBoundingClientRect();
      return r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9;
    });
  });

/* ------------------------------------------------------------ 1. boot */

{
  const { ctx, page, errors } = await freshPage();
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  const early = await bootVisible(page);
  check("boot screen covers the page on a first visit", early);
  await page.waitForTimeout(3000);
  check("boot screen dismisses itself within 3s", !(await bootVisible(page)));
  await page.waitForTimeout(1500);
  const ach = (await stored(page, "glitch.achievements")) ?? [];
  check('"Press Start" achievement unlocks', ach.includes("press-start"), JSON.stringify(ach));

  // Same session reload: no boot.
  await page.reload({ waitUntil: "domcontentloaded" });
  check("boot screen does not replay in the same session", !(await bootVisible(page)));

  check("no console errors (boot)", errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
}

{
  // Any key skips it immediately.
  const { ctx, page } = await freshPage();
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(250);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(700);
  check("a key press skips the boot screen", !(await bootVisible(page)));
  await ctx.close();
}

/* ---------------------------------------------- 2. pause menu + settings */

const skipBoot = async (ctx) =>
  ctx.addInitScript(() => {
    try {
      sessionStorage.setItem("glitch.booted", "1");
    } catch {}
  });

{
  const { ctx, page, errors } = await freshPage();
  await skipBoot(ctx);
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  const dialogOpen = () => page.evaluate(() => !!document.querySelector("dialog[open]"));

  await page.keyboard.press("p");
  await page.waitForTimeout(400);
  check("P opens the pause menu", await dialogOpen());
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  check("Escape closes the pause menu", !(await dialogOpen()));

  await page.getByRole("button", { name: /^Menu$/ }).click();
  await page.waitForTimeout(400);
  check("the HUD Menu button opens the pause menu", await dialogOpen());

  // Settings: CRT switch flips the html attribute.
  const before = await page.evaluate(() => document.documentElement.dataset.crt);
  const crt = page.getByRole("switch", { name: /crt/i });
  if (await crt.count()) {
    await crt.first().click();
    await page.waitForTimeout(250);
    const after = await page.evaluate(() => document.documentElement.dataset.crt);
    check("CRT switch toggles the overlay", before !== after, `${before} → ${after}`);
    await crt.first().click();
  } else {
    // It may live on the settings screen rather than the main one.
    const settings = page.getByRole("button", { name: /settings/i }).first();
    await settings.click();
    await page.waitForTimeout(300);
    const crt2 = page.getByRole("switch", { name: /crt/i }).first();
    await crt2.click();
    await page.waitForTimeout(250);
    const after = await page.evaluate(() => document.documentElement.dataset.crt);
    check("CRT switch toggles the overlay", before !== after, `${before} → ${after}`);
    await crt2.click();
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // The level pill jumps straight to achievements.
  await page.getByRole("button", { name: /^Level \d/ }).click();
  await page.waitForTimeout(400);
  const onAchievements = await page.evaluate(() => {
    const d = document.querySelector("dialog[open]");
    return !!d && /achievement/i.test(d.textContent || "");
  });
  check("the HUD level pill opens the achievements screen", onAchievements);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  /* --------------------------------------------- 3. coins + collector */

  const coinIds = await page.evaluate(() =>
    [...document.querySelectorAll("[data-coin]")].map((c) => c.getAttribute("data-coin")),
  );
  check("all 12 coins are placed on the page", new Set(coinIds).size === 12, coinIds.join(","));

  for (const id of coinIds) {
    await page.evaluate(async (cid) => {
      const el = document.querySelector(`[data-coin="${cid}"]`);
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: "instant" });
      await new Promise((r) => setTimeout(r, 120));
      el.click();
    }, id);
  }
  await page.waitForTimeout(600);
  const coins = (await stored(page, "glitch.coins")) ?? [];
  check("every coin can be collected by clicking", coins.length === 12, `${coins.length}/12`);
  const ach = (await stored(page, "glitch.achievements")) ?? [];
  check('"Collector" unlocks after the last coin', ach.includes("collector"));

  /* ------------------------------------------ 4. level tracking + reveal */

  await page.evaluate(async () => {
    const H = document.documentElement.scrollHeight;
    for (let y = 0; y <= H; y += Math.round(innerHeight * 0.5)) {
      window.scrollTo({ top: y, behavior: "instant" });
      await new Promise((r) => setTimeout(r, 220));
    }
  });
  await page.waitForTimeout(900);
  const visited = (await stored(page, "glitch.visited")) ?? [];
  check("scrolling the page visits all 7 sections", visited.length >= 7, visited.join(","));
  const ach2 = (await stored(page, "glitch.achievements")) ?? [];
  check('"Level Select" unlocks after visiting every section', ach2.includes("tourist"));

  const hidden = await page.evaluate(
    () =>
      [...document.querySelectorAll("[data-reveal]")].filter(
        (el) => getComputedStyle(el).opacity === "0",
      ).length,
  );
  check("no reveal element is left invisible after a full scroll", hidden === 0, `${hidden} hidden`);

  /* ------------------------------------------------------- 5. cursor */

  await page.mouse.move(400, 300);
  await page.mouse.move(420, 320);
  await page.waitForTimeout(200);
  const cursorOn = await page.evaluate(() =>
    document.documentElement.hasAttribute("data-cursor-active"),
  );
  check("reticle cursor engages on a fine pointer", cursorOn);

  check("no console errors (menu, coins, scroll)", errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
}

/* ------------------------------------------------- 6. reduced motion */

{
  const { ctx, page, errors } = await freshPage({ reducedMotion: "reduce" });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(300);
  check("reduced motion: no boot screen", !(await bootVisible(page)));
  await page.waitForTimeout(800);
  const hidden = await page.evaluate(
    () =>
      [...document.querySelectorAll("[data-reveal]")].filter(
        (el) => getComputedStyle(el).opacity === "0",
      ).length,
  );
  check("reduced motion: nothing is hidden waiting for a reveal", hidden === 0, `${hidden} hidden`);
  const cursorOn = await page.evaluate(() =>
    document.documentElement.hasAttribute("data-cursor-active"),
  );
  check("reduced motion: native cursor kept", !cursorOn);
  check("no console errors (reduced motion)", errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
}

/* ------------------------------------------------------ 7. phone */

{
  const { ctx, page, errors } = await freshPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  await skipBoot(ctx);
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check("phone: no horizontal overflow", overflow <= 1, `${overflow}px`);

  await page.getByRole("button", { name: /^Menu$/ }).tap();
  await page.waitForTimeout(500);
  const fits = await page.evaluate(() => {
    const d = document.querySelector("dialog[open]");
    if (!d) return null;
    const r = d.getBoundingClientRect();
    return { w: Math.round(r.width), right: Math.round(r.right), vw: innerWidth };
  });
  check(
    "phone: the menu opens and fits the screen",
    !!fits && fits.right <= fits.vw + 1,
    JSON.stringify(fits),
  );
  // The menu is the phone's navigation: it must offer every section.
  const sectionLinks = await page.evaluate(() => {
    const d = document.querySelector("dialog[open]");
    const t = (d?.textContent || "").toUpperCase();
    return ["STUDIO", "ROSTER", "ARCADE", "PIPELINE", "PARTNER"].filter((s) => t.includes(s)).length;
  });
  check("phone: the menu lists the site sections", sectionLinks === 5, `${sectionLinks}/5`);
  check("no console errors (phone)", errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
}

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
