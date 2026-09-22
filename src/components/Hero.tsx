"use client";

import { useEffect, useRef, useState } from "react";
import { STUDIO } from "@/data/studio";
import { byId, spriteSrc } from "@/data/characters";
import { useGame } from "@/lib/game-state";
import { useIsTouch, useReducedMotion } from "@/lib/hooks";
import { Coin } from "./GameUi";
import { sfx } from "@/lib/audio";

const STAGE = [
  "orc",
  "skeleton",
  "reaper",
  "viking",
  "swordknight",
  "crimson",
  "dino",
  "raccoon",
  "chili",
  "potato",
];

export default function Hero() {
  const { characterId, setControlling, controlling } = useGame();
  const reduced = useReducedMotion();
  const touch = useIsTouch();
  const ref = useRef<HTMLElement>(null);
  const [par, setPar] = useState(0);

  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setPar(window.scrollY));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
    };
  }, [reduced]);

  const hero = byId(characterId);
  const stage = STAGE.filter((id) => id !== characterId);

  return (
    <section
      id="top"
      ref={ref}
      className="scanlines relative isolate flex min-h-[100svh] flex-col justify-center overflow-hidden pt-[var(--hud-h)]"
    >
      {/* ---------- backdrop ---------- */}
      <div aria-hidden="true" className="absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_0%,#1a1030_0%,#0a0a12_45%,#06060a_100%)]" />

        {/* neon wave field — a nod to the studio deck */}
        <svg
          className="absolute inset-x-0 top-[18%] h-[62%] w-full opacity-45"
          preserveAspectRatio="none"
          viewBox="0 0 1200 400"
        >
          {Array.from({ length: 16 }).map((_, i) => {
            const y = 40 + i * 22;
            const hue = i / 15;
            return (
              <path
                key={i}
                d={`M0 ${y} C 200 ${y - 34 + i * 2}, 400 ${y + 34 - i}, 600 ${y} S 1000 ${y - 30 + i}, 1200 ${y}`}
                fill="none"
                strokeWidth="1.5"
                stroke={hue < 0.5 ? "#8b5cf6" : "#ff2d77"}
                strokeOpacity={0.55 - i * 0.02}
                style={
                  reduced
                    ? undefined
                    : {
                        animation: `wave ${7 + i * 0.35}s ease-in-out ${i * 0.1}s infinite alternate`,
                      }
                }
              />
            );
          })}
        </svg>

        {/* perspective floor */}
        <div
          className="grid-floor absolute inset-x-0 bottom-0 h-[38%] origin-bottom opacity-70"
          style={{
            transform: `perspective(420px) rotateX(68deg) translateY(${reduced ? 0 : par * 0.06}px)`,
            maskImage: "linear-gradient(to top, #000 10%, transparent 92%)",
            WebkitMaskImage: "linear-gradient(to top, #000 10%, transparent 92%)",
          }}
        />
        <div className="absolute inset-x-0 bottom-[36%] h-px bg-gradient-to-r from-transparent via-cyan to-transparent opacity-70 blur-[1px]" />
        <div className="noise absolute inset-0 opacity-[0.045] mix-blend-overlay" />
      </div>

      {/* ---------- copy ---------- */}
      <div className="relative z-10 mx-auto w-full max-w-[1400px] px-5 sm:px-6">
        <p className="label mb-5 flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-lime" />
          Insert coin · Studio online
        </p>

        <h1 className="font-display text-[clamp(3.1rem,12.5vw,10.5rem)] leading-[0.84] tracking-tight">
          <span className="glitch block" data-text="GLITCH">
            GLITCH
          </span>
          <span className="block bg-gradient-to-r from-lime via-cyan to-violet bg-clip-text text-transparent">
            GAMES
          </span>
        </h1>

        <div className="mt-7 grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="max-w-xl">
            <p className="text-balance text-lg leading-relaxed text-ink/90 sm:text-xl">
              {STUDIO.mission}
            </p>
            <p className="mt-3 text-sm text-muted sm:text-base">
              {STUDIO.blurb} A small dedicated studio in {STUDIO.location}, trying
              to make a global impact — everything happens in house.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <a
                href="#portfolio"
                onMouseEnter={() => sfx.hover()}
                className="group relative inline-flex items-center gap-2 overflow-hidden rounded-lg bg-gradient-to-r from-cyan to-violet px-6 py-3.5 font-display text-sm tracking-wide text-void transition-transform duration-200 hover:scale-[1.04] active:scale-95"
              >
                <span className="relative z-10">PLAY THE PORTFOLIO</span>
                <span className="relative z-10 transition-transform group-hover:translate-x-1">
                  →
                </span>
              </a>
              <a
                href="#partner"
                onMouseEnter={() => sfx.hover()}
                className="inline-flex items-center gap-2 rounded-lg border border-edge bg-panel/70 px-6 py-3.5 font-display text-sm tracking-wide text-ink backdrop-blur transition-colors hover:border-lime hover:text-lime"
              >
                PARTNER WITH US
              </a>
            </div>

            {!reduced && (
              <button
                type="button"
                onClick={() => {
                  sfx.select();
                  setControlling(!controlling);
                }}
                className="mono mt-6 inline-flex items-center gap-2 rounded-md border border-dashed border-edge px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-muted transition-colors hover:border-lime hover:text-lime"
              >
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-lime" />
                {touch
                  ? "Tap to take control of the character"
                  : "Press G to take control — then walk the page"}
              </button>
            )}
          </div>

          {/* chosen fighter card */}
          <div className="panel relative hidden w-[260px] shrink-0 p-4 lg:block">
            <p className="label mb-3">Your fighter</p>
            <div className="flex items-end gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={spriteSrc(hero.id)}
                alt={hero.name}
                width={hero.w}
                height={hero.h}
                className="sprite h-[120px] w-auto motion-safe:bob"
              />
              <div className="pb-1">
                <p className="font-display text-lg leading-tight">{hero.name}</p>
                <p className="mono text-[10px] uppercase tracking-[0.2em] text-muted">
                  {hero.role}
                </p>
                <a
                  href="#roster"
                  className="mono mt-2 inline-block text-[10px] uppercase tracking-[0.16em] text-cyan hover:underline"
                >
                  Change →
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- sprite stage ---------- */}
      <div
        aria-hidden="true"
        className="pointer-events-none relative z-0 mt-10 flex h-[120px] items-end justify-center gap-1 overflow-hidden px-2 sm:h-[150px] sm:gap-4"
      >
        {stage.map((id, i) => {
          const c = byId(id);
          const h = 62 + ((i * 7) % 26);
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={id}
              src={spriteSrc(id)}
              alt=""
              width={c.w}
              height={c.h}
              className="sprite w-auto opacity-55 motion-safe:bob"
              style={{
                height: h,
                ["--bob-dur" as string]: `${2 + (i % 5) * 0.3}s`,
                animationDelay: `${i * 0.19}s`,
              }}
            />
          );
        })}
      </div>

      {/* floor line — the platformer stands on this */}
      <div
        data-solid=""
        className="relative z-0 h-[2px] w-full bg-gradient-to-r from-transparent via-cyan/60 to-transparent"
      />

      <Coin id="hero" label="the hero stage" className="bottom-[13%] left-[14%] sm:left-[22%]" />

      <div className="relative z-10 mx-auto w-full max-w-[1400px] px-5 pb-8 pt-6 sm:px-6">
        <a
          href="#studio"
          className="mono inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-muted transition-colors hover:text-cyan"
        >
          <span className="motion-safe:animate-bounce">↓</span> Scroll to continue
        </a>
      </div>

      <style>{`@keyframes wave{from{transform:translateX(-18px)}to{transform:translateX(18px)}}`}</style>
    </section>
  );
}
