"use client";

/**
 * Fire-and-forget visual effects.
 *
 * Any component can call `fx.burst(...)` without knowing who draws it. The
 * calls become window events that `FxLayer` (a single fixed canvas) renders.
 * If the layer is not mounted, or the visitor prefers reduced motion, the
 * events are simply ignored — callers never need to check.
 */

export interface BurstOptions {
  /** Number of particles. */
  count?: number;
  colors?: string[];
  /** Initial speed in px/s. */
  speed?: number;
  /** Direction of the cone in radians (0 = right, -PI/2 = up). */
  angle?: number;
  /** Width of the cone in radians. 2*PI is a full ring. */
  spread?: number;
  /** px/s^2, positive pulls down. */
  gravity?: number;
  /** Particle size in px. */
  size?: number;
  /** Seconds. */
  life?: number;
  shape?: "square" | "spark" | "ring";
}

export type FxPreset =
  | "click"
  | "coin"
  | "achievement"
  | "hit"
  | "select"
  | "dust"
  | "confetti";

export const FX_PRESETS: Record<FxPreset, BurstOptions> = {
  click: { count: 8, colors: ["#00e5ff", "#8b5cf6"], speed: 260, gravity: 600, size: 3, life: 0.45 },
  coin: { count: 18, colors: ["#ffb020", "#ff2d77", "#fff3c4"], speed: 360, gravity: 900, size: 4, life: 0.8 },
  achievement: { count: 28, colors: ["#c8ff2e", "#00e5ff", "#ffb020"], speed: 420, gravity: 700, size: 4, life: 1 },
  hit: { count: 14, colors: ["#ff2d77", "#ffffff"], speed: 380, gravity: 400, size: 3, life: 0.5, shape: "spark" },
  select: { count: 22, colors: ["#00e5ff", "#c8ff2e", "#8b5cf6"], speed: 340, gravity: 500, size: 4, life: 0.7 },
  dust: { count: 7, colors: ["#8a8fa3", "#2a2a3d"], speed: 120, angle: -Math.PI / 2, spread: Math.PI, gravity: 260, size: 3, life: 0.4 },
  confetti: { count: 60, colors: ["#00e5ff", "#ff2d77", "#c8ff2e", "#8b5cf6", "#ffb020"], speed: 620, angle: -Math.PI / 2, spread: Math.PI * 0.9, gravity: 1100, size: 5, life: 1.6 },
};

export type FxEvent =
  | { kind: "burst"; x: number; y: number; opts: BurstOptions }
  | { kind: "flash"; color: string; strength: number };

export const FX_EVENT = "glitch:fx";

function emit(e: FxEvent) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<FxEvent>(FX_EVENT, { detail: e }));
}

const resolve = (o?: BurstOptions | FxPreset): BurstOptions =>
  typeof o === "string" ? FX_PRESETS[o] : (o ?? FX_PRESETS.click);

export const fx = {
  /** Particle burst at a viewport position (clientX / clientY space). */
  burst(x: number, y: number, opts?: BurstOptions | FxPreset) {
    emit({ kind: "burst", x, y, opts: resolve(opts) });
  },

  /** Particle burst from the centre of an element. */
  burstAt(el: Element | null | undefined, opts?: BurstOptions | FxPreset) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    emit({ kind: "burst", x: r.left + r.width / 2, y: r.top + r.height / 2, opts: resolve(opts) });
  },

  /**
   * A soft full-screen colour wash. Strength is capped well below anything
   * that could count as a photosensitive flash.
   */
  flash(color = "#ffffff", strength = 0.14) {
    emit({ kind: "flash", color, strength: Math.max(0, Math.min(0.22, strength)) });
  },

  /**
   * A short vibration on touch devices that support it. Never throws, and
   * waits for the visitor's first tap — Chrome logs an error for vibrate()
   * calls that arrive before any user activation.
   */
  haptic(pattern: number | number[] = 12) {
    try {
      const activation = (
        navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }
      ).userActivation;
      if (
        typeof navigator !== "undefined" &&
        "vibrate" in navigator &&
        activation?.hasBeenActive !== false &&
        window.matchMedia("(pointer: coarse)").matches
      ) {
        navigator.vibrate(pattern);
      }
    } catch {
      /* unsupported */
    }
  },
};
