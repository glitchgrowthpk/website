"use client";

import { useEffect, useRef, useState } from "react";
import { PIPELINE, STRENGTHS } from "@/data/studio";
import { spriteSrc } from "@/data/characters";
import { useGame } from "@/lib/game-state";
import { useReducedMotion } from "@/lib/hooks";
import { sfx } from "@/lib/audio";
import { fx } from "@/lib/fx";
import { Section, SectionHead } from "./Section";
import { Coin } from "./GameUi";

const PHASE_COLOR: Record<string, string> = {
  BUILD: "#00e5ff",
  VALIDATE: "#ffb020",
  GROW: "#c8ff2e",
};

const ACCENT: Record<string, string> = {
  cyan: "#00e5ff",
  magenta: "#ff2d77",
  lime: "#c8ff2e",
};

const NODES = PIPELINE.length;

/**
 * Scroll window for the level map, as fractions of the viewport height: the
 * fill starts when the track's top reaches START and is full once the track's
 * bottom has risen to END.
 */
const START = 0.85;
const END = 0.5;

/** Rider sprite height (px) — matches the h-11 on the image. */
const RIDER_H = 44;

/** Half the rider's stance (px): how far either foot reaches from its centre. */
const FOOT = 8;

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Scroll progress through the track for a given bounding rect. */
const progressFor = (r: DOMRect, H: number) =>
  clamp01((H * START - r.top) / (H * (START - END) + r.height));

/**
 * Layout position of `el` inside `root`, from offsets rather than bounding
 * rects so hover lifts and reveal animations never skew the measurement.
 */
function offsetWithin(el: HTMLElement, root: HTMLElement) {
  let x = 0;
  let y = 0;
  let n: HTMLElement | null = el;
  while (n && n !== root) {
    x += n.offsetLeft;
    y += n.offsetTop;
    n = n.offsetParent as HTMLElement | null;
  }
  return { x, y };
}

interface Geometry {
  /** lg+: the rail runs left to right. Below lg it runs down the left edge. */
  horizontal: boolean;
  /** Rail start along its axis, px from the track's corner. */
  a0: number;
  len: number;
  /** Rail centre line on the other axis. */
  cross: number;
  /** Node centres along the axis (px) and as 0-1 fractions of the rail. */
  centres: number[];
  fracs: number[];
  /** Node radius — the rider arcs over each node on the horizontal map. */
  radius: number;
}

type RiderState = "idle" | "run" | "air";

/* ------------------------------------------------------------------ stamp */

function Stamp({
  children,
  hex,
  className = "",
  big = false,
}: {
  children: React.ReactNode;
  hex: string;
  className?: string;
  big?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`pipeline-stamp mono pointer-events-none inline-flex items-center gap-1 whitespace-nowrap rounded-[5px] border-[1.5px] bg-void/85 font-bold uppercase leading-none ${
        big
          ? "px-2.5 py-1.5 text-[11px] tracking-[0.2em]"
          : "px-1.5 py-1 text-[9px] tracking-[0.16em]"
      } ${className}`}
      style={{
        color: hex,
        borderColor: hex,
        boxShadow: `0 0 18px -6px ${hex}, inset 0 0 10px -6px ${hex}`,
      }}
    >
      <svg
        width={big ? 12 : 10}
        height={big ? 12 : 10}
        viewBox="0 0 10 10"
        shapeRendering="crispEdges"
        fill="currentColor"
      >
        {/* pixel check mark */}
        <rect x="0" y="5" width="2" height="2" />
        <rect x="2" y="7" width="2" height="2" />
        <rect x="4" y="5" width="2" height="2" />
        <rect x="6" y="3" width="2" height="2" />
        <rect x="8" y="1" width="2" height="2" />
      </svg>
      {children}
    </span>
  );
}

/* -------------------------------------------------------------- strengths */

function StrengthCard({
  s,
  index,
  reduced,
}: {
  s: (typeof STRENGTHS)[number];
  index: number;
  reduced: boolean;
}) {
  const hex = ACCENT[s.accent];
  const cardRef = useRef<HTMLElement>(null);
  const spriteRef = useRef<HTMLImageElement>(null);
  const slashRef = useRef<SVGSVGElement>(null);
  const timer = useRef(0);

  useEffect(() => {
    const t = timer;
    return () => window.clearTimeout(t.current);
  }, []);

  /** Wind up, lunge at the card title, slash, land. Ignored mid-swing. */
  const attack = () => {
    const card = cardRef.current;
    const sprite = spriteRef.current;
    const slash = slashRef.current;
    if (!card || !sprite || !slash || card.dataset.attack !== undefined) return;
    card.dataset.attack = "";
    sfx.whoosh();

    const done = () => {
      delete card.dataset.attack;
    };
    if (reduced || typeof sprite.animate !== "function") {
      timer.current = window.setTimeout(done, 650);
      return;
    }

    sprite
      .animate(
        [
          { transform: "translate(0, 0) rotate(0deg) scale(1, 1)" },
          { transform: "translate(7px, 3px) rotate(8deg) scale(1.1, 0.88)", offset: 0.2 },
          { transform: "translate(-26px, -18px) rotate(-14deg) scale(0.92, 1.1)", offset: 0.46 },
          { transform: "translate(-16px, 0) rotate(-5deg) scale(1.12, 0.9)", offset: 0.64 },
          { transform: "translate(-4px, 0) rotate(0deg) scale(0.98, 1.02)", offset: 0.82 },
          { transform: "translate(0, 0) rotate(0deg) scale(1, 1)" },
        ],
        { duration: 640, easing: "cubic-bezier(0.3, 0.7, 0.2, 1)" },
      )
      .finished.then(done, done);

    slash.animate(
      [
        { opacity: 0, transform: "rotate(-55deg) scale(0.5)" },
        { opacity: 0, transform: "rotate(-55deg) scale(0.5)", offset: 0.3 },
        { opacity: 1, transform: "rotate(-8deg) scale(1)", offset: 0.48 },
        { opacity: 0, transform: "rotate(22deg) scale(1.18)" },
      ],
      { duration: 640, easing: "ease-out" },
    );

    // Sparks land on the frame where the blade connects.
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      fx.burstAt(slash, {
        count: 12,
        colors: [hex, "#ffffff"],
        speed: 300,
        angle: Math.PI,
        spread: Math.PI * 0.9,
        gravity: 420,
        size: 3,
        life: 0.45,
        shape: "spark",
      });
    }, 300);
  };

  return (
    <article
      ref={cardRef}
      data-solid=""
      data-reveal=""
      style={{ ["--reveal-delay" as string]: `${index * 110}ms` }}
      onPointerEnter={(e) => e.pointerType === "mouse" && attack()}
      // A tap, not pointerdown: a finger that lands here to scroll the page
      // shouldn't swing the sword every time.
      onClick={attack}
      className="panel group relative flex flex-col overflow-hidden p-5 transition-[translate,border-color] duration-300 hover:-translate-y-1.5 sm:p-6"
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[2px] transition-[height] duration-300 group-hover:h-[3px] group-data-[attack]:h-[3px]"
        style={{ background: hex }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-40 group-data-[attack]:opacity-60"
        style={{ background: hex }}
      />

      <div className="relative flex items-start justify-between gap-3">
        <span
          className="font-display text-4xl leading-none opacity-30 transition-opacity duration-300 group-hover:opacity-60"
          style={{ color: hex }}
        >
          {s.n}
        </span>
        <svg
          ref={slashRef}
          aria-hidden="true"
          viewBox="0 0 64 64"
          className="pointer-events-none absolute right-12 top-0 h-16 w-16 opacity-0"
          style={{ filter: `drop-shadow(0 0 6px ${hex})` }}
        >
          <path
            d="M10 54 C 16 30, 30 12, 58 6"
            fill="none"
            stroke={hex}
            strokeWidth="5"
            strokeLinecap="round"
          />
          <path
            d="M20 56 C 26 38, 38 24, 60 18"
            fill="none"
            stroke="#ffffff"
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.8"
          />
        </svg>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={spriteRef}
          src={spriteSrc(s.char)}
          alt=""
          loading="lazy"
          className="sprite relative h-16 w-auto origin-bottom opacity-80 transition-[translate,scale,opacity] duration-300 group-hover:-translate-y-1 group-hover:scale-110 group-hover:opacity-100"
        />
      </div>

      <h4 className="mt-3 font-display text-xl leading-tight">{s.title}</h4>
      <p className="mt-2.5 flex-1 text-[13.5px] leading-relaxed text-muted">
        {s.body}
      </p>

      <div className="mt-4 border-t border-edge/60 pt-3">
        <p className="label mb-2">Proof</p>
        <ul className="flex flex-wrap gap-1.5">
          {s.proof.map((p) => (
            <li
              key={p}
              className="mono rounded border border-edge bg-panel-2/60 px-2 py-1 text-[10px] uppercase tracking-[0.1em] text-muted"
            >
              {p}
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

/* --------------------------------------------------------------- section */

export default function Pipeline() {
  const { characterId, unlock, paused } = useGame();
  const reduced = useReducedMotion();

  /** How many nodes the rider has cleared. Nodes clear in order, so a count is enough. */
  const [cleared, setCleared] = useState(0);
  /** Stage under the pointer — its node and card light up together. */
  const [hot, setHot] = useState<number | null>(null);

  const trackRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const riderRef = useRef<HTMLDivElement>(null);
  const faceRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLSpanElement>(null);
  const liveRef = useRef<HTMLParagraphElement>(null);
  const nodeRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const dotRefs = useRef<(HTMLSpanElement | null)[]>([]);

  /** Animation state that must survive effect re-runs but never re-render. */
  const st = useRef({ cur: 0, max: 0, facing: 1, cleared: 0, runUntil: 0, h: 0 });
  const pausedRef = useRef(paused);
  const kickRef = useRef<() => void>(() => {});

  useEffect(() => {
    pausedRef.current = paused;
    if (!paused) kickRef.current();
  }, [paused]);

  useEffect(() => {
    const track = trackRef.current;
    const rail = railRef.current;
    const tip = tipRef.current;
    const rider = riderRef.current;
    const face = faceRef.current;
    const shadow = shadowRef.current;
    if (!track || !rail || !tip || !rider || !face || !shadow) return;

    const s = st.current;

    const measure = (): Geometry => {
      const horizontal = rail.offsetWidth >= rail.offsetHeight;
      const o = offsetWithin(rail, track);
      const a0 = horizontal ? o.x : o.y;
      const len = Math.max(1, horizontal ? rail.offsetWidth : rail.offsetHeight);
      const cross = horizontal
        ? o.y + rail.offsetHeight / 2
        : o.x + rail.offsetWidth / 2;
      const els = (horizontal ? nodeRefs : dotRefs).current;
      const centres = els.map((el) => {
        if (!el) return a0 + len;
        const p = offsetWithin(el, track);
        return horizontal ? p.x + el.offsetWidth / 2 : p.y + el.offsetHeight / 2;
      });
      return {
        horizontal,
        a0,
        len,
        cross,
        centres,
        fracs: centres.map((c) => clamp01((c - a0) / len)),
        radius: horizontal ? (els[0]?.offsetWidth ?? 76) / 2 : 0,
      };
    };

    let g = measure();

    /** Height of the hop arc over whichever node the rider is crossing. */
    const arc = (x: number) => {
      let h = 0;
      const reach = g.radius + 18;
      for (const c of g.centres) {
        const d = Math.abs(x - c) / reach;
        if (d < 1) h = Math.max(h, (g.radius + 6) * (1 - d * d));
      }
      return h;
    };

    /** Top of the node circle under either foot — what the rider stands on. */
    const surface = (x: number) => {
      let h = 0;
      const r = g.radius;
      for (const c of g.centres) {
        const d = Math.max(0, Math.abs(x - c) - FOOT);
        if (d < r) h = Math.max(h, Math.sqrt(r * r - d * d));
      }
      return h;
    };

    /**
     * Write every moving part for progress p. DOM writes only. `dt` eases the
     * hop height (0 snaps it); returns false while the rider is still in the
     * air, so the loop keeps running until it has landed.
     */
    const place = (p: number, max: number, state: RiderState, dt = 0) => {
      rail.style.setProperty("--p", p.toFixed(4));
      rail.style.setProperty("--m", max.toFixed(4));
      const along = g.a0 + p * g.len;
      tip.style.opacity = p > 0.003 ? "1" : "0";
      face.style.scale = `${s.facing} 1`;
      rider.dataset.axis = g.horizontal ? "x" : "y";
      rider.dataset.ready = "";

      if (!g.horizontal) {
        const y = Math.min(g.a0 + g.len, Math.max(g.a0, along));
        rider.style.transform = `translate3d(${g.cross}px, ${y + RIDER_H / 2}px, 0)`;
        shadow.style.opacity = "0";
        tip.style.transform = `translate3d(${g.cross}px, ${along}px, 0)`;
        rider.dataset.state = state;
        s.h = 0;
        return true;
      }

      const x = Math.min(g.a0 + g.len - 14, Math.max(g.a0 + 6, along));
      const floor = surface(x);
      // Running arcs over each node; stopping drops the rider onto whatever
      // is under its feet, so it never idles in mid-air.
      const goal = state === "run" ? Math.max(floor, arc(x)) : floor;
      if (dt > 0) {
        const k = goal > s.h ? 26 : 14;
        s.h += (goal - s.h) * (1 - Math.exp(-dt * k));
        if (Math.abs(goal - s.h) < 0.3) s.h = goal;
      } else {
        s.h = goal;
      }
      s.h = Math.max(s.h, floor);
      const air = s.h - floor;

      rider.style.transform = `translate3d(${x}px, ${g.cross - s.h}px, 0)`;
      shadow.style.transform = `translate3d(${x}px, ${g.cross - floor}px, 0) scale(${Math.max(0.4, 1 - air / 50)})`;
      shadow.style.opacity = String(Math.max(0, 1 - air / 20));
      tip.style.transform = `translate3d(${along}px, ${g.cross}px, 0)`;
      rider.dataset.state = air > 4 ? "air" : state;
      return s.h === goal;
    };

    const announce = (msg: string) => {
      const live = liveRef.current;
      if (live && live.textContent !== msg) live.textContent = msg;
    };

    /* ---------- reduced motion: the finished map, no movement ---------- */

    // The hook reports false on the first pass; read the query directly so a
    // reduced-motion visitor never gets a frame of the animated map.
    if (reduced || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const apply = () => {
        g = measure();
        place(1, 1, "idle");
      };
      apply();
      let done = false;
      const onScroll = () => {
        if (done) return;
        const H = window.innerHeight;
        const r = track.getBoundingClientRect();
        // Only while the map is on screen: jumping past it doesn't count.
        if (r.bottom < 0 || r.top > H) return;
        const p = progressFor(r, H);
        if (p >= g.fracs[NODES - 1]) {
          done = true;
          unlock("pipeline");
          announce("Level map complete.");
        }
      };
      onScroll();
      const ro = new ResizeObserver(apply);
      ro.observe(track);
      window.addEventListener("scroll", onScroll, { passive: true });
      return () => {
        ro.disconnect();
        window.removeEventListener("scroll", onScroll);
      };
    }

    /* ---------- animated map ---------- */

    const clearUpTo = (n: number) => {
      const from = s.cleared;
      s.cleared = n;
      const els = (g.horizontal ? nodeRefs : dotRefs).current;
      for (let i = from; i < n; i++) {
        const hex = PHASE_COLOR[PIPELINE[i].phase];
        fx.burstAt(els[i], {
          count: i === NODES - 1 ? 22 : 12,
          colors: [hex, "#ffffff"],
          speed: i === NODES - 1 ? 340 : 240,
          gravity: 520,
          size: 3,
          life: 0.6,
        });
      }
      // A rising arpeggio as the rider works its way along the map.
      sfx.match((n - 1) * 2);
      setCleared(n);
      if (n === NODES) {
        unlock("pipeline");
        announce("Level map complete.");
      }
    };

    let raf = 0;
    let last = 0;
    /** Kept by an IntersectionObserver so scrolling elsewhere costs nothing. */
    let onScreen = false;

    const frame = (now: number) => {
      raf = 0;
      if (pausedRef.current || document.hidden) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;

      // read
      const H = window.innerHeight;
      const r = track.getBoundingClientRect();
      // Off screen: freeze. The next scroll that brings it back resumes,
      // so a visitor who jumps past the map still sees the rider catch up.
      if (r.bottom < -60 || r.top > H + 60) {
        place(s.cur, s.max, "idle");
        return;
      }
      const target = progressFor(r, H);

      // integrate
      const prev = s.cur;
      s.cur += (target - s.cur) * (1 - Math.exp(-dt * 9));
      if (Math.abs(target - s.cur) < 0.0005) s.cur = target;
      s.max = Math.max(s.max, s.cur);
      const v = (s.cur - prev) / dt;
      if (Math.abs(v) > 0.012) {
        s.facing = v > 0 ? 1 : -1;
        s.runUntil = now + 140;
      }
      const running = now < s.runUntil;

      // write
      const landed = place(s.cur, s.max, running ? "run" : "idle", dt);

      let n = s.cleared;
      while (n < NODES && s.cur >= g.fracs[n] - 0.001) n++;
      if (n > s.cleared) clearUpTo(n);

      if (s.cur !== target || running || !landed) raf = requestAnimationFrame(frame);
    };

    const kick = () => {
      if (raf || !onScreen || pausedRef.current || document.hidden) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    kickRef.current = kick;

    const onResize = () => {
      g = measure();
      place(s.cur, s.max, "idle");
      kick();
    };

    place(s.cur, s.max, "idle");

    const io = new IntersectionObserver(
      ([e]) => {
        onScreen = e.isIntersecting;
        kick();
      },
      { rootMargin: "60px 0px" },
    );
    io.observe(track);
    const ro = new ResizeObserver(onResize);
    ro.observe(track);
    window.addEventListener("scroll", kick, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    document.addEventListener("visibilitychange", kick);
    return () => {
      cancelAnimationFrame(raf);
      kickRef.current = () => {};
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("scroll", kick);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", kick);
    };
  }, [reduced, unlock]);

  const shown = reduced ? NODES : cleared;
  const complete = shown === NODES;

  const onEnter = (i: number) => (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") setHot(i);
  };
  const onLeave = (i: number) => (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") setHot((h) => (h === i ? null : h));
  };
  // Touch has no hover: a tap (a click, so scrolling past doesn't count)
  // highlights the stage until another is tapped.
  const onTap = (i: number) => () => setHot(i);

  return (
    <Section id="pipeline">
      <style>{PIPELINE_CSS}</style>
      <SectionHead
        index="06"
        kicker="How we build"
        title="THE LEVEL MAP"
        accent="lime"
        lead="Five stages from an idea to a live title. Nothing gets scaled until the soft-launch numbers earn it."
      />

      {/* ---------------- stage track ---------------- */}
      <div ref={trackRef} className="relative pb-16 lg:pb-0">
        <Coin
          id="pipeline"
          label="the pipeline track"
          className="bottom-3 right-1 lg:-top-12 lg:bottom-auto lg:right-[9%]"
        />

        {/* rail: explored trail (furthest reached) under the live fill */}
        <div
          ref={railRef}
          aria-hidden="true"
          className="absolute bottom-9 left-[21px] top-[30px] w-[2px] rounded-full bg-panel-2 lg:inset-x-0 lg:bottom-auto lg:top-[37px] lg:h-[2px] lg:w-auto"
        >
          <span className="pipeline-trail absolute inset-0 rounded-full bg-gradient-to-b from-cyan via-amber to-lime opacity-25 lg:bg-gradient-to-r" />
          <span className="pipeline-fill absolute inset-0 rounded-full bg-gradient-to-b from-cyan via-amber to-lime lg:bg-gradient-to-r" />
        </div>

        {/* glowing tip of the fill */}
        <span
          ref={tipRef}
          aria-hidden="true"
          className="pipeline-tip pointer-events-none absolute left-0 top-0 z-[2] -ml-[5px] -mt-[5px] h-2.5 w-2.5 rounded-full bg-white opacity-0"
        />

        <ol className="relative grid gap-3 lg:grid-cols-5 lg:gap-4">
          {PIPELINE.map((p, i) => {
            const hex = PHASE_COLOR[p.phase];
            const lit = i < shown;
            const isHot = hot === i;
            return (
              <li
                key={p.n}
                data-reveal=""
                style={{ ["--reveal-delay" as string]: `${i * 90}ms` }}
                onPointerEnter={onEnter(i)}
                onPointerLeave={onLeave(i)}
                onClick={onTap(i)}
                className="relative flex flex-col pl-12 lg:pl-0"
              >
                {/* node on the vertical rail (below lg) */}
                <span
                  ref={(el) => {
                    dotRefs.current[i] = el;
                  }}
                  aria-hidden="true"
                  data-lit={lit ? "" : undefined}
                  className="pipeline-node absolute left-[13px] top-[21px] z-[1] h-[18px] w-[18px] rounded-full border-2 bg-void transition-[border-color,box-shadow,background-color,scale] duration-300 lg:hidden"
                  style={{
                    borderColor: lit || isHot ? hex : "#2a2a3d",
                    background: lit ? `${hex}33` : undefined,
                    boxShadow: lit ? `0 0 14px -2px ${hex}` : "none",
                    scale: isHot ? "1.25" : undefined,
                  }}
                />

                {/* node on the horizontal rail (lg+) */}
                <div className="mb-4 hidden lg:block">
                  <span
                    ref={(el) => {
                      nodeRefs.current[i] = el;
                    }}
                    data-solid=""
                    data-lit={lit ? "" : undefined}
                    className="pipeline-node relative grid h-[76px] w-[76px] place-items-center rounded-full border-2 bg-void font-display text-xl transition-[border-color,color,box-shadow,scale,background-color] duration-300"
                    style={{
                      borderColor: lit || isHot ? hex : "#2a2a3d",
                      color: lit || isHot ? hex : "#8a8fa3",
                      background: isHot ? `${hex}14` : undefined,
                      boxShadow: lit
                        ? `0 0 ${isHot ? 34 : 26}px -8px ${hex}${isHot ? `, inset 0 0 18px -8px ${hex}` : ""}`
                        : "none",
                      scale: isHot ? "1.08" : undefined,
                    }}
                  >
                    {p.n}
                  </span>
                </div>

                <div
                  data-solid=""
                  className="panel relative flex-1 p-4 transition-[translate,border-color,box-shadow] duration-300 hover:-translate-y-1"
                  style={{
                    borderColor: isHot ? hex : lit ? `${hex}55` : undefined,
                    boxShadow: isHot ? `0 12px 34px -18px ${hex}` : undefined,
                  }}
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span className="font-display text-lg lg:hidden">{p.n}</span>
                    <span
                      className="mono rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em]"
                      style={{
                        color: hex,
                        borderColor: `${hex}55`,
                        background: `${hex}12`,
                      }}
                    >
                      {p.phase}
                    </span>
                  </div>
                  <h3 className="font-display text-lg leading-tight">{p.stage}</h3>
                  <p className="mt-2 text-[13px] leading-relaxed text-muted">
                    {p.body}
                  </p>
                  {lit && (
                    <Stamp hex={hex} className="absolute right-3 top-3 -rotate-[7deg]">
                      Cleared
                    </Stamp>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        {complete && (
          <Stamp
            hex="#c8ff2e"
            big
            className="absolute bottom-2 left-12 -rotate-[4deg] lg:-bottom-12 lg:left-auto lg:right-1"
          >
            Map complete
          </Stamp>
        )}

        {/* the visitor's fighter riding the tip */}
        <span
          ref={shadowRef}
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 z-[3] -ml-3 -mt-[3px] h-1.5 w-6 rounded-[50%] bg-black/60 opacity-0 blur-[2px]"
        />
        <div
          ref={riderRef}
          aria-hidden="true"
          className="pipeline-rider pointer-events-none absolute left-0 top-0 z-[4]"
        >
          <div ref={faceRef} className="absolute left-0 top-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={spriteSrc(characterId)}
              alt=""
              className="pipeline-rider-img sprite absolute bottom-0 left-0 h-11 w-auto max-w-none -translate-x-1/2"
            />
          </div>
        </div>

        <p ref={liveRef} aria-live="polite" className="sr-only" />
      </div>

      {/* ---------------- strengths ---------------- */}
      <div className="mt-20 sm:mt-24">
        <div className="mb-8 flex items-center gap-3">
          <span className="h-3 w-1.5 rounded-full bg-violet" />
          <h3 className="font-display text-[clamp(1.5rem,3.6vw,2.2rem)] leading-none">
            WHERE THE PORTFOLIO IS DEEPEST
          </h3>
        </div>

        <div className="relative grid gap-3 sm:gap-4 lg:grid-cols-3">
          <Coin
            id="strengths"
            label="the strengths cards"
            className="-top-5 right-4 lg:right-[calc(33.333%_+_1.5rem)]"
          />
          {STRENGTHS.map((s, i) => (
            <StrengthCard key={s.n} s={s} index={i} reduced={reduced} />
          ))}
        </div>
      </div>
    </Section>
  );
}

const PIPELINE_CSS = `
.pipeline-fill { clip-path: inset(0 0 calc((1 - var(--p, 0)) * 100%) 0); }
.pipeline-trail { clip-path: inset(0 0 calc((1 - var(--m, 0)) * 100%) 0); }
@media (min-width: 64rem) {
  .pipeline-fill { clip-path: inset(0 calc((1 - var(--p, 0)) * 100%) 0 0); }
  .pipeline-trail { clip-path: inset(0 calc((1 - var(--m, 0)) * 100%) 0 0); }
}
.pipeline-tip {
  box-shadow: 0 0 10px 3px rgba(255, 255, 255, 0.55), 0 0 22px 6px rgba(200, 255, 46, 0.35);
  transition: opacity 0.2s;
}
.pipeline-rider:not([data-ready]) { visibility: hidden; }
.pipeline-rider-img { transform-origin: 50% 100%; }

@media (prefers-reduced-motion: no-preference) {
  .pipeline-rider[data-state="run"] .pipeline-rider-img {
    animation: pipeline-run 0.34s linear infinite;
  }
  .pipeline-rider[data-axis="y"][data-state="run"] .pipeline-rider-img {
    animation: pipeline-slide 0.3s ease-in-out infinite;
  }
  .pipeline-rider[data-state="air"] .pipeline-rider-img {
    transform: rotate(-6deg) scale(0.94, 1.08);
    transition: transform 0.12s;
  }
  .pipeline-rider:not([data-state="run"]):not([data-state="air"]) .pipeline-rider-img {
    animation: pipeline-idle 1.9s ease-in-out infinite;
  }
  .pipeline-node[data-lit] { animation: pipeline-node-pop 0.55s var(--ease-pop); }
  .pipeline-stamp { animation: pipeline-stamp 0.42s cubic-bezier(0.2, 1.4, 0.4, 1) backwards; }
}

@keyframes pipeline-run {
  0%, 100% { transform: translateY(0) rotate(5deg) scale(1.04, 0.95); }
  25%      { transform: translateY(-5px) rotate(7deg) scale(0.97, 1.04); }
  50%      { transform: translateY(0) rotate(5deg) scale(1.04, 0.95); }
  75%      { transform: translateY(-4px) rotate(3deg) scale(0.97, 1.04); }
}
@keyframes pipeline-slide {
  0%, 100% { transform: rotate(-5deg) scale(1, 1); }
  50%      { transform: rotate(5deg) scale(0.96, 1.04); }
}
@keyframes pipeline-idle {
  0%, 100% { transform: scale(1, 1); }
  50%      { transform: scale(1.02, 0.97); }
}
@keyframes pipeline-node-pop {
  0%   { scale: 1; }
  35%  { scale: 1.28; filter: brightness(1.8); }
  100% { scale: 1; }
}
@keyframes pipeline-stamp {
  0%   { opacity: 0; scale: 2.4; }
  60%  { opacity: 1; scale: 0.92; }
  100% { opacity: 1; scale: 1; }
}
`;
