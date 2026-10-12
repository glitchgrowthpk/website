"use client";

import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { STUDIO } from "@/data/studio";
import { ACCENT_HEX, byId, spriteSrc } from "@/data/characters";
import { useGame } from "@/lib/game-state";
import { useFinePointer, useReducedMotion } from "@/lib/hooks";
import { Coin } from "./GameUi";
import { sfx } from "@/lib/audio";
import { fx, type BurstOptions } from "@/lib/fx";

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

/** The wordmark, one poppable letter at a time. */
const TITLE = ["G", "L", "I", "T", "C", "H"];

/**
 * Pointer parallax: px of travel with the pointer at the edge of the viewport.
 * Negative layers slide against the pointer and positive ones follow it, so
 * the title floats in front of the world behind it.
 */
const PARALLAX = { back: -18, stage: -10, title: 6 };

const FLOOR_REST = "perspective(420px) rotateX(68deg) translate3d(0px, 0px, 0px)";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/* -------------------------------------------------------------- wave field */

// Everything here is in screen px so the field feels the same at any size.
const LENS_X = 170; // how far along a line the pointer bends it
const LENS_Y = 72; // how far above / below the pointer lines still react
const LENS_PUSH = 70; // peak push, lines part around the pointer
const GLOW_X = 200; // half-width of the highlight that follows the pointer
const RIP_SPEED = 820; // click shockwave, px/s
const RIP_W = 46;
const RIP_LEN = 22;
const RIP_AMP = 14;
const RIP_LIFE = 1.5; // s

const HIGHLIGHT = [0, 229, 255]; // cyan

interface Wave {
  /** Resting height in viewBox units. */
  y: number;
  /** The original path, plus straight run-outs past both edges. */
  d: string;
  color: string;
  rgb: number[];
  opacity: number;
  /** The same curve sampled as x,y pairs, for the bent version. */
  pts: Float32Array;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

const bez = (t: number, a: number, b: number, c: number, d: number) => {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
};

const hexRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

const WAVE_STEPS = 40;

const WAVES: Wave[] = Array.from({ length: 16 }, (_, i) => {
  const y = 40 + i * 22;
  const c1 = y - 34 + i * 2;
  const c2 = y + 34 - i;
  const c3 = 2 * y - c2; // the S command mirrors c2 through the midpoint
  const c4 = y - 30 + i;
  // Run-outs follow the end tangents, so drift and parallax never expose a
  // line end inside the hero.
  const yl = r1(y - (c1 - y) * 0.4);
  const yr = r1(y + (y - c4) * 0.4);
  const pts: number[] = [-80, yl];
  for (let s = 0; s <= WAVE_STEPS; s++) {
    const t = s / WAVE_STEPS;
    pts.push(600 * t, bez(t, y, c1, c2, y));
  }
  for (let s = 1; s <= WAVE_STEPS; s++) {
    const t = s / WAVE_STEPS;
    pts.push(600 + 600 * t, bez(t, y, c3, c4, y));
  }
  pts.push(1280, yr);
  const color = i / 15 < 0.5 ? "#8b5cf6" : "#ff2d77";
  return {
    y,
    d: `M-80 ${yl} L0 ${y} C 200 ${c1}, 400 ${c2}, 600 ${y} S 1000 ${c4}, 1200 ${y} L1280 ${yr}`,
    color,
    rgb: hexRgb(color),
    opacity: 0.55 - i * 0.02,
    pts: Float32Array.from(pts),
  };
});

/* ------------------------------------------------------- squash & stretch */

/**
 * One beat of a sprite move. A toy is two nested boxes: `.hero-lift` carries
 * the height (and the speech bubble, so it rides along upright), `.hero-body`
 * carries the squash, stretch and spin (from its feet, set in CSS). The toy's
 * own box never moves, so as a platform it stays put mid-jump.
 */
interface Beat {
  at?: number;
  y: number;
  sx?: number;
  sy?: number;
  r?: number;
  ease?: string;
}

const HOP: Beat[] = [
  { y: 0, ease: "ease-out" },
  { at: 0.18, y: 0, sx: 1.1, sy: 0.9, ease: "cubic-bezier(.2,.8,.3,1)" },
  { at: 0.5, y: -14, sx: 0.96, sy: 1.05, ease: "cubic-bezier(.6,0,.9,.5)" },
  { at: 0.82, y: 0, sx: 1.08, sy: 0.93, ease: "ease-out" },
  { y: 0 },
];

const JUMP: Beat[] = [
  { y: 0, ease: "ease-out" },
  { at: 0.16, y: 0, sx: 1.24, sy: 0.78, ease: "cubic-bezier(.15,.75,.35,1)" },
  { at: 0.56, y: -64, sx: 0.95, sy: 1.06, ease: "cubic-bezier(.6,0,.9,.45)" },
  { y: 0, sx: 0.9, sy: 1.14 },
];

const LAND: Beat[] = [
  { y: 0, sx: 1.26, sy: 0.76, ease: "cubic-bezier(.3,1.7,.5,1)" },
  { y: 0 },
];

const flipFrom = (y: number): Beat[] => [
  { y, ease: "cubic-bezier(.2,.75,.35,1)" },
  { at: 0.5, y: y - 54, r: -200, sx: 0.92, sy: 1.08, ease: "cubic-bezier(.6,0,.9,.45)" },
  { y: 0, r: -360, sx: 0.9, sy: 1.14 },
];

/** Play a move on a toy's lift + body pair. Returns the lift's animation. */
function play(toy: HTMLElement, beats: Beat[], duration: number, origin?: string) {
  const lift = toy.querySelector<HTMLElement>(".hero-lift");
  const body = toy.querySelector<HTMLElement>(".hero-body");
  if (!lift || !body) return null;
  const at = (b: Beat) => (b.at === undefined ? {} : { offset: b.at });
  const ease = (b: Beat) => (b.ease ? { easing: b.ease } : {});
  body.animate(
    beats.map((b) => ({
      ...at(b),
      ...ease(b),
      ...(origin ? { transformOrigin: origin } : {}),
      scale: `${b.sx ?? 1} ${b.sy ?? 1}`,
      rotate: `${b.r ?? 0}deg`,
    })),
    { duration },
  );
  return lift.animate(
    beats.map((b) => ({ ...at(b), ...ease(b), translate: `0 ${b.y}px` })),
    { duration },
  );
}

/** Cancel whatever move a toy is in the middle of. */
function stop(toy: HTMLElement) {
  toy.querySelectorAll<HTMLElement>(".hero-lift, .hero-body").forEach((n) =>
    n.getAnimations().forEach((a) => a.cancel()),
  );
}

const POP: Keyframe[] = [
  { transform: "translateY(0) scale(1, 1)", easing: "ease-out" },
  { offset: 0.18, transform: "translateY(3%) scale(1.16, 0.84)", easing: "cubic-bezier(.2,.8,.3,1)" },
  { offset: 0.48, transform: "translateY(-14%) scale(0.92, 1.1)", easing: "cubic-bezier(.5,0,.6,1)" },
  { offset: 0.74, transform: "translateY(0) scale(1.05, 0.96)", easing: "ease-out" },
  { transform: "translateY(0) scale(1, 1)" },
];

const LETTER_BURST: BurstOptions = {
  count: 10,
  colors: ["#00e5ff", "#ff2d77", "#f2f3f7"],
  speed: 300,
  gravity: 760,
  size: 3,
  life: 0.5,
};

const RIPPLE_BURST: BurstOptions = {
  count: 6,
  colors: ["#00e5ff", "#8b5cf6"],
  speed: 180,
  gravity: 0,
  size: 2,
  life: 0.4,
  shape: "spark",
};

/** A toy's current height mid-move ("0px -63.9px" → -63.9). */
const liveY = (toy: HTMLElement) => {
  const lift = toy.querySelector<HTMLElement>(".hero-lift");
  if (!lift) return 0;
  const [, y] = getComputedStyle(lift).translate.split(" ");
  return parseFloat(y) || 0;
};

/** Is the toy mid-move? */
const moving = (toy: HTMLElement) =>
  !!toy.querySelector<HTMLElement>(".hero-lift")?.getAnimations().length;

/**
 * Jump with anticipation, stretch and a squashy landing. A second click while
 * airborne turns it into a flip.
 */
function jump(el: HTMLElement, land: () => void) {
  const air = el.dataset.air;
  if (air === "flip") return;
  const y = air ? liveY(el) : 0;
  stop(el);
  const a = air ? play(el, flipFrom(y), 640, "50% 55%") : play(el, JUMP, 620);
  if (!a) return;
  el.dataset.air = air ? "flip" : "up";
  a.onfinish = () => {
    delete el.dataset.air;
    play(el, LAND, 300);
    land();
  };
  a.oncancel = () => {
    if (el.dataset.air && !moving(el)) delete el.dataset.air;
  };
}

function hop(el: HTMLElement) {
  if (el.dataset.air || moving(el)) return;
  play(el, HOP, 440);
}

/** Nudge an actor's speech bubble back inside the viewport. */
function fitBubble(actor: HTMLElement) {
  const b = actor.querySelector<HTMLElement>(".hero-bubble");
  if (!b) return;
  const r = actor.getBoundingClientRect();
  const mid = r.left + r.width / 2;
  const half = b.offsetWidth / 2; // layout size, unaffected by the pop-in scale
  const lo = 8;
  const hi = window.innerWidth - 8;
  const shift = mid - half < lo ? lo - (mid - half) : mid + half > hi ? hi - (mid + half) : 0;
  b.style.setProperty("--hero-bx", `${Math.round(shift)}px`);
}

/** Dust at an element's feet. */
const dustAt = (el: Element) => {
  const r = el.getBoundingClientRect();
  fx.burst(r.left + r.width / 2, r.bottom - 2, "dust");
};

/**
 * Is a full-screen layer (boot screen, modal, Konami rain) on top of this
 * point? Ordinary page chrome like the HUD doesn't count.
 */
function overlayAt(x: number, y: number) {
  for (let n = document.elementFromPoint(x, y); n && n !== document.body; n = n.parentElement) {
    if (n.tagName === "DIALOG") return true;
    const cs = getComputedStyle(n);
    if (cs.position === "fixed" && (parseInt(cs.zIndex, 10) || 0) >= 70) return true;
  }
  return false;
}

/** A light sweep across the GAMES gradient. */
function shine(el: HTMLElement | null) {
  if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  el.getAnimations().forEach((a) => a.cancel());
  el.animate([{ backgroundPosition: "120% 0" }, { backgroundPosition: "-20% 0" }], {
    duration: 950,
    easing: "cubic-bezier(.3,.6,.2,1)",
  });
}

/* ------------------------------------------------------------------- hero */

export default function Hero() {
  const { characterId, setControlling, controlling, paused } = useGame();
  const reduced = useReducedMotion();
  const fine = useFinePointer();

  const ref = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const floorRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const spotRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const cardWrapRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const cardRowRef = useRef<HTMLDivElement>(null);
  const typeRef = useRef<HTMLSpanElement>(null);
  const shineRef = useRef<HTMLSpanElement>(null);
  const letterRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const pathRefs = useRef<(SVGPathElement | null)[]>([]);
  /** Three gradient stops per wave: left edge, centre, right edge of the glow. */
  const stopRefs = useRef<(SVGStopElement | null)[]>([]);

  // Shared between the click handlers and the animation loop.
  const pausedRef = useRef(paused);
  const kickRef = useRef<() => void>(() => {});
  const spikes = useRef<number[]>(TITLE.map(() => 0));
  const hits = useRef<number[]>(TITLE.map(() => -1e9));
  const timers = useRef<Set<number>>(new Set());
  const lastHover = useRef(0);
  const talkAt = useRef(0);

  const [talk, setTalk] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");

  useEffect(() => {
    pausedRef.current = paused;
    kickRef.current();
  }, [paused]);

  // Pending timeouts die with the component.
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((id) => window.clearTimeout(id));
  }, []);

  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  };

  /* ---------------- the one animation loop ---------------- */

  // Parallax, the wave field, letter glitches, the fighter-card tilt and the
  // floor's scroll parallax all share this loop. It only runs while something
  // is still moving and the hero is on screen, and it writes styles directly so
  // nothing here ever re-renders React.
  useEffect(() => {
    if (reduced) return;
    const section = ref.current;
    const svg = svgRef.current;
    const floor = floorRef.current;
    const glow = glowRef.current;
    const stage = stageRef.current;
    const title = titleRef.current;
    if (!section || !svg || !floor || !glow || !stage || !title) return;
    const paths = pathRefs.current;
    const stops = stopRefs.current;
    const letters = letterRefs.current;
    const spike = spikes.current;
    const cardWrap = cardWrapRef.current;
    const card = cardRef.current;
    const row = cardRowRef.current;
    const spot = spotRef.current;

    let raf = 0;
    let running = false;
    let visible = true;
    let last = 0;

    // pointer, in viewport px
    let px = 0;
    let py = 0;
    let has = false;
    let movedAt = -1e9;

    // eased state
    let nx = 0;
    let ny = 0;
    let wStr = 0;
    let wx = 0;
    let wy = 0;
    let crx = 0;
    let cry = 0;
    let cgl = 0;
    let gx = 50;
    let gy = 50;
    let jitterAt = 0;
    const glitch = new Float32Array(TITLE.length);
    const gDirty = new Uint8Array(TITLE.length);
    const wDirty = new Uint8Array(WAVES.length);
    const wLit = new Uint8Array(WAVES.length);
    const ripples: { x: number; y: number; t: number }[] = [];

    // offsets currently applied to the svg and the title
    let bx = 0;
    let by = 0;
    let tx = 0;
    let ty = 0;

    // Geometry, cached in document coordinates with our own transforms
    // removed, so pointermove never touches layout.
    let secTop = 0;
    let secLeft = 0;
    let secH = 1;
    let box = { x: 0, y: 0, w: 1, h: 1 };
    let marks = letters.map(() => ({ x: -1e5, y: -1e5, r: 1 }));
    let cardBox: { x: number; y: number; w: number; h: number } | null = null;

    const measure = () => {
      const sy = window.scrollY;
      const s = section.getBoundingClientRect();
      secTop = s.top + sy;
      secLeft = s.left;
      secH = s.height;
      const b = svg.getBoundingClientRect();
      box = { x: b.left - bx, y: b.top + sy - by, w: Math.max(1, b.width), h: Math.max(1, b.height) };
      marks = letters.map((el) => {
        if (!el) return { x: -1e5, y: -1e5, r: 1 };
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2 - tx, y: r.top + r.height / 2 + sy - ty, r: Math.max(28, r.width) };
      });
      cardBox = null;
      if (cardWrap && cardWrap.offsetParent) {
        const r = cardWrap.getBoundingClientRect();
        cardBox = { x: r.left, y: r.top + sy, w: r.width, h: r.height };
      }
    };

    const resetWave = (i: number) => {
      const p = paths[i];
      if (p) {
        p.setAttribute("d", WAVES[i].d);
        p.setAttribute("stroke", WAVES[i].color);
        p.setAttribute("stroke-opacity", String(WAVES[i].opacity));
        p.setAttribute("stroke-width", "1.5");
      }
      wDirty[i] = 0;
      wLit[i] = 0;
    };

    const resetLetter = (i: number) => {
      const el = letters[i];
      gDirty[i] = 0;
      if (!el) return;
      el.style.removeProperty("--hs");
      el.style.removeProperty("--hx");
      for (let c = 1; c < el.children.length; c++) {
        const s = el.children[c] as HTMLElement;
        s.style.opacity = "";
        s.style.clipPath = "";
        s.style.transform = "";
      }
    };

    const step = (now: number) => {
      raf = 0;
      if (!visible || document.hidden) {
        running = false;
        return;
      }
      // Exponential easing is stable at any step, so a slow frame just catches up.
      const dt = Math.min(0.25, Math.max(0.001, (now - last) / 1000));
      last = now;
      const ease = (rate: number) => 1 - Math.exp(-rate * dt);
      let busy = false;

      const W = window.innerWidth;
      const H = window.innerHeight;
      const sy = window.scrollY;
      const live = has && !pausedRef.current;
      const fresh = live && now - movedAt < 1200;

      /* ---- parallax ---- */
      if (fine) {
        const tnx = live ? clamp((px / W) * 2 - 1, -1, 1) : 0;
        const tny = live ? clamp((py / H) * 2 - 1, -1, 1) : 0;
        nx += (tnx - nx) * ease(4.5);
        ny += (tny - ny) * ease(4.5);
        if (Math.abs(tnx - nx) + Math.abs(tny - ny) > 0.002) busy = true;
        bx = nx * PARALLAX.back;
        by = ny * PARALLAX.back * 0.55;
        tx = nx * PARALLAX.title;
        ty = ny * PARALLAX.title * 0.6;
        svg.style.transform = `translate3d(${bx.toFixed(2)}px, ${by.toFixed(2)}px, 0)`;
        glow.style.transform = `translate3d(${bx.toFixed(2)}px, ${(by * 0.4).toFixed(2)}px, 0)`;
        stage.style.transform = `translate3d(${(nx * PARALLAX.stage).toFixed(2)}px, 0, 0)`;
        title.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0)`;
      }
      // The floor's scroll parallax lives here too, so scrolling never
      // re-renders the hero.
      floor.style.transform = `perspective(420px) rotateX(68deg) translate3d(${bx.toFixed(2)}px, ${(sy * 0.06).toFixed(2)}px, 0px)`;

      /* ---- wave field ---- */
      const inHero = py >= secTop - sy && py <= secTop - sy + secH;
      const wTarget = fresh && inHero ? 1 : 0;
      // pointer in svg-box px
      const bpx = px - (box.x + bx);
      const bpy = py - (box.y - sy + by);
      if (wStr < 0.01 && wTarget) {
        wx = bpx;
        wy = bpy;
      }
      wx += (bpx - wx) * ease(10);
      wy += (bpy - wy) * ease(10);
      wStr += (wTarget - wStr) * ease(wTarget > wStr ? 5 : 1.8);
      // below this the bend is under a pixel: snap to rest and let the loop sleep
      if (wStr < 0.015 && !wTarget) wStr = 0;
      for (let r = ripples.length - 1; r >= 0; r--) {
        if ((now - ripples[r].t) / 1000 > RIP_LIFE) ripples.splice(r, 1);
      }
      if (wStr > 0 || ripples.length) busy = true;
      if (spot) {
        // a soft light that follows the pointer through the field
        spot.style.opacity = (wStr * 0.9).toFixed(3);
        if (wStr > 0) {
          spot.style.transform = `translate3d(${(wx + box.x + bx - secLeft).toFixed(1)}px, ${(wy + box.y - secTop + by).toFixed(1)}px, 0)`;
        }
      }

      const ux = box.w / 1200;
      const uy = box.h / 400;
      for (let i = 0; i < WAVES.length; i++) {
        const w = WAVES[i];
        const p = paths[i];
        if (!p) continue;
        const lineY = w.y * uy;
        const dyp = lineY - wy;
        const fall = Math.exp(-(dyp * dyp) / (2 * LENS_Y * LENS_Y));
        // (dy / sigma) * gaussian: lines part smoothly around the pointer
        // instead of snapping from one side to the other.
        const amp = LENS_PUSH * (dyp / LENS_Y) * fall * wStr;
        const lit = wStr * Math.exp(-(dyp * dyp) / (2 * (LENS_Y * 1.3) ** 2));
        let rippling = false;
        for (const r of ripples) {
          const front = ((now - r.t) / 1000) * RIP_SPEED;
          if (Math.abs(lineY - r.y) < front + RIP_W * 3) rippling = true;
        }
        if (Math.abs(amp) < 0.05 && lit < 0.01 && !rippling) {
          if (wDirty[i] || wLit[i]) resetWave(i);
          continue;
        }

        let d = "";
        const pts = w.pts;
        for (let j = 0; j < pts.length; j += 2) {
          const x = pts[j];
          const yv = pts[j + 1];
          const xp = x * ux;
          const dx = xp - wx;
          let off = amp * Math.exp(-(dx * dx) / (2 * LENS_X * LENS_X));
          for (const r of ripples) {
            const age = (now - r.t) / 1000;
            const ddx = xp - r.x;
            const ddy = yv * uy - r.y;
            const e = Math.sqrt(ddx * ddx + ddy * ddy) - age * RIP_SPEED;
            if (e > RIP_W * 3 || e < -RIP_W * 3) continue;
            const fade = 1 - age / RIP_LIFE;
            off += RIP_AMP * Math.sin(e / RIP_LEN) * Math.exp(-(e * e) / (2 * RIP_W * RIP_W)) * fade * fade;
          }
          d += `${j ? "L" : "M"}${x.toFixed(1)} ${(yv + off / uy).toFixed(1)}`;
        }
        p.setAttribute("d", d);
        wDirty[i] = 1;

        if (lit >= 0.01) {
          // Glow: the line's own gradient brightens towards cyan under the pointer.
          const c = (wx / ux + 80) / 1360;
          const half = GLOW_X / ux / 1360;
          const s0 = stops[i * 3];
          const s1 = stops[i * 3 + 1];
          const s2 = stops[i * 3 + 2];
          const k = Math.min(1, lit);
          const mix = w.rgb.map((v, n) => Math.round(v + (HIGHLIGHT[n] - v) * k));
          s0?.setAttribute("offset", clamp(c - half, 0, 1).toFixed(4));
          s1?.setAttribute("offset", clamp(c, 0, 1).toFixed(4));
          s1?.setAttribute("stop-color", `rgb(${mix[0]},${mix[1]},${mix[2]})`);
          s2?.setAttribute("offset", clamp(c + half, 0, 1).toFixed(4));
          if (!wLit[i]) p.setAttribute("stroke", `url(#hero-wave-${i})`);
          p.setAttribute("stroke-opacity", (w.opacity + 0.45 * lit).toFixed(3));
          p.setAttribute("stroke-width", (1.5 + lit).toFixed(2));
          wLit[i] = 1;
        } else if (wLit[i]) {
          p.setAttribute("stroke", w.color);
          p.setAttribute("stroke-opacity", String(w.opacity));
          p.setAttribute("stroke-width", "1.5");
          wLit[i] = 0;
        }
      }

      /* ---- title letters ---- */
      const jitter = now >= jitterAt;
      if (jitter) jitterAt = now + 55 + Math.random() * 40;
      for (let i = 0; i < letters.length; i++) {
        const el = letters[i];
        if (!el) continue;
        const m = marks[i];
        let prox = 0;
        if (fresh) {
          const dist = Math.hypot(px - (m.x + tx), py - (m.y - sy + ty));
          prox = clamp(1 - dist / (m.r * 1.5), 0, 1);
          prox *= prox;
        }
        spike[i] = Math.max(0, spike[i] - dt * 2.2);
        const target = Math.max(prox, spike[i]);
        const g = glitch[i] + (target - glitch[i]) * ease(target > glitch[i] ? 16 : 5);
        glitch[i] = g;
        if (g < 0.004 && target === 0) {
          glitch[i] = 0;
          if (gDirty[i]) resetLetter(i);
          continue;
        }
        busy = true;
        gDirty[i] = 1;
        // offsets scale with the letter, so a phone-sized wordmark glitches
        // as hard as a desktop one, not three times harder
        const u = clamp(m.r / 70, 0.35, 1.25);
        el.style.setProperty("--hs", `${(g * 9 * u).toFixed(2)}px`);
        if (!jitter) continue;
        el.style.setProperty("--hx", `${((Math.random() - 0.5) * g * 6 * u).toFixed(2)}px`);
        for (let c = 1; c < el.children.length; c++) {
          const s = el.children[c] as HTMLElement;
          if (g < 0.08 || Math.random() > 0.45 + g * 0.5) {
            s.style.opacity = "0";
            continue;
          }
          const top = Math.random() * 82;
          const h = 5 + Math.random() * (10 + g * 22);
          s.style.opacity = Math.min(1, 0.45 + g).toFixed(2);
          s.style.clipPath = `inset(${top.toFixed(1)}% 0 ${Math.max(0, 100 - top - h).toFixed(1)}% 0)`;
          s.style.transform = `translateX(${((Math.random() - 0.5) * 2 * (3 + g * 16) * u).toFixed(1)}px)`;
        }
      }

      /* ---- fighter card tilt ---- */
      if (fine && card && row && cardBox) {
        let trx = 0;
        let tryy = 0;
        let tgl = 0;
        if (live) {
          const dx = (px - (cardBox.x + cardBox.w / 2)) / (cardBox.w / 2);
          const dy = (py - (cardBox.y - sy + cardBox.h / 2)) / (cardBox.h / 2);
          if (Math.abs(dx) < 1.45 && Math.abs(dy) < 1.7) {
            trx = clamp(-dy, -1, 1) * 8;
            tryy = clamp(dx, -1, 1) * 11;
            if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
              tgl = 1;
              gx = (dx + 1) * 50;
              gy = (dy + 1) * 50;
            }
          }
        }
        crx += (trx - crx) * ease(9);
        cry += (tryy - cry) * ease(9);
        cgl += (tgl - cgl) * ease(7);
        if (Math.abs(trx - crx) + Math.abs(tryy - cry) + Math.abs(tgl - cgl) > 0.01) busy = true;
        card.style.transform = `perspective(800px) rotateX(${crx.toFixed(2)}deg) rotateY(${cry.toFixed(2)}deg)`;
        card.style.setProperty("--hero-gx", `${gx.toFixed(1)}%`);
        card.style.setProperty("--hero-gy", `${gy.toFixed(1)}%`);
        card.style.setProperty("--hero-go", cgl.toFixed(3));
        row.style.transform = `translateZ(${(cgl * 22).toFixed(1)}px)`;
      }

      if (busy) raf = requestAnimationFrame(step);
      else running = false;
    };

    const kick = () => {
      if (running || !visible || document.hidden) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(step);
    };
    kickRef.current = kick;

    /* ---- input ---- */
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      px = e.clientX;
      py = e.clientY;
      has = true;
      movedAt = performance.now();
      kick();
    };
    const onLeave = () => {
      has = false;
      kick();
    };
    // Click (or tap) anywhere that isn't a control sends a shockwave through
    // the wave field. "click" rather than pointerdown, so a touch swipe that
    // scrolls the page doesn't set one off.
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0 || pausedRef.current) return;
      const t = e.target as Element | null;
      if (t?.closest("a, button, input, textarea, select, [data-hero-toy], .hero-card")) return;
      // Releasing a drag that selected some copy is not a click on the world.
      if (window.getSelection()?.isCollapsed === false) return;
      const sy = window.scrollY;
      ripples.push({ x: e.clientX - (box.x + bx), y: e.clientY - (box.y - sy + by), t: performance.now() });
      if (ripples.length > 4) ripples.shift();
      fx.burst(e.clientX, e.clientY, RIPPLE_BURST);
      sfx.whoosh();
      kick();
    };
    const onScroll = () => kick();
    const onResize = () => {
      measure();
      kick();
    };
    const onVis = () => {
      if (!document.hidden) kick();
    };

    if (fine) {
      window.addEventListener("pointermove", onMove, { passive: true });
      document.documentElement.addEventListener("pointerleave", onLeave);
    }
    section.addEventListener("click", onDown, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVis);

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      // Off screen, the hero's own CSS loops (wave drift, GAMES drift, glitch,
      // bobbing sprites) are paused too: nobody can see them.
      section.toggleAttribute("data-hero-off", !visible);
      if (visible) {
        measure();
        kick();
      }
    });
    io.observe(section);
    // Web fonts swapping in move the letters, and reflowed copy moves the
    // wave field (it is sized off the section).
    const ro = new ResizeObserver(() => measure());
    ro.observe(title);
    ro.observe(section);

    measure();
    kick();

    return () => {
      cancelAnimationFrame(raf);
      kickRef.current = () => {};
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      section.removeEventListener("click", onDown);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVis);
      io.disconnect();
      ro.disconnect();
      section.removeAttribute("data-hero-off");
      // Back to the resting look (e.g. if reduced motion was just switched on).
      svg.style.transform = "";
      glow.style.transform = "";
      stage.style.transform = "";
      title.style.transform = "";
      floor.style.transform = FLOOR_REST;
      if (card) {
        card.style.transform = "";
        card.style.removeProperty("--hero-go");
      }
      if (row) row.style.transform = "";
      if (spot) spot.style.opacity = "0";
      WAVES.forEach((_, i) => resetWave(i));
      TITLE.forEach((_, i) => resetLetter(i));
    };
  }, [reduced, fine]);

  /* ---------------- "insert coin" typing ---------------- */

  // Typed once the label is actually visible — not underneath the boot screen.
  useEffect(() => {
    const el = typeRef.current;
    if (!el || reduced) return;
    let tries = 0;
    let t = 0;
    // Opened in a background tab: wait until someone is looking.
    const onVis = () => {
      if (document.hidden) return;
      document.removeEventListener("visibilitychange", onVis);
      t = window.setTimeout(check, 200);
    };
    const check = () => {
      if (document.hidden) {
        document.addEventListener("visibilitychange", onVis);
        return;
      }
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) {
        el.dataset.typed = "done"; // scrolled away already: just show it
        return;
      }
      if (overlayAt(r.left + r.width / 2, r.top + r.height / 2) && tries++ < 40) {
        t = window.setTimeout(check, 200);
        return;
      }
      el.dataset.typed = "go";
      // a one-off shine across GAMES once the label has finished typing
      t = window.setTimeout(() => shine(shineRef.current), 1150);
    };
    t = window.setTimeout(check, 120);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [reduced]);

  /* ---------------- handlers ---------------- */

  const onLetter = (e: ReactMouseEvent<HTMLSpanElement>, i: number) => {
    const el = e.currentTarget;
    sfx.select();
    fx.haptic(10);
    if (e.detail === 0) fx.burstAt(el, LETTER_BURST);
    else fx.burst(e.clientX, e.clientY, LETTER_BURST);
    spikes.current[i] = 1;
    kickRef.current();
    el.dataset.hit = "";
    later(() => delete el.dataset.hit, 380);
    if (!reduced) el.animate(POP, { duration: 520 });

    // Pop all six inside a few seconds for a bonus.
    const now = e.timeStamp;
    hits.current[i] = now;
    if (hits.current.every((h) => now - h < 4000)) {
      hits.current = TITLE.map(() => -1e9);
      later(() => {
        sfx.unlock();
        fx.flash("#00e5ff", 0.08);
        setAnnounce("Six for six. The title is fully glitched.");
        letterRefs.current.forEach((l, n) => {
          if (!l) return;
          later(() => {
            spikes.current[n] = 1;
            kickRef.current();
            fx.burstAt(l, "select");
            if (!reduced) l.animate(POP, { duration: 520 });
          }, n * 70);
        });
      }, 260);
      later(() => setAnnounce(""), 5000);
    }
  };

  const onActorEnter = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType !== "mouse") return;
    fitBubble(e.currentTarget);
    const now = e.timeStamp;
    if (now - lastHover.current > 120) sfx.hover();
    lastHover.current = now;
    if (!reduced) hop(e.currentTarget);
  };

  const onActorClick = (e: ReactMouseEvent<HTMLElement>, id: string) => {
    const el = e.currentTarget;
    fitBubble(el);
    sfx.jump();
    fx.haptic(8);
    // The bubble stays up a moment after the last tap, then the actor shuts up.
    const stamp = e.timeStamp;
    talkAt.current = stamp;
    setTalk(id);
    later(() => {
      if (talkAt.current === stamp) setTalk(null);
    }, 1800);
    if (reduced) return;
    if (!el.dataset.air) dustAt(el);
    else fx.burstAt(el.querySelector(".hero-body"), "click");
    jump(el, () => {
      sfx.land();
      dustAt(el);
    });
  };

  const onCta = (e: ReactMouseEvent<HTMLElement>) => {
    sfx.select();
    fx.haptic(10);
    if (e.detail === 0) fx.burstAt(e.currentTarget, "click");
    else fx.burst(e.clientX, e.clientY, "click");
  };

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
          ref={svgRef}
          className="absolute inset-x-0 top-[18%] h-[62%] w-full opacity-45"
          style={{ overflow: "visible" }}
          preserveAspectRatio="none"
          viewBox="0 0 1200 400"
        >
          <defs>
            {WAVES.map((w, i) => (
              <linearGradient
                key={i}
                id={`hero-wave-${i}`}
                gradientUnits="userSpaceOnUse"
                x1="-80"
                y1="0"
                x2="1280"
                y2="0"
              >
                <stop offset="0" stopColor={w.color} />
                {[0.45, 0.5, 0.55].map((o, n) => (
                  <stop
                    key={o}
                    ref={(el) => {
                      stopRefs.current[i * 3 + n] = el;
                    }}
                    offset={o}
                    stopColor={w.color}
                  />
                ))}
                <stop offset="1" stopColor={w.color} />
              </linearGradient>
            ))}
          </defs>
          {WAVES.map((w, i) => (
            <path
              key={i}
              ref={(el) => {
                pathRefs.current[i] = el;
              }}
              d={w.d}
              fill="none"
              strokeWidth="1.5"
              stroke={w.color}
              strokeOpacity={w.opacity}
              className="hero-wave"
              style={{
                ["--wave-dur" as string]: `${7 + i * 0.35}s`,
                ["--wave-delay" as string]: `${i * 0.1}s`,
              }}
            />
          ))}
        </svg>

        <div ref={spotRef} className="hero-spot" />

        {/* perspective floor — one grid tile wider on each side, so the
            parallax pan never reaches an edge */}
        <div
          ref={floorRef}
          className="grid-floor absolute -inset-x-12 bottom-0 h-[38%] origin-bottom opacity-70"
          style={{
            transform: FLOOR_REST,
            maskImage: "linear-gradient(to top, #000 10%, transparent 92%)",
            WebkitMaskImage: "linear-gradient(to top, #000 10%, transparent 92%)",
          }}
        />
        <div
          ref={glowRef}
          className="absolute inset-x-0 bottom-[36%] h-px bg-gradient-to-r from-transparent via-cyan to-transparent opacity-70 blur-[1px]"
        />
        <div className="noise absolute inset-0 opacity-[0.045] mix-blend-overlay" />
      </div>

      {/* ---------- copy ---------- */}
      <div className="relative z-10 mx-auto w-full max-w-[1400px] px-5 sm:px-6">
        <div>
          <p className="label mb-5 flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-lime" />
            <span className="relative inline-block">
              <span ref={typeRef} className="hero-type inline-block whitespace-nowrap">
                <span className="hero-blink">Insert coin</span> · Studio online
              </span>
              <span aria-hidden="true" className="hero-caret" />
            </span>
          </p>

          {/* The wordmark floats in front of the world. The label above stays
              put: it sits right under the HUD and would slide beneath it. */}
          <div ref={titleRef} className="relative">
            <h1 className="font-display text-[clamp(3.1rem,12.5vw,10.5rem)] leading-[0.84] tracking-tight">
              <span className="sr-only">GLITCH GAMES</span>
              <span aria-hidden="true" className="block">
                {TITLE.map((ch, i) => (
                  <span
                    key={i}
                    ref={(el) => {
                      letterRefs.current[i] = el;
                    }}
                    data-hero-toy=""
                    data-cursor="POP"
                    className="hero-l"
                    onClick={(e) => onLetter(e, i)}
                  >
                    <span className="glitch" data-text={ch}>
                      {ch}
                    </span>
                    {/* glyphs come from CSS, so the page text stays "GLITCH" */}
                    <span className="hero-slice hero-slice-c" data-text={ch} />
                    <span className="hero-slice hero-slice-m" data-text={ch} />
                  </span>
                ))}
              </span>
              <span aria-hidden="true" className="relative block">
                <span className="hero-games block bg-clip-text text-transparent">GAMES</span>
                <span
                  ref={shineRef}
                  data-hero-toy=""
                  data-text="GAMES"
                  className="hero-shine absolute left-0 top-0 select-none"
                  onPointerEnter={(e) => {
                    if (e.pointerType === "mouse") shine(e.currentTarget);
                  }}
                  onClick={(e) => shine(e.currentTarget)}
                />
              </span>
            </h1>

            {/* sized like the wordmark, so the coin sits just off the H at any width */}
            <div className="pointer-events-none absolute left-0 top-0 font-display text-[clamp(3.1rem,12.5vw,10.5rem)] leading-[0.84] tracking-tight">
              <span aria-hidden="true" className="hero-measure invisible" data-text="GLITCH" />
              <Coin
                id="hero-sky"
                label="the sky above the title"
                className="pointer-events-auto left-full top-[0.34em] ml-[0.12em]"
              />
            </div>
          </div>
        </div>

        <div className="mt-7 grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="max-w-xl">
            {/* the copy doubles as ledges: climb it to reach the sky coin */}
            <p data-solid="" className="text-balance text-lg leading-relaxed text-ink/90 sm:text-xl">
              {STUDIO.mission}
            </p>
            <p data-solid="" className="mt-3 text-sm text-muted sm:text-base">
              {STUDIO.blurb} A small dedicated studio in {STUDIO.location}, trying
              to make a global impact — everything happens in house.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <a
                href="#portfolio"
                data-solid=""
                data-magnetic=""
                data-cursor="PLAY"
                onMouseEnter={() => sfx.hover()}
                onClick={onCta}
                className="hero-cta group relative inline-flex items-center gap-2 overflow-hidden rounded-lg bg-gradient-to-r from-cyan to-violet px-6 py-3.5 font-display text-sm tracking-wide text-void"
              >
                <span aria-hidden="true" className="hero-cta-shine" />
                <span className="relative z-10">PLAY THE PORTFOLIO</span>
                <span className="relative z-10 transition-transform group-hover:translate-x-1">
                  →
                </span>
              </a>
              <a
                href="#partner"
                data-solid=""
                data-magnetic=""
                data-cursor="TALK"
                onMouseEnter={() => sfx.hover()}
                onClick={onCta}
                className="hero-cta-2 inline-flex items-center gap-2 rounded-lg border border-edge bg-panel/70 px-6 py-3.5 font-display text-sm tracking-wide text-ink backdrop-blur hover:border-lime hover:text-lime"
              >
                PARTNER WITH US
              </a>
            </div>

            {/* Rendered under reduced motion too: the platformer is
                visitor-driven and still works there, and dropping the button
                after hydration shifted the layout. */}
            <button
              type="button"
              data-solid=""
              data-magnetic=""
              data-cursor="CONTROL"
              aria-pressed={controlling}
              onClick={() => {
                sfx.select();
                setControlling(!controlling);
              }}
              className="hero-press mono mt-6 inline-flex items-center gap-2 rounded-md border border-dashed border-edge px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-muted hover:border-lime hover:text-lime aria-pressed:border-solid aria-pressed:border-lime aria-pressed:text-lime"
            >
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-lime" />
              {/* Picked by a media query rather than after hydration, so the
                  button never changes size (and nudges the hero) on phones. */}
              <span className="hero-if-coarse">Tap to take control of the character</span>
              <span className="hero-if-fine">
                Press <kbd className="hero-key">G</kbd> to take control — then walk the page
              </span>
            </button>
          </div>

          {/* chosen fighter card */}
          <div ref={cardWrapRef} data-solid="" className="relative hidden w-[260px] shrink-0 lg:block">
            <div
              ref={cardRef}
              className="hero-card panel relative p-4"
              onPointerEnter={(e) => {
                const s = cardRowRef.current?.querySelector<HTMLElement>(".hero-card-sprite");
                if (e.pointerType === "mouse" && s && !reduced) hop(s);
              }}
            >
              <span aria-hidden="true" className="hero-card-glare" />
              <p className="label mb-3">Your fighter</p>
              <div ref={cardRowRef} className="flex items-end gap-3">
                <span
                  key={hero.id}
                  data-hero-toy=""
                  className="hero-card-sprite relative block shrink-0 cursor-pointer"
                  onClick={(e) => {
                    const el = e.currentTarget;
                    sfx.jump();
                    if (reduced) return;
                    if (!el.dataset.air) dustAt(el);
                    jump(el, () => {
                      sfx.land();
                      dustAt(el);
                    });
                  }}
                >
                  <span className="hero-lift block">
                    <span className="hero-body block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={spriteSrc(hero.id)}
                        alt={hero.name}
                        width={hero.w}
                        height={hero.h}
                        draggable={false}
                        className="sprite block h-[120px] w-auto motion-safe:bob"
                      />
                    </span>
                  </span>
                </span>
                <div className="pb-1">
                  <p className="font-display text-lg leading-tight">{hero.name}</p>
                  <p className="mono text-[10px] uppercase tracking-[0.2em] text-muted">
                    {hero.role}
                  </p>
                  <a
                    href="#roster"
                    onClick={() => sfx.select()}
                    // padded to a 24px-tall target, with the padding taken
                    // back out of the margins so the card doesn't move
                    className="mono -mb-[5px] mt-[3px] inline-block py-[5px] text-[10px] uppercase tracking-[0.16em] text-cyan hover:underline"
                  >
                    Change →
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- sprite stage ---------- */}
      {/* Decorative: the cast hops, talks and jumps under the pointer, and their
          heads are platforms for the walker. Kept out of the tab order. */}
      <div
        ref={stageRef}
        aria-hidden="true"
        className="pointer-events-none relative z-0 mt-10 flex h-[120px] items-end justify-center gap-1 px-2 [overflow-x:clip] sm:h-[150px] sm:gap-4"
      >
        {stage.map((id, i) => {
          const c = byId(id);
          const h = 62 + ((i * 7) % 26);
          return (
            <span
              key={id}
              data-solid=""
              data-hero-toy=""
              data-talk={talk === id ? "" : undefined}
              className="hero-actor pointer-events-auto relative block shrink-0 cursor-pointer"
              style={{ ["--hero-accent" as string]: ACCENT_HEX[c.accent] }}
              onPointerEnter={onActorEnter}
              onClick={(e) => onActorClick(e, id)}
            >
              <span className="hero-lift block">
                <span className="hero-bubble">
                  <span className="text-ink">{c.name}</span>
                  <span className="text-muted"> · {c.role}</span>
                </span>
                <span className="hero-body block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={spriteSrc(id)}
                    alt=""
                    width={c.w}
                    height={c.h}
                    draggable={false}
                    className="sprite block w-auto opacity-55 motion-safe:bob"
                    style={{
                      height: h,
                      ["--bob-dur" as string]: `${2 + (i % 5) * 0.3}s`,
                      animationDelay: `${i * 0.19}s`,
                    }}
                  />
                </span>
              </span>
            </span>
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
          onClick={() => sfx.whoosh()}
          className="group mono inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-muted transition-colors hover:text-cyan"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 7 8"
            width="11"
            height="13"
            shapeRendering="crispEdges"
            fill="currentColor"
            className="hero-cue"
          >
            <path d="M2 0h3v3h2v1H6v1H5v1H4v1H3V6H2V5H1V4H0V3h2z" />
          </svg>
          Scroll to continue
        </a>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>

      <style>{HERO_CSS}</style>
    </section>
  );
}

/* -------------------------------------------------------------------- css */

const HERO_CSS = `
@keyframes wave{from{transform:translateX(-18px)}to{transform:translateX(18px)}}
@media (prefers-reduced-motion:no-preference){.hero-wave{animation:wave var(--wave-dur) ease-in-out var(--wave-delay) infinite alternate}}
#top[data-hero-off] *,#top[data-hero-off] *::before,#top[data-hero-off] *::after{animation-play-state:paused}

/* ---- wordmark letters ---- */
.hero-l{position:relative;display:inline-block;cursor:pointer;transform-origin:50% 85%;-webkit-user-select:none;user-select:none}
.hero-l>.glitch{translate:var(--hx,0px) 0;transition:color .25s}
.hero-l>.glitch::before{translate:calc(var(--hs,0px) * -1) 0}
.hero-l>.glitch::after{translate:var(--hs,0px) 0}
.hero-l[data-hit]>.glitch{color:#c8ff2e;transition:none}
.hero-slice{position:absolute;left:0;top:0;pointer-events:none;opacity:0;mix-blend-mode:screen}
.hero-slice::before,.hero-shine::before,.hero-measure::before{content:attr(data-text)}
.hero-slice-c{color:#00e5ff}
.hero-slice-m{color:#ff2d77}

/* ---- GAMES: the original gradient, twice as wide so it can drift ---- */
.hero-games{background-image:linear-gradient(to right in oklab,#c8ff2e 0%,#00e5ff 25%,#8b5cf6 50%,#00e5ff 75%,#c8ff2e 100%);background-size:200% 100%;background-position:0% 0}
.hero-shine{color:transparent;background-image:linear-gradient(105deg,transparent 38%,rgba(255,255,255,.92) 50%,transparent 62%);background-size:300% 100%;background-position:120% 0;background-repeat:no-repeat;-webkit-background-clip:text;background-clip:text;cursor:default}

/* ---- wave field: the light that follows the pointer ---- */
.hero-spot{position:absolute;left:0;top:0;width:560px;height:560px;margin:-280px 0 0 -280px;border-radius:50%;pointer-events:none;opacity:0;background:radial-gradient(closest-side,rgba(0,229,255,.09),rgba(139,92,246,.05) 50%,transparent)}

/* ---- insert coin ---- */
.hero-caret{position:absolute;top:-1px;bottom:-1px;left:100%;width:.62em;background:#c8ff2e;opacity:0;pointer-events:none}

/* ---- CTAs ---- */
.hero-cta{transition:scale .2s var(--ease-pop),box-shadow .25s,filter .15s}
.hero-cta-shine{position:absolute;inset:-2px auto -2px 0;width:42%;z-index:1;pointer-events:none;background:linear-gradient(100deg,transparent,rgba(255,255,255,.55),transparent);transform:translateX(-130%) skewX(-18deg);opacity:0}
.hero-cta-2{transition:color .2s,border-color .2s,scale .2s var(--ease-pop),box-shadow .25s}
.hero-press{transition:color .2s,border-color .2s,scale .15s var(--ease-pop)}
@media (hover:hover){
  .hero-cta:hover{scale:1.04;box-shadow:0 0 32px -6px rgba(0,229,255,.6)}
  .hero-cta-2:hover{box-shadow:0 0 26px -8px rgba(200,255,46,.55)}
}
/* pressed: after the hover rules, so a held mouse button wins over hover */
.hero-cta:active,.hero-cta-2:active,.hero-press:active{scale:.95;transition-duration:.06s}
.hero-cta:active{filter:brightness(.88);box-shadow:inset 0 3px 10px rgba(6,6,10,.45)}
.hero-cta-2:active{box-shadow:inset 0 3px 10px rgba(0,0,0,.5)}
@media (pointer:coarse){.hero-press{min-height:40px}.hero-if-fine{display:none}}
@media not (pointer:coarse){.hero-if-coarse{display:none}}
.hero-key{display:inline-grid;place-items:center;min-width:1.7em;padding:1px 4px;margin:0 1px;border:1px solid currentColor;border-bottom-width:2px;border-radius:4px;font:inherit;line-height:1.2}

/* ---- fighter card ---- */
.hero-card{transform-style:preserve-3d;transition:border-color .3s}
.hero-card:hover{border-color:rgba(0,229,255,.45)}
.hero-card-glare{position:absolute;inset:0;border-radius:14px;pointer-events:none;opacity:var(--hero-go,0);background:radial-gradient(240px circle at var(--hero-gx,50%) var(--hero-gy,0%),rgba(0,229,255,.14),transparent 70%)}

/* ---- toys: letters and sprites (rapid taps must not double-tap zoom) ---- */
.hero-l,.hero-shine,.hero-actor,.hero-card-sprite{touch-action:manipulation}
.hero-lift{position:relative}
.hero-body{transform-origin:50% 100%}

/* ---- stage actors ---- */
/* a talking or airborne actor (and its bubble) paints over its neighbours */
.hero-actor[data-talk],.hero-actor[data-air]{z-index:3}
.hero-actor img{transition:opacity .2s}
.hero-bubble{position:absolute;left:50%;bottom:calc(100% + 10px);z-index:2;translate:calc(-50% + var(--hero-bx,0px)) 0;scale:.6;opacity:0;transform-origin:50% 100%;transition:opacity .15s,scale .25s var(--ease-pop);white-space:nowrap;pointer-events:none;font-family:var(--font-mono);font-size:10px;line-height:1;letter-spacing:.14em;text-transform:uppercase;padding:5px 8px;border-radius:6px;background:#12121d;border:1px solid var(--hero-accent);box-shadow:0 0 18px -6px var(--hero-accent)}
.hero-bubble::after{content:"";position:absolute;left:calc(50% - var(--hero-bx,0px));top:100%;width:7px;height:7px;background:#12121d;border-right:1px solid var(--hero-accent);border-bottom:1px solid var(--hero-accent);translate:-50% -50%;rotate:45deg}
.hero-actor[data-talk] .hero-bubble{opacity:1;scale:1}
.hero-actor[data-talk] img{opacity:1}
@media (hover:hover) and (pointer:fine){
  .hero-actor:hover{z-index:3}
  .hero-actor:hover .hero-bubble{opacity:1;scale:1}
  .hero-actor:hover img{opacity:1}
}

@media (prefers-reduced-motion:no-preference){
  /* background-position repaints the whole word, so the drift ticks ~4 times a
     second instead of every frame: on a gradient this slow the steps (a few
     px of hue) can't be seen, and the paint cost drops by an order of magnitude */
  .hero-games{animation:hero-games-drift 9s steps(36) 2.5s infinite alternate}

  html.js .hero-type:not([data-typed]){clip-path:inset(0 100% 0 0);animation:hero-type-failsafe 0s 9s forwards}
  .hero-type[data-typed="go"]{animation:hero-type .95s steps(27,end) both}
  .hero-type[data-typed="go"]+.hero-caret{opacity:1;animation:hero-caret-move .95s steps(27,end) both,hero-caret-blink .5s steps(1) .95s 4 forwards}
  .hero-type[data-typed="go"] .hero-blink{animation:hero-blink 1s steps(1) 1.15s 4}

  /* an even glide, so the light is seen crossing the label; on the way out it
     fades, then jumps back unseen (no reverse sweep) */
  .hero-cta-shine{transition:transform 0s .2s,opacity .2s}
  .hero-cta:hover .hero-cta-shine,.hero-cta:focus-visible .hero-cta-shine{transform:translateX(330%) skewX(-18deg);opacity:1;transition:transform .7s cubic-bezier(.45,.05,.3,1),opacity .2s}

  .hero-card-sprite{animation:hero-card-in .5s var(--ease-pop) backwards}
  .hero-cue{animation:hero-cue 1.2s steps(1) infinite}
}
@keyframes hero-games-drift{to{background-position:32% 0}}
@keyframes hero-type{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}
@keyframes hero-type-failsafe{to{clip-path:inset(0 0 0 0)}}
@keyframes hero-caret-move{from{left:0}to{left:100%}}
@keyframes hero-caret-blink{0%{opacity:1}50%{opacity:0}100%{opacity:0}}
@keyframes hero-blink{0%{opacity:1}50%{opacity:.18}}
@keyframes hero-card-in{from{opacity:0;scale:.6;translate:0 12px}}
@keyframes hero-cue{0%{transform:translateY(-2px)}33%{transform:translateY(1px)}66%{transform:translateY(4px)}}
`;
