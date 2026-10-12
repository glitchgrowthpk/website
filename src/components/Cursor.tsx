"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useGame } from "@/lib/game-state";
import { useFinePointer, useReducedMotion } from "@/lib/hooks";
import { fx } from "@/lib/fx";

/**
 * The targeting-reticle cursor.
 *
 * A pixel dot sits exactly on the pointer; four corner brackets trail it on
 * an eased follow and "lock on" to whatever is clickable — framing compact
 * targets, swelling over big ones, and reading out `data-cursor="LABEL"`.
 * Elements tagged `data-magnetic` lean toward the pointer.
 *
 * Mouse and trackpad only. Touch, reduced motion, the cursor setting and any
 * open modal <dialog> (which lives in the top layer, above z-200) all hand the
 * native cursor straight back. Everything moves through refs and direct style
 * writes in one rAF loop that sleeps whenever the pointer is still.
 */

/** What the reticle locks onto. `html` carries data-cursor="on|off" itself. */
const INTERACTIVE = [
  "a[href]",
  "button:not(:disabled)",
  "[role='button']",
  "[role='radio']",
  "[role='switch']",
  "[role='checkbox']",
  "[role='tab']",
  "[role='menuitem']",
  "[role='option']",
  "summary",
  "label",
  "select:not(:disabled)",
  "input:not(:disabled):not([type='hidden'])",
  "[data-cursor]:not(html)",
].join(",");

/** Where a text caret is the right cursor: the reticle steps aside entirely. */
const TEXTY =
  "textarea, [contenteditable]:not([contenteditable='false']), " +
  "input:not([type='button'],[type='submit'],[type='reset'],[type='checkbox'],[type='radio'],[type='range'],[type='color'],[type='file'],[type='image'],[type='hidden'])";

/** Controls that keep their native cursor (CSS below), so the dot hides. */
const NATIVE = "input, select";

type Mode = "free" | "lock" | "grow" | "text";

/** Free reticle half-size: a 28px box. */
const SIZE = 14;
/** Half-size over big targets (cards), which are not worth framing. */
const GROW = 22;
/** Breathing room between a framed target and the brackets. */
const PAD = 5;
/** Targets up to this size get framed; anything bigger just grows the reticle. */
const COMPACT_W = 280;
const COMPACT_H = 160;
/**
 * Button-height strips are controls, not cards, so they are framed up to a
 * wider limit (the arcade's PRESS START, the hero's control hint). A reticle
 * grown over a cyan button would barely read against it.
 */
const STRIP_W = 480;
const STRIP_H = 64;
/** Follow rate (1/s) for the trailing reticle — higher is tighter. */
const FOLLOW = 24;
/** Size spring: under-damped for a little overshoot when locking on. */
const SIZE_K = 520;
const SIZE_C = 30;
/** Rotation spring for the spin-in on lock and the click twist. */
const ROT_K = 260;
const ROT_C = 22;
/** Peak angle (rad) this spring reaches per 1 rad/s of kick. */
const ROT_PEAK = 0.0288;
/** Lock-on swirl: strongest kick (rad/s) and the corner travel (px) it aims for. */
const SWIRL_MAX = 22;
const LOCK_SWING = 14;
/** Largest spring integration step (s); slower frames are substepped. */
const MAX_STEP = 1 / 120;
/** Magnetic pull: reach outside the rect, max shift and spring. */
const MAG_RANGE = 30;
const MAG_MAX = 10;
const MAG_K = 240;
const MAG_C = 19;
/** How long a fresh lock keeps re-measuring (hover scale transitions settle). */
const FRESH_MS = 360;
/** Re-scan for data-magnetic elements at most this often while moving. */
const MAGNET_SCAN_MS = 1500;
const CLICK_BURST_MS = 90;
/** Label chip height; its width is measured whenever the text changes. */
const LABEL_H = 18;

/** [x sign, y sign, base rotation] for TL, TR, BR, BL — one L shape, rotated. */
const CORNERS: [number, number, number][] = [
  [-1, -1, 0],
  [1, -1, 90],
  [1, 1, 180],
  [-1, 1, 270],
];

/** The default `transition` property list minus `transform` (expands "all"). */
const ALL_BUT_TRANSFORM = [
  "color",
  "background-color",
  "border-color",
  "outline-color",
  "text-decoration-color",
  "fill",
  "stroke",
  "opacity",
  "box-shadow",
  "translate",
  "scale",
  "rotate",
  "filter",
  "backdrop-filter",
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const px2 = (v: number) => v.toFixed(2);

/** Split a computed CSS list on top-level commas (cubic-bezier(…) has its own). */
function splitList(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      out.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(s.slice(start).trim());
  return out.filter(Boolean);
}

/**
 * A magnetic CTA usually has `transition` / `transition-transform`, which
 * would smear our per-frame transform writes into a 200ms lag. Drop
 * `transform` from its transition list (keeping everything else, including
 * Tailwind's separate scale/translate) and return a function that undoes it.
 */
function stripTransformTransition(el: HTMLElement): (() => void) | null {
  const cs = getComputedStyle(el);
  const props = splitList(cs.transitionProperty);
  if (!props.some((p) => p === "transform" || p === "all")) return null;
  const durs = splitList(cs.transitionDuration);
  const fns = splitList(cs.transitionTimingFunction);
  const dels = splitList(cs.transitionDelay);

  const p: string[] = [];
  const d: string[] = [];
  const f: string[] = [];
  const l: string[] = [];
  props.forEach((prop, i) => {
    const list = prop === "all" ? ALL_BUT_TRANSFORM : prop === "transform" ? [] : [prop];
    for (const q of list) {
      p.push(q);
      d.push(durs[i % durs.length] ?? "0s");
      f.push(fns[i % fns.length] ?? "ease");
      l.push(dels[i % dels.length] ?? "0s");
    }
  });

  const s = el.style;
  const prev = [s.transitionProperty, s.transitionDuration, s.transitionTimingFunction, s.transitionDelay];
  s.transitionProperty = p.length ? p.join(", ") : "none";
  s.transitionDuration = d.join(", ") || "0s";
  s.transitionTimingFunction = f.join(", ") || "ease";
  s.transitionDelay = l.join(", ") || "0s";
  return () => {
    [s.transitionProperty, s.transitionDuration, s.transitionTimingFunction, s.transitionDelay] = prev;
  };
}

/**
 * An endless CSS animation that shifts its element (a bob). Spins don't
 * count: a rotating box's bounds breathe, and the frame would breathe too.
 */
function isMovingLoop(a: Animation) {
  const k = a.effect;
  return (
    k instanceof KeyframeEffect &&
    !!k.target &&
    !k.pseudoElement &&
    a.playState === "running" &&
    k.getTiming().iterations === Infinity &&
    k.getKeyframes().some(
      (f) => "translate" in f || (typeof f.transform === "string" && f.transform.includes("translate")),
    )
  );
}

/**
 * A coin's hit box stays put while its face bobs inside it, so a frame
 * measured once would hang off the coin. Returns the looping part when it is
 * about the target's own size (a bobbing sprite inside a card, or a spinning
 * rim twice as big, is not the body), so the frame can ride along with what
 * the visitor actually sees.
 */
function movingBody(el: Element, r: DOMRect): Element | null {
  if (typeof el.getAnimations !== "function") return null;
  const area = r.width * r.height;
  if (!area) return null;
  for (const a of el.getAnimations({ subtree: true })) {
    if (!isMovingLoop(a)) continue;
    const t = (a.effect as KeyframeEffect).target as Element;
    const b = t.getBoundingClientRect();
    const ratio = (b.width * b.height) / area;
    if (ratio > 0.8 && ratio < 1.25) return t;
  }
  return null;
}

/* ------------------------------------------------------- modal detection */

// A modal <dialog> sits in the browser's top layer, above even z-[200], so the
// reticle would vanish behind it. Watch `open` flips rather than polling.
function subscribeModal(onChange: () => void) {
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, {
    subtree: true,
    attributes: true,
    attributeFilter: ["open"],
  });
  document.addEventListener("close", onChange, true);
  return () => {
    mo.disconnect();
    document.removeEventListener("close", onChange, true);
  };
}

function isModalOpen() {
  try {
    return document.querySelector("dialog:modal") !== null;
  } catch {
    // Browsers without :modal — any open dialog counts.
    return document.querySelector("dialog[open]") !== null;
  }
}

/* ------------------------------------------------------------------ CSS */

/** Stepped wipe for the label chip, used by two identically named copies. */
const LABEL_GLITCH = `
  0%   { clip-path: inset(0 100% 0 0); }
  25%  { clip-path: inset(0 60% 0 0); translate: 2px 0; }
  50%  { clip-path: inset(0 25% 0 0); translate: -1px 0; }
  75%  { clip-path: inset(0 0 0 0); translate: 1px 0; }
  100% { clip-path: none; translate: 0 0; }
`;

const CSS = `
html[data-cursor-active],
html[data-cursor-active] *,
html[data-cursor-active] *::before,
html[data-cursor-active] *::after { cursor: none !important; }
html[data-cursor-active] :is(input, textarea, select, [contenteditable]:not([contenteditable="false"]), [contenteditable]:not([contenteditable="false"]) *) {
  cursor: auto !important;
}

.cursorfx { opacity: 0; transition: opacity .14s ease-out; }
.cursorfx[data-visible="1"] { opacity: 1; }
.cursorfx[data-mode="text"] { opacity: 0; }
.cursorfx > * { position: absolute; left: 0; top: 0; will-change: transform; }

.cursorfx-dot > span {
  display: block;
  width: 4px;
  height: 4px;
  margin: -2px 0 0 -2px;
  background: #ff2d77;
  box-shadow: 0 0 0 1px rgba(6, 6, 10, .85), 0 0 8px 1px rgba(255, 45, 119, .85);
  transition: transform .14s cubic-bezier(.34, 1.56, .64, 1), background-color .1s;
}
.cursorfx[data-pressed="1"] .cursorfx-dot > span { transform: scale(1.75); background: #fff; }
.cursorfx[data-native="1"] .cursorfx-dot { opacity: 0; }

.cursorfx-corner {
  width: 8px;
  height: 8px;
  border-top: 2px solid #00e5ff;
  border-left: 2px solid #00e5ff;
  transform-origin: 0 0;
  filter: drop-shadow(0 0 1px rgba(6, 6, 10, .95)) drop-shadow(0 0 4px rgba(0, 229, 255, .55));
  transition: border-color .1s;
}
.cursorfx[data-mode="lock"] .cursorfx-corner { width: 9px; height: 9px; }
.cursorfx[data-pressed="1"] .cursorfx-corner { border-color: #ff2d77; }

.cursorfx-ticks { width: 0; height: 0; transition: opacity .14s; }
.cursorfx-ticks > span {
  position: absolute;
  background: rgba(0, 229, 255, .75);
  box-shadow: 0 0 0 1px rgba(6, 6, 10, .5);
}
.cursorfx-ticks > span:nth-child(1) { left: -1px; top: -9px; width: 2px; height: 4px; }
.cursorfx-ticks > span:nth-child(2) { left: 5px; top: -1px; width: 4px; height: 2px; }
.cursorfx-ticks > span:nth-child(3) { left: -1px; top: 5px; width: 2px; height: 4px; }
.cursorfx-ticks > span:nth-child(4) { left: -9px; top: -1px; width: 4px; height: 2px; }
.cursorfx:not([data-mode="free"]) .cursorfx-ticks { opacity: 0; }

.cursorfx-label > span {
  display: block;
  height: ${LABEL_H}px;
  padding: 0 6px 0 7px;
  border-left: 2px solid #ff2d77;
  background: #00e5ff;
  color: #06060a;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  line-height: ${LABEL_H}px;
  letter-spacing: .18em;
  text-transform: uppercase;
  white-space: nowrap;
  box-shadow: 0 0 14px rgba(0, 229, 255, .35);
  opacity: 0;
  transform: translateX(-4px);
  transition: opacity .1s, transform .18s cubic-bezier(.34, 1.56, .64, 1);
}
.cursorfx:is([data-label="1"], [data-label="2"]) .cursorfx-label > span {
  opacity: 1;
  transform: none;
}
/* Two identical animations: flipping between them replays the glitch-in
   when the text changes, with no reflow. */
.cursorfx[data-label="1"] .cursorfx-label > span { animation: cursorfx-label-in .24s steps(1); }
.cursorfx[data-label="2"] .cursorfx-label > span { animation: cursorfx-label-in2 .24s steps(1); }
@keyframes cursorfx-label-in {${LABEL_GLITCH}}
@keyframes cursorfx-label-in2 {${LABEL_GLITCH}}
`;

/* -------------------------------------------------------------- reticle */

interface Magnet {
  el: HTMLElement;
  /** Resting rect in client coords (our own offset subtracted). */
  l: number;
  t: number;
  r: number;
  b: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Inline transform before we touched it, restored on release. */
  orig: string;
  written: string;
  /** Undo for the transition tweak; null until first engaged. */
  restore: (() => void) | null;
  engaged: boolean;
}

function Reticle() {
  const rootRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const ticksRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const dot = dotRef.current;
    const ticks = ticksRef.current;
    const label = labelRef.current;
    const labelChip = label?.firstElementChild as HTMLElement | null;
    if (!root || !dot || !ticks || !label || !labelChip) return;
    const corners = Array.from(root.querySelectorAll<HTMLElement>(".cursorfx-corner"));
    const html = document.documentElement;

    /* ---------- state (all plain variables — nothing here re-renders) ---------- */

    let px = 0;
    let py = 0;
    /** Reticle centre (eased) and half-size (sprung). */
    let cx = 0;
    let cy = 0;
    let hw = SIZE;
    let hh = SIZE;
    let vw = 0;
    let vh = 0;
    let rot = 0;
    let vrot = 0;

    let shown = false;
    let pressed = false;
    let viewW = html.clientWidth;
    let viewH = html.clientHeight;

    let mode: Mode = "free";
    let target: Element | null = null;
    let hoverDirty = false;
    let hitTest = false;
    let rectDirty = false;
    let hit: Element | null = null;
    let hitMagnet: Magnet | null = null;
    /** The locked target's looping, moving part (a bobbing coin face), if any. */
    let body: Element | null = null;
    /** Locked target's resting centre and half-size. */
    let lx = 0;
    let ly = 0;
    let lhw = 0;
    let lhh = 0;
    let freshUntil = 0;
    let native = false;
    let labelStr = "";
    let labelW = 0;
    /** Tall, narrow targets (sprites) get their tag beside the frame. */
    let labelSide = false;
    /** Alternates "1" / "2" so a new label text replays the glitch-in. */
    let labelPhase = "1";

    const magnets = new Map<HTMLElement, Magnet>();
    let magnetsDirty = true;
    let magnetsAt = 0;

    let raf = 0;
    let last = 0;
    let lastBurst = 0;

    // Attribute cache so the write phase only touches what changed.
    const attrs: Record<string, string> = {};
    const attr = (k: string, v: string) => {
      if (attrs[k] === v) return;
      attrs[k] = v;
      root.setAttribute(`data-${k}`, v);
    };

    /* ---------- magnets ---------- */

    const releaseMagnet = (m: Magnet) => {
      m.el.style.transform = m.orig;
      m.restore?.();
      m.restore = null;
    };

    const measureMagnets = (now: number) => {
      magnetsDirty = false;
      magnetsAt = now;
      const seen = new Set<HTMLElement>();
      document.querySelectorAll<HTMLElement>("[data-magnetic]").forEach((el) => {
        seen.add(el);
        let m = magnets.get(el);
        if (!m) {
          m = {
            el,
            l: 0,
            t: 0,
            r: 0,
            b: 0,
            x: 0,
            y: 0,
            vx: 0,
            vy: 0,
            orig: el.style.transform,
            written: el.style.transform,
            restore: null,
            engaged: false,
          };
          magnets.set(el, m);
        }
        const r = el.getBoundingClientRect();
        m.l = r.left - m.x;
        m.t = r.top - m.y;
        m.r = r.right - m.x;
        m.b = r.bottom - m.y;
      });
      for (const [el, m] of magnets) {
        if (!seen.has(el)) {
          releaseMagnet(m);
          magnets.delete(el);
        }
      }
      // Keep the locked target's magnet link in step with the new list.
      if (hit) {
        const magEl = hit.closest<HTMLElement>("[data-magnetic]");
        hitMagnet = magEl ? (magnets.get(magEl) ?? null) : null;
      }
    };

    /** Pull for one magnet at the current pointer: 0 outside its reach. */
    const magnetPull = (m: Magnet) => {
      if (!shown) return null;
      const out = Math.max(m.l - px, 0, px - m.r, m.t - py, 0, py - m.b);
      if (out >= MAG_RANGE || m.r - m.l < 1) return null;
      const f0 = 1 - out / MAG_RANGE;
      const f = f0 * f0 * (3 - 2 * f0);
      return {
        x: clamp((px - (m.l + m.r) / 2) * 0.3, -MAG_MAX, MAG_MAX) * f,
        y: clamp((py - (m.t + m.b) / 2) * 0.3, -MAG_MAX, MAG_MAX) * f,
      };
    };

    /* ---------- hover ---------- */

    const measureLock = () => {
      if (!hit || !hit.isConnected) {
        hit = null;
        hitMagnet = null;
        body = null;
        mode = "free";
        return;
      }
      // Once the loop ends (a collected coin flies off), go back to the box.
      if (body && (!body.isConnected || !body.getAnimations().some(isMovingLoop))) body = null;
      const r = (body ?? hit).getBoundingClientRect();
      // getBoundingClientRect includes the magnet's current shift.
      lx = r.left + r.width / 2 - (hitMagnet?.x ?? 0);
      ly = r.top + r.height / 2 - (hitMagnet?.y ?? 0);
      lhw = r.width / 2;
      lhh = r.height / 2;
    };

    const resolveHover = (el: Element | null, now: number) => {
      let next: Element | null = null;
      let nextMode: Mode = "free";
      if (el && el !== html && el !== document.body) {
        if (el.closest(TEXTY)) nextMode = "text";
        else next = el.closest(INTERACTIVE);
      }
      if (nextMode === "text") {
        mode = "text";
        hit = null;
        hitMagnet = null;
        body = null;
        labelStr = "";
        return;
      }
      if (next === hit && mode !== "text") {
        if (mode === "lock") measureLock();
        return;
      }

      let r: DOMRect | null = null;
      if (next) {
        r = next.getBoundingClientRect();
        // display:contents wrappers and the like have no box to frame.
        if (r.width === 0 && r.height === 0) next = null;
      }
      const wasLocked = mode === "lock";
      hit = next;
      body = null;

      if (!next || !r) {
        mode = "free";
        hitMagnet = null;
        native = false;
        labelStr = "";
        return;
      }

      const magEl = next.closest<HTMLElement>("[data-magnetic]");
      hitMagnet = magEl ? (magnets.get(magEl) ?? null) : null;
      // Rendered since the last scan: pick it up next frame.
      if (magEl && !hitMagnet) magnetsDirty = true;
      native = next.matches(NATIVE);
      const raw = next.closest("[data-cursor]:not(html)")?.getAttribute("data-cursor") ?? "";
      labelStr = raw.trim().slice(0, 16);
      if (labelStr) {
        if (labelChip.textContent !== labelStr) {
          labelChip.textContent = labelStr;
          labelPhase = labelPhase === "1" ? "2" : "1";
        }
        // Measured, not estimated, so edge clamping holds whatever the font
        // did. This runs in the read phase, once per new target.
        labelW = labelChip.offsetWidth;
      }
      // Sprites often carry their own name bubble above them (the hero cast
      // does), so a tag on top would cover it.
      labelSide = r.height > r.width * 1.15;

      if (
        (r.width <= COMPACT_W && r.height <= COMPACT_H) ||
        (r.width <= STRIP_W && r.height <= STRIP_H)
      ) {
        mode = "lock";
        body = movingBody(next, r);
        measureLock();
        freshUntil = now + FRESH_MS;
        // Brackets swirl in when acquiring from free; hopping between
        // neighbouring targets just slides. The kick shrinks with the frame
        // so a wide button's corners swing ~14px, not 60px across the page.
        if (!wasLocked) {
          const reach = Math.hypot(lhw + PAD, lhh + PAD);
          vrot -= Math.min(SWIRL_MAX, LOCK_SWING / (reach * ROT_PEAK));
        }
      } else {
        mode = "grow";
      }
    };

    /* ---------- loop ---------- */

    const tick = (now: number) => {
      raf = 0;
      // Clamped both ways: a long stall can't explode the sim, and a frame
      // stamped before the previous one can't run it backwards.
      const dt = last ? Math.min(0.05, Math.max(0, (now - last) / 1000)) : 1 / 60;
      last = now;

      // Reads (layout) first, all of them, before any style writes below.
      if (magnetsDirty || (shown && now - magnetsAt > MAGNET_SCAN_MS)) measureMagnets(now);
      if (hitTest && shown) {
        hitTest = false;
        // Layout is being read here anyway; also catches a page scrollbar
        // that appeared without a resize (e.g. after the boot screen).
        viewW = html.clientWidth;
        viewH = html.clientHeight;
        target = document.elementFromPoint(px, py);
        hoverDirty = true;
      }
      if (hoverDirty) {
        hoverDirty = false;
        resolveHover(target, now);
      } else if (mode === "lock" && (rectDirty || now < freshUntil || (body && shown))) {
        measureLock();
      }
      rectDirty = false;
      // A bobbing target keeps the loop awake while the frame rides on it.
      const tracking = mode === "lock" && shown && body !== null;
      for (const m of magnets.values()) {
        if (!m.engaged && magnetPull(m)) {
          m.engaged = true;
          m.restore = stripTransformTransition(m.el);
        }
      }

      // Simulate. Springs integrate in fixed substeps: one 50ms step on a
      // slow frame would make the stiff size spring explode.
      const steps = Math.max(1, Math.ceil(dt / MAX_STEP));
      const h = dt / steps;
      // Magnets first: a locked magnetic target is framed where it is drawn
      // this frame, not where it was.
      let moving = false;
      for (const m of magnets.values()) {
        const pull = magnetPull(m);
        const tx = pull?.x ?? 0;
        const ty = pull?.y ?? 0;
        for (let i = 0; i < steps; i++) {
          m.vx += ((tx - m.x) * MAG_K - m.vx * MAG_C) * h;
          m.vy += ((ty - m.y) * MAG_K - m.vy * MAG_C) * h;
          m.x += m.vx * h;
          m.y += m.vy * h;
        }
        if (Math.abs(tx - m.x) < 0.05 && Math.abs(ty - m.y) < 0.05 && Math.abs(m.vx) < 0.5 && Math.abs(m.vy) < 0.5) {
          m.x = tx;
          m.y = ty;
          m.vx = 0;
          m.vy = 0;
        } else {
          moving = true;
        }
      }

      let tx = px;
      let ty = py;
      let thw = SIZE;
      let thh = SIZE;
      if (mode === "lock") {
        tx = lx + (hitMagnet?.x ?? 0);
        ty = ly + (hitMagnet?.y ?? 0);
        thw = lhw + PAD;
        thh = lhh + PAD;
        if (pressed) {
          thw = Math.max(6, thw - 4);
          thh = Math.max(6, thh - 4);
        }
      } else {
        if (mode === "grow") thw = thh = GROW;
        if (pressed) {
          thw *= 0.6;
          thh *= 0.6;
        }
      }

      const k = 1 - Math.exp(-FOLLOW * dt);
      cx += (tx - cx) * k;
      cy += (ty - cy) * k;
      for (let i = 0; i < steps; i++) {
        vw += ((thw - hw) * SIZE_K - vw * SIZE_C) * h;
        vh += ((thh - hh) * SIZE_K - vh * SIZE_C) * h;
        hw += vw * h;
        hh += vh * h;
        vrot += (-rot * ROT_K - vrot * ROT_C) * h;
        rot += vrot * h;
      }

      const settled =
        !moving &&
        !tracking &&
        now >= freshUntil &&
        Math.abs(tx - cx) < 0.15 &&
        Math.abs(ty - cy) < 0.15 &&
        Math.abs(thw - hw) < 0.1 &&
        Math.abs(thh - hh) < 0.1 &&
        Math.abs(vw) < 2 &&
        Math.abs(vh) < 2 &&
        Math.abs(rot) < 0.003 &&
        Math.abs(vrot) < 0.02;
      if (settled) {
        // Land on whole pixels so the 2px brackets rest crisp.
        const l = Math.round(tx - thw);
        const r = Math.round(tx + thw);
        const t = Math.round(ty - thh);
        const b = Math.round(ty + thh);
        cx = (l + r) / 2;
        cy = (t + b) / 2;
        hw = (r - l) / 2;
        hh = (b - t) / 2;
        vw = vh = rot = vrot = 0;
      }

      // Writes.
      attr("mode", mode);
      attr("native", native ? "1" : "0");
      attr("label", labelStr && mode !== "text" ? labelPhase : "0");

      const c = Math.cos(rot);
      const s = Math.sin(rot);
      const deg = (rot * 180) / Math.PI;
      for (let i = 0; i < 4; i++) {
        const [sx, sy, base] = CORNERS[i];
        const ox = sx * hw;
        const oy = sy * hh;
        corners[i].style.transform = `translate3d(${px2(cx + ox * c - oy * s)}px, ${px2(cy + ox * s + oy * c)}px, 0) rotate(${px2(deg + base)}deg)`;
      }
      const tickScale = clamp(hw / SIZE, 0.5, 1.6);
      ticks.style.transform = `translate3d(${px2(cx)}px, ${px2(cy)}px, 0) rotate(${px2(deg)}deg) scale(${px2(tickScale)})`;

      if (labelStr) {
        let lxp: number;
        let lyp: number;
        if (mode === "lock" && !labelSide) {
          // A name tag over the framed target — controls mostly sit in rows,
          // so above never covers a neighbour. Under it for the HUD row.
          lxp = cx - hw;
          lyp = cy - hh - LABEL_H - 4;
          if (lyp < 4) lyp = cy + hh + 4;
        } else if (mode === "lock") {
          // Beside a tall frame, level with its top corner.
          lxp = cx + hw + 6;
          lyp = cy - hh;
          if (lxp + labelW > viewW - 4) lxp = cx - hw - 6 - labelW;
        } else {
          // Free / grow: a tooltip beside the reticle, flipped at the edge.
          lxp = cx + hw + 7;
          lyp = cy - hh - 1;
          if (lxp + labelW > viewW - 4) lxp = cx - hw - 7 - labelW;
        }
        lxp = clamp(lxp, 4, viewW - labelW - 4);
        lyp = clamp(lyp, 4, viewH - LABEL_H - 4);
        label.style.transform = `translate3d(${px2(lxp)}px, ${px2(lyp)}px, 0)`;
      }

      for (const m of magnets.values()) {
        const next =
          m.x === 0 && m.y === 0
            ? m.orig
            : `${m.orig ? `${m.orig} ` : ""}translate3d(${px2(m.x)}px, ${px2(m.y)}px, 0)`;
        if (next !== m.written) {
          m.el.style.transform = next;
          m.written = next;
        }
      }

      if (!settled) raf = requestAnimationFrame(tick);
      else last = 0;
    };

    const kick = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };

    /* ---------- visibility ---------- */

    const show = () => {
      if (shown) return;
      shown = true;
      // Appear on the pointer (no fly-in from where it left) and pop open.
      cx = px;
      cy = py;
      hw = hh = 3;
      vw = vh = 0;
      viewW = html.clientWidth;
      viewH = html.clientHeight;
      html.setAttribute("data-cursor-active", "");
      attr("visible", "1");
      hitTest = true;
    };

    const hide = () => {
      if (!shown) return;
      shown = false;
      pressed = false;
      attr("visible", "0");
      attr("pressed", "0");
      kick(); // let engaged magnets spring home
    };

    /** A finger is in use: there is no cursor to draw, native or ours. */
    const toTouch = () => {
      hide();
      html.removeAttribute("data-cursor-active");
    };

    /* ---------- input ---------- */

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return toTouch();
      px = e.clientX;
      py = e.clientY;
      // The dot is the precise part: written straight from the event.
      dot.style.transform = `translate3d(${px}px, ${py}px, 0)`;
      if (px >= viewW || py >= viewH) {
        // Confirm before hiding: a scrollbar can come or go without a resize.
        viewW = html.clientWidth;
        viewH = html.clientHeight;
      }
      if (px >= viewW || py >= viewH) {
        // Over a scrollbar, where the native cursor can't be hidden anyway.
        hide();
        return;
      }
      show();
      if (e.target !== target) {
        target = e.target as Element | null;
        hoverDirty = true;
      }
      kick();
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "touch") return toTouch();
      if (e.button !== 0) return;
      pressed = true;
      attr("pressed", "1");
      kick();
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      if (!pressed) return;
      pressed = false;
      attr("pressed", "0");
      // Whatever was under the pointer may have just changed.
      hitTest = true;
      kick();
    };

    const onOut = (e: PointerEvent) => {
      if (!e.relatedTarget) hide();
    };

    const onClick = (e: MouseEvent) => {
      // Keyboard activation reports detail 0 and no real position.
      if (e.detail === 0 || !shown || mode === "text") return;
      const now = performance.now();
      if (now - lastBurst < CLICK_BURST_MS) return;
      lastBurst = now;
      fx.burst(e.clientX, e.clientY, "click");
      fx.burst(e.clientX, e.clientY, {
        shape: "ring",
        count: 1,
        speed: 0,
        gravity: 0,
        size: 3,
        life: 0.32,
        colors: ["#00e5ff"],
      });
      // The square reticle gets a quick twist; a framed rectangle turning
      // would just look broken.
      if (mode !== "lock") vrot += 14;
      kick();
    };

    const onScroll = () => {
      magnetsDirty = true;
      if (!shown) return;
      rectDirty = true;
      hitTest = true;
      kick();
    };

    const onResize = () => {
      viewW = html.clientWidth;
      viewH = html.clientHeight;
      onScroll();
    };

    const opts = { capture: true, passive: true } as const;
    window.addEventListener("pointermove", onMove, opts);
    window.addEventListener("pointerdown", onDown, opts);
    window.addEventListener("pointerup", onUp, opts);
    window.addEventListener("pointercancel", onUp, opts);
    document.addEventListener("pointerout", onOut, { passive: true });
    document.addEventListener("click", onClick, true);
    // Capture on document: element scrolls (the HUD nav strip, the arcade's
    // results overlay) don't bubble, but they do pass through here.
    document.addEventListener("scroll", onScroll, opts);
    window.addEventListener("resize", onResize, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove, opts);
      window.removeEventListener("pointerdown", onDown, opts);
      window.removeEventListener("pointerup", onUp, opts);
      window.removeEventListener("pointercancel", onUp, opts);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("scroll", onScroll, opts);
      window.removeEventListener("resize", onResize);
      html.removeAttribute("data-cursor-active");
      for (const m of magnets.values()) releaseMagnet(m);
      magnets.clear();
    };
  }, []);

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className="cursorfx pointer-events-none fixed left-0 top-0 z-[200]"
      data-visible="0"
      data-mode="free"
    >
      <style>{CSS}</style>
      <div ref={ticksRef} className="cursorfx-ticks">
        <span />
        <span />
        <span />
        <span />
      </div>
      <span className="cursorfx-corner" />
      <span className="cursorfx-corner" />
      <span className="cursorfx-corner" />
      <span className="cursorfx-corner" />
      <div ref={dotRef} className="cursorfx-dot">
        <span />
      </div>
      <div ref={labelRef} className="cursorfx-label">
        <span />
      </div>
    </div>
  );
}

/** Mounted only while the reticle is allowed; unmounts while a modal is up. */
function ModalGate() {
  const modal = useSyncExternalStore(subscribeModal, isModalOpen, () => false);
  return modal ? null : <Reticle />;
}

export default function Cursor() {
  const { ready, settings } = useGame();
  const fine = useFinePointer();
  const reduced = useReducedMotion();
  // `ready` waits for the stored settings, so a visitor who switched the
  // cursor off never sees it flash on during load.
  if (!ready || !settings.cursor || !fine || reduced) return null;
  return <ModalGate />;
}
