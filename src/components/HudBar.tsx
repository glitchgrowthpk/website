"use client";

import { useEffect, useState } from "react";
import { SECTIONS } from "@/data/studio";
import { useGame } from "@/lib/game-state";
import { sfx } from "@/lib/audio";
import { useIsTouch } from "@/lib/hooks";

export default function HudBar() {
  const {
    coinCount,
    totalCoins,
    sound,
    toggleSound,
    controlling,
    setControlling,
    level,
    levelProgress,
    maxLevel,
    achievements,
    totalAchievements,
    menu,
    openMenu,
    settings,
  } = useGame();
  const [progress, setProgress] = useState(0);
  const [active, setActive] = useState<string>("top");
  const touch = useIsTouch();

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const max = document.body.scrollHeight - window.innerHeight;
        setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 0);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target.id) setActive(visible.target.id);
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: [0, 0.2, 0.6] },
    );
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, []);

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      {/* Named so view transitions (the portfolio filter morph) keep the HUD
          as its own layer above the moving cards. The name sits on the blurred
          bar itself: a view-transition-name makes its element a backdrop
          root, so on the <header> it would hide the page from this blur. */}
      <div
        className="relative border-b border-edge/70 bg-void/80 backdrop-blur-md"
        style={{ viewTransitionName: "hud" }}
      >
        <div className="mx-auto flex h-[var(--hud-h)] max-w-[1400px] items-center gap-3 px-4 sm:gap-5 sm:px-6">
          {/* wordmark */}
          <a
            href="#top"
            className="group flex shrink-0 items-center gap-2"
            aria-label="GlitchTech Games — back to top"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo-mark.webp"
              alt=""
              width={18}
              height={29}
              className="h-[26px] w-auto transition-transform duration-200 group-hover:scale-110"
            />
            <span className="font-display text-[15px] tracking-wide sm:text-[17px]">
              GLITCH
              <span className="text-muted group-hover:text-lime"> GAMES</span>
            </span>
          </a>

          {/* nav */}
          <nav
            aria-label="Sections"
            className="hide-scroll ml-auto hidden overflow-x-auto md:block"
          >
            <ul className="flex items-center gap-1">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    aria-current={active === s.id ? "true" : undefined}
                    onMouseEnter={() => sfx.hover()}
                    className={`mono block rounded-md px-2.5 py-1.5 text-[11px] uppercase tracking-[0.18em] transition-colors ${
                      active === s.id
                        ? "bg-panel-2 text-cyan"
                        : "text-muted hover:text-ink"
                    }`}
                  >
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="ml-auto flex items-center gap-2 md:ml-0">
            {/* coins */}
            <div
              className="mono flex items-center gap-1.5 rounded-md border border-edge bg-panel px-2 py-1.5 text-[11px] tabular-nums"
              title="Coins hidden around the page"
            >
              <span className="inline-block h-3 w-3 rounded-full bg-gradient-to-br from-amber to-magenta" />
              <span aria-live="polite" aria-atomic="true">
                <span className="sr-only">Coins collected: </span>
                {coinCount}
                <span className="text-muted">/{totalCoins}</span>
              </span>
            </div>

            {/* level + achievements */}
            <button
              type="button"
              onClick={() => {
                sfx.menuOpen();
                openMenu("achievements");
              }}
              onMouseEnter={() => sfx.hover()}
              aria-haspopup="dialog"
              aria-label={`Level ${level}${maxLevel ? " (max)" : ""}. ${achievements.length} of ${totalAchievements} achievements unlocked. Open achievements.`}
              className="mono group relative flex items-center gap-1.5 overflow-hidden rounded-md border border-edge bg-panel px-2 py-1.5 text-[11px] tabular-nums transition-colors hover:border-lime"
            >
              <span
                key={level}
                className="font-bold text-lime motion-safe:animate-[lvlup_.7s_var(--ease-pop)]"
              >
                {maxLevel ? "MAX" : `LV${level}`}
              </span>
              <span className="hidden items-center gap-1 text-muted sm:flex">
                <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M7 3h10v3h3v3a5 5 0 0 1-4.6 5A5 5 0 0 1 13 16.9V19h3v2H8v-2h3v-2.1A5 5 0 0 1 8.6 14 5 5 0 0 1 4 9V6h3V3zm0 5H6v1a3 3 0 0 0 1.2 2.4C7.1 10.6 7 9.8 7 9V8zm10 0v1c0 .8-.1 1.6-.2 2.4A3 3 0 0 0 18 9V8h-1z"
                    fill="currentColor"
                  />
                </svg>
                <span className="text-ink">{achievements.length}</span>
                <span>/{totalAchievements}</span>
              </span>
              {/* XP toward the next level */}
              <span
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 h-[2px] bg-panel-2"
              >
                <span
                  className="block h-full bg-lime transition-[width] duration-500"
                  style={{ width: `${(maxLevel ? 1 : levelProgress) * 100}%` }}
                />
              </span>
            </button>

            {/* take control */}
            <button
              type="button"
              onClick={() => {
                sfx.select();
                setControlling(!controlling);
              }}
              aria-pressed={controlling}
              aria-keyshortcuts={settings.shortcuts ? "G" : undefined}
              className={`mono hidden rounded-md border px-2.5 py-1.5 text-[11px] uppercase tracking-[0.14em] transition-colors sm:block ${
                controlling
                  ? "border-lime bg-lime/15 text-lime"
                  : "border-edge bg-panel text-muted hover:text-ink"
              }`}
            >
              {controlling ? "Control ON" : "Control"}
              {/* The key hint is visual only; aria-keyshortcuts carries it. */}
              {!touch && settings.shortcuts && (
                <span aria-hidden="true" className="ml-1.5 text-muted">
                  G
                </span>
              )}
            </button>

            {/* sound */}
            <button
              type="button"
              onClick={toggleSound}
              aria-pressed={sound}
              aria-label={sound ? "Turn sound off" : "Turn sound on"}
              className={`hidden rounded-md border px-2 py-1.5 transition-colors min-[400px]:block ${
                sound
                  ? "border-cyan bg-cyan/15 text-cyan"
                  : "border-edge bg-panel text-muted hover:text-ink"
              }`}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M4 9v6h4l5 4V5L8 9H4z"
                  fill="currentColor"
                />
                {sound ? (
                  <path
                    d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    fill="none"
                    strokeLinecap="round"
                  />
                ) : (
                  <path
                    d="M17 9.5l4 5m0-5l-4 5"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                )}
              </svg>
            </button>

            {/* pause menu — also the section menu on small screens */}
            <button
              type="button"
              onClick={() => {
                sfx.menuOpen();
                openMenu("main");
              }}
              onMouseEnter={() => sfx.hover()}
              aria-haspopup="dialog"
              aria-expanded={menu !== null}
              aria-keyshortcuts={settings.shortcuts ? "P" : undefined}
              className="mono flex items-center gap-1.5 rounded-md border border-edge bg-panel px-2 py-1.5 text-[11px] uppercase tracking-[0.14em] text-muted transition-colors hover:border-cyan hover:text-ink"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
                <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
              </svg>
              <span className="sr-only sm:not-sr-only">Menu</span>
              {!touch && settings.shortcuts && (
                <span aria-hidden="true" className="hidden text-muted lg:inline">
                  P
                </span>
              )}
            </button>
          </div>
        </div>

        {/* scroll / XP bar */}
        <div
          className="h-[3px] w-full bg-panel-2"
          role="progressbar"
          aria-label="Page progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <div
            className="h-full bg-gradient-to-r from-cyan via-violet to-magenta transition-[width] duration-150"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>

      <style>{`@keyframes lvlup{0%{transform:scale(1.9);filter:brightness(2)}100%{transform:scale(1);filter:none}}`}</style>
    </header>
  );
}
