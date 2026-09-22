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
  } = useGame();
  const [progress, setProgress] = useState(0);
  const [active, setActive] = useState<string>("top");
  const [open, setOpen] = useState(false);
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
      <div className="relative border-b border-edge/70 bg-void/80 backdrop-blur-md">
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

            {/* take control */}
            <button
              type="button"
              onClick={() => {
                sfx.select();
                setControlling(!controlling);
              }}
              aria-pressed={controlling}
              className={`mono hidden rounded-md border px-2.5 py-1.5 text-[11px] uppercase tracking-[0.14em] transition-colors sm:block ${
                controlling
                  ? "border-lime bg-lime/15 text-lime"
                  : "border-edge bg-panel text-muted hover:text-ink"
              }`}
            >
              {controlling ? "Control ON" : "Control"}
              {!touch && <span className="ml-1.5 text-muted">G</span>}
            </button>

            {/* sound */}
            <button
              type="button"
              onClick={toggleSound}
              aria-pressed={sound}
              aria-label={sound ? "Turn sound off" : "Turn sound on"}
              className={`rounded-md border px-2 py-1.5 transition-colors ${
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

            {/* mobile menu */}
            <button
              type="button"
              className="rounded-md border border-edge bg-panel px-2 py-1.5 text-muted md:hidden"
              aria-expanded={open}
              aria-controls="hud-mobile-nav"
              onClick={() => setOpen((o) => !o)}
            >
              <span className="sr-only">Menu</span>
              <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d={open ? "M5 5l14 14M19 5L5 19" : "M4 7h16M4 12h16M4 17h16"}
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
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

      {open && (
        <nav
          id="hud-mobile-nav"
          aria-label="Sections"
          className="border-b border-edge bg-abyss/97 backdrop-blur-md md:hidden"
        >
          <ul className="grid grid-cols-2 gap-1 p-3">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  onClick={() => setOpen(false)}
                  className="mono block rounded-md border border-edge bg-panel px-3 py-2.5 text-[11px] uppercase tracking-[0.18em] text-muted"
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
