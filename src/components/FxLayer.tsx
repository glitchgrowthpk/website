"use client";

import { useEffect, useRef } from "react";
import { FX_EVENT, type BurstOptions, type FxEvent } from "@/lib/fx";
import { useReducedMotion } from "@/lib/hooks";

/**
 * The one canvas every particle burst and screen flash is drawn on.
 *
 * Components never talk to this directly — they call `fx.burst()` /
 * `fx.flash()` from `lib/fx.ts`, which become window events. The canvas costs
 * nothing at rest: the rAF loop only runs while something is alive, and the
 * backing store is released after a few idle seconds.
 */

/** Hard cap so spamming bursts can't tank the frame rate. */
const MAX_PARTICLES = 400;
/** Beyond 2x the extra pixels are invisible and the fill cost is not. */
const MAX_DPR = 2;
const FLASH_MS = 250;
/** Free the (potentially 20MB) backing store after this long at rest. */
const RELEASE_MS = 4000;

/**
 * Additive bloom under every particle, as a fraction of its own alpha. It is
 * what makes a 4px square read as light on the dark panels — and it simply
 * vanishes over white, where the solid core still shows.
 */
const GLOW = 0.4;
/**
 * Halos per frame. Every real preset fits; past this the screen is already a
 * blizzard, and on software-rendered canvases each halo costs ~40µs.
 */
const GLOW_BUDGET = 96;
/** Glow sprites are cached per colour; callers only use a handful. */
const GLOW_CACHE_MAX = 48;
/** Particles spawn oversized and snap down to size over this long (s). */
const POP_S = 0.08;
/** The flare at a burst's origin: how long it lives (s) and its peak alpha. */
const FLARE_S = 0.16;
const FLARE_MAX = 0.55;

const SQUARE = 0;
const SPARK = 1;
const RING = 2;
/** Internal: the soft muzzle-flash at the origin of a multi-particle burst. */
const FLARE = 3;
type Shape = typeof SQUARE | typeof SPARK | typeof RING | typeof FLARE;

const SHAPES: Record<NonNullable<BurstOptions["shape"]>, Shape> = {
  square: SQUARE,
  spark: SPARK,
  ring: RING,
};

const DEFAULTS = {
  count: 12,
  colors: ["#00e5ff", "#ff2d77", "#c8ff2e"],
  speed: 300,
  angle: -Math.PI / 2,
  spread: Math.PI * 2,
  gravity: 700,
  size: 4,
  life: 0.6,
} as const;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** px/s^2 */
  g: number;
  /** Exponential velocity damping per second. */
  drag: number;
  age: number;
  life: number;
  size: number;
  color: string;
  /** Rotation (rad) and its rate — squares tumble. */
  rot: number;
  spin: number;
  /** Fake 3D flip: the square's width breathes with cos(flip). */
  flip: number;
  flipRate: number;
  shape: Shape;
  /** Peak alpha — only the origin flare uses less than 1. */
  alpha: number;
}

const blank = (): Particle => ({
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  g: 0,
  drag: 0,
  age: 0,
  life: 1,
  size: 1,
  color: "#fff",
  rot: 0,
  spin: 0,
  flip: 0,
  flipRate: 0,
  shape: SQUARE,
  alpha: 1,
});

/**
 * Options arrive from any component. A NaN life would keep the loop awake
 * forever and a negative size makes arc() throw mid-frame, so anything
 * unusable falls back to the default.
 */
const num = (v: number | undefined, fallback: number, min = -Infinity) =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(min, v) : fallback;

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
/** Squares hold full brightness for most of their life, then fade. */
const squareAlpha = (t: number) => (t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45);
/** Spawn pop: 1.6x at birth, snapping to 1x over POP_S. */
const popScale = (age: number) => (age < POP_S ? 1 + 0.6 * (1 - age / POP_S) ** 2 : 1);

/**
 * A soft round glow in one colour, drawn once into a small canvas and then
 * stamped with drawImage — far cheaper than shadowBlur on every particle.
 * The gradient fades to transparent black, which under "lighter" just means
 * "adds less light", so any CSS colour string works without parsing it.
 */
function makeGlow(color: string): HTMLCanvasElement | null {
  const s = document.createElement("canvas");
  s.width = s.height = 32;
  const g = s.getContext("2d");
  if (g) {
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    try {
      grad.addColorStop(0, color);
      grad.addColorStop(0.3, color);
    } catch {
      // Not a colour the canvas can parse (a CSS variable, a typo).
      return null;
    }
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.globalAlpha = 1;
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    // Thin the shoulder so the bloom reads as a halo, not a disc.
    g.globalCompositeOperation = "destination-in";
    const fall = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    fall.addColorStop(0, "rgba(0,0,0,1)");
    fall.addColorStop(0.5, "rgba(0,0,0,0.35)");
    fall.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = fall;
    g.fillRect(0, 0, 32, 32);
  }
  return s;
}

export default function FxLayer() {
  const reduced = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (reduced) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    // Preallocated pool: [0, alive) are live. Dead particles are swapped to
    // the tail, so spawning and killing never allocate.
    const pool: Particle[] = Array.from({ length: MAX_PARTICLES }, blank);
    let alive = 0;
    /** Round-robin victim when the pool is full — newest bursts always show. */
    let recycle = 0;

    let flash: { color: string; strength: number; start: number } | null = null;

    let raf = 0;
    let last = 0;
    let releaseTimer = 0;
    let sizeDirty = true;
    let w = 0;
    let h = 0;
    let dpr = 1;

    /* ---------- sizing ---------- */

    const fit = () => {
      sizeDirty = false;
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      const bw = Math.round(w * dpr);
      const bh = Math.round(h * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
    };

    const release = () => {
      releaseTimer = 0;
      if (raf) return;
      canvas.width = 0;
      canvas.height = 0;
      sizeDirty = true;
    };

    /** Glow sprite per colour; null marks a colour the canvas can't parse. */
    const glows = new Map<string, HTMLCanvasElement | null>();
    const glowOf = (color: string) => {
      let s = glows.get(color);
      if (s === undefined) {
        if (glows.size >= GLOW_CACHE_MAX) glows.clear();
        s = makeGlow(color);
        glows.set(color, s);
      }
      return s;
    };

    /* ---------- spawning ---------- */

    const take = (): Particle => {
      if (alive < MAX_PARTICLES) return pool[alive++];
      const p = pool[recycle];
      recycle = (recycle + 1) % MAX_PARTICLES;
      return p;
    };

    const burst = (x: number, y: number, o: BurstOptions) => {
      const count = Math.min(MAX_PARTICLES, Math.round(num(o.count, DEFAULTS.count, 0)));
      // Validating a colour also builds its glow sprite, so frames never do.
      const valid = (o.colors ?? []).filter((c) => typeof c === "string" && glowOf(c) !== null);
      const colors: readonly string[] = valid.length ? valid : DEFAULTS.colors;
      const speed = num(o.speed, DEFAULTS.speed);
      const angle = num(o.angle, DEFAULTS.angle);
      const spread = num(o.spread, DEFAULTS.spread);
      const gravity = num(o.gravity, DEFAULTS.gravity);
      const size = num(o.size, DEFAULTS.size, 0.5);
      const life = num(o.life, DEFAULTS.life, 0.05);
      const shape = SHAPES[o.shape ?? "square"] ?? SQUARE;

      // A real burst gets a quick flare where it starts — the "pop" the eye
      // catches before the particles have travelled anywhere. Bigger bursts
      // flare harder. Single rings and stills (speed 0) don't need one.
      if (count > 2 && speed > 0) {
        glowOf(colors[0]);
        const f = take();
        f.x = x;
        f.y = y;
        f.vx = f.vy = f.g = f.drag = 0;
        f.age = 0;
        f.life = FLARE_S;
        f.size = Math.max(10, size * 4.5);
        f.color = colors[0];
        f.rot = f.spin = f.flip = f.flipRate = 0;
        f.shape = FLARE;
        f.alpha = Math.min(FLARE_MAX, 0.14 + count * 0.012);
      }

      for (let i = 0; i < count; i++) {
        const p = take();
        // Even spacing across the cone plus jitter reads as an explosion
        // rather than a clump; a full ring stays a full ring.
        const a = angle + spread * ((i + Math.random()) / Math.max(1, count) - 0.5);
        const v = speed * (0.45 + Math.random() * 0.7);
        p.x = x;
        p.y = y;
        p.vx = Math.cos(a) * v;
        p.vy = Math.sin(a) * v;
        p.g = gravity * (0.85 + Math.random() * 0.3);
        p.drag = shape === RING ? 4 : 1.2 + Math.random() * 1.4;
        p.age = 0;
        p.life = life * (0.7 + Math.random() * 0.5);
        p.size = size * (0.7 + Math.random() * 0.6);
        p.color = colors[(Math.random() * colors.length) | 0];
        p.rot = Math.random() * Math.PI;
        p.spin = (Math.random() - 0.5) * 18;
        p.flip = Math.random() * Math.PI;
        p.flipRate = 6 + Math.random() * 10;
        p.shape = shape;
        p.alpha = 1;
        // Build sprites at spawn time, never mid-frame.
        glowOf(p.color);
      }
      kick();
    };

    /* ---------- loop ---------- */

    const kill = (i: number) => {
      const dead = pool[i];
      pool[i] = pool[alive - 1];
      pool[alive - 1] = dead;
      alive--;
    };

    const frame = (now: number) => {
      raf = 0;
      // Clamped both ways: a long stall can't explode the sim, and a frame
      // stamped before the previous one can't run it backwards.
      const dt = last ? Math.min(0.05, Math.max(0, (now - last) / 1000)) : 1 / 60;
      last = now;
      if (sizeDirty) fit();

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Flash first, so particles stay crisp on top of the wash.
      if (flash) {
        // rAF timestamps can predate the event that started the flash.
        const p = Math.max(0, (now - flash.start) / FLASH_MS);
        if (p >= 1) {
          flash = null;
        } else {
          ctx.globalAlpha = flash.strength * (1 - p) * (1 - p);
          ctx.fillStyle = flash.color;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
      }

      // Pass 1: simulate, cull, and lay down the additive bloom.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      // Newest particles sit at the end of the pool, so they get halos first.
      let glowLeft = GLOW_BUDGET;
      for (let i = alive - 1; i >= 0; i--) {
        const p = pool[i];
        p.age += dt;
        if (p.age >= p.life || p.y > h + 80 || p.x < -80 || p.x > w + 80) {
          kill(i);
          continue;
        }
        const damp = Math.exp(-p.drag * dt);
        p.vx *= damp;
        p.vy = p.vy * damp + p.g * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.spin * dt;
        p.flip += p.flipRate * dt;

        const t = p.age / p.life;
        if (p.shape !== FLARE && glowLeft-- <= 0) continue;
        if (p.shape === FLARE) {
          // Blooms out fast and is gone before the particles are.
          const r = p.size * (0.55 + 0.6 * easeOutCubic(t));
          ctx.globalAlpha = p.alpha * (1 - t) * (1 - t);
          const glow = glowOf(p.color);
          if (glow) ctx.drawImage(glow, p.x - r, p.y - r, r * 2, r * 2);
        } else if (p.shape === RING) {
          ctx.globalAlpha = GLOW * 0.6 * (1 - t) ** 1.5;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = Math.max(2, p.size * 1.8 * (1 - t));
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (0.6 + 5.4 * easeOutCubic(t)), 0, Math.PI * 2);
          ctx.stroke();
        } else {
          // Squares and spark heads: a soft halo a few times their size.
          const a = p.shape === SQUARE ? squareAlpha(t) : 1 - t * t;
          const r = p.size * (p.shape === SQUARE ? 2.6 : 2.2) * popScale(p.age);
          ctx.globalAlpha = GLOW * a;
          const glow = glowOf(p.color);
          if (glow) ctx.drawImage(glow, p.x - r, p.y - r, r * 2, r * 2);
        }
      }

      // Pass 2: the solid cores on top, in normal blending so they still
      // read over white headings.
      ctx.globalCompositeOperation = "source-over";
      for (let i = 0; i < alive; i++) {
        const p = pool[i];
        const t = p.age / p.life;

        if (p.shape === SQUARE) {
          // Full brightness for most of the life, then a quick fade + shrink.
          ctx.globalAlpha = squareAlpha(t);
          const s = p.size * (1 - 0.55 * t) * popScale(p.age);
          const sw = s * (0.3 + 0.7 * Math.abs(Math.cos(p.flip)));
          const c = Math.cos(p.rot) * dpr;
          const sn = Math.sin(p.rot) * dpr;
          ctx.setTransform(c, sn, -sn, c, p.x * dpr, p.y * dpr);
          ctx.fillStyle = p.color;
          ctx.fillRect(-sw / 2, -s / 2, sw, s);
        } else if (p.shape === SPARK) {
          // A streak trailing back along the velocity: fast = long.
          const v = Math.hypot(p.vx, p.vy) || 1;
          const len = Math.min(p.size * 7, Math.max(p.size, v * 0.04));
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.globalAlpha = 1 - t * t;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = Math.max(0.75, p.size * 0.6 * (1 - 0.5 * t));
          ctx.beginPath();
          ctx.moveTo(p.x - (p.vx / v) * len, p.y - (p.vy / v) * len);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        } else if (p.shape === RING) {
          // Shockwave: grows fast, thins and fades.
          const e = easeOutCubic(t);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.globalAlpha = (1 - t) ** 1.5;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = Math.max(0.6, p.size * 0.55 * (1 - t));
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (0.6 + 5.4 * e), 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      if (alive > 0 || flash) {
        raf = requestAnimationFrame(frame);
      } else {
        // Idle: leave a clean canvas and stop. Zero cost until the next event.
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        last = 0;
        recycle = 0;
        window.clearTimeout(releaseTimer);
        releaseTimer = window.setTimeout(release, RELEASE_MS);
      }
    };

    const kick = () => {
      if (raf) return;
      window.clearTimeout(releaseTimer);
      releaseTimer = 0;
      if (sizeDirty || canvas.width === 0) fit();
      last = 0;
      raf = requestAnimationFrame(frame);
    };

    /* ---------- events ---------- */

    const onFx = (e: Event) => {
      // Nobody can see it, and rAF would just queue it up for later.
      if (document.hidden) return;
      const d = (e as CustomEvent<FxEvent>).detail;
      if (!d) return;
      if (d.kind === "burst") {
        if (Number.isFinite(d.x) && Number.isFinite(d.y)) burst(d.x, d.y, d.opts ?? {});
      } else if (d.kind === "flash") {
        const strength = Math.max(0, Math.min(1, d.strength));
        // A weaker flash never cuts a stronger one short.
        if (!flash || strength >= flash.strength * 0.5) {
          flash = { color: d.color, strength, start: performance.now() };
        }
        kick();
      }
    };

    const onResize = () => {
      sizeDirty = true;
    };

    window.addEventListener(FX_EVENT, onFx);
    window.addEventListener("resize", onResize, { passive: true });
    return () => {
      window.removeEventListener(FX_EVENT, onFx);
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
      window.clearTimeout(releaseTimer);
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [reduced]);

  if (reduced) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      width={0}
      height={0}
      className="pointer-events-none fixed inset-0 z-[66] h-full w-full"
    />
  );
}
