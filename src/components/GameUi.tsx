"use client";

import { useEffect } from "react";
import { useGame } from "@/lib/game-state";
import { useIsTouch, useReducedMotion } from "@/lib/hooks";

/* ------------------------------------------------------------------ coin */

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
  const { coins, collect } = useGame();
  const got = coins.includes(id);

  return (
    <button
      type="button"
      data-coin={got ? undefined : id}
      onClick={() => !got && collect(id)}
      disabled={got}
      aria-label={got ? `Coin found: ${label}` : `Collect the coin near ${label}`}
      className={`absolute z-20 grid h-9 w-9 place-items-center rounded-full transition-all duration-300 ${
        got
          ? "scale-0 opacity-0"
          : "scale-100 opacity-100 hover:scale-125 motion-safe:animate-[bob_1.8s_ease-in-out_infinite]"
      } ${className}`}
    >
      <span className="absolute inset-0 rounded-full bg-amber/25 blur-md" />
      <span className="relative grid h-6 w-6 place-items-center rounded-full border-2 border-amber bg-gradient-to-br from-amber to-magenta font-display text-[11px] leading-none text-void shadow-[0_0_14px_rgba(255,176,32,0.6)]">
        G
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ toast */

export function Toast() {
  const { toast } = useGame();
  if (!toast) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 px-4"
    >
      <div className="mono flex items-center gap-2.5 rounded-lg border border-lime/60 bg-abyss/95 px-4 py-3 text-[11px] uppercase tracking-[0.18em] text-lime shadow-[0_0_30px_rgba(200,255,46,0.25)] backdrop-blur">
        <span className="inline-block h-2 w-2 rounded-full bg-lime" />
        {toast}
      </div>
    </div>
  );
}

/* ------------------------------------------------------- control chip + pad */

function pad(dir: string, down: boolean) {
  window.dispatchEvent(
    new CustomEvent("glitch:pad", { detail: { dir, down } }),
  );
}

export function ControlLayer() {
  const { controlling, setControlling } = useGame();
  const touch = useIsTouch();
  const reduced = useReducedMotion();

  // Releasing control should also clear any stuck key.
  useEffect(() => {
    if (!controlling) ["left", "right", "up", "down"].forEach((d) => pad(d, false));
  }, [controlling]);

  if (reduced || !controlling) return null;

  const btn =
    "pointer-events-auto grid h-14 w-14 place-items-center rounded-xl border border-edge bg-panel/90 text-ink backdrop-blur active:bg-cyan/25 active:border-cyan";

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[55] flex flex-col items-center gap-3 p-4">
        <div className="mono pointer-events-auto flex items-center gap-3 rounded-full border border-lime/60 bg-abyss/95 px-4 py-2 text-[10px] uppercase tracking-[0.18em] text-lime backdrop-blur">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-lime" />
          Control active
          <button
            type="button"
            onClick={() => setControlling(false)}
            className="rounded border border-lime/50 px-2 py-0.5 text-lime/90 hover:bg-lime/15"
          >
            {touch ? "Release" : "Esc to release"}
          </button>
        </div>

        {touch && (
          <div className="pointer-events-none flex w-full max-w-md items-end justify-between">
            <div className="grid grid-cols-3 grid-rows-2 gap-1.5" aria-hidden="true">
              <span />
              <button
                type="button"
                className={btn}
                onPointerDown={() => pad("up", true)}
                onPointerUp={() => pad("up", false)}
                onPointerLeave={() => pad("up", false)}
              >
                ▲
              </button>
              <span />
              <button
                type="button"
                className={btn}
                onPointerDown={() => pad("left", true)}
                onPointerUp={() => pad("left", false)}
                onPointerLeave={() => pad("left", false)}
              >
                ◀
              </button>
              <button
                type="button"
                className={btn}
                onPointerDown={() => pad("down", true)}
                onPointerUp={() => pad("down", false)}
                onPointerLeave={() => pad("down", false)}
              >
                ▼
              </button>
              <button
                type="button"
                className={btn}
                onPointerDown={() => pad("right", true)}
                onPointerUp={() => pad("right", false)}
                onPointerLeave={() => pad("right", false)}
              >
                ▶
              </button>
            </div>

            <button
              type="button"
              aria-label="Jump"
              className="pointer-events-auto grid h-20 w-20 place-items-center rounded-full border-2 border-cyan bg-cyan/15 font-display text-sm text-cyan backdrop-blur active:bg-cyan/35"
              onPointerDown={() => pad("up", true)}
              onPointerUp={() => pad("up", false)}
              onPointerLeave={() => pad("up", false)}
            >
              JUMP
            </button>
          </div>
        )}
      </div>
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
  const { devMode, setDevMode, pushToast } = useGame();

  useEffect(() => {
    let i = 0;
    const onKey = (e: KeyboardEvent) => {
      const want = CODE[i];
      const got = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (got === want) {
        i++;
        if (i === CODE.length) {
          i = 0;
          setDevMode(true);
          pushToast("KONAMI ACCEPTED — ROSTER UNLEASHED");
        }
      } else {
        i = got === CODE[0] ? 1 : 0;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setDevMode, pushToast]);

  if (!devMode) return null;
  return <ConfettiRoster onDone={() => setDevMode(false)} />;
}

function ConfettiRoster({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(onDone, 6500);
    return () => window.clearTimeout(t);
  }, [onDone]);

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
            animation: `fall ${3 + (i % 5) * 0.8}s cubic-bezier(0.4,0,0.7,1) ${(i % 9) * 0.22}s forwards`,
          }}
        />
      ))}
      <style>{`@keyframes fall{to{transform:translateY(130vh) rotate(${520}deg)}}`}</style>
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
