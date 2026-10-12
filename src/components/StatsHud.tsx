"use client";

import {
  useEffect,
  useRef,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { HEADLINE_STATS, PERF_STATS } from "@/data/studio";
import { useGame } from "@/lib/game-state";
import { sfx } from "@/lib/audio";
import { useFinePointer, useReducedMotion } from "@/lib/hooks";
import { Section, SectionHead, useEntrance } from "./Section";
import { Coin } from "./GameUi";

const ACCENT = {
  cyan: {
    hex: "#00e5ff",
    text: "text-cyan",
    bg: "bg-cyan",
    glow: "shadow-[0_0_24px_-6px_#00e5ff] hover:shadow-[0_0_46px_-4px_#00e5ff]",
  },
  magenta: {
    hex: "#ff2d77",
    text: "text-magenta",
    bg: "bg-magenta",
    glow: "shadow-[0_0_24px_-6px_#ff2d77] hover:shadow-[0_0_46px_-4px_#ff2d77]",
  },
  lime: {
    hex: "#c8ff2e",
    text: "text-lime",
    bg: "bg-lime",
    glow: "shadow-[0_0_24px_-6px_#c8ff2e] hover:shadow-[0_0_46px_-4px_#c8ff2e]",
  },
  violet: {
    hex: "#8b5cf6",
    text: "text-violet",
    bg: "bg-violet",
    glow: "shadow-[0_0_24px_-6px_#8b5cf6] hover:shadow-[0_0_46px_-4px_#8b5cf6]",
  },
} as const;

/* ------------------------------------------------------------ slot reels */

/** Digits in the longest headline stat. Column n rolls n laps plus its digit. */
const MAX_COLS = Math.max(...HEADLINE_STATS.map((s) => String(s.value).length));
/** Lines on each reel strip: the digits 0-9, once per lap plus one. */
const STRIP_CYCLES = MAX_COLS + 1;
const STRIP = Array.from({ length: STRIP_CYCLES * 10 }, (_, i) => i % 10).join("\\A ");
/**
 * Line pitch on the strip, in em. Looser than the 1em digit line so that a
 * resting reel's neighbours sit fully outside its window instead of peeking
 * into the top and bottom edges.
 */
const PITCH = 1.3;

/**
 * Reel timing, shared by the CSS (per-column custom properties) and the
 * landing sound. Tiles stagger in; within a tile the columns stop left to
 * right, each spinning one more lap than the one before it.
 */
const TILE_STAGGER = 110;
const REEL_START = 120;
const COL_STAGGER = 50;
const REEL_DUR = 800;
const COL_EXTRA = 220;

const reelEnd = (tile: number, cols: number) =>
  tile * TILE_STAGGER +
  REEL_START +
  (cols - 1) * COL_STAGGER +
  REEL_DUR +
  (cols - 1) * COL_EXTRA;

/** When the last stat tile has landed and its flash has faded. */
const GRID_DONE =
  Math.max(...HEADLINE_STATS.map((s, i) => reelEnd(i, String(s.value).length))) + 1000;

/** Number of cells in a performance bar. */
const SEGMENTS = 20;
const SEG_STAGGER = 38;
const BAR_STAGGER = 140;

/* ------------------------------------------------------------- stat tile */

function StatTile({
  value,
  suffix,
  label,
  accent,
  index,
  onPointerEnter,
  onPointerMove,
  onPointerLeave,
}: {
  value: number;
  suffix: string;
  label: string;
  accent: keyof typeof ACCENT;
  index: number;
  onPointerEnter: (e: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLDivElement>) => void;
  onPointerLeave: (e: PointerEvent<HTMLDivElement>) => void;
}) {
  const a = ACCENT[accent];
  const digits = [...String(value)].map(Number);

  return (
    <div
      data-solid=""
      data-reveal="pop"
      onPointerEnter={onPointerEnter}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      style={
        {
          "--reveal-delay": `${index * 90}ms`,
          "--st-accent": a.hex,
          "--st-land": `${reelEnd(index, digits.length)}ms`,
        } as CSSProperties
      }
      className={`st-tile panel relative overflow-hidden p-5 hover:-translate-y-1 sm:p-6 ${a.glow}`}
    >
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${a.bg}`} />
      <span aria-hidden="true" className="st-glare" />
      <span aria-hidden="true" className="st-sweep" />
      <span aria-hidden="true" className="st-flash" />

      <p className="relative font-display text-[clamp(2.2rem,5.4vw,3.4rem)] leading-none tabular-nums">
        <span className="sr-only">
          {value}
          {suffix}
        </span>
        {/* Digits and suffix are drawn from data attributes by CSS, so the
            document text is only the real value above — never a reel strip. */}
        <span aria-hidden="true">
          {digits.map((d, col) => (
            <span
              key={col}
              className="st-reel"
              data-d={d}
              style={
                {
                  "--st-k": 10 * (col + 1) + d,
                  "--st-dur": `${REEL_DUR + col * COL_EXTRA}ms`,
                  "--st-delay": `${index * TILE_STAGGER + REEL_START + col * COL_STAGGER}ms`,
                } as CSSProperties
              }
            >
              <span className="st-strip" />
            </span>
          ))}
          {suffix && <span className={`st-suffix ${a.text}`} data-s={suffix} />}
        </span>
      </p>
      <p className="label relative mt-3">{label}</p>
    </div>
  );
}

/* -------------------------------------------------------------- perf bar */

function PerfBar({
  label,
  display,
  fill,
  note,
  accent,
  index,
}: {
  label: string;
  display: string;
  fill: number;
  note: string;
  accent: keyof typeof ACCENT;
  index: number;
}) {
  const a = ACCENT[accent];
  const lit = Math.round(fill * SEGMENTS);
  const delay = index * BAR_STAGGER;

  return (
    <div
      className="st-perf py-3.5"
      style={
        {
          "--st-accent": a.hex,
          "--st-bar-delay": `${delay}ms`,
          "--st-fill-end": `${delay + lit * SEG_STAGGER + 150}ms`,
        } as CSSProperties
      }
    >
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="mono text-[11px] uppercase tracking-[0.16em] text-muted">
          {label}
        </span>
        <span className={`st-val inline-block font-display text-lg tabular-nums ${a.text}`}>
          {display}
        </span>
      </div>
      {/* A segmented health bar. Purely visual: the value is printed above. */}
      <div aria-hidden="true" className="st-bar relative flex h-2.5 gap-[3px]">
        {Array.from({ length: SEGMENTS }, (_, s) => (
          <span key={s} className="relative flex-1 rounded-[2px] bg-panel-2">
            {s < lit && (
              <span
                className={`st-fill absolute inset-0 rounded-[2px] ${a.bg} ${
                  s === lit - 1 ? "is-tip" : ""
                }`}
                style={{ "--i": s } as CSSProperties}
              />
            )}
          </span>
        ))}
        <span className="st-shine" style={{ width: `${(lit / SEGMENTS) * 100}%` }} />
      </div>
      <p className="mono mt-1.5 text-[10px] uppercase tracking-[0.16em] text-muted">
        {note}
      </p>
    </div>
  );
}

/* --------------------------------------------------------------- section */

/** Max tilt of a hovered stat tile, in degrees. */
const TILT = 7;

export default function StatsHud() {
  const { paused } = useGame();
  const fine = useFinePointer();
  const reduced = useReducedMotion();

  const gridRef = useRef<HTMLDivElement>(null);
  const perfRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused);
  const landTimers = useRef<number[]>([]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  // The reels and bars are pure CSS once their container is in "play". The
  // only script is the landing blip, one per tile, timed to its last reel.
  useEntrance(gridRef, {
    duration: GRID_DONE,
    onPlay: () => {
      landTimers.current = HEADLINE_STATS.map((s, i) =>
        window.setTimeout(() => {
          if (!pausedRef.current && !document.hidden) sfx.menuMove();
        }, reelEnd(i, String(s.value).length)),
      );
    },
  });
  useEntrance(perfRef, {
    duration: (PERF_STATS.length - 1) * BAR_STAGGER + SEGMENTS * SEG_STAGGER + 1600,
  });

  useEffect(() => () => landTimers.current.forEach((t) => window.clearTimeout(t)), []);

  /* ---------- tile tilt: one rAF loop for whichever tile is hovered ---------- */

  const tilt = useRef({
    el: null as HTMLElement | null,
    rect: null as DOMRect | null,
    dirty: false,
    hover: false,
    px: 0,
    py: 0,
    rx: 0,
    ry: 0,
    raf: 0,
  });

  useEffect(() => {
    const s = tilt.current;
    // Rects are cached while hovering; a scroll under the pointer stales them.
    const onScroll = () => {
      if (s.el) s.dirty = true;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(s.raf);
    };
  }, []);

  const frame = () => {
    const s = tilt.current;
    s.raf = 0;
    const el = s.el;
    if (!el) return;
    if (s.dirty || !s.rect) {
      s.rect = el.getBoundingClientRect();
      s.dirty = false;
    }
    let tx = 0;
    let ty = 0;
    let mx = 0.5;
    let my = 0.5;
    if (s.hover) {
      mx = Math.min(1, Math.max(0, (s.px - s.rect.left) / s.rect.width));
      my = Math.min(1, Math.max(0, (s.py - s.rect.top) / s.rect.height));
      // lean the hovered corner away, as if pressed
      tx = (0.5 - my) * 2 * TILT;
      ty = (mx - 0.5) * 2 * TILT;
    }
    s.rx += (tx - s.rx) * 0.18;
    s.ry += (ty - s.ry) * 0.18;
    const settled = Math.abs(tx - s.rx) < 0.02 && Math.abs(ty - s.ry) < 0.02;

    if (!s.hover && settled) {
      el.style.transform = "";
      s.el = null;
      s.rect = null;
      return;
    }
    el.style.transform = `perspective(800px) rotateX(${s.rx.toFixed(2)}deg) rotateY(${s.ry.toFixed(2)}deg)`;
    if (s.hover) {
      el.style.setProperty("--mx", `${(mx * 100).toFixed(1)}%`);
      el.style.setProperty("--my", `${(my * 100).toFixed(1)}%`);
    }
    if (!settled) s.raf = requestAnimationFrame(frame);
  };

  const kick = () => {
    const s = tilt.current;
    if (!s.raf) s.raf = requestAnimationFrame(frame);
  };

  const onTileEnter = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || !fine || reduced) return;
    const s = tilt.current;
    if (s.el && s.el !== e.currentTarget) s.el.style.transform = "";
    if (s.el !== e.currentTarget) {
      s.rx = 0;
      s.ry = 0;
    }
    s.el = e.currentTarget;
    s.dirty = true;
    s.hover = true;
    s.px = e.clientX;
    s.py = e.clientY;
    kick();
  };
  const onTileMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = tilt.current;
    if (!s.hover || s.el !== e.currentTarget) return;
    s.px = e.clientX;
    s.py = e.clientY;
    kick();
  };
  const onTileLeave = (e: PointerEvent<HTMLDivElement>) => {
    const s = tilt.current;
    if (s.el !== e.currentTarget) return;
    s.hover = false;
    kick();
  };

  return (
    <Section id="studio">
      <SectionHead
        index="02"
        kicker="Who we are"
        title="STUDIO SNAPSHOT"
        accent="magenta"
        lead="A small dedicated studio in Pakistan, trying to make a global impact. Design, art, engineering, user acquisition and live ops all happen in house — which is why a concept can reach soft launch in weeks, not quarters."
      />

      <div>
        <div
          ref={gridRef}
          className="st-grid grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
        >
          {HEADLINE_STATS.map((s, i) => (
            <StatTile
              key={s.label}
              value={s.value}
              suffix={s.suffix}
              label={s.label}
              accent={s.accent}
              index={i}
              onPointerEnter={onTileEnter}
              onPointerMove={onTileMove}
              onPointerLeave={onTileLeave}
            />
          ))}
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1.25fr_1fr]">
          <div ref={perfRef} data-reveal="" className="st-panel panel relative p-5 sm:p-7">
            <Coin id="stats" label="the performance panel" className="right-5 top-4" />
            <div className="mb-2 flex items-center gap-2">
              <span className="label">Live performance</span>
              <span className="mono rounded border border-cyan/40 bg-cyan/10 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] text-cyan">
                Puzzle Warrior
              </span>
            </div>
            <div className="divide-y divide-edge/60">
              {PERF_STATS.map((p, i) => (
                <PerfBar key={p.label} {...p} index={i} />
              ))}
            </div>
          </div>

          <div
            data-reveal=""
            style={{ "--reveal-delay": "140ms" } as CSSProperties}
            className="panel relative flex flex-col justify-between gap-6 p-5 sm:p-7"
          >
            <div>
              <p className="label mb-3">The thesis</p>
              <p className="text-pretty text-base leading-relaxed text-ink/90">
                Hybrid-casual lives or dies on two numbers: what it costs to buy a
                player, and whether they come back tomorrow. We build small, test
                in market early, and only scale the titles that clear both bars.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div
                data-reveal="pop"
                style={{ "--reveal-delay": "260ms" } as CSSProperties}
                className="st-mini relative rounded-lg border border-edge bg-panel-2/60 p-3.5 hover:-translate-y-1 hover:scale-[1.04] hover:border-lime/60 hover:shadow-[0_10px_30px_-12px_#c8ff2e]"
              >
                {/* A coin on the one-cent card. Obviously. */}
                <Coin id="studio-thesis" label="the thesis panel" className="-right-2.5 -top-4" />
                <p className="font-display text-2xl text-lime">1¢</p>
                <p className="label mt-1.5">Best CPI achieved</p>
              </div>
              <div
                data-reveal="pop"
                style={{ "--reveal-delay": "340ms" } as CSSProperties}
                className="st-mini relative rounded-lg border border-edge bg-panel-2/60 p-3.5 hover:-translate-y-1 hover:scale-[1.04] hover:border-cyan/60 hover:shadow-[0_10px_30px_-12px_#00e5ff]"
              >
                <p className="font-display text-2xl text-cyan">100%</p>
                <p className="label mt-1.5">Made in house</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style href="glitch-stats-hud" precedence="default">
        {STATS_CSS}
      </style>
    </Section>
  );
}

/* ------------------------------------------------------------------- css */

const STATS_CSS = `
.st-tile{transition:translate .35s var(--ease-pop),box-shadow .35s ease}
.st-reel{position:relative;display:inline-block;padding-block:.14em;margin-block:-.14em;clip-path:inset(0 -.45em)}
.st-reel::before{content:attr(data-d)}
/* A ${PITCH}em line puts each digit's baseline ${((PITCH - 1) / 2).toFixed(2)}em lower than the 1em
   line of the resting digit; the top offset takes that back out. */
.st-strip{position:absolute;inset:${(0.14 - (PITCH - 1) / 2).toFixed(2)}em 0 auto;display:none;line-height:${PITCH};text-align:center;white-space:pre}
.st-strip::before{content:"${STRIP}"}
.st-suffix::before{content:attr(data-s)}

.st-glare{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .35s;
  background:radial-gradient(260px circle at var(--mx,50%) var(--my,0%),color-mix(in srgb,var(--st-accent) 20%,transparent),transparent 70%)}
.st-tile:hover .st-glare{opacity:1}
.st-sweep{position:absolute;inset:0 auto 0 0;width:55%;pointer-events:none;
  background:linear-gradient(100deg,transparent 15%,rgba(255,255,255,.14) 50%,transparent 85%);
  transform:translateX(-130%) skewX(-14deg)}
.st-flash{position:absolute;inset:0;border-radius:inherit;pointer-events:none;opacity:0;
  box-shadow:inset 0 0 0 1px var(--st-accent),inset 0 0 34px -8px var(--st-accent)}

.st-mini{transition:translate .3s var(--ease-pop),scale .3s var(--ease-pop),border-color .3s,box-shadow .3s}

.st-bar{transform:skewX(-20deg)}
.st-fill.is-tip{box-shadow:inset 0 0 0 1px rgba(255,255,255,.55)}
.st-shine{position:absolute;inset:0 auto 0 0;overflow:hidden;pointer-events:none}
.st-shine::after{content:"";position:absolute;inset:0 auto 0 0;width:28%;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.7),transparent);
  transform:translateX(-110%);mix-blend-mode:overlay}

@media (hover:hover) and (prefers-reduced-motion:no-preference){
  .st-tile:hover .st-sweep{transform:translateX(260%) skewX(-14deg);transition:transform .85s cubic-bezier(.2,.7,.2,1)}
  .st-perf:hover .st-shine::after{animation:st-shine .9s cubic-bezier(.4,0,.2,1)}
}

/* screen only: printed while armed, the reels would read 000 */
@media screen and (prefers-reduced-motion:no-preference){
  .st-grid[data-stage] .st-reel::before{color:transparent}
  .st-grid[data-stage] .st-strip{display:block}
  .st-grid[data-stage] .st-reel{mask-image:linear-gradient(transparent,#000 .16em,#000 calc(100% - .16em),transparent)}
  .st-grid[data-stage="play"] .st-strip{animation:st-roll var(--st-dur) var(--st-delay) both}
  .st-grid[data-stage="play"] .st-sweep{animation:st-sweep .9s cubic-bezier(.2,.7,.2,1) var(--st-land)}
  .st-grid[data-stage="play"] .st-flash{animation:st-flash .95s ease-out var(--st-land) both}

  .st-panel[data-stage="armed"] .st-fill{opacity:0}
  .st-panel[data-stage="play"] .st-fill{animation:st-seg .34s cubic-bezier(.2,.9,.3,1.25) calc(var(--st-bar-delay) + var(--i) * ${SEG_STAGGER}ms + 150ms) both}
  .st-panel[data-stage="play"] .st-shine::after{animation:st-shine .9s cubic-bezier(.4,0,.2,1) var(--st-fill-end) both}
  .st-panel[data-stage="play"] .st-val{animation:st-val .55s var(--ease-pop) var(--st-fill-end) both}
}

@keyframes st-roll{
  0%{transform:translateY(0);animation-timing-function:cubic-bezier(.33,.02,.2,1)}
  88%{transform:translateY(calc(var(--st-k) * -${PITCH}em - .16em));animation-timing-function:ease-in-out}
  100%{transform:translateY(calc(var(--st-k) * -${PITCH}em))}
}
@keyframes st-sweep{from{transform:translateX(-130%) skewX(-14deg)}to{transform:translateX(260%) skewX(-14deg)}}
@keyframes st-flash{0%{opacity:0}15%{opacity:1}100%{opacity:0}}
@keyframes st-seg{from{opacity:0;transform:scaleY(2.4);filter:brightness(2.4)}to{opacity:1;transform:none;filter:none}}
@keyframes st-shine{from{transform:translateX(-110%)}to{transform:translateX(420%)}}
@keyframes st-val{0%{transform:none}35%{transform:scale(1.28);text-shadow:0 0 16px var(--st-accent)}100%{transform:none;text-shadow:none}}
`;
