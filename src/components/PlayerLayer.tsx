"use client";

import { useEffect, useRef } from "react";
import { ACCENT_HEX, byId, spriteSrc } from "@/data/characters";
import { QUIPS } from "@/data/quips";
import { SECTIONS } from "@/data/studio";
import { useGame } from "@/lib/game-state";
import { useReducedMotion } from "@/lib/hooks";
import { sfx } from "@/lib/audio";
import { fx, FX_PRESETS, type BurstOptions } from "@/lib/fx";

/* ---------------------------------------------------------------- tuning */

const GRAVITY = 2400; // px/s^2 on the way up
const FALL_GRAVITY = 2900; // a touch heavier on the way down: snappier arcs
const MAX_FALL = 1900; // px/s
const RUN = 430; // px/s
const GROUND_ACCEL = 5200; // px/s^2 — full speed in ~80ms
const AIR_ACCEL = 3400;
const JUMP = 900; // px/s — a full hold rises JUMP^2 / 2g ≈ 169px, as before
const JUMP_CUT = 380; // releasing early caps the rise at this speed
const MIN_RISE = 0.06; // s — even the quickest tap rises this long first (~80px hop)
const DOUBLE_JUMP = 780;
// Both windows count simulated time, not wall time, so a slow frame or a GC
// pause can never swallow a jump press.
const COYOTE = 0.09; // s — grace period after walking off an edge
const BUFFER = 0.11; // s — a jump pressed just before landing still counts
const DROP = 0.26; // s — how long a Down tap ignores the platform underfoot
const FLOOR_PAD = 18;
const SPAWN_SNAP = 16; // px — taking control stands on a top this close to the feet
const LEDGE_REACH = 170; // px — ...or hops onto one this far above (a full jump)
const SPRITE_H = 92;

const SLEEP_AFTER_MS = 25_000; // no input this long and the walker sits down
const AFK_AFTER_MS = 20_000; // ...and this much longer asleep earns "afk"
const PARKOUR_GOAL = 10;

const QUIP_DWELL_MS = 3000; // a section must be on screen this long first
const QUIP_CHAR_MS = 26; // typewriter speed
const QUIP_HOLD_MS = 2800; // how long a finished line stays up
const QUIP_GAP_MS = 10_000; // minimum quiet time between two lines
const QUIP_WARMUP_MS = 6000; // and none at all in the first seconds after load
/** Half-size of the keep-out box around a coin that a bubble may not cover. */
const COIN_CLEAR = 26;
const QUIPS_KEY = "glitch.quips";

/* ------------------------------------------------------------------ fx */

const RING: BurstOptions = {
  count: 1,
  colors: ["#00e5ff"],
  speed: 0,
  gravity: 0,
  size: 9,
  life: 0.42,
  shape: "ring",
};
const RING_SPARKS: BurstOptions = {
  count: 10,
  colors: ["#00e5ff", "#8b5cf6", "#f2f3f7"],
  speed: 260,
  spread: Math.PI * 2,
  gravity: 0,
  size: 2.5,
  life: 0.32,
  shape: "spark",
};
const HARD_DUST: BurstOptions = { ...FX_PRESETS.dust, count: 14, speed: 200 };
const JUMP_DUST: BurstOptions = { ...FX_PRESETS.dust, count: 4, speed: 90 };
const runDust = (facing: number): BurstOptions => ({
  count: 2,
  colors: ["#8a8fa3", "#2a2a3d"],
  speed: 80,
  // kicked back and up, away from the direction of travel
  angle: facing > 0 ? -Math.PI + 0.5 : -0.5,
  spread: 0.7,
  gravity: 220,
  size: 3,
  life: 0.32,
});

/* ------------------------------------------------------------- helpers */

type Dir = "left" | "right" | "up" | "down";

interface Platform {
  el: Element;
  x: number;
  /** top edge in DOCUMENT coordinates */
  y: number;
  w: number;
}

interface CoinSpot {
  id: string;
  /** centre, x in viewport space, y in DOCUMENT space */
  x: number;
  y: number;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
const approach = (v: number, target: number, step: number) =>
  v < target ? Math.min(target, v + step) : Math.max(target, v - step);
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeOutBack = (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;

const dirFor = (key: string): Dir | null => {
  const k = key.toLowerCase();
  if (k === "arrowleft" || k === "a") return "left";
  if (k === "arrowright" || k === "d") return "right";
  if (k === "arrowup" || k === "w" || k === " ") return "up";
  if (k === "arrowdown" || k === "s") return "down";
  return null;
};

const isTypingTarget = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable
  );
};

/** One-shot pop over the character's head (decorative, so WAAPI is fine). */
function pop(el: HTMLElement | null, kind: "plus" | "bang") {
  if (!el || typeof el.animate !== "function") return;
  el.animate(
    kind === "bang"
      ? [
          { opacity: 0, transform: "translateY(6px) scale(0.3) rotate(-12deg)" },
          { opacity: 1, transform: "translateY(-6px) scale(1.35) rotate(6deg)", offset: 0.22 },
          { opacity: 1, transform: "translateY(-4px) scale(1) rotate(0deg)", offset: 0.5 },
          { opacity: 0, transform: "translateY(-14px) scale(0.9)" },
        ]
      : [
          { opacity: 0, transform: "translateY(4px) scale(0.5)" },
          { opacity: 1, transform: "translateY(-10px) scale(1.2)", offset: 0.22 },
          { opacity: 1, transform: "translateY(-18px) scale(1)", offset: 0.6 },
          { opacity: 0, transform: "translateY(-34px) scale(0.95)" },
        ],
    { duration: kind === "bang" ? 760 : 900, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
  );
}

/**
 * A side-scrolling character that walks the page.
 *
 * In "ambient" mode it reacts to scrolling, watches the pointer, falls asleep
 * when nobody is around and now and then comments on the section in view. Once
 * the visitor takes control it becomes a real platformer whose collision
 * geometry is the page itself: every element tagged `data-solid` is a one-way
 * platform. Jumps get coyote time, buffering, variable height and one air
 * jump, so it feels like a game rather than a demo.
 *
 * Arrow keys are only captured while control is active, so normal keyboard
 * scrolling is never hijacked. Everything freezes while the pause menu is up.
 */
export default function PlayerLayer() {
  const {
    characterId,
    controlling,
    setControlling,
    collect,
    coins,
    paused,
    settings,
    unlock,
    hasAchievement,
    ready,
  } = useGame();
  const reduced = useReducedMotion();
  // Reduced motion removes the ambient walker (nothing moves on its own), but
  // the platformer itself is visitor-driven, so it still works under control.
  const show = !reduced || controlling;

  const wrapRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const dustRef = useRef<HTMLDivElement>(null);
  const plusRef = useRef<HTMLSpanElement>(null);
  const plusCountRef = useRef<HTMLElement>(null);
  const bangRef = useRef<HTMLSpanElement>(null);
  const quipRef = useRef<HTMLDivElement>(null);
  const quipBoxRef = useRef<HTMLDivElement>(null);
  const quipTypedRef = useRef<HTMLSpanElement>(null);
  const quipRestRef = useRef<HTMLSpanElement>(null);
  const quipTailRef = useRef<HTMLSpanElement>(null);

  // Mutable refs so the rAF loop and listeners never re-subscribe.
  const keys = useRef<Partial<Record<Dir, boolean>>>({});
  const controllingRef = useRef(controlling);
  const pausedRef = useRef(paused);
  const shortcutsRef = useRef(settings.shortcuts);
  const reducedRef = useRef(reduced);
  const collectedRef = useRef<Set<string>>(new Set(coins));
  const collectRef = useRef(collect);
  const unlockRef = useRef(unlock);
  const parkourDoneRef = useRef(false);
  const hasAchievementRef = useRef(hasAchievement);
  /** Restarts the loop if it is parked (asleep, paused, hidden). */
  const kickRef = useRef<() => void>(() => {});
  /** Wakes a sleeping walker. */
  const wakeRef = useRef<() => void>(() => {});
  /** Distinct platform elements stood on, for the parkour achievement. */
  const landedOn = useRef<Set<Element>>(new Set());

  const st = useRef({
    x: 140,
    /** feet position in DOCUMENT coordinates while under control */
    y: 0,
    /** height above the viewport floor while idling ambiently */
    hop: 0,
    vx: 0,
    vy: 0,
    facing: 1,
    /** rendered facing, eased through 0 for a paper-flip turn */
    face: 1,
    grounded: true,
    phase: 0,
    lastScroll: 0,
    scrollVel: 0,
    idleHopAt: 0,
    landFlash: 0,
    wasActive: false,
    lastViewY: 0,
    /** distance from the feet down to whatever is underneath */
    gap: 0,
    docFloor: 0,
    /** half the sprite's width, so it never walks partly off screen */
    halfW: 27,
    /** top of the on-screen control chip / touch pad (viewport y) */
    uiTop: Infinity,
    /** coyote time left after leaving the ground (s) */
    coyote: 0,
    jumped: false,
    airJumps: 1,
    /** buffered jump press still waiting to be used (s left) */
    jumpBuf: 0,
    /** true while a rise can still be cut short by releasing jump */
    cut: false,
    /** time since takeoff (s), for the minimum hop */
    riseT: 0,
    /** 0 → 1 over a double-jump flip; 1 = not spinning */
    spinT: 1,
    stretch: 0,
    dustT: 0,
    groundEl: null as Element | null,
    dropEl: null as Element | null,
    /** drop-through time left on `dropEl` (s) */
    dropT: 0,
    asleep: false,
    asleepAt: 0,
    /** 0 = standing, 1 = sat down asleep */
    sit: 0,
    /** 0 → 1 pop-in after a character swap; 1 = settled */
    spawnT: 1,
    pointerX: -1,
    pointerAt: -Infinity,
  });

  useEffect(() => {
    controllingRef.current = controlling;
    if (controlling) wakeRef.current();
    kickRef.current();
  }, [controlling]);
  useEffect(() => {
    pausedRef.current = paused;
    if (paused) keys.current = {};
    // Resuming restarts the loop with a fresh frame clock: no time jump.
    else kickRef.current();
  }, [paused]);
  useEffect(() => {
    shortcutsRef.current = settings.shortcuts;
  }, [settings.shortcuts]);
  useEffect(() => {
    reducedRef.current = reduced;
  }, [reduced]);
  useEffect(() => {
    collectedRef.current = new Set(coins);
  }, [coins]);
  useEffect(() => {
    collectRef.current = collect;
    unlockRef.current = unlock;
  }, [collect, unlock]);
  useEffect(() => {
    hasAchievementRef.current = hasAchievement;
    parkourDoneRef.current = hasAchievement("parkour");
  }, [hasAchievement]);

  // A fresh fighter pops in with a burst in its own colour. Skipped for the
  // restore-from-storage swap on load, which happens in the same render that
  // flips `ready`.
  const prevChar = useRef(characterId);
  const wasReady = useRef(ready);
  useEffect(() => {
    if (prevChar.current !== characterId && wasReady.current && !reducedRef.current) {
      const s = st.current;
      s.spawnT = 0;
      fx.burst(s.x, s.lastViewY - SPRITE_H * 0.5, {
        count: 16,
        colors: [ACCENT_HEX[byId(characterId).accent], "#f2f3f7"],
        speed: 280,
        spread: Math.PI * 2,
        gravity: 0,
        size: 3,
        life: 0.42,
        shape: "spark",
      });
      wakeRef.current();
      kickRef.current();
    }
    prevChar.current = characterId;
    wasReady.current = ready;
  }, [characterId, ready]);

  /* ---------------- input ---------------- */
  useEffect(() => {
    const s = st.current;

    const press = (dir: Dir, down: boolean) => {
      const was = !!keys.current[dir];
      keys.current[dir] = down;
      if (!down || was) return;
      // Buffered: a press a moment before landing still jumps on touchdown.
      if (dir === "up") s.jumpBuf = BUFFER;
      // A tap of Down drops through the platform underfoot.
      if (dir === "down" && s.grounded && s.groundEl) {
        s.dropEl = s.groundEl;
        s.dropT = DROP;
      }
    };

    const down = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.isComposing) return;
      // The pause menu owns the keyboard while it is open.
      if (pausedRef.current) return;
      const mod = e.ctrlKey || e.metaKey || e.altKey;

      // `G` toggles control from anywhere (unless shortcuts are switched off).
      if ((e.key === "g" || e.key === "G") && !mod) {
        if (!shortcutsRef.current || e.repeat) return;
        e.preventDefault();
        sfx.select();
        setControlling(!controllingRef.current);
        return;
      }
      if (e.key === "Escape" && controllingRef.current) {
        sfx.back();
        setControlling(false);
        return;
      }
      if (!controllingRef.current || mod) return;

      const dir = dirFor(e.key);
      if (!dir) return;
      e.preventDefault(); // only while control is active
      press(dir, true);
    };

    const up = (e: KeyboardEvent) => {
      const dir = dirFor(e.key);
      if (dir) press(dir, false);
    };

    // Touch D-pad dispatches these synthetic events.
    const onPad = (e: Event) => {
      const { dir, down } = (e as CustomEvent<{ dir: Dir; down: boolean }>).detail;
      if (down && pausedRef.current) return;
      press(dir, down);
    };

    // Never leave a key stuck down when the window loses focus.
    const clear = () => {
      keys.current = {};
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("glitch:pad", onPad as EventListener);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("glitch:pad", onPad as EventListener);
      window.removeEventListener("blur", clear);
    };
  }, [setControlling]);

  /* ---------------- idle → asleep → AFK ---------------- */
  useEffect(() => {
    const s = st.current;
    let lastInput = performance.now();
    let afkDone = false;

    const sleep = (now: number) => {
      s.asleep = true;
      s.asleepAt = now;
      wrapRef.current?.setAttribute("data-sleep", "");
    };

    const wake = () => {
      if (!s.asleep) return;
      s.asleep = false;
      const wrap = wrapRef.current;
      if (!wrap) return; // reduced motion: there is no ambient walker to wake
      wrap.removeAttribute("data-sleep");
      if (!reducedRef.current && !controllingRef.current) {
        // "!" — a startled hop.
        s.vy = -JUMP * 0.5;
        s.grounded = false;
        s.stretch = 1;
        pop(bangRef.current, "bang");
        sfx.select();
      }
      kickRef.current();
    };
    wakeRef.current = wake;

    const onInput = (e: Event) => {
      lastInput = performance.now();
      if (e.type === "pointermove" && (e as PointerEvent).pointerType === "mouse") {
        s.pointerX = (e as PointerEvent).clientX;
        s.pointerAt = lastInput;
      }
      wake();
    };
    const onVis = () => {
      if (!document.hidden) {
        lastInput = performance.now();
        wake();
      }
    };

    const events = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart", "scroll"];
    // Capture, so scrolls inside nested scrollers count too.
    const opts: AddEventListenerOptions = { passive: true, capture: true };
    events.forEach((t) => window.addEventListener(t, onInput, opts));
    document.addEventListener("visibilitychange", onVis);

    const tick = window.setInterval(() => {
      const now = performance.now();
      // Never doze off while driven, paused, or in a background tab.
      if (document.hidden || controllingRef.current || pausedRef.current) {
        lastInput = now;
        return;
      }
      if (!s.asleep) {
        if (now - lastInput >= SLEEP_AFTER_MS) sleep(now);
      } else if (!afkDone && now - s.asleepAt >= AFK_AFTER_MS) {
        afkDone = true;
        unlockRef.current("afk");
      }
    }, 1000);

    return () => {
      events.forEach((t) => window.removeEventListener(t, onInput, opts));
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(tick);
      wakeRef.current = () => {};
    };
  }, []);

  /* ---------------- main loop ---------------- */
  useEffect(() => {
    if (!show) return;

    const wrap = wrapRef.current;
    const body = bodyRef.current;
    const shadow = shadowRef.current;
    const dust = dustRef.current;
    if (!wrap || !body || !shadow || !dust) return;
    const quipEl = quipRef.current;
    const quipBox = quipBoxRef.current;
    const quipTyped = quipTypedRef.current;
    const quipRest = quipRestRef.current;
    const quipTail = quipTailRef.current;

    let raf = 0;
    let last = performance.now();

    const s = st.current;
    s.hop = 0;
    s.wasActive = false;
    s.lastScroll = window.scrollY;
    if (s.asleep) wrap.setAttribute("data-sleep", "");

    /* -------- collision + coin cache (document space) -------- */
    let platforms: Platform[] = [];
    let coinSpots: CoinSpot[] = [];
    let cacheAt = -Infinity;
    let stale = true;

    // Stored in document coordinates, so a scroll alone never invalidates the
    // geometry — only layout changes do (resize, reveals, filters), which the
    // interval and the scroll-throttled refresh pick up.
    const refresh = (now: number) => {
      const sy = window.scrollY;
      // The ambient walker only needs the coins; platforms are for control.
      const solids: Platform[] = [];
      if (controllingRef.current) {
        document.querySelectorAll<HTMLElement>("[data-solid]").forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width < 40 || r.height <= 0) return;
          solids.push({ el, x: r.left, y: r.top + sy, w: r.width });
        });
      }
      const spots: CoinSpot[] = [];
      document.querySelectorAll<HTMLElement>("[data-coin]").forEach((el) => {
        const id = el.dataset.coin;
        const r = el.getBoundingClientRect();
        if (!id || !r.width) return;
        spots.push({ id, x: r.left + r.width / 2, y: r.top + r.height / 2 + sy });
      });
      platforms = solids;
      coinSpots = spots;
      s.docFloor =
        Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) -
        FLOOR_PAD;
      s.halfW = body.offsetWidth / 2 || s.halfW;
      // On a phone the D-pad covers the bottom quarter of the screen; the
      // camera keeps the character above it rather than underneath.
      const ui = controllingRef.current && document.querySelector("[data-control-ui]");
      s.uiTop = ui ? ui.getBoundingClientRect().top : Infinity;
      cacheAt = now;
      stale = false;
    };
    const invalidate = () => {
      stale = true;
    };
    window.addEventListener("scroll", invalidate, { passive: true });
    window.addEventListener("resize", invalidate);
    const staleTimer = window.setInterval(invalidate, 400);

    /* -------- companion hints -------- */
    let said = new Set<string>();
    try {
      said = new Set(JSON.parse(sessionStorage.getItem(QUIPS_KEY) ?? "[]") as string[]);
    } catch {
      /* storage blocked — lines may repeat, which is harmless */
    }
    /** sections crossing the middle band of the viewport → when they entered */
    const inBand = new Map<string, number>();
    const q = {
      visible: false,
      text: "",
      shownAt: 0,
      hideAt: 0,
      hiddenAt: -Infinity,
      checkAt: 0,
      chars: 0,
      bw: 0,
      bh: 0,
      /** bubble's left edge relative to the walker, chosen when it opens */
      off: 0,
    };
    /** Nothing is said in the first seconds after load: let the page land. */
    const quietUntil = performance.now() + QUIP_WARMUP_MS;
    const io = new IntersectionObserver(
      (entries) => {
        const now = performance.now();
        for (const e of entries) {
          if (e.isIntersecting) inBand.set(e.target.id, now);
          else inBand.delete(e.target.id);
        }
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 },
    );
    SECTIONS.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    });

    // Only talk when the walker can actually be seen — not under the boot
    // screen, a dialog or any other overlay.
    const unobstructed = (x: number, y: number, W: number, H: number) => {
      const hit = document.elementFromPoint(clamp(x, 1, W - 1), clamp(y, 1, H - 1));
      return (
        !hit ||
        hit === document.body ||
        hit === document.documentElement ||
        !!hit.closest("main, footer")
      );
    };

    /** Viewport y of the bubble's top edge for a walker whose feet are at `viewY`. */
    const quipTop = (viewY: number, lift: number) => viewY - SPRITE_H - 18 - q.bh + lift;
    const quipMaxLeft = (W: number) => Math.max(10, W - 10 - q.bw);

    // A spot is clear when no coin sits under the bubble (it must never hide
    // or crowd a coin) and no overlay (popup, toast, side rail) covers it.
    const quipClear = (left: number, top: number, W: number, H: number) => {
      const right = left + q.bw;
      const bottom = top + q.bh + 8; // + the tail
      if (top < 0 || bottom > H) return false;
      const sy = window.scrollY;
      for (const c of coinSpots) {
        if (collectedRef.current.has(c.id)) continue;
        const cy = c.y - sy;
        if (
          c.x + COIN_CLEAR > left &&
          c.x - COIN_CLEAR < right &&
          cy + COIN_CLEAR > top &&
          cy - COIN_CLEAR < bottom
        ) {
          return false;
        }
      }
      return (
        unobstructed(left + 6, top + 6, W, H) &&
        unobstructed(right - 6, top + 6, W, H) &&
        unobstructed(left + 6, bottom - 10, W, H) &&
        unobstructed(right - 6, bottom - 10, W, H)
      );
    };

    /**
     * Picks where the bubble opens: centred over the walker if that is clear,
     * otherwise hanging off to one side (the tail still points at the
     * walker). Returns the left edge relative to the walker, or null.
     */
    const placeQuip = (viewY: number, lift: number, W: number, H: number) => {
      const top = quipTop(viewY, lift);
      const hi = quipMaxLeft(W);
      for (const want of [s.x - q.bw / 2, s.x - 26, s.x - q.bw + 26]) {
        const left = clamp(want, 10, hi);
        const tail = s.x - left;
        if (tail < 14 || tail > q.bw - 14) continue;
        if (quipClear(left, top, W, H)) return left - s.x;
      }
      return null;
    };

    const showQuip = (
      id: string,
      now: number,
      viewY: number,
      lift: number,
      W: number,
      H: number,
    ) => {
      if (!quipEl || !quipBox || !quipTyped || !quipRest) return;
      const quip = QUIPS[id];
      const keyless =
        !shortcutsRef.current || window.matchMedia("(pointer: coarse)").matches;
      const text = keyless && quip.alt ? quip.alt : quip.line;
      // The untyped remainder is laid out invisibly, so the bubble is its
      // final size from the first frame and never reflows while typing.
      quipTyped.textContent = "";
      quipRest.textContent = text;
      q.bw = quipBox.offsetWidth;
      q.bh = quipBox.offsetHeight;
      const off = placeQuip(viewY, lift, W, H);
      if (off === null) {
        q.checkAt = now + 1200; // nowhere clear right now; try again shortly
        return;
      }
      said.add(id);
      try {
        sessionStorage.setItem(QUIPS_KEY, JSON.stringify([...said]));
      } catch {
        /* ignore */
      }
      q.text = text;
      q.off = off;
      q.chars = 0;
      q.shownAt = now;
      q.hideAt = now + text.length * QUIP_CHAR_MS + QUIP_HOLD_MS;
      q.checkAt = now + 300;
      q.visible = true;
      positionQuip(viewY, lift, W);
      quipEl.setAttribute("data-show", "");
    };

    const positionQuip = (viewY: number, lift: number, W: number) => {
      if (!quipEl) return;
      const left = clamp(s.x + q.off, 10, quipMaxLeft(W));
      const top = quipTop(viewY, lift);
      const tailX = clamp(s.x - left, 16, Math.max(16, q.bw - 16));
      quipEl.style.transform = `translate3d(${left.toFixed(1)}px, ${top.toFixed(1)}px, 0)`;
      if (quipTail) quipTail.style.transform = `translateX(${tailX.toFixed(1)}px) rotate(45deg)`;
      if (quipBox) quipBox.style.transformOrigin = `${tailX.toFixed(1)}px 100%`;
      return { left, top };
    };

    const hideQuip = (now: number) => {
      q.visible = false;
      q.hiddenAt = now;
      quipEl?.removeAttribute("data-show");
    };

    const updateQuip = (
      now: number,
      active: boolean,
      viewY: number,
      lift: number,
      W: number,
      H: number,
    ) => {
      if (!quipEl || !quipTyped || !quipRest) return;
      if (q.visible) {
        if (active || s.asleep || now >= q.hideAt) {
          hideQuip(now);
          return;
        }
        const n = Math.min(q.text.length, Math.floor((now - q.shownAt) / QUIP_CHAR_MS));
        if (n !== q.chars) {
          if (n % 2 === 0 && q.text[n - 1] !== " ") sfx.type();
          quipTyped.textContent = q.text.slice(0, n);
          quipRest.textContent = q.text.slice(n);
          q.chars = n;
        }
        const at = positionQuip(viewY, lift, W);
        // A coin or an overlay slid under it (the page scrolled, a popup
        // arrived): bow out rather than cover it.
        if (at && now >= q.checkAt) {
          q.checkAt = now + 300;
          if (!quipClear(at.left, at.top, W, H)) hideQuip(now);
        }
        return;
      }
      if (active || s.asleep || now < q.checkAt || now < quietUntil) return;
      q.checkAt = now + 400;
      if (now - q.hiddenAt < QUIP_GAP_MS) return;
      // The most recent section to enter the band is the one being read.
      let id = "";
      let since = -Infinity;
      for (const [k, t] of inBand) {
        if (t > since) {
          id = k;
          since = t;
        }
      }
      if (!id || said.has(id) || !QUIPS[id]) return;
      const skip = QUIPS[id].skipIf;
      if (skip && hasAchievementRef.current(skip)) return;
      if (now - since < QUIP_DWELL_MS) return;
      if (!unobstructed(s.x, viewY - SPRITE_H * 0.5, W, H)) return;
      showQuip(id, now, viewY, lift, W, H);
    };

    /* -------- the loop -------- */
    const kick = () => {
      if (raf || document.hidden || pausedRef.current) return;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    };
    kickRef.current = kick;

    const onVis = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else kick();
    };
    document.addEventListener("visibilitychange", onVis);

    const loop = (now: number) => {
      raf = 0;
      // Parked while hidden or paused; `kick` restarts with a fresh clock.
      if (document.hidden || pausedRef.current) return;
      // Long gaps (a GC pause, a stalled tab) are capped so nothing teleports.
      const frameDt = clamp((now - last) / 1000, 0, 0.1);
      const dt = Math.min(frameDt, 0.033);
      last = now;

      const W = window.innerWidth;
      const H = window.innerHeight;
      const active = controllingRef.current;
      const rm = reducedRef.current;
      const k = keys.current;

      if (stale && now - cacheAt > 120) refresh(now);

      // scroll velocity feeds the ambient run animation
      const sy = window.scrollY;
      const dScroll = sy - s.lastScroll;
      s.lastScroll = sy;
      s.scrollVel = s.scrollVel * 0.85 + dScroll * 0.15;

      /** feet position in viewport space, whichever mode we are in */
      let viewY: number;
      /** downward speed at touchdown this frame, 0 if we did not land */
      let landed = 0;
      /** 1 = jump, 2 = air jump, 3 = control takeover */
      let leap = 0;
      let runPuff = false;
      let newPlatform = false;

      if (active) {
        /* -------- player controlled (document space) -------- */
        if (!s.wasActive) {
          // Hand over from the ambient walker without a teleport.
          refresh(now);
          s.y = sy + (H - FLOOR_PAD) - s.hop;
          // The ambient floor and a platform's top rarely line up to the
          // pixel; feet a few px under a floor line would start below it and
          // fall straight through. Stand on the nearest top within reach, or
          // hop up onto a ledge just above (on a phone the hero's floor sits
          // well above the bottom of the screen) rather than dropping out of
          // the section the visitor is looking at.
          let snap = SPAWN_SNAP;
          let snapY = NaN;
          let ledge = Infinity;
          for (const p of platforms) {
            if (s.x < p.x - 6 || s.x > p.x + p.w + 6) continue;
            const d = s.y - p.y; // > 0: above the feet
            if (Math.abs(d) <= snap) {
              snap = Math.abs(d);
              snapY = p.y;
            } else if (d > 0 && d <= LEDGE_REACH && d < ledge && p.y - sy > H * 0.2) {
              ledge = d;
            }
          }
          s.hop = 0;
          s.vx = 0;
          s.vy = rm ? 0 : -520; // a little "ready!" hop
          if (!Number.isNaN(snapY)) s.y = snapY;
          else if (ledge < Infinity) {
            // Reduced motion just stands it there; otherwise it leaps up.
            if (rm) s.y -= ledge;
            else s.vy = -Math.sqrt(2 * GRAVITY * (ledge + 28));
          }
          s.grounded = false;
          s.jumped = true;
          s.airJumps = 1;
          s.cut = false;
          s.jumpBuf = 0;
          s.coyote = 0;
          s.dropT = 0;
          s.sit = 0;
          s.wasActive = true;
          if (!rm) leap = 3;
        }

        // On a slow frame, run the physics in sub-steps so the character
        // still moves at real speed instead of in slow motion.
        const steps = Math.max(1, Math.ceil(frameDt / 0.034));
        const h = frameDt / steps;
        for (let step = 0; step < steps; step++) {
          const want = (k.right ? 1 : 0) - (k.left ? 1 : 0);
          s.vx = approach(s.vx, want * RUN, (s.grounded ? GROUND_ACCEL : AIR_ACCEL) * h);
          if (want !== 0) s.facing = want;

          // Buffered press, coyote time, then one air jump.
          if (s.jumpBuf > 0) {
            const coyote = !s.grounded && !s.jumped && s.coyote > 0;
            if (s.grounded || coyote) {
              s.vy = -JUMP;
              s.grounded = false;
              s.jumped = true;
              s.cut = true;
              s.riseT = 0;
              s.jumpBuf = 0;
              s.coyote = 0;
              s.stretch = 1;
              leap = 1;
              sfx.jump();
            } else if (s.airJumps > 0) {
              s.airJumps--;
              s.jumped = true;
              s.vy = -DOUBLE_JUMP;
              s.cut = true;
              s.riseT = 0;
              s.jumpBuf = 0;
              s.stretch = 1;
              s.spinT = 0;
              leap = 2;
              sfx.jump();
              sfx.whoosh();
            }
          }
          s.jumpBuf = Math.max(0, s.jumpBuf - h);
          s.coyote = Math.max(0, s.coyote - h);
          s.dropT = Math.max(0, s.dropT - h);
          s.riseT += h;
          // Variable height: let go early and the rise is cut short (after a
          // minimum rise, so even the quickest tap is a real hop).
          if (s.cut && !k.up && s.riseT >= MIN_RISE && s.vy < -JUMP_CUT) {
            s.vy = -JUMP_CUT;
            s.cut = false;
          }
          if (s.vy >= 0) s.cut = false;

          // Exact for constant acceleration, so jump height does not depend on
          // the frame rate (plain Euler loses ~15px of apex at 30fps).
          const g = s.vy > 0 ? FALL_GRAVITY : GRAVITY;
          const prevFeet = s.y;
          s.x += s.vx * h;
          s.y += s.vy * h + 0.5 * g * h * h;
          s.vy = Math.min(MAX_FALL, s.vy + g * h);

          // one-way platforms: land on the top edge only, drop through on Down
          const wasGrounded = s.grounded;
          const impact = s.vy;
          s.grounded = false;
          let support: Platform | null = null;
          if (s.vy >= 0 && !k.down) {
            for (const p of platforms) {
              if (s.x < p.x - 6 || s.x > p.x + p.w + 6) continue;
              if (p.el === s.dropEl && s.dropT > 0) continue;
              if (prevFeet <= p.y + 4 && s.y >= p.y && (!support || p.y < support.y)) {
                support = p;
              }
            }
          }
          if (support) {
            s.y = support.y;
            s.grounded = true;
            if (support.el !== s.groundEl && !landedOn.current.has(support.el)) {
              landedOn.current.add(support.el);
              newPlatform = true;
              if (landedOn.current.size === PARKOUR_GOAL) unlockRef.current("parkour");
            }
            s.groundEl = support.el;
          } else if (s.y >= s.docFloor) {
            s.y = s.docFloor;
            s.grounded = true;
            s.groundEl = null;
          } else {
            s.groundEl = null;
          }
          if (s.grounded) {
            s.vy = 0;
            s.coyote = COYOTE;
            s.jumped = false;
            s.airJumps = 1;
            s.cut = false;
            if (!wasGrounded) landed = Math.max(1, impact);
          }

          s.x = clamp(s.x, s.halfW + 4, W - s.halfW - 4);

          if (s.grounded && Math.abs(s.vx) > 260) {
            s.dustT -= h;
            if (s.dustT <= 0) {
              s.dustT = 0.11;
              runPuff = true;
            }
          } else s.dustT = 0;
        }

        // Where would the shadow fall? The nearest surface straight down.
        let ground = s.docFloor;
        for (const p of platforms) {
          if (s.x < p.x - 6 || s.x > p.x + p.w + 6) continue;
          if (p.y >= s.y - 1 && p.y < ground) ground = p.y;
        }
        s.gap = Math.max(0, ground - s.y);

        // Camera: keep the character inside a comfortable band by scrolling
        // the page, which is what makes the whole document walkable.
        viewY = s.y - sy;
        const topBand = H * 0.32;
        const botBand = Math.max(topBand + 80, Math.min(H * 0.86, s.uiTop - 28));
        // `behavior: "instant"` matters — the page sets scroll-behavior:smooth
        // for anchor links, which would animate (and fight) every frame.
        if (viewY < topBand)
          window.scrollTo({ top: s.y - topBand, behavior: "instant" });
        else if (viewY > botBand)
          window.scrollTo({ top: s.y - botBand, behavior: "instant" });
        viewY = s.y - window.scrollY;
      } else {
        /* -------- ambient (viewport space) -------- */
        if (s.wasActive) {
          // Hand back without a teleport: fall from wherever it was left.
          s.hop = Math.max(0, H - FLOOR_PAD - s.lastViewY);
          s.grounded = s.hop <= 0;
          if (s.grounded) s.vy = 0;
          s.cut = false;
          s.spinT = 1;
          s.wasActive = false;
        }
        const drift = clamp(s.scrollVel / 24, -1, 1);
        s.vx = s.asleep ? 0 : drift * RUN * 0.8;
        if (Math.abs(drift) > 0.08) s.facing = drift > 0 ? 1 : -1;
        else if (!s.asleep && now - s.pointerAt < 4000 && Math.abs(s.pointerX - s.x) > 70) {
          // Idle and a mouse is about: keep an eye on it.
          s.facing = s.pointerX > s.x ? 1 : -1;
        }
        s.x += s.vx * dt;

        if (s.x > W - 40) s.x = 40;
        if (s.x < 40) s.x = W - 40;

        // occasional idle hop
        if (!s.asleep && Math.abs(drift) < 0.05 && s.grounded && now > s.idleHopAt) {
          s.idleHopAt = now + 2600 + Math.random() * 4200;
          if (!rm) {
            s.vy = -JUMP * 0.42;
            s.grounded = false;
          }
        }
        s.hop -= s.vy * dt + 0.5 * GRAVITY * dt * dt;
        s.vy += GRAVITY * dt;
        const impact = s.vy;
        if (s.hop <= 0) {
          if (!s.grounded) landed = impact;
          s.hop = 0;
          s.vy = 0;
          s.grounded = true;
        }
        viewY = H - FLOOR_PAD - s.hop;
        s.gap = s.hop;
      }
      s.lastViewY = viewY;

      /* -------- juice -------- */
      if (landed > 0) {
        s.landFlash = clamp(landed / 1300, 0.35, 1);
        if (active) sfx.land();
      }
      if (!rm) {
        if (landed > 0 && (active || landed > 700)) {
          fx.burst(s.x, viewY, landed > 1100 ? HARD_DUST : "dust");
        }
        if (leap === 1) fx.burst(s.x, viewY, JUMP_DUST);
        if (leap >= 2) {
          fx.burst(s.x, viewY, RING);
          fx.burst(s.x, viewY, RING_SPARKS);
        }
        if (runPuff) fx.burst(s.x - s.facing * 12, viewY - 2, runDust(s.facing));
        if (newPlatform && !parkourDoneRef.current) {
          const n = Math.min(landedOn.current.size, PARKOUR_GOAL);
          if (plusCountRef.current) plusCountRef.current.textContent = `${n}/${PARKOUR_GOAL}`;
          pop(plusRef.current, "plus");
          sfx.menuMove();
        }
      }

      /* -------- coin pickups -------- */
      const scrollNow = window.scrollY;
      const reachY = viewY - SPRITE_H * 0.45;
      for (const c of coinSpots) {
        if (collectedRef.current.has(c.id)) continue;
        const cy = c.y - scrollNow;
        if (Math.abs(c.x - s.x) < 46 && Math.abs(cy - reachY) < 56) {
          collectedRef.current.add(c.id);
          collectRef.current(c.id, { x: c.x, y: cy });
        }
      }

      /* -------- render -------- */
      const moving = Math.abs(s.vx) > 30;
      s.phase += dt * (moving ? 13 : 4.2);
      s.sit = approach(s.sit, s.asleep && !active ? 1 : 0, dt / (s.asleep ? 0.35 : 0.15));

      let lift = 0;
      let tilt = 0;
      let spin = 0;
      let sx = 1;
      let sy2 = 1;
      if (!rm) {
        const airborne = !s.grounded;
        if (!airborne) {
          if (moving) {
            // a step bounce: feet push off the floor twice per cycle
            lift = -Math.abs(Math.sin(s.phase)) * 7;
            const step = Math.abs(Math.cos(s.phase));
            sy2 = 1 - 0.035 * step;
            sx = 1 + 0.02 * step;
          } else {
            // breathing
            const b = Math.sin(s.phase) * (1 - s.sit);
            sy2 = 1 + 0.022 * b;
            sx = 1 - 0.012 * b;
          }
        }
        tilt = moving
          ? s.facing * Math.min(8, Math.abs(s.vx) / 55)
          : Math.sin(s.phase * 0.5) * 1.5 * (1 - s.sit);
        if (airborne) {
          const v = clamp(s.vy / 900, -1, 1);
          sy2 = 1 + Math.abs(v) * 0.12 * (v < 0 ? 1 : 0.6);
          sx = 1 / sy2;
          tilt = (s.vx / RUN) * 6;
        }
        if (s.stretch > 0) {
          sy2 *= 1 + 0.16 * s.stretch;
          sx *= 1 - 0.1 * s.stretch;
          s.stretch = Math.max(0, s.stretch - dt * 7);
        }
        if (s.landFlash > 0) {
          const f = s.landFlash;
          sy2 *= 1 - 0.24 * f;
          sx *= 1 + 0.24 * f;
        }
        if (s.sit > 0) {
          sy2 *= 1 - 0.14 * s.sit;
          sx *= 1 + 0.07 * s.sit;
          tilt += s.facing * 7 * s.sit; // head nods forward
        }
        if (s.spinT < 1) {
          s.spinT = Math.min(1, s.spinT + dt / 0.36);
          spin = easeOutCubic(s.spinT) * 360 * s.facing;
        }
        if (s.spawnT < 1) {
          s.spawnT = Math.min(1, s.spawnT + dt / 0.42);
          const p = Math.max(0.01, easeOutBack(s.spawnT));
          sx *= p;
          sy2 *= p;
        }
        // A quick paper-flip when turning around.
        s.face = approach(s.face, s.facing, dt * 14);
      } else {
        s.face = s.facing;
        s.stretch = 0;
        s.spinT = 1;
        s.spawnT = 1;
      }
      if (s.landFlash > 0) s.landFlash = Math.max(0, s.landFlash - dt * 5);

      const half = SPRITE_H / 2;
      wrap.style.transform = `translate3d(${s.x.toFixed(2)}px, ${viewY.toFixed(2)}px, 0)`;
      // Origin is the feet: squash keeps them planted, the lean pivots on
      // them, and the flip spins around the body's centre.
      body.style.transform =
        `translate(-50%, ${(-SPRITE_H + lift).toFixed(2)}px) rotate(${tilt.toFixed(2)}deg) ` +
        `translate(0, ${-half}px) rotate(${spin.toFixed(1)}deg) translate(0, ${half}px) ` +
        `scale(${(sx * s.face).toFixed(3)}, ${sy2.toFixed(3)})`;

      const shadowScale = clamp(1 - s.gap / 260, 0.3, 1);
      shadow.style.transform = `translate(-50%, ${(s.gap - 6).toFixed(1)}px) scale(${shadowScale.toFixed(3)}, ${(shadowScale * 0.5).toFixed(3)})`;
      shadow.style.opacity = String(s.gap > 520 ? 0 : 0.5 * shadowScale);

      dust.style.opacity = String(rm ? 0 : s.landFlash);
      dust.style.transform = `translate(-50%, -4px) scale(${(1 + (1 - s.landFlash) * 1.6).toFixed(3)})`;

      if (rm) {
        if (q.visible) hideQuip(now);
      } else updateQuip(now, active, viewY, lift, W, H);

      // Sat down asleep: nothing left to animate per frame (the breathing and
      // the Z's are CSS). Park until something wakes us.
      if (s.asleep && !active && s.sit >= 1 && s.grounded) return;
      raf = requestAnimationFrame(loop);
    };

    kick();
    return () => {
      cancelAnimationFrame(raf);
      raf = 0;
      kickRef.current = () => {};
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("scroll", invalidate);
      window.removeEventListener("resize", invalidate);
      window.clearInterval(staleTimer);
      io.disconnect();
    };
  }, [show]);

  if (!show) return null;

  const ch = byId(characterId);
  const w = Math.round((ch.w / ch.h) * SPRITE_H);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-40 overflow-hidden"
    >
      <div ref={wrapRef} className="absolute left-0 top-0 will-change-transform">
        <div
          ref={shadowRef}
          className="absolute left-0 top-0 h-6 w-20 rounded-[50%] bg-black blur-[6px]"
        />
        <div
          ref={dustRef}
          className="absolute left-0 top-0 h-3 w-24 rounded-[50%] border border-cyan/50 opacity-0"
        />
        <div
          ref={bodyRef}
          className="absolute left-0 top-0 will-change-transform"
          style={{ width: w, height: SPRITE_H, transformOrigin: "50% 100%" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={spriteSrc(ch.id)}
            alt=""
            width={w}
            height={SPRITE_H}
            className="sprite player-sprite block"
            style={{ width: w, height: SPRITE_H, maxWidth: "none" }}
            draggable={false}
          />
        </div>

        {/* parkour "+1", startled "!", and the snore */}
        <span ref={plusRef} className="player-pop player-plus">
          +1
          <small ref={plusCountRef} />
        </span>
        <span ref={bangRef} className="player-pop player-bang">
          !
        </span>
        <span className="player-zzz">
          <i>Z</i>
          <i>z</i>
          <i>z</i>
        </span>
      </div>

      {/* companion hint — clamped to the viewport, so not inside the walker */}
      <div ref={quipRef} className="player-quip pointer-events-none absolute left-0 top-0">
        <div
          ref={quipBoxRef}
          className="player-quip-box relative w-max max-w-[min(296px,calc(100vw-128px))] rounded-lg border border-edge bg-abyss px-3 pb-2 pt-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.55)]"
        >
          <p className="mono flex items-center gap-1.5 text-[9px] uppercase tracking-[0.2em] text-muted">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: ACCENT_HEX[ch.accent] }}
            />
            {ch.name}
          </p>
          <p className="mt-0.5 text-balance text-[13px] leading-snug text-ink">
            <span ref={quipTypedRef} />
            <span ref={quipRestRef} className="opacity-0" />
          </p>
          <span
            ref={quipTailRef}
            className="player-quip-tail absolute -bottom-[6px] left-[-6px] h-3 w-3 border-b border-r border-edge bg-abyss"
          />
        </div>
      </div>

      <style>{`
.player-pop{position:absolute;left:0;top:${-SPRITE_H - 40}px;width:80px;margin-left:-40px;text-align:center;opacity:0;white-space:nowrap}
.player-plus{font-family:var(--font-display);font-size:22px;line-height:1;color:var(--color-lime);text-shadow:0 0 12px rgba(200,255,46,.55),0 2px 0 #06060a}
.player-plus small{display:block;margin-top:3px;font-family:var(--font-mono);font-size:9px;letter-spacing:.2em;color:var(--color-ink)}
.player-bang{font-family:var(--font-display);font-size:34px;line-height:1;color:var(--color-amber);text-shadow:0 0 14px rgba(255,176,32,.6),0 2px 0 #06060a}
.player-zzz{position:absolute;left:12px;top:${-SPRITE_H - 6}px;display:none;font-family:var(--font-display);font-size:18px;line-height:1;color:var(--color-cyan);text-shadow:0 0 10px rgba(0,229,255,.5)}
[data-sleep] .player-zzz{display:block}
.player-zzz i{position:absolute;left:0;bottom:0;font-style:normal;opacity:0}
.player-quip-box{scale:.6;opacity:0;transition:scale .28s var(--ease-pop),opacity .18s ease}
.player-quip[data-show] .player-quip-box{scale:1;opacity:1}
@media (prefers-reduced-motion: no-preference){
  .player-zzz i{animation:player-zzz 2.4s ease-out infinite}
  .player-zzz i:nth-child(2){animation-delay:.8s}
  .player-zzz i:nth-child(3){animation-delay:1.6s}
  [data-sleep] .player-sprite{transform-origin:50% 100%;animation:player-breathe 2.8s ease-in-out infinite}
}
@keyframes player-zzz{0%{opacity:0;transform:translate(0,0) scale(.55) rotate(-10deg)}20%{opacity:1}100%{opacity:0;transform:translate(28px,-48px) scale(1.3) rotate(12deg)}}
@keyframes player-breathe{0%,100%{scale:1 1}50%{scale:1.025 .965}}
`}</style>
    </div>
  );
}
