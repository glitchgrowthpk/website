"use client";

import { memo, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { preload } from "react-dom";
import { useGame } from "@/lib/game-state";
import { audioContext, isSoundEnabled, sfx } from "@/lib/audio";

/**
 * First-visit boot sequence: a CRT power-on, a fast BIOS-style log over a
 * segmented loading bar, PRESS START, then the tube switches off (collapses
 * to a bright line, then a dot) and reveals the page.
 *
 * The whole sequence is CSS. It ships in the server HTML, so it covers the page
 * with no flash, and it keeps time while the JS bundle is still parsing (the
 * big moves are transform / opacity, which run on the compositor). JavaScript
 * only skips it early on any input (a tiny inline script covers the time
 * before hydration) and cleans up afterwards. If the bundle
 * never runs at all, the switch-off still ends in `visibility: hidden`, with a
 * separate 4s failsafe behind it.
 *
 * CSS animations start when styles resolve, which can be well before first
 * paint while the main stylesheet is still downloading — on a slow connection
 * the boot would play to an empty screen. So every animation here is held
 * paused until a variable set by a Tailwind class (`[--bootscreen-play:running]`,
 * i.e. a rule that lives in the main stylesheet) arrives. That stylesheet is
 * render-blocking, so "the variable exists" means "the page can paint": the
 * sequence starts at first paint. The 4s failsafe is held with it (so a slow
 * stylesheet can't cut a boot short), and a second, never-held one at 10s
 * covers the case where that stylesheet never arrives at all.
 *
 * Purely decorative: aria-hidden, nothing focusable, no scroll lock. Hidden
 * outright on repeat visits this session (html[data-booted], set before paint
 * by layout.tsx) and under prefers-reduced-motion.
 */

/* --------------------------------------------------------------- timeline */

/** Milliseconds from first paint. */
const T = {
  logo: 60,
  word: 130,
  sub: 300,
  log: 330,
  logStep: 118,
  barFrom: 240,
  barTo: 1150,
  press: 1180,
  exit: 1520,
  exitDur: 340,
  /** Switch-off used when the visitor skips. */
  cut: 250,
  failsafe: 4000,
  /** Not held for the stylesheet: measured from when styles first resolve. */
  hardFailsafe: 10000,
} as const;

const TOTAL = T.exit + T.exitDur;

/** The longest the JS will wait on the sequence before cleaning up regardless. */
const MAX_WAIT = 12000;

/** Only facts that already appear on the site. */
const LOG = [
  "booting from Pakistan",
  "mounting 12 titles",
  "counting 220K+ installs",
  "loading 400+ characters",
  "arming match-3 boss fight",
  "calibrating glitch",
].map((text, i) => {
  const at = T.log + i * T.logStep;
  const type = 40 + text.length * 4;
  return { text, at, type, status: at + type + 30 };
});

/** The last line fails for a beat before it passes. */
const GLITCH_OK = LOG[LOG.length - 1].status + 80;

/* ----------------------------------------------------------- loading bar */

const SEGS = 20;

/** Loading curve as [time 0-1, percent]: quick, a stall, then a burst. */
const CURVE: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.3, 44],
  [0.5, 57],
  [0.68, 62],
  [1, 100],
];

/** Inverse of CURVE: when does the bar reach `pct`? */
function timeAt(pct: number) {
  for (let k = 1; k < CURVE.length; k++) {
    const [t0, p0] = CURVE[k - 1];
    const [t1, p1] = CURVE[k];
    if (pct <= p1) return t0 + ((pct - p0) / (p1 - p0)) * (t1 - t0);
  }
  return 1;
}

/** cyan -> violet -> magenta along the bar. */
const RAMP = [
  [0, 229, 255],
  [139, 92, 246],
  [255, 45, 119],
] as const;

function ramp(x: number) {
  const pos = x * (RAMP.length - 1);
  const k = Math.min(RAMP.length - 2, Math.floor(pos));
  const f = pos - k;
  const a = RAMP[k];
  const b = RAMP[k + 1];
  return `rgb(${a.map((v, j) => Math.round(v + (b[j] - v) * f)).join(" ")})`;
}

const SEGMENTS = Array.from({ length: SEGS }, (_, i) => ({
  at: Math.round(T.barFrom + (T.barTo - T.barFrom) * timeAt(((i + 1) / SEGS) * 100)),
  color: ramp(i / (SEGS - 1)),
}));

/* -------------------------------------------------------------------- css */

const ms = (n: number) => `${n}ms`;

/**
 * Shared by the natural switch-off and the faster one used on skip: the
 * picture squashes into a strip and goes dark while the separate beam element
 * takes over as the bright line, shrinks to a dot and fades.
 */
const OFF_FRAMES = `
  0% { transform: scale(1, 1); opacity: 1; animation-timing-function: cubic-bezier(.7, 0, .84, 0); }
  46% { transform: scale(1, .006); opacity: 1; animation-timing-function: ease-in; }
  56% { transform: scale(.8, .006); opacity: 0; }
  100% { transform: scale(.8, .006); opacity: 0; visibility: hidden; }`;

/** The picture brightens a little as it collapses (the beam concentrating). */
const GLOW_FRAMES = `0%, 34% { opacity: 0; } 46%, 100% { opacity: .4; }`;

const BEAM_FRAMES = `
  0%, 38% { opacity: 0; transform: scaleX(1); }
  46% { opacity: 1; transform: scaleX(1); animation-timing-function: cubic-bezier(.6, 0, .9, .4); }
  84% { opacity: 1; transform: scaleX(.012); }
  100% { opacity: 0; transform: scaleX(0); visibility: hidden; }`;

const FAILSAFES = `bootscreen-failsafe 1ms linear ${ms(T.failsafe)} forwards,
    bootscreen-failsafe 1ms linear ${ms(T.hardFailsafe)} forwards`;

const CSS = `
@property --bootscreen-pct { syntax: "<integer>"; inherits: false; initial-value: 0; }

html[data-booted] .bootscreen,
html[data-booted] .bootscreen-beam { display: none; }
@media (prefers-reduced-motion: reduce) {
  .bootscreen,
  .bootscreen-beam { display: none; }
}

.bootscreen {
  transform-origin: 50% 50%;
  will-change: transform, opacity;
  animation:
    bootscreen-off ${ms(T.exitDur)} linear ${ms(T.exit)} both,
    ${FAILSAFES};
}
.bootscreen[data-skip] {
  animation:
    bootscreen-cut ${ms(T.cut)} linear both,
    ${FAILSAFES};
}
.bootscreen.scanlines::after { z-index: 40; }
@keyframes bootscreen-off { ${OFF_FRAMES} }
@keyframes bootscreen-cut { ${OFF_FRAMES} }
@keyframes bootscreen-failsafe { to { visibility: hidden; opacity: 0; } }

/* the picture brightens as it collapses into the beam */
.bootscreen-glow {
  opacity: 0;
  background: linear-gradient(to bottom, #8ff4ff, #ffffff 40%, #ffffff 60%, #8ff4ff);
  animation: bootscreen-glow ${ms(T.exitDur)} linear ${ms(T.exit)} forwards;
}
.bootscreen[data-skip] .bootscreen-glow { animation: bootscreen-glow-cut ${ms(T.cut)} linear forwards; }
@keyframes bootscreen-glow { ${GLOW_FRAMES} }
@keyframes bootscreen-glow-cut { ${GLOW_FRAMES} }

/*
 * The beam lives outside the root, so the squash never flattens it. It draws
 * the bright line at power-on, then again at switch-off, where it shrinks to
 * a dot over the revealed page.
 */
.bootscreen-beam {
  opacity: 0;
  background: #ffffff;
  box-shadow: 0 0 10px 2px rgba(0, 229, 255, .9), 0 0 40px 10px rgba(139, 92, 246, .45);
  animation:
    bootscreen-beam-on 320ms linear both,
    bootscreen-beam ${ms(T.exitDur)} linear ${ms(T.exit)} forwards,
    ${FAILSAFES};
}
@keyframes bootscreen-beam-on {
  0% { opacity: 1; transform: scaleX(.15); animation-timing-function: cubic-bezier(.2, .8, .3, 1); }
  32% { opacity: 1; transform: scaleX(1); }
  80%, 100% { opacity: 0; transform: scaleX(1); }
}
.bootscreen[data-skip] ~ .bootscreen-beam { animation: bootscreen-beam-cut ${ms(T.cut)} linear forwards; }
@keyframes bootscreen-beam { ${BEAM_FRAMES} }
@keyframes bootscreen-beam-cut { ${BEAM_FRAMES} }

/* CRT power-on: a line that widens, then opens up with a little overshoot */
.bootscreen-screen {
  transform-origin: 50% 50%;
  animation: bootscreen-on 300ms both;
}
@keyframes bootscreen-on {
  0% { transform: scale(.2, .006); animation-timing-function: cubic-bezier(.2, .8, .3, 1); }
  34% { transform: scale(1, .006); animation-timing-function: cubic-bezier(.2, 1.25, .35, 1); }
  100% { transform: scale(1, 1); }
}
/* afterglow as the picture opens up */
.bootscreen-flash {
  background: radial-gradient(70% 50% at 50% 50%, #ffffff 0%, rgba(154, 246, 255, .7) 22%, rgba(139, 92, 246, .2) 55%, transparent 80%);
  animation: bootscreen-flash 400ms ease-out both;
}
@keyframes bootscreen-flash { 0%, 25% { opacity: .65; } 70% { opacity: .05; } 100% { opacity: 0; } }

/* the floor rushes toward the screen, like the level is loading in */
.bootscreen-floor {
  transform: perspective(420px) rotateX(68deg);
  transform-origin: 50% 100%;
  mask-image: linear-gradient(to top, #000 10%, transparent 92%);
  -webkit-mask-image: linear-gradient(to top, #000 10%, transparent 92%);
}
.bootscreen-grid {
  background-image:
    linear-gradient(to right, rgba(0, 229, 255, .2) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(139, 92, 246, .24) 1px, transparent 1px);
  background-size: 48px 48px;
  will-change: transform;
  animation: bootscreen-rush 420ms linear infinite;
}
@keyframes bootscreen-rush { from { transform: translateY(0); } to { transform: translateY(48px); } }

/* logo + wordmark */
.bootscreen-logo {
  opacity: 0;
  filter: drop-shadow(0 0 22px rgba(0, 229, 255, .45));
  animation: bootscreen-logo 560ms ${ms(T.logo)} forwards;
}
@keyframes bootscreen-logo {
  0% { opacity: 0; transform: translateY(14px) scale(.45) rotate(-14deg); animation-timing-function: cubic-bezier(.2, .9, .3, 1); }
  55% { opacity: 1; transform: translateY(-3px) scale(1.1) rotate(3deg); animation-timing-function: cubic-bezier(.4, 0, .3, 1); }
  100% { opacity: 1; transform: none; }
}

.bootscreen-word {
  opacity: 0;
  animation: bootscreen-word 520ms ${ms(T.word)} forwards;
}
@keyframes bootscreen-word {
  0% { opacity: 0; transform: scale(1.7); animation-timing-function: cubic-bezier(.5, 0, .9, .4); }
  14% { opacity: 1; transform: scale(.94) skewX(-10deg) translateX(-12px); animation-timing-function: steps(1, end); }
  24% { transform: scale(1.03) skewX(6deg) translateX(8px); }
  34% { transform: scale(.99) translateX(-3px); }
  44%, 100% { opacity: 1; transform: none; }
}
.bootscreen .bootscreen-word::before { animation: bootscreen-split-a 1400ms steps(1, end) ${ms(T.word)} both; }
.bootscreen .bootscreen-word::after { animation: bootscreen-split-b 1400ms steps(1, end) ${ms(T.word)} both; }
@keyframes bootscreen-split-a {
  0% { transform: translate(-16px, 0); clip-path: inset(0 0 55% 0); }
  6% { transform: translate(10px, -2px); clip-path: inset(40% 0 22% 0); }
  12% { transform: translate(-7px, 2px); clip-path: inset(72% 0 0 0); }
  18% { transform: translate(-4px, 0); clip-path: inset(0); }
  26%, 74% { transform: translate(-2px, 0); clip-path: inset(0); }
  77% { transform: translate(-11px, 1px); clip-path: inset(14% 0 60% 0); }
  81% { transform: translate(8px, -1px); clip-path: inset(60% 0 12% 0); }
  85%, 100% { transform: translate(-2px, 0); clip-path: inset(0); }
}
@keyframes bootscreen-split-b {
  0% { transform: translate(16px, 0); clip-path: inset(48% 0 0 0); }
  6% { transform: translate(-9px, 2px); clip-path: inset(10% 0 64% 0); }
  12% { transform: translate(6px, -2px); clip-path: inset(0 0 70% 0); }
  18% { transform: translate(4px, 0); clip-path: inset(0); }
  26%, 75% { transform: translate(2px, 0); clip-path: inset(0); }
  78% { transform: translate(12px, -2px); clip-path: inset(55% 0 20% 0); }
  82% { transform: translate(-7px, 1px); clip-path: inset(8% 0 72% 0); }
  86%, 100% { transform: translate(2px, 0); clip-path: inset(0); }
}

/* shared one-shot switches */
.bootscreen-in { opacity: 0; animation: bootscreen-show 1ms linear var(--at) forwards; }
.bootscreen-out { animation: bootscreen-hide 1ms linear var(--at) forwards; }
.bootscreen-fade { opacity: 0; animation: bootscreen-fade 320ms ease-out var(--at) forwards; }
@keyframes bootscreen-show { to { opacity: 1; } }
@keyframes bootscreen-hide { to { opacity: 0; } }
@keyframes bootscreen-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

/* typed log: a cover that shrinks off each line in character-sized steps, with a block caret riding its edge */
.bootscreen-type { position: relative; }
.bootscreen-type::after {
  content: "";
  position: absolute;
  inset: -1px -2px -1px 0;
  background: var(--color-abyss);
  transform-origin: 100% 50%;
  animation: bootscreen-cover var(--type) steps(var(--n), end) var(--at) both;
}
.bootscreen-type::before {
  content: "";
  position: absolute;
  z-index: 1;
  top: 12%;
  bottom: 12%;
  left: 0;
  width: 100%;
  background: linear-gradient(90deg, var(--color-cyan) 0 .62em, transparent .62em);
  opacity: 0;
  animation:
    bootscreen-caret var(--type) steps(var(--n), end) var(--at) both,
    bootscreen-hide 1ms linear var(--status) forwards;
}
@keyframes bootscreen-cover { from { transform: scaleX(1); } to { transform: scaleX(0); } }
@keyframes bootscreen-caret { from { opacity: 1; transform: translateX(0); } to { opacity: 1; transform: translateX(100%); } }
.bootscreen-lead::before { content: "........................................................................"; }
.bootscreen-status { opacity: 0; animation: bootscreen-show 1ms linear var(--status) forwards; }
.bootscreen-err { opacity: 0; animation: bootscreen-blip ${ms(GLITCH_OK - LOG[LOG.length - 1].status)} steps(1, end) var(--status); }
@keyframes bootscreen-blip { 0%, 100% { opacity: 1; transform: translateX(-2px); } 50% { opacity: 1; transform: translateX(2px); } }

/* loading bar */
.bootscreen-seg::before,
.bootscreen-seg::after { content: ""; position: absolute; inset: 0; border-radius: inherit; opacity: 0; }
.bootscreen-seg::before {
  background: var(--c);
  box-shadow: 0 0 10px var(--c);
  animation: bootscreen-show 1ms linear var(--at) forwards;
}
/* white-hot as each segment lights, cooling to its colour */
.bootscreen-seg::after { background: #ffffff; animation: bootscreen-pop 220ms ease-out var(--at); }
@keyframes bootscreen-pop { from { opacity: 1; } to { opacity: 0; } }
.bootscreen-bar { animation: bootscreen-done 600ms ease-out ${ms(T.barTo)} forwards; }
@keyframes bootscreen-done {
  0% { border-color: var(--color-lime); box-shadow: 0 0 0 1px var(--color-lime), 0 0 26px rgba(200, 255, 46, .55); }
  100% { border-color: rgba(200, 255, 46, .7); box-shadow: 0 0 14px rgba(200, 255, 46, .18); }
}
.bootscreen-sweep {
  transform: translateX(-120%);
  background: linear-gradient(90deg, transparent, rgba(200, 255, 46, .95), transparent);
  animation: bootscreen-sweep 380ms cubic-bezier(.3, 0, .2, 1) ${ms(T.barTo)};
}
@keyframes bootscreen-sweep { from { transform: translateX(-120%); } to { transform: translateX(280%); } }

.bootscreen-pct {
  counter-reset: bootscreen-pct var(--bootscreen-pct);
  animation: bootscreen-count ${ms(T.barTo - T.barFrom)} linear ${ms(T.barFrom)} both;
}
.bootscreen-pct::after { content: counter(bootscreen-pct) "%"; }
@keyframes bootscreen-count {
  ${CURVE.map(([t, p]) => `${(t * 100).toFixed(1)}% { --bootscreen-pct: ${p}; }`).join(" ")}
}

/* PRESS START: slams in, then blinks until the tube switches off */
.bootscreen-press {
  opacity: 0;
  text-shadow: 0 0 18px rgba(200, 255, 46, .55);
  animation: bootscreen-press ${ms(T.exit - T.press)} ${ms(T.press)} forwards;
}
@keyframes bootscreen-press {
  0% { opacity: 1; transform: scale(1.45); animation-timing-function: cubic-bezier(.2, .9, .3, 1.35); }
  24% { opacity: 1; transform: scale(1); animation-timing-function: steps(1, end); }
  40% { opacity: .12; animation-timing-function: steps(1, end); }
  54% { opacity: 1; animation-timing-function: steps(1, end); }
  70% { opacity: .12; animation-timing-function: steps(1, end); }
  84%, 100% { opacity: 1; transform: scale(1); }
}

.bootscreen-coin { animation: bootscreen-coin 300ms steps(1, end) infinite; }
@keyframes bootscreen-coin { 50% { opacity: .25; } }

.bootscreen-hint-touch { display: none; }
@media (hover: none) {
  .bootscreen-hint-touch { display: inline; }
  .bootscreen-hint-key { display: none; }
}

/* short screens (small laptops, landscape phones): tighten the stack so it fits between the bezel labels */
@media (max-height: 720px) {
  .bootscreen-console { padding-bottom: 0; }
  .bootscreen-logo { height: clamp(2rem, 8vh, 3.5rem); }
  .bootscreen-mark { margin-top: 1.5vh; font-size: clamp(2.4rem, min(15vw, 13.5vh), 7rem); }
  .bootscreen-log { margin-top: 3.5vh; }
  .bootscreen-loader { margin-top: 2.5vh; }
  .bootscreen-press { margin-top: 3.5vh; }
}
@media (max-height: 480px) {
  .bootscreen-logo { display: none; }
  .bootscreen-mark { margin-top: 0; }
  .bootscreen-sub { margin-top: .25rem; }
  .bootscreen-log { padding-top: .6rem; padding-bottom: .45rem; }
  .bootscreen-log ul { line-height: 1.55; }
  .bootscreen-bezel-top { top: 10px; }
  .bootscreen-bezel-bottom { bottom: 10px; }
  .bootscreen-press { font-size: 1.25rem; }
}

/* hold everything until the main stylesheet (and so first paint) is in — see the top of the file */
.bootscreen *,
.bootscreen *::before,
.bootscreen *::after { animation-play-state: var(--bootscreen-play, paused) !important; }
/* the last animation on the root and the beam is the hard failsafe, which always runs */
.bootscreen {
  animation-play-state: var(--bootscreen-play, paused), var(--bootscreen-play, paused), running !important;
}
.bootscreen-beam {
  animation-play-state:
    var(--bootscreen-play, paused), var(--bootscreen-play, paused), var(--bootscreen-play, paused), running !important;
}
`;

/** A rule from the main stylesheet that releases the held animations. */
const RELEASE = "[--bootscreen-play:running]";

/** The root element, with the hand-off from the inline script below. */
type BootRoot = HTMLDivElement & { bootscreenOff?: () => void };

/**
 * Skips the boot before React has hydrated. On a slow phone the bundle can
 * still be parsing when the sequence ends, so a tap would otherwise do
 * nothing. It only flips [data-skip] (the CSS does the rest; never once the
 * switch-off has begun) and mirrors the key rules of the effect below. It
 * handles the first input only. Once the effect runs it calls
 * `root.bootscreenOff()` and takes over. Inline and parser-inserted, so it
 * runs as soon as the overlay is in the document; React hydrates it as-is.
 */
const EARLY_SKIP = `(function(){var s=document.currentScript,r=s&&s.parentNode,d=document.documentElement;
if(!r||d.hasAttribute("data-booted")||matchMedia("(prefers-reduced-motion: reduce)").matches)return;
var t=["keydown","pointerdown","wheel","touchstart"];if(location.hash.length<2)t.push("scroll");
function off(){t.forEach(function(k){removeEventListener(k,on,true)});r.bootscreenOff=null}
function on(e){if(e.type==="keydown"&&!(e.key==="Tab"||e.ctrlKey||e.metaKey||e.altKey||/^F\\d+$/.test(e.key)))e.preventDefault();
var a=r.getAnimations?r.getAnimations().filter(function(x){return x.animationName==="bootscreen-off"})[0]:null;
if(!a||a.currentTime==null||a.currentTime<${T.exit})r.setAttribute("data-skip","");off()}
t.forEach(function(k){addEventListener(k,on,{capture:true,passive:k!=="keydown"})});r.bootscreenOff=off})();`;

const noSubscribe = () => () => {};

/**
 * True for the server render and the hydration pass that matches it, false
 * afterwards. The inline script only means anything in server HTML; a
 * client-created <script> never runs (and React warns about it in dev).
 */
const useServerHtml = () =>
  useSyncExternalStore(
    noSubscribe,
    () => false,
    () => true,
  );

/* ------------------------------------------------------------------- art */

const cssVars = (vars: Record<string, string | number>) => vars as React.CSSProperties;

const CORNERS = [
  "left-3 top-3 border-l-2 border-t-2",
  "right-3 top-3 border-r-2 border-t-2",
  "bottom-3 left-3 border-b-2 border-l-2",
  "bottom-3 right-3 border-b-2 border-r-2",
];

/** The overlay's static markup. Rendered once; everything after that is CSS. */
const BootArt = memo(function BootArt() {
  return (
    <>
      <div className="bootscreen-screen absolute inset-0">
        {/* ---------- backdrop ---------- */}
        <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_0%,#1a1030_0%,#0a0a12_48%,#06060a_100%)]" />
        <div className="absolute left-1/2 top-[40%] h-[80vmin] w-[80vmin] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(139,92,246,0.22),rgba(0,229,255,0.06)_55%,transparent)]" />
        <div className="bootscreen-floor absolute inset-x-[-15%] bottom-0 h-[40%] overflow-hidden opacity-70">
          <div className="bootscreen-grid absolute inset-x-0 bottom-0 top-[-48px]" />
        </div>
        <div className="absolute inset-x-0 bottom-[40%] h-px bg-gradient-to-r from-transparent via-cyan to-transparent opacity-60 blur-[1px]" />
        <div className="noise absolute inset-0 opacity-[0.05]" />

        {/* ---------- bezel ---------- */}
        {CORNERS.map((c) => (
          <span key={c} className={`absolute h-5 w-5 border-cyan/60 ${c}`} />
        ))}
        <div className="bootscreen-bezel-top label absolute inset-x-10 top-[18px] flex justify-between">
          <span className="bootscreen-coin text-amber">Insert coin</span>
          <span className="grid">
            <span
              className="bootscreen-out col-start-1 row-start-1"
              style={cssVars({ "--at": `${T.press}ms` })}
            >
              Credit 0
            </span>
            <span
              className="bootscreen-in col-start-1 row-start-1 text-lime"
              style={cssVars({ "--at": `${T.press}ms` })}
            >
              Credit 1
            </span>
          </span>
        </div>
        <div className="bootscreen-bezel-bottom label absolute inset-x-10 bottom-[18px] flex justify-between">
          <span>© GlitchTech Games</span>
          <span>
            <span className="bootscreen-hint-key">Press any key</span>
            <span className="bootscreen-hint-touch">Tap to skip</span>
          </span>
        </div>

        {/* ---------- console ---------- */}
        <div className="bootscreen-console relative z-10 flex h-full flex-col items-center justify-center px-5 pb-[4vh] text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-mark.webp"
            alt=""
            width={934}
            height={1507}
            decoding="async"
            className="bootscreen-logo h-14 w-auto sm:h-[72px]"
          />

          <p className="bootscreen-mark mt-4 font-display text-[clamp(3.4rem,15vw,7rem)] leading-[0.9] tracking-tight">
            <span className="bootscreen-word glitch" data-text="GLITCHTECH">
              GLITCHTECH
            </span>
          </p>
          <p
            className="bootscreen-fade bootscreen-sub mono mt-2 text-[11px] uppercase tracking-[0.45em] text-muted sm:text-xs"
            style={cssVars({ "--at": `${T.sub}ms` })}
          >
            <span className="bg-gradient-to-r from-lime via-cyan to-violet bg-clip-text font-bold text-transparent">
              Games
            </span>{" "}
            · made in house
          </p>

          {/* boot log */}
          <div className="bootscreen-log relative mt-8 w-full max-w-[25rem] rounded-md border border-edge bg-abyss px-4 pb-3 pt-3.5 text-left sm:mt-10">
            <span className="mono absolute -top-2 left-3 bg-void px-1.5 text-[10px] uppercase tracking-[0.3em] text-muted">
              boot.log
            </span>
            <ul className="mono text-[11px] leading-[1.8] sm:text-xs">
              {LOG.map((l, i) => {
                const last = i === LOG.length - 1;
                return (
                  <li
                    key={l.text}
                    className="bootscreen-in flex items-baseline whitespace-nowrap"
                    style={cssVars({
                      "--at": `${l.at}ms`,
                      "--type": `${l.type}ms`,
                      "--status": `${l.status}ms`,
                      "--n": l.text.length,
                    })}
                  >
                    <span className="mr-2 text-cyan">&gt;</span>
                    <span className="bootscreen-type text-ink/85">{l.text}</span>
                    <span className="bootscreen-status bootscreen-lead mx-2 min-w-3 flex-1 overflow-hidden text-muted/35" />
                    {last ? (
                      <span className="bootscreen-status relative font-bold">
                        <span
                          className="bootscreen-in text-lime"
                          style={cssVars({ "--at": `${GLITCH_OK}ms` })}
                        >
                          OK
                        </span>
                        <span className="bootscreen-err absolute right-0 top-0 bg-abyss pl-1 text-magenta">
                          ERR
                        </span>
                      </span>
                    ) : (
                      <span className="bootscreen-status font-bold text-lime">OK</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* loading bar */}
          <div className="bootscreen-loader mt-5 w-full max-w-[25rem]">
            <div className="label mb-2 flex items-center justify-between">
              <span className="grid">
                <span
                  className="bootscreen-out col-start-1 row-start-1"
                  style={cssVars({ "--at": `${T.barTo}ms` })}
                >
                  Loading
                </span>
                <span
                  className="bootscreen-in col-start-1 row-start-1 text-lime"
                  style={cssVars({ "--at": `${T.barTo}ms` })}
                >
                  Ready
                </span>
              </span>
              <span className="bootscreen-pct tabular-nums text-cyan" />
            </div>
            <div className="bootscreen-bar relative flex h-[18px] gap-[3px] overflow-hidden rounded-[5px] border border-edge bg-abyss p-[3px] sm:h-5">
              {SEGMENTS.map((s, i) => (
                <span
                  key={i}
                  className="bootscreen-seg relative flex-1 rounded-[2px] bg-panel-2"
                  style={cssVars({ "--at": `${s.at}ms`, "--c": s.color })}
                />
              ))}
              <span className="bootscreen-sweep pointer-events-none absolute inset-y-0 left-0 w-2/5" />
            </div>
          </div>

          <p className="bootscreen-press mt-7 flex items-center gap-3 font-display text-2xl tracking-[0.28em] text-lime sm:text-3xl">
            <span className="h-0 w-0 border-y-[7px] border-l-[11px] border-y-transparent border-l-lime" />
            PRESS START
            <span className="h-0 w-0 border-y-[7px] border-r-[11px] border-y-transparent border-r-lime" />
          </p>
        </div>

        <div className="bootscreen-flash pointer-events-none absolute inset-0 z-20" />
      </div>

      <div className="bootscreen-glow pointer-events-none absolute inset-0 z-30" />
    </>
  );
});

/* -------------------------------------------------------------- component */

export default function BootScreen() {
  const { unlock, ready } = useGame();
  const serverHtml = useServerHtml();
  const rootRef = useRef<HTMLDivElement>(null);
  /** True while the sequence is actually playing on this page view. */
  const live = useRef(false);
  const [gone, setGone] = useState(false);

  // Hoisted into <head> during the server render so the mark is ready by 60ms.
  preload("/logo-mark.webp", { as: "image", fetchPriority: "high" });

  useEffect(() => {
    const root = rootRef.current as BootRoot | null;
    if (!root) return;
    // The inline pre-hydration listeners hand over to this effect.
    root.bootscreenOff?.();
    const html = document.documentElement;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Repeat visit or reduced motion: CSS already hides the overlay. Drop it
    // from the DOM and still award the boot achievement, a beat later.
    if (html.hasAttribute("data-booted") || reduce) {
      const t = window.setTimeout(() => {
        setGone(true);
        unlock("press-start");
      }, 1200);
      return () => window.clearTimeout(t);
    }

    live.current = true;
    let done = false;
    const ac = new AbortController();
    const timers: number[] = [];

    const finish = () => {
      if (done) return;
      done = true;
      live.current = false;
      ac.abort();
      timers.forEach((t) => window.clearTimeout(t));
      try {
        sessionStorage.setItem("glitch.booted", "1");
      } catch {
        /* storage blocked — the boot just plays again next time */
      }
      html.setAttribute("data-booted", "");
      setGone(true);
      unlock("press-start");
    };

    const mounted = performance.now();
    const animation = (name: string) =>
      root
        .getAnimations?.()
        .find((a) => (a as CSSAnimation).animationName === name);

    const elapsed = (name: string) => {
      const t = animation(name)?.currentTime;
      return typeof t === "number" ? t : null;
    };

    /**
     * Finish when the named switch-off ends. A watchdog runs behind the
     * promise (hidden tabs don't tick animations): it re-arms while the
     * sequence is still legitimately playing or held for the stylesheet, and
     * gives up after MAX_WAIT so the key listener can never outlive the boot.
     */
    const finishAfter = (name: string, length: number) => {
      animation(name)?.finished.then(finish, () => {
        /* cancelled because the visitor skipped — the skip animation takes over */
      });
      const watchdog = () => {
        if (done) return;
        const t = elapsed(name);
        const playing =
          t !== null && t < length && getComputedStyle(root).visibility !== "hidden";
        if (playing && performance.now() - mounted < MAX_WAIT) {
          timers.push(window.setTimeout(watchdog, Math.min(500, length - t + 150)));
        } else {
          finish();
        }
      };
      timers.push(window.setTimeout(watchdog, length - (elapsed(name) ?? 0) + 150));
    };

    // Skipped before hydration: the faster switch-off is already playing.
    if (root.hasAttribute("data-skip")) finishAfter("bootscreen-cut", T.cut);
    else finishAfter("bootscreen-off", TOTAL);

    const skip = () => {
      if (done || root.hasAttribute("data-skip")) return;
      const t = elapsed("bootscreen-off");
      if (t !== null && t >= T.exit) return; // already switching itself off
      // Still held for the stylesheet: nothing has been painted, so just go.
      if (getComputedStyle(root).getPropertyValue("--bootscreen-play").trim() !== "running") {
        finish();
        return;
      }
      root.setAttribute("data-skip", "");
      finishAfter("bootscreen-cut", T.cut);
    };

    const { signal } = ac;
    window.addEventListener(
      "keydown",
      (e) => {
        skip();
        // Tab still moves focus, and browser / OS shortcuts are left alone.
        if (e.key === "Tab" || e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.key)) {
          return;
        }
        // Any other key only skips the boot; it must not also trigger a
        // shortcut (G, P, ...) on a page the visitor cannot see yet.
        e.preventDefault();
        e.stopImmediatePropagation();
      },
      { capture: true, signal },
    );
    // A deep link (/#arcade) scrolls the page under the overlay while it
    // loads, which would cut the boot short a few frames in. There, only real
    // input skips it (wheel, touch, keys); the scroll itself doesn't.
    const inputs = ["pointerdown", "wheel", "touchstart"];
    if (location.hash.length < 2) inputs.push("scroll");
    for (const type of inputs) {
      window.addEventListener(type, skip, { capture: true, passive: true, signal });
    }

    return () => {
      done = true;
      live.current = false;
      ac.abort();
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [unlock]);

  // Boot sound once saved settings are restored (the provider's effect runs
  // after this component's). Only if the context is genuinely running: a sound
  // booked on a suspended context would play late, on the visitor's first click.
  useEffect(() => {
    if (!ready || !live.current || !isSoundEnabled()) return;
    const c = audioContext();
    if (!c) return;
    if (c.state === "running") {
      sfx.boot();
      return;
    }
    // A fresh context starts suspended and flips to running shortly after if
    // the browser allows autoplay. Give it a moment, then let it go.
    const onState = () => {
      if (c.state === "running" && live.current) sfx.boot();
    };
    c.addEventListener("statechange", onState, { once: true });
    const t = window.setTimeout(() => c.removeEventListener("statechange", onState), 400);
    return () => {
      window.clearTimeout(t);
      c.removeEventListener("statechange", onState);
    };
  }, [ready]);

  if (gone) return null;

  return (
    <>
      <div
        ref={rootRef}
        aria-hidden="true"
        className={`bootscreen scanlines fixed inset-0 z-[80] overflow-hidden bg-void ${RELEASE}`}
        // The inline script may already have set data-skip before hydration.
        suppressHydrationWarning
      >
        <style>{CSS}</style>
        {serverHtml && <script dangerouslySetInnerHTML={{ __html: EARLY_SKIP }} />}
        <BootArt />
      </div>
      {/* Outside the root so the switch-off squash doesn't flatten it. */}
      <div
        aria-hidden="true"
        className={`bootscreen-beam pointer-events-none fixed inset-x-0 top-1/2 z-[80] -mt-[2px] h-1 ${RELEASE}`}
      />
    </>
  );
}
