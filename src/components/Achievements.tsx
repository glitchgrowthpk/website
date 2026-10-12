"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useGame } from "@/lib/game-state";
import type { Achievement } from "@/data/achievements";
import { spriteSrc } from "@/data/characters";
import { sfx } from "@/lib/audio";
import { fx } from "@/lib/fx";
import { useIsTouch } from "@/lib/hooks";

/** Fully open, readable time. Paused while hovered or focused. */
const HOLD_MS = 3200;
/** Circle pop + expand into a bar. Matches the CSS timeline below. */
const INTRO_MS = 680;
/** Collapse back to a circle + drop out. */
const OUTRO_MS = 540;

/** Pointy-top hexagon used for every trophy badge on the site. */
const HEX = "polygon(50% 0, 94% 25%, 94% 75%, 50% 100%, 6% 75%, 6% 25%)";

const prefersReduced = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The HUD's level/trophy pill: the permanent home of the achievements screen,
 * so focus lands there when a popup that opened the menu is gone.
 */
export function trophyPill() {
  return (
    document.querySelector<HTMLElement>('header button[aria-haspopup="dialog"][aria-label^="Level"]') ??
    document.querySelector<HTMLElement>('header button[aria-haspopup="dialog"]')
  );
}

/* ------------------------------------------------------------------ badge */

/**
 * A hex trophy badge with the achievement's character inside. Unlocked badges
 * get a spinning neon rim; locked ones show the sprite as a silhouette.
 * Shared by the popup and the pause menu's achievements screen.
 */
export function AchievementBadge({
  icon,
  unlocked,
  size = 60,
  className = "",
  lazy = false,
}: {
  icon: string;
  unlocked: boolean;
  size?: number;
  className?: string;
  lazy?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`ach-badge relative block shrink-0 ${unlocked ? "ach-badge-on" : ""} ${className}`}
      style={{ width: size, height: size }}
    >
      <span
        className="absolute -inset-[3px] overflow-hidden"
        style={{ clipPath: HEX }}
      >
        {unlocked ? (
          <span className="ach-rim absolute -inset-1/2 bg-[conic-gradient(from_0deg,#c8ff2e,#00e5ff,#8b5cf6,#ffb020,#c8ff2e)]" />
        ) : (
          <span className="absolute inset-0 bg-edge" />
        )}
      </span>
      <span
        className={`absolute inset-0 grid place-items-center overflow-hidden ${
          unlocked
            ? "bg-[radial-gradient(circle_at_50%_30%,#2a2a3d_0%,#12121d_70%)]"
            : "bg-[radial-gradient(circle_at_50%_30%,#3a3a52_0%,#1a1a28_75%)]"
        }`}
        style={{ clipPath: HEX }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={spriteSrc(icon)}
          alt=""
          loading={lazy ? "lazy" : undefined}
          decoding="async"
          className="h-[76%] w-auto max-w-[80%] object-contain"
          style={
            unlocked
              ? { filter: "drop-shadow(0 3px 4px rgba(0,0,0,0.6))" }
              : { filter: "brightness(0)", opacity: 0.55 }
          }
        />
      </span>
    </span>
  );
}

/* ----------------------------------------------------------------- popups */

/**
 * Console-style "achievement unlocked" toasts. Shows the head of the
 * provider's popup queue one at a time: a badge pops in as a circle, stretches
 * into a bar, holds, then folds away and hands over to the next one.
 *
 * The queue is held while the pause menu is open — its <dialog> lives in the
 * browser's top layer and would cover the popup. One that arrives during the
 * menu waits for it to close and then makes its full entrance. One the menu
 * interrupts freezes where it is, hidden, and slips back in silently on
 * close: the fanfare only ever plays once.
 */
export function AchievementPopups() {
  const { popup, nextPopup, menu, openMenu, controlling } = useGame();
  const touch = useIsTouch();
  const held = menu !== null;

  // The popup that has already made its entrance. Adjusted during render
  // (React's pattern for state derived from changing props).
  const [live, setLive] = useState<string | null>(null);
  const want = popup && (!held || live === popup.id) ? popup.id : null;
  if (want !== live) setLive(want);
  const shown = want ? popup : null;

  // Phones get a notification-style banner just under the HUD: at the bottom
  // it sat over the hero's sprite stage and its coin, and over the D-pad while
  // in control. Larger screens keep the console-style bottom-right corner,
  // clear of the control chip — unless the touch D-pad is up.
  const top = "top-[calc(var(--hud-h)+10px)]";
  const place =
    controlling && touch
      ? top
      : controlling
        ? `${top} sm:top-auto sm:bottom-[76px]`
        : `${top} sm:top-auto sm:bottom-6`;

  return (
    <>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {shown ? `Achievement unlocked: ${shown.title}. ${shown.desc}` : ""}
      </div>

      {shown && (
        <Popup
          key={shown.id}
          a={shown}
          held={held}
          place={place}
          onDone={nextPopup}
          onOpen={() => {
            // The popup unmounts as the menu opens, so park focus on the HUD
            // trophy pill first — the menu hands focus back there on close.
            trophyPill()?.focus({ preventScroll: true });
            nextPopup();
            sfx.menuOpen();
            openMenu("achievements");
          }}
        />
      )}

      <style>{CSS}</style>
    </>
  );
}

function Popup({
  a,
  held,
  place,
  onDone,
  onOpen,
}: {
  a: Achievement;
  /** The pause menu is open: freeze, hide and stop the clock. */
  held: boolean;
  /** Tailwind bottom offsets for the current HUD furniture. */
  place: string;
  onDone: () => void;
  onOpen: () => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const badge = useRef<HTMLSpanElement>(null);
  const xp = useRef<HTMLSpanElement>(null);
  /** Pause/resume handles for the hold timer, keyed by reason. */
  const clock = useRef<{ hold: (why: string) => void; release: (why: string) => void } | null>(
    null,
  );
  const wasHeld = useRef(false);
  const [phase, setPhase] = useState<"in" | "out">("in");

  // Arrival: fanfare, particles off the badge, a buzz, and the XP ticking up.
  // Deferred a tick so a development double-mount only fires once.
  useEffect(() => {
    const reduced = prefersReduced();
    const counter = xp.current;
    let raf = 0;
    const fanfare = window.setTimeout(() => {
      sfx.achievement();
      fx.haptic([10, 40, 10]);
      if (reduced) return;
      fx.burstAt(badge.current, "achievement");
      if (a.id === "completionist") {
        fx.burstAt(badge.current, "confetti");
        fx.flash("#c8ff2e", 0.12);
      }

      // Written straight to the text node — no re-render per frame.
      if (!counter) return;
      counter.textContent = "0";
      const t0 = performance.now() + 420;
      const tick = (t: number) => {
        const p = Math.max(0, Math.min(1, (t - t0) / 650));
        counter.textContent = String(Math.round(a.points * (1 - Math.pow(1 - p, 3))));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, 40);
    return () => {
      window.clearTimeout(fanfare);
      cancelAnimationFrame(raf);
      if (counter) counter.textContent = String(a.points);
    };
  }, [a]);

  // Hold timer. Hovering or focusing the popup pauses it so nobody has to
  // race a timeout to read it (WCAG 2.2.1); so do a background tab and the
  // pause menu, so it never expires unseen. A layout effect only so it is in
  // place before the menu effect below runs.
  useLayoutEffect(() => {
    const el = btn.current;
    if (!el) return;
    let left = (prefersReduced() ? 0 : INTRO_MS) + HOLD_MS;
    let started = 0;
    let timer = 0;
    const holds = new Set<string>();

    const run = () => {
      started = performance.now();
      timer = window.setTimeout(() => setPhase("out"), left);
    };
    const hold = (why: string) => {
      if (holds.has(why)) return;
      if (!holds.size) {
        window.clearTimeout(timer);
        left -= performance.now() - started;
      }
      holds.add(why);
    };
    const release = (why: string) => {
      if (!holds.delete(why) || holds.size) return;
      left = Math.max(1200, left);
      run();
    };
    clock.current = { hold, release };
    run();

    const onVisibility = () => (document.hidden ? hold("tab") : release("tab"));
    onVisibility();
    const on: [EventTarget, string, () => void][] = [
      [el, "pointerenter", () => hold("hover")],
      [el, "pointerleave", () => release("hover")],
      [el, "focus", () => hold("focus")],
      [el, "blur", () => release("focus")],
      [document, "visibilitychange", onVisibility],
    ];
    on.forEach(([t, type, fn]) => t.addEventListener(type, fn));
    return () => {
      window.clearTimeout(timer);
      clock.current = null;
      on.forEach(([t, type, fn]) => t.removeEventListener(type, fn));
    };
  }, []);

  // The pause menu stops the clock. Coming back, the popup slips in again with
  // a quick pop instead of replaying its whole entrance and fanfare. Layout
  // effect, so the frame where it reappears already has the animation.
  useLayoutEffect(() => {
    if (held) {
      clock.current?.hold("menu");
      wasHeld.current = true;
      return;
    }
    clock.current?.release("menu");
    if (!wasHeld.current) return;
    wasHeld.current = false;
    if (prefersReduced()) return;
    wrap.current?.animate(
      [
        { opacity: 0, translate: "0 14px", scale: "0.92" },
        { opacity: 1, translate: "0 0", scale: "1" },
      ],
      // Waits out the dialog's own fold-away first.
      { duration: 360, delay: 160, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)", fill: "backwards" },
    );
  }, [held]);

  // Fold away, then hand the slot to the next achievement in the queue.
  useEffect(() => {
    if (phase !== "out") return;
    const t = window.setTimeout(onDone, prefersReduced() ? 0 : OUTRO_MS);
    return () => window.clearTimeout(t);
  }, [phase, onDone]);

  return (
    <div
      ref={wrap}
      data-held={held ? "" : undefined}
      className={`ach-wrap pointer-events-none fixed inset-x-0 z-[65] flex justify-center px-4 sm:inset-x-auto sm:right-6 sm:px-0 ${place}`}
    >
      <button
        ref={btn}
        type="button"
        onClick={onOpen}
        data-phase={phase}
        data-cursor="OPEN"
        aria-label={`Achievement unlocked: ${a.title}, plus ${a.points} XP. Open achievements.`}
        className="ach-pop group pointer-events-auto relative block h-[76px] rounded-full text-left"
      >
        {/* the bar that grows out of the badge */}
        <span className="ach-body absolute inset-0 overflow-hidden rounded-full border border-lime/55 bg-abyss/95 shadow-[0_0_0_1px_rgba(0,0,0,0.6),0_0_36px_rgba(200,255,46,0.22),0_18px_40px_rgba(0,0,0,0.55)] backdrop-blur transition-[border-color,box-shadow] duration-200 group-hover:border-lime group-hover:shadow-[0_0_0_1px_rgba(0,0,0,0.6),0_0_44px_rgba(200,255,46,0.38),0_18px_40px_rgba(0,0,0,0.55)]">
          <span className="ach-grid absolute inset-0 opacity-40" />
          <span className="ach-shine absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
          <span className="ach-text absolute inset-y-0 left-[84px] right-6 flex flex-col justify-center gap-1">
            <span className="mono flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-muted">
              <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true" className="text-amber">
                <path
                  d="M7 3h10v3h3v3a5 5 0 0 1-4.6 5A5 5 0 0 1 13 16.9V19h3v2H8v-2h3v-2.1A5 5 0 0 1 8.6 14 5 5 0 0 1 4 9V6h3V3zm0 5H6v1a3 3 0 0 0 1.2 2.4C7.1 10.6 7 9.8 7 9V8zm10 0v1c0 .8-.1 1.6-.2 2.4A3 3 0 0 0 18 9V8h-1z"
                  fill="currentColor"
                />
              </svg>
              Achievement unlocked
            </span>
            <span className="flex items-baseline gap-3">
              <span className="min-w-0 flex-1 truncate font-display text-[21px] leading-tight text-ink">
                {a.title}
              </span>
              <span className="mono shrink-0 text-[12px] font-bold tabular-nums text-lime">
                +<span ref={xp}>{a.points}</span> XP
              </span>
            </span>
          </span>
        </span>

        <span ref={badge} className="ach-slot absolute left-2 top-2 block">
          {/* the circle the bar grows out of, and a one-shot shockwave */}
          <span className="ach-ring absolute -inset-2 rounded-full border-2 border-lime/80 bg-abyss shadow-[0_0_20px_rgba(200,255,46,0.5),inset_0_0_14px_rgba(200,255,46,0.3)]" />
          <span className="ach-pulse absolute -inset-2 rounded-full border-2 border-lime" />
          <AchievementBadge icon={a.icon} unlocked size={60} />
        </span>
      </button>
    </div>
  );
}

/*
 * Timeline (motion allowed):
 *   0ms     the bar is clipped to a 76px circle around the centred badge; it pops in
 *   260ms   the clip opens to full width while the badge slides to the left end
 *   520ms   text slides in, XP starts counting, a shine sweeps the bar
 *   out     text fades, the bar folds back into the badge, the circle drops away
 */
const CSS = `
.ach-pop {
  --ach-w: min(360px, calc(100vw - 32px));
  --ach-c: calc(var(--ach-w) / 2 - 38px);
  width: var(--ach-w);
}
.ach-badge-on { filter: drop-shadow(0 0 10px rgba(200, 255, 46, 0.45)); }
.ach-grid {
  background-image:
    linear-gradient(to right, rgba(200, 255, 46, 0.07) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(0, 229, 255, 0.06) 1px, transparent 1px);
  background-size: 14px 14px;
  mask-image: linear-gradient(to right, #000, transparent 70%);
  -webkit-mask-image: linear-gradient(to right, #000, transparent 70%);
}
.ach-shine { transform: translateX(-120%) skewX(-20deg); }
.ach-ring, .ach-pulse { opacity: 0; }
/* the global focus ring squares corners off; keep it pill-shaped */
.ach-pop:focus-visible { border-radius: 999px; outline-offset: 4px; }
/* Behind the pause menu: hidden and frozen mid-move, so it picks up exactly
   where it left off. !important because the phase rules below set the
   animation shorthand (and with it the play state) at higher specificity. */
.ach-wrap[data-held] { visibility: hidden; }
.ach-wrap[data-held] * { animation-play-state: paused !important; }

@media (prefers-reduced-motion: no-preference) {
  .ach-badge-on .ach-rim { animation: ach-spin 3.2s linear infinite; }

  .ach-pop[data-phase="in"] .ach-ring { animation: ach-ring 0.62s linear both; }
  .ach-pop[data-phase="in"] .ach-pulse { animation: ach-pulse 0.7s 0.1s cubic-bezier(0.16, 1, 0.3, 1) both; }
  .ach-pop[data-phase="out"] .ach-ring { animation: ach-ring 0.36s linear reverse both; }

  .ach-pop[data-phase="in"] { animation: ach-pop 0.34s var(--ease-pop) both; }
  .ach-pop[data-phase="in"] .ach-body { animation: ach-open 0.42s 0.26s cubic-bezier(0.16, 1, 0.3, 1) both; }
  .ach-pop[data-phase="in"] .ach-slot { animation: ach-slide 0.42s 0.26s cubic-bezier(0.16, 1, 0.3, 1) both; }
  .ach-pop[data-phase="in"] .ach-text { animation: ach-text 0.34s 0.52s cubic-bezier(0.16, 1, 0.3, 1) both; }
  .ach-pop[data-phase="in"] .ach-shine { animation: ach-shine 0.9s 0.72s ease-in-out both; }
  .ach-pop[data-phase="in"]:hover .ach-slot > .ach-badge { animation: ach-wiggle 0.5s var(--ease-pop); }

  .ach-pop[data-phase="out"] .ach-text { animation: ach-text 0.14s cubic-bezier(0.7, 0, 0.84, 0) reverse both; }
  .ach-pop[data-phase="out"] .ach-body { animation: ach-open 0.3s 0.08s cubic-bezier(0.7, 0, 0.84, 0) reverse both; }
  .ach-pop[data-phase="out"] .ach-slot { animation: ach-slide 0.3s 0.08s cubic-bezier(0.7, 0, 0.84, 0) reverse both; }
  .ach-pop[data-phase="out"] { animation: ach-drop 0.16s 0.37s ease-in both; }
}
@media (prefers-reduced-motion: reduce) {
  .ach-pop[data-phase="out"] { visibility: hidden; }
}

@keyframes ach-spin { to { transform: rotate(360deg); } }
@keyframes ach-ring {
  0%, 45% { opacity: 1; }
  100% { opacity: 0; }
}
@keyframes ach-pulse {
  from { opacity: 0.9; transform: scale(0.9); }
  to { opacity: 0; transform: scale(2.1); }
}
@keyframes ach-pop {
  0% { transform: scale(0.1); opacity: 0; }
  55% { opacity: 1; }
  100% { transform: scale(1); }
}
@keyframes ach-open {
  from { clip-path: inset(0 var(--ach-c) 0 var(--ach-c) round 38px); }
  to { clip-path: inset(0 0 0 0 round 38px); }
}
@keyframes ach-slide {
  from { transform: translateX(var(--ach-c)); }
  to { transform: translateX(0); }
}
@keyframes ach-text {
  from { opacity: 0; transform: translateX(-12px); }
  to { opacity: 1; transform: translateX(0); }
}
@keyframes ach-shine {
  from { transform: translateX(-120%) skewX(-20deg); }
  to { transform: translateX(360%) skewX(-20deg); }
}
@keyframes ach-drop {
  to { transform: translateY(26px) scale(0.5); opacity: 0; }
}
/* On phones the popup hangs under the HUD, so it lifts away instead. */
@media (prefers-reduced-motion: no-preference) and (max-width: 639.98px) {
  .ach-pop[data-phase="out"] { animation-name: ach-rise; }
}
@keyframes ach-rise {
  to { transform: translateY(-26px) scale(0.5); opacity: 0; }
}
@keyframes ach-wiggle {
  0%, 100% { transform: rotate(0); }
  30% { transform: rotate(-9deg) scale(1.08); }
  60% { transform: rotate(6deg); }
}
`;
