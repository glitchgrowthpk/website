"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { COIN_POINTS } from "@/data/coins";
import { useGame } from "@/lib/game-state";
import { useIsTouch, useReducedMotion } from "@/lib/hooks";
import { sfx } from "@/lib/audio";
import { fx, FX_PRESETS } from "@/lib/fx";

const isTypingTarget = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable
  );
};

/* ------------------------------------------------------------------ coin */

// Shared by every coin on the page. React hoists a <style> with an `href` and
// `precedence` into <head> once, however many coins render it.
const COIN_CSS = `
.gameui-coin::before{content:"";position:absolute;inset:-4px;border-radius:9999px}
.gameui-coin[data-state="gone"]{scale:0;opacity:0;pointer-events:none}
.gameui-coin[data-state="collect"]{pointer-events:none}
.gameui-coin[data-state="collect"] .gameui-coin-float{opacity:0}
.gameui-coin-glow{transition:background-color .2s ease,scale .25s var(--ease-pop)}
.gameui-coin[data-state="idle"]:hover .gameui-coin-glow,
.gameui-coin[data-state="idle"]:focus-visible .gameui-coin-glow{background-color:rgba(255,176,32,.5);scale:1.25}
.gameui-coin-spark{position:absolute;width:5px;height:5px;rotate:45deg;background:#fff3c4;box-shadow:0 0 6px #ffb020;opacity:0}
.gameui-coin-plus{position:absolute;left:50%;top:-10px;margin-left:-20px;width:40px;text-align:center;font-family:var(--font-display);font-size:15px;line-height:1;color:var(--color-amber);text-shadow:0 0 10px rgba(255,176,32,.6),0 2px 0 #06060a;opacity:0}
@media (prefers-reduced-motion: no-preference){
  .gameui-coin[data-state="idle"] .gameui-coin-float{animation:bob 1.8s ease-in-out infinite}
  .gameui-coin-shine{animation:gameui-coin-shine 3.4s ease-in-out infinite}
  .gameui-coin[data-state="idle"]:hover .gameui-coin-face,
  .gameui-coin[data-state="idle"]:focus-visible .gameui-coin-face{animation:gameui-coin-flip .7s cubic-bezier(.2,.8,.2,1)}
  .gameui-coin[data-state="idle"]:hover .gameui-coin-spark,
  .gameui-coin[data-state="idle"]:focus-visible .gameui-coin-spark{animation:gameui-coin-spark 1s ease-out infinite}
  .gameui-coin-spark:nth-child(4){animation-delay:.25s!important}
  .gameui-coin-spark:nth-child(5){animation-delay:.5s!important}
  .gameui-coin-spark:nth-child(6){animation-delay:.75s!important}
  .gameui-coin[data-state="collect"] .gameui-coin-float{animation:gameui-coin-collect .72s cubic-bezier(.2,.7,.3,1) both}
  .gameui-coin[data-state="collect"] .gameui-coin-plus{animation:gameui-coin-plus .9s cubic-bezier(.2,.7,.3,1) both}
}
@keyframes gameui-coin-shine{0%,62%{translate:0 0}100%{translate:320% 0}}
@keyframes gameui-coin-flip{from{transform:perspective(120px) rotateY(0)}to{transform:perspective(120px) rotateY(360deg)}}
@keyframes gameui-coin-spark{0%{opacity:0;scale:.2}35%{opacity:1;scale:1}100%{opacity:0;scale:.4}}
@keyframes gameui-coin-collect{
  0%{opacity:1;transform:perspective(160px) translateY(0) scale(1) rotateY(0)}
  28%{opacity:1;transform:perspective(160px) translateY(-20px) scale(1.4) rotateY(300deg)}
  100%{opacity:0;transform:perspective(160px) translateY(-50px) scale(.5) rotateY(900deg)}
}
@keyframes gameui-coin-plus{
  0%{opacity:0;transform:translateY(8px) scale(.5)}
  22%{opacity:1;transform:translateY(-10px) scale(1.2)}
  70%{opacity:1;transform:translateY(-26px) scale(1)}
  100%{opacity:0;transform:translateY(-38px) scale(1)}
}
`;

/** How long the collected animation runs before the coin is put away. */
const COIN_COLLECT_MS = 900;

/**
 * A collectible. Reachable two ways: walk your character into it, or simply
 * click it — so the reward is never locked behind the platformer.
 */
export function Coin({
  id,
  className = "",
  label,
}: {
  id: string;
  className?: string;
  label: string;
}) {
  const { coins, collect, ready } = useGame();
  const got = coins.includes(id);

  // Play the pickup only when the coin is collected while the page is live —
  // never for coins restored from storage on load, which arrive in the same
  // render that flips `ready`. (Adjusting state from the previous render is
  // the pattern React recommends over an effect here.)
  const [seen, setSeen] = useState({ got, ready });
  const [collecting, setCollecting] = useState(false);
  if (seen.got !== got || seen.ready !== ready) {
    setSeen({ got, ready });
    setCollecting(got && !seen.got && seen.ready);
  }

  useEffect(() => {
    if (!collecting) return;
    const t = window.setTimeout(() => setCollecting(false), COIN_COLLECT_MS);
    return () => window.clearTimeout(t);
  }, [collecting]);

  const state = !got ? "idle" : collecting ? "collect" : "gone";

  return (
    <button
      type="button"
      data-coin={got ? undefined : id}
      data-state={state}
      onClick={(e) => {
        if (got) return;
        const r = e.currentTarget.getBoundingClientRect();
        collect(id, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }}
      onMouseEnter={() => !got && sfx.hover()}
      disabled={got}
      aria-label={got ? `Coin found: ${label}` : `Collect the coin near ${label}`}
      // The global focus ring sets a 4px radius; keep it round.
      style={{ borderRadius: "9999px" }}
      className={`gameui-coin absolute z-20 grid h-9 w-9 place-items-center transition-[scale,opacity] duration-300 ${
        got ? "" : "hover:scale-125"
      } ${className}`}
    >
      <span
        aria-hidden="true"
        className="gameui-coin-float relative grid h-9 w-9 place-items-center"
      >
        <span className="gameui-coin-glow absolute inset-0 rounded-full bg-amber/25 blur-md" />
        <span className="gameui-coin-face relative grid h-6 w-6 place-items-center overflow-hidden rounded-full border-2 border-amber bg-gradient-to-br from-amber to-magenta font-display text-[11px] leading-none text-void shadow-[0_0_14px_rgba(255,176,32,0.6)]">
          G
          <span className="gameui-coin-shine absolute inset-y-0 -left-1/2 w-1/3 -skew-x-12 bg-white/55" />
        </span>
        <span className="gameui-coin-spark -left-0.5 top-0.5" />
        <span className="gameui-coin-spark -right-0.5 top-1.5" />
        <span className="gameui-coin-spark bottom-0 right-1" />
        <span className="gameui-coin-spark bottom-1 left-0" />
      </span>
      <span aria-hidden="true" className="gameui-coin-plus">
        +{COIN_POINTS}
      </span>
      <style href="gameui-coin" precedence="gameui">
        {COIN_CSS}
      </style>
    </button>
  );
}

/* ------------------------------------------------------------------ toast */

/** Matches the provider's toast lifetime, for the countdown bar. */
const TOAST_MS = 3600;

export function Toast() {
  const { toast } = useGame();

  // Keep the last message around briefly so it can slide out.
  const [shown, setShown] = useState<string | null>(toast);
  const [prev, setPrev] = useState(toast);
  if (toast !== prev) {
    setPrev(toast);
    if (toast) setShown(toast);
  }
  const leaving = !toast && shown !== null;
  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(() => setShown(null), 220);
    return () => window.clearTimeout(t);
  }, [leaving]);

  return (
    <>
      {/* Always mounted, so screen readers reliably announce changes. */}
      <div role="status" aria-live="polite" className="sr-only">
        {toast ?? ""}
      </div>

      {shown && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed bottom-24 left-1/2 z-[60] w-max max-w-[calc(100vw-32px)] -translate-x-1/2"
        >
          <div
            key={shown}
            data-leaving={leaving ? "" : undefined}
            className="gameui-toast mono relative flex items-center gap-2.5 overflow-hidden rounded-lg border border-lime/60 bg-abyss/95 py-2 pl-2 pr-4 text-[11px] uppercase tracking-[0.18em] text-lime shadow-[0_0_30px_rgba(200,255,46,0.22)] backdrop-blur"
          >
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-lime/40 bg-lime/10">
              <svg width="12" height="12" viewBox="0 0 24 24">
                <path
                  d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z"
                  fill="currentColor"
                />
              </svg>
            </span>
            <span className="text-balance">{shown}</span>
            <span className="gameui-toast-timer absolute inset-x-0 bottom-0 h-[2px] origin-left bg-lime/50" />
          </div>
        </div>
      )}

      <style>{`
@media (prefers-reduced-motion: no-preference){
  .gameui-toast{animation:gameui-toast-in .42s var(--ease-pop) both}
  .gameui-toast[data-leaving]{animation:gameui-toast-out .22s ease-in both}
  .gameui-toast-timer{animation:gameui-toast-timer ${TOAST_MS}ms linear both}
}
@keyframes gameui-toast-in{from{opacity:0;transform:translateY(18px) scale(.94)}}
@keyframes gameui-toast-out{to{opacity:0;transform:translateY(10px) scale(.97)}}
@keyframes gameui-toast-timer{from{transform:scaleX(1)}to{transform:scaleX(0)}}
`}</style>
    </>
  );
}

/* ------------------------------------------------------- control chip + pad */

type Dir = "left" | "right" | "up" | "down";
const DIRS: Dir[] = ["left", "right", "up", "down"];

function pad(dir: Dir, down: boolean) {
  window.dispatchEvent(
    new CustomEvent("glitch:pad", { detail: { dir, down } }),
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mono inline-grid min-w-[20px] place-items-center rounded border border-edge bg-panel-2 px-1 py-px text-[10px] leading-4 text-ink">
      {children}
    </kbd>
  );
}

/**
 * The touch D-pad is one surface rather than four buttons: the finger can
 * slide between directions (and diagonals) without lifting, like a real pad.
 */
function DPad() {
  const ref = useRef<HTMLDivElement>(null);
  const held = useRef<Record<Dir, boolean>>({ left: false, right: false, up: false, down: false });
  const pointer = useRef<number | null>(null);
  const centre = useRef({ x: 0, y: 0 });

  const apply = useCallback((next: Record<Dir, boolean>) => {
    const root = ref.current;
    let pressed = false;
    for (const d of DIRS) {
      if (next[d] === held.current[d]) continue;
      held.current[d] = next[d];
      pad(d, next[d]);
      if (next[d]) pressed = true;
      root?.querySelector(`[data-dir="${d}"]`)?.toggleAttribute("data-pressed", next[d]);
    }
    if (pressed) fx.haptic(8);
  }, []);

  const release = useCallback(
    () => apply({ left: false, right: false, up: false, down: false }),
    [apply],
  );

  // Never leave a direction held if the pad unmounts mid-press.
  useEffect(() => release, [release]);

  const read = (x: number, y: number) => {
    const dx = x - centre.current.x;
    const dy = y - centre.current.y;
    const dead = 10;
    // Each direction owns a 135° wedge, so the 45° diagonals press two.
    return {
      left: dx < -dead && -dx > Math.abs(dy) * 0.41,
      right: dx > dead && dx > Math.abs(dy) * 0.41,
      up: dy < -dead && -dy > Math.abs(dx) * 0.41,
      // Down drops through platforms, so it wants a more deliberate push.
      down: dy > dead && dy > Math.abs(dx),
    };
  };

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="gameui-pad pointer-events-auto relative grid h-[150px] w-[150px] touch-none select-none grid-cols-3 grid-rows-3 gap-1"
      onPointerDown={(e) => {
        if (pointer.current !== null) return;
        pointer.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        const r = e.currentTarget.getBoundingClientRect();
        centre.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        apply(read(e.clientX, e.clientY));
      }}
      onPointerMove={(e) => {
        if (e.pointerId !== pointer.current) return;
        apply(read(e.clientX, e.clientY));
      }}
      onPointerUp={(e) => {
        if (e.pointerId !== pointer.current) return;
        pointer.current = null;
        release();
      }}
      onPointerCancel={() => {
        pointer.current = null;
        release();
      }}
      onLostPointerCapture={() => {
        pointer.current = null;
        release();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span />
      <span data-dir="up" className="gameui-pad-arm rounded-t-xl">
        ▲
      </span>
      <span />
      <span data-dir="left" className="gameui-pad-arm rounded-l-xl">
        ◀
      </span>
      <span className="gameui-pad-hub" />
      <span data-dir="right" className="gameui-pad-arm rounded-r-xl">
        ▶
      </span>
      <span />
      <span data-dir="down" className="gameui-pad-arm rounded-b-xl">
        ▼
      </span>
      <span />
    </div>
  );
}

function JumpButton() {
  const pointer = useRef<number | null>(null);
  const lastPress = useRef(-Infinity);

  const set = (el: HTMLElement, down: boolean) => {
    el.toggleAttribute("data-pressed", down);
    pad("up", down);
    if (down) fx.haptic(8);
  };

  return (
    <button
      type="button"
      aria-label="Jump"
      className="gameui-jump pointer-events-auto grid h-20 w-20 touch-none select-none place-items-center rounded-full border-2 border-cyan font-display text-sm text-cyan backdrop-blur"
      onPointerDown={(e) => {
        if (pointer.current !== null) return;
        pointer.current = e.pointerId;
        lastPress.current = performance.now();
        e.currentTarget.setPointerCapture(e.pointerId);
        set(e.currentTarget, true);
      }}
      onPointerUp={(e) => {
        if (e.pointerId !== pointer.current) return;
        pointer.current = null;
        set(e.currentTarget, false);
      }}
      onPointerCancel={(e) => {
        pointer.current = null;
        set(e.currentTarget, false);
      }}
      onLostPointerCapture={(e) => {
        if (pointer.current === null) return;
        pointer.current = null;
        set(e.currentTarget, false);
      }}
      onContextMenu={(e) => e.preventDefault()}
      // Screen readers and switch devices activate with a click and no
      // pointer press: give them a short tap jump.
      onClick={(e) => {
        if (performance.now() - lastPress.current < 600) return;
        const el = e.currentTarget;
        set(el, true);
        window.setTimeout(() => set(el, false), 140);
      }}
    >
      JUMP
    </button>
  );
}

export function ControlLayer() {
  const { controlling, setControlling } = useGame();
  const touch = useIsTouch();

  // Releasing control should also clear any stuck key.
  useEffect(() => {
    if (!controlling) DIRS.forEach((d) => pad(d, false));
  }, [controlling]);

  // Only announce "released" once there has been something to release.
  const [everOn, setEverOn] = useState(false);
  if (controlling && !everOn) setEverOn(true);

  const announce = controlling
    ? touch
      ? "Control on. Use the on-screen pad to move and the jump button to jump. Tap Release to stop."
      : "Control on. Arrow keys or WASD move. Up jumps, and again in mid-air for a double jump. Down drops through. Escape releases."
    : everOn
      ? "Control released."
      : "";

  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>

      {controlling && (
        <div
          data-control-ui=""
          className="pointer-events-none fixed inset-x-0 bottom-0 z-[55] flex flex-col items-center gap-3 p-4"
        >
          <div className="gameui-chip mono pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-1.5 rounded-full border border-lime/60 bg-abyss/95 py-1.5 pl-4 pr-1.5 text-[10px] uppercase tracking-[0.18em] text-lime shadow-[0_0_24px_rgba(200,255,46,0.18)] backdrop-blur">
            <span className="flex items-center gap-2">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-lime motion-safe:animate-pulse" />
              Control active
            </span>
            {!touch && (
              <span
                aria-hidden="true"
                className="hidden items-center gap-2.5 tracking-[0.14em] text-muted md:flex"
              >
                <span className="flex items-center gap-1">
                  <Key>←</Key>
                  <Key>→</Key>
                  move
                </span>
                <span className="flex items-center gap-1">
                  <Key>↑</Key>
                  jump ×2
                </span>
                <span className="flex items-center gap-1">
                  <Key>↓</Key>
                  drop
                </span>
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                sfx.back();
                setControlling(false);
              }}
              className={`flex items-center gap-1.5 rounded-full border border-lime/50 py-1 uppercase text-lime/90 transition-colors hover:bg-lime/15 ${
                touch ? "min-h-10 px-4" : "min-h-8 px-3"
              }`}
            >
              {touch ? (
                "Release"
              ) : (
                <>
                  <Key>Esc</Key>
                  release
                </>
              )}
            </button>
          </div>

          {touch && (
            <div className="gameui-pads pointer-events-none flex w-full max-w-md items-end justify-between">
              <DPad />
              <JumpButton />
            </div>
          )}
        </div>
      )}

      <style>{`
.gameui-pad-arm{display:grid;place-items:center;border:1px solid var(--color-edge);background:rgba(18,18,29,.94);color:var(--color-ink);font-size:15px;backdrop-filter:blur(8px);transition:background-color .12s,border-color .12s,color .12s,scale .12s var(--ease-pop),box-shadow .12s}
.gameui-pad-arm[data-pressed]{background:rgba(0,229,255,.28);border-color:var(--color-cyan);color:var(--color-cyan);scale:.92;box-shadow:0 0 18px rgba(0,229,255,.35) inset}
.gameui-pad::before{content:"";position:absolute;inset:-10px;z-index:-1;border-radius:50%;background:radial-gradient(circle,rgba(11,11,19,.82) 55%,rgba(11,11,19,.55));border:1px solid rgba(42,42,61,.9);box-shadow:0 10px 30px rgba(0,0,0,.45)}
.gameui-pad-hub{border-radius:6px;background:rgba(18,18,29,.94);border:1px solid var(--color-edge)}
.gameui-jump{background:radial-gradient(circle at 50% 30%,rgba(0,229,255,.24),rgba(0,229,255,.07) 72%),rgba(11,11,19,.9);box-shadow:0 0 18px rgba(0,229,255,.18);transition:scale .14s var(--ease-pop),box-shadow .12s}
.gameui-jump[data-pressed]{background:radial-gradient(circle at 50% 30%,rgba(0,229,255,.5),rgba(0,229,255,.28) 72%),rgba(11,11,19,.9);scale:.9;box-shadow:0 0 30px rgba(0,229,255,.5)}
@media (prefers-reduced-motion: no-preference){
  .gameui-chip{animation:gameui-rise .4s var(--ease-pop) both}
  .gameui-pads{animation:gameui-rise .45s var(--ease-pop) .06s both}
}
@keyframes gameui-rise{from{opacity:0;transform:translateY(24px)}}
`}</style>
    </>
  );
}

/* ------------------------------------------------------------- konami code */

const CODE = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
];

export function Konami() {
  const { devMode, setDevMode, pushToast, unlock, paused } = useGame();
  // The pause menu owns the arrow keys (and covers the reward) while open.
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    let i = 0;
    const timers: number[] = [];
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key === "Shift") return;
      if (isTypingTarget(e.target)) return;
      if (pausedRef.current) {
        i = 0;
        return;
      }
      const want = CODE[i];
      const got = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (got === want) {
        i++;
        if (i === CODE.length) {
          i = 0;
          setDevMode(true);
          unlock("konami");
          pushToast("KONAMI ACCEPTED — ROSTER UNLEASHED");
          sfx.unlock();
          // Confetti cannons along the top edge, fired in a quick ripple.
          const W = window.innerWidth;
          [0.12, 0.37, 0.63, 0.88].forEach((f, k) => {
            timers.push(
              window.setTimeout(
                () =>
                  fx.burst(W * f, 4, {
                    ...FX_PRESETS.confetti,
                    count: 44,
                    angle: Math.PI / 2,
                    spread: Math.PI * 0.75,
                    speed: 540,
                  }),
                k * 110,
              ),
            );
          });
          fx.flash("#c8ff2e", 0.1);
        }
      } else {
        i = got === CODE[0] ? 1 : 0;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [setDevMode, pushToast, unlock]);

  const done = useCallback(() => setDevMode(false), [setDevMode]);

  return (
    <>
      <CrashCheat />
      {devMode && <ConfettiRoster onDone={done} />}
    </>
  );
}

function ConfettiRoster({ onDone }: { onDone: () => void }) {
  const reduced = useReducedMotion();

  useEffect(() => {
    const t = window.setTimeout(onDone, 6500);
    return () => window.clearTimeout(t);
  }, [onDone]);

  // Nothing falls for reduced-motion visitors; the toast still lands.
  if (reduced) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[70] overflow-hidden"
    >
      {Array.from({ length: 26 }).map((_, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={i}
          src={`/characters/${ROSTER_FALL[i % ROSTER_FALL.length]}.webp`}
          alt=""
          className="sprite absolute top-[-200px] h-[70px] w-auto"
          style={{
            left: `${(i * 97) % 100}%`,
            animation: `gameui-fall ${3 + (i % 5) * 0.8}s cubic-bezier(0.4,0,0.7,1) ${(i % 9) * 0.22}s forwards`,
          }}
        />
      ))}
      <style>{`@keyframes gameui-fall{to{transform:translateY(130vh) rotate(520deg)}}`}</style>
    </div>
  );
}

const ROSTER_FALL = [
  "swordknight",
  "chili",
  "skeleton",
  "duck",
  "potato",
  "blackcat",
  "reaper",
  "dino",
  "egg",
  "ninja",
  "cube",
  "raccoon",
  "viking",
];

/* --------------------------------------------------------- "crash" cheat */

// Not a word that starts with a shortcut letter (G takes control, P pauses),
// so typing it never fires one on the way.
const WORD = "crash";
const CRASH_MS = 1000;
/** One tear per colour shift, so the whole thing is three flashes, never more. */
const TEAR_EVERY_MS = 340;

interface Tear {
  top: number;
  h: number;
}

/**
 * Type "crash" anywhere (outside a text field) and the page crashes for one
 * second: it jitters, splits into RGB and hue-shifts, then recovers. Three
 * colour shifts in that second at constant brightness, so it never strobes;
 * skipped entirely under reduced motion (the toast still lands).
 */
function CrashCheat() {
  const { settings, pushToast, paused } = useGame();
  const reduced = useReducedMotion();
  const [tears, setTears] = useState<Tear[] | null>(null);

  const live = useRef({ shortcuts: settings.shortcuts, reduced, paused });
  useEffect(() => {
    live.current = { shortcuts: settings.shortcuts, reduced, paused };
  }, [settings.shortcuts, reduced, paused]);

  // Progress through the word lives in a ref, so a re-subscribed listener
  // (Fast Refresh, Strict Mode) never loses a half-typed word.
  const seq = useRef({ i: 0, lastAt: 0, busyUntil: 0 });

  useEffect(() => {
    const root = document.documentElement;
    const q = seq.current;
    let off = 0;

    const fire = () => {
      // Pivot the skew on the middle of the viewport, not of the whole page.
      const main = document.getElementById("main");
      if (main) {
        const y = window.innerHeight / 2 - main.getBoundingClientRect().top;
        root.style.setProperty("--gameui-crash-y", `${Math.round(y)}px`);
      }
      root.classList.add("gameui-crashing");
      setTears(
        Array.from({ length: 3 }, () => ({
          top: 8 + Math.random() * 80,
          h: 6 + Math.random() * 30,
        })),
      );
      sfx.boot();
      fx.haptic([10, 40, 10]);
      off = window.setTimeout(() => {
        root.classList.remove("gameui-crashing");
        setTears(null);
      }, CRASH_MS);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.isComposing) return;
      if (e.key.length !== 1 || isTypingTarget(e.target)) return;
      const L = live.current;
      if (!L.shortcuts || L.paused) {
        q.i = 0;
        return;
      }
      const now = performance.now();
      if (now - q.lastAt > 1500) q.i = 0; // has to be typed, not assembled
      q.lastAt = now;
      const k = e.key.toLowerCase();
      if (k !== WORD[q.i]) q.i = 0;
      if (k !== WORD[q.i]) return;
      q.i++;
      if (q.i < WORD.length) return;

      q.i = 0;
      pushToast("IT'S NOT A BUG. IT'S THE BRAND.");
      if (L.reduced || now < q.busyUntil) return;
      q.busyUntil = now + CRASH_MS + 200;
      fire();
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(off);
      root.classList.remove("gameui-crashing");
    };
  }, [pushToast]);

  return (
    <>
      {tears && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-[70] overflow-hidden"
        >
          {tears.map((t, k) => (
            <span
              key={k}
              className="gameui-tear"
              style={{ top: `${t.top}%`, height: t.h, animationDelay: `${k * TEAR_EVERY_MS}ms` }}
            />
          ))}
        </div>
      )}
      <style>{`
@media (prefers-reduced-motion: no-preference){
  html.gameui-crashing main{
    transform-origin:50% var(--gameui-crash-y,50vh);
    animation:gameui-crash ${CRASH_MS}ms steps(1,end) both;
    text-shadow:-3px 0 rgba(0,229,255,.75),3px 0 rgba(255,45,119,.75);
  }
  html.gameui-crashing main img{filter:drop-shadow(3px 0 0 rgba(255,45,119,.75)) drop-shadow(-3px 0 0 rgba(0,229,255,.75))}
  .gameui-tear{position:absolute;left:-4%;right:-4%;opacity:0;background:linear-gradient(90deg,rgba(0,229,255,.12),rgba(139,92,246,.08) 50%,rgba(255,45,119,.14));backdrop-filter:hue-rotate(150deg) saturate(1.8);-webkit-backdrop-filter:hue-rotate(150deg) saturate(1.8);animation:gameui-tear .3s steps(1,end) both}
}
@keyframes gameui-crash{
  0%{transform:translate3d(-7px,0,0) skewX(-2deg);filter:hue-rotate(-35deg) saturate(1.5)}
  11%{transform:translate3d(5px,0,0) skewX(2.5deg)}
  22%{transform:translate3d(-2px,0,0)}
  34%{transform:translate3d(9px,0,0) skewX(-3deg);filter:hue-rotate(60deg) saturate(1.7)}
  47%{transform:translate3d(-4px,0,0) skewX(1deg)}
  58%{transform:translate3d(3px,0,0)}
  68%{transform:translate3d(-8px,0,0) skewX(2deg);filter:hue-rotate(-80deg) saturate(1.4)}
  82%{transform:translate3d(2px,0,0)}
  92%{transform:translate3d(-1px,0,0);filter:none}
  100%{transform:none;filter:none}
}
@keyframes gameui-tear{
  0%{opacity:1;transform:translateX(-26px)}
  33%{transform:translateX(18px)}
  66%{transform:translateX(-9px)}
  100%{opacity:0;transform:none}
}
`}</style>
    </>
  );
}
