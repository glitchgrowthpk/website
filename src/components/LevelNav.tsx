"use client";

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { SECTIONS } from "@/data/studio";
import { spriteSrc } from "@/data/characters";
import { useGame } from "@/lib/game-state";
import { sfx } from "@/lib/audio";
import { fx } from "@/lib/fx";
import { useReducedMotion } from "@/lib/hooks";

const COUNT = SECTIONS.length;
/** Vertical distance between nodes, px. */
const STEP = 36;
/** Height of each node's link (its hit area), px. Nodes sit at its centre. */
const LINK_H = 30;
const RAIL_H = (COUNT - 1) * STEP;
/**
 * Width of the rail column, px. Below ~1450px the sections fill the viewport
 * and their content stops 24px (the px-6 gutter) short of the right edge, so
 * everything here — hit areas, dots, sprite — is centred in that strip and
 * stays clear of the content.
 */
const RAIL_W = 24;
/** Rendered height of the fighter sprite, px. */
const SPRITE_H = 22;
/** sessionStorage: sections whose stage banner has already been shown. */
const STAGES_KEY = "glitch.stages";
/** Below the HUD, px: the banner (15px gap + ~48px chip) plus breathing room. */
const BANNER_CLEAR = 76;

/** The rail gradient — cyan, violet, magenta — sampled at t in [0, 1]. */
const STOPS = [
  [0, 229, 255],
  [139, 92, 246],
  [255, 45, 119],
];
function railColor(t: number, lift = 0) {
  const x = t * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(x));
  const f = x - i;
  const c = STOPS[i].map((v, k) => {
    const base = v + (STOPS[i + 1][k] - v) * f;
    return Math.round(base + (255 - base) * lift);
  });
  return `rgb(${c.join(",")})`;
}
const NODE_COLOR = SECTIONS.map((_, i) => railColor(i / (COUNT - 1)));
/** Lightened for small text: the violet-magenta stretch of the gradient
 *  falls just short of 4.5:1 on the dark panels otherwise. */
const NODE_TEXT = SECTIONS.map((_, i) => railColor(i / (COUNT - 1), 0.22));

const stageNo = (i: number) => String(i + 1).padStart(2, "0");
/** Feet of the sprite rest on the top of node i. */
const spriteY = (i: number) => LINK_H / 2 + i * STEP - 5 - SPRITE_H + 1;

/**
 * The level map: a slim rail of section nodes on the right edge (lg and up),
 * the visitor's fighter hopping from node to node, and a one-time "STAGE 03"
 * banner per section per session. It also owns visited-section tracking for
 * the "Level Select" achievement, which runs at every breakpoint.
 */
export default function LevelNav() {
  const { characterId, visited, markVisited, ready, paused } = useGame();
  const reduced = useReducedMotion();
  const [current, setCurrent] = useState(0);
  const [banner, setBanner] = useState<{ i: number; key: number } | null>(null);

  const fillRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const spriteRef = useRef<HTMLSpanElement>(null);
  const nodeRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const bannerRef = useRef<HTMLDivElement>(null);
  const prevRef = useRef(0);
  const mountedAt = useRef(0);
  const bannerSeq = useRef(0);
  /** Stages seen this session, for when sessionStorage is unavailable. */
  const seenMem = useRef<string[]>([]);

  /* ---------- scroll: current section + rail fill ---------- */

  useEffect(() => {
    mountedAt.current = performance.now();
    // stops[i] = the scrollY at which section i's top crosses mid-screen. The
    // rail fills piecewise between them, so the fill tip meets each node
    // exactly as its section becomes current.
    let stops: number[] = SECTIONS.map(() => 0);
    let raf = 0;
    let last = -1;

    const measure = () => {
      const vh = window.innerHeight;
      const sy = window.scrollY;
      const max = Math.max(0, document.documentElement.scrollHeight - vh);
      let prev = 0;
      stops = SECTIONS.map((s, i) => {
        const el = i === 0 ? null : document.getElementById(s.id);
        if (el) {
          const y = el.getBoundingClientRect().top + sy - vh * 0.5;
          prev = Math.min(max, Math.max(prev, y));
        }
        return prev;
      });
    };

    const update = () => {
      raf = 0;
      const y = window.scrollY;
      let k = 0;
      while (k < COUNT - 1 && y >= stops[k + 1] && stops[k + 1] > 0) k++;
      let p = 1;
      if (k < COUNT - 1) {
        const span = stops[k + 1] - stops[k];
        p = (k + (span > 0 ? Math.min(1, Math.max(0, (y - stops[k]) / span)) : 0)) / (COUNT - 1);
      }
      const fill = fillRef.current;
      const tip = tipRef.current;
      if (fill) fill.style.clipPath = `inset(0 0 ${((1 - p) * 100).toFixed(2)}% 0)`;
      if (tip) tip.style.transform = `translateY(${(p * RAIL_H).toFixed(1)}px)`;
      if (k !== last) {
        last = k;
        setCurrent(k);
      }
    };

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    const remeasure = () => {
      measure();
      schedule();
    };

    remeasure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", remeasure);
    // Section heights change as images load, filters run and panels open.
    const ro = new ResizeObserver(remeasure);
    ro.observe(document.body);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", remeasure);
      ro.disconnect();
    };
  }, []);

  /* ---------- visited tracking (every breakpoint) ---------- */

  // A progress reset empties `visited`; the observer is then rebuilt (sections
  // it had already ticked off were unobserved), and its first report re-marks
  // whatever is on screen right now.
  const noneVisited = visited.length === 0;
  useEffect(() => {
    if (!ready) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const vh = e.rootBounds?.height ?? window.innerHeight;
          if (e.intersectionRatio >= 0.35 || e.intersectionRect.height >= vh * 0.5) {
            markVisited(e.target.id);
            io.unobserve(e.target);
          }
        }
      },
      { threshold: Array.from({ length: 21 }, (_, i) => i / 20) },
    );
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, [ready, markVisited, noneVisited]);

  /* ---------- the fighter hops to the current node ---------- */

  useEffect(() => {
    const el = spriteRef.current;
    const from = prevRef.current;
    prevRef.current = current;
    if (!el || from === current || reduced) return;
    // The first measurement after mount (a reload halfway down the page) just
    // places the sprite; only real travel gets a hop.
    if (performance.now() - mountedAt.current < 600) return;

    const y1 = spriteY(current);
    let y0 = spriteY(from);
    // A smooth-scrolled anchor jump changes the section every ~150ms. Each
    // change retargets the hop from wherever the sprite is, still airborne —
    // restarting from a crouch every time would just make it jitter in place.
    const running = el.getAnimations();
    const airborne = running.length > 0;
    if (airborne) {
      y0 = new DOMMatrix(getComputedStyle(el).transform).m42;
      running.forEach((a) => a.cancel());
    }
    const nodes = Math.min(Math.abs(current - from), 5);
    const up = y1 < y0;
    // A real arc: it peaks a little above the higher end — early when
    // dropping down the rail, late when climbing it.
    const peak = Math.min(spriteY(from), y1) - 9 - Math.min(nodes, 4) * 2.5;
    const rise = "cubic-bezier(.2,.65,.35,1)"; // decelerate into the apex
    const fall = "cubic-bezier(.6,0,.85,.45)"; // accelerate out of it
    // already moving: keep most of the speed rather than starting from rest
    const glide = "cubic-bezier(.4,.25,.8,.6)";
    const frames: Keyframe[] = airborne
      ? [{ transform: `translateY(${y0}px) scale(0.92, 1.1)`, easing: y0 > peak ? rise : glide }]
      : [
          { transform: `translateY(${y0}px) scale(1, 1)`, easing: "ease-out" },
          { transform: `translateY(${y0}px) scale(1.22, 0.78)`, offset: 0.14, easing: rise },
        ];
    // Already above the apex (retargeted on the way down): just fall.
    if (!airborne || y0 > peak) {
      frames.push({
        transform: `translateY(${peak}px) scale(0.9, 1.12)`,
        offset: up ? 0.6 : 0.4,
        easing: fall,
      });
    }
    frames.push(
      { transform: `translateY(${y1}px) scale(1.24, 0.76)`, offset: 0.86, easing: "ease-out" },
      { transform: `translateY(${y1}px) scale(1, 1)` },
    );
    const anim = el.animate(frames, { duration: (airborne ? 300 : 380) + nodes * 55 });
    anim.onfinish = () => {
      const node = nodeRefs.current[current];
      // only when the rail is actually on screen (lg and up)
      if (node && node.offsetParent) {
        const r = node.getBoundingClientRect();
        fx.burst(r.left + r.width / 2, r.top, {
          count: 6,
          colors: [NODE_COLOR[current], "#8a8fa3"],
          speed: 90,
          angle: -Math.PI / 2,
          spread: Math.PI,
          gravity: 240,
          size: 2,
          life: 0.35,
        });
      }
    };
    return () => {
      anim.onfinish = null;
    };
  }, [current, reduced]);

  /* ---------- stage banner: once per section per session ---------- */

  useEffect(() => {
    if (current === 0 || reduced || paused) return;
    const id = SECTIONS[current].id;
    // Wait for the section to stay current, so flying past several sections
    // on an anchor jump does not fire a banner for each.
    const t = window.setTimeout(() => {
      // Read storage every time (not once): a progress reset clears the key
      // mid-session and the banners should replay like a first visit.
      let seen = seenMem.current;
      try {
        const stored: unknown = JSON.parse(sessionStorage.getItem(STAGES_KEY) ?? "[]");
        if (Array.isArray(stored)) seen = stored.filter((s) => typeof s === "string");
      } catch {
        /* storage blocked — fall back to this page's memory */
      }
      if (seen.includes(id)) return;

      // Never land on the section's own heading. If a fast scroll has already
      // carried it up under the banner, skip for now — it shows next time.
      const head = document.querySelector<HTMLElement>(`#${id} header`);
      const title = head?.querySelector("h2");
      if (head && title) {
        const hud = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hud-h")) || 56;
        if (head.getBoundingClientRect().top < hud + BANNER_CLEAR && title.getBoundingClientRect().bottom > 0) {
          return;
        }
      }

      seen = [...seen, id];
      seenMem.current = seen;
      try {
        sessionStorage.setItem(STAGES_KEY, JSON.stringify(seen));
      } catch {
        /* storage blocked — banners just repeat next visit */
      }
      if (!document.hidden) sfx.whoosh();
      bannerSeq.current += 1;
      setBanner({ i: current, key: bannerSeq.current });
    }, 320);
    return () => window.clearTimeout(t);
  }, [current, reduced, paused]);

  useEffect(() => {
    if (!banner) return;
    // While it is up, the banner ducks out early if scrolling brings the
    // section's kicker or title up underneath it.
    const head = document.querySelector<HTMLElement>(`#${SECTIONS[banner.i].id} header`);
    const title = head?.querySelector("h2");
    let raf = 0;
    const check = () => {
      raf = 0;
      const chip = bannerRef.current;
      if (!chip || !head || !title || chip.hasAttribute("data-out")) return;
      const b = chip.getBoundingClientRect();
      if (head.getBoundingClientRect().top < b.bottom + 12 && title.getBoundingClientRect().bottom > b.top) {
        chip.setAttribute("data-out", "");
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(check);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    const t = window.setTimeout(() => setBanner(null), 1700);
    return () => {
      window.clearTimeout(t);
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
    };
  }, [banner]);

  const onNodeClick = (e: MouseEvent<HTMLAnchorElement>, i: number) => {
    sfx.select();
    fx.burstAt(nodeRefs.current[i] ?? e.currentTarget, "click");
  };

  return (
    <>
      <nav
        aria-label="Level map"
        className="lvl pointer-events-none fixed right-0 top-1/2 z-[45] hidden -translate-y-1/2 opacity-80 transition-opacity duration-300 hover:opacity-100 focus-within:opacity-100 lg:block"
      >
        <div className="relative" style={{ width: RAIL_W, height: RAIL_H + LINK_H }}>
          {/* rail + progress fill */}
          <span
            aria-hidden="true"
            className="absolute right-[11px] w-[2px] rounded-full bg-edge"
            style={{ top: LINK_H / 2, height: RAIL_H }}
          />
          <span
            ref={fillRef}
            aria-hidden="true"
            className="absolute right-[11px] w-[2px] rounded-full bg-gradient-to-b from-cyan via-violet to-magenta"
            style={{ top: LINK_H / 2, height: RAIL_H, clipPath: "inset(0 0 100% 0)" }}
          />
          <span
            ref={tipRef}
            aria-hidden="true"
            className="lvl-tip absolute right-[9px] h-1.5 w-1.5 rounded-full bg-ink"
            style={{ top: LINK_H / 2 - 3 }}
          />

          <ol>
            {SECTIONS.map((s, i) => {
              const isCurrent = i === current;
              const isVisited = visited.includes(s.id);
              return (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    aria-current={isCurrent ? "location" : undefined}
                    onClick={(e) => onNodeClick(e, i)}
                    onMouseEnter={() => sfx.hover()}
                    className="group pointer-events-auto absolute right-[3px] block w-[18px] rounded-md"
                    style={{ top: i * STEP, height: LINK_H, "--c": NODE_COLOR[i] } as CSSProperties}
                  >
                    <span
                      ref={(el) => {
                        nodeRefs.current[i] = el;
                      }}
                      aria-hidden="true"
                      className={`lvl-dot absolute right-1 top-1/2 -mt-[5px] h-2.5 w-2.5 rounded-full border-[1.5px] ${
                        isCurrent ? "is-current" : isVisited ? "is-visited" : "is-open"
                      }`}
                    />
                    <span className="lvl-label mono pointer-events-none absolute right-full top-1/2 mr-1.5 whitespace-nowrap rounded border border-edge bg-abyss/95 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-ink shadow-[0_6px_20px_-8px_#000]">
                      <span style={{ color: NODE_TEXT[i] }}>{stageNo(i)}</span>{" "}
                      <span aria-hidden="true" className="text-muted">
                        ·
                      </span>{" "}
                      {s.label}
                    </span>
                  </a>
                </li>
              );
            })}
          </ol>

          {/* the visitor's fighter, standing on the current node */}
          <span
            ref={spriteRef}
            aria-hidden="true"
            className="pointer-events-none absolute right-0 top-0 flex w-6 origin-bottom justify-center"
            style={{ height: SPRITE_H, transform: `translateY(${spriteY(current)}px)` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={characterId}
              src={spriteSrc(characterId)}
              alt=""
              className="lvl-sprite h-full w-auto max-w-none"
            />
          </span>
        </div>
      </nav>

      {banner && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-x-0 top-[calc(var(--hud-h)+15px)] z-[45]"
        >
          <div className="mx-auto max-w-[1400px] px-5 sm:px-6">
            <div
              key={banner.key}
              ref={bannerRef}
              className="lvl-banner inline-flex items-center gap-3 rounded-md border border-edge/80 bg-abyss/90 py-2 pl-2.5 pr-4 shadow-[0_12px_30px_-14px_#000] backdrop-blur"
            >
              <span
                className="lvl-banner-bar h-8 w-[3px] rounded-full"
                style={{
                  background: NODE_COLOR[banner.i],
                  boxShadow: `0 0 10px ${NODE_COLOR[banner.i]}`,
                }}
              />
              <span className="flex flex-col gap-1">
                <span
                  className="mono text-[10px] leading-none tracking-[0.28em]"
                  style={{ color: NODE_TEXT[banner.i] }}
                >
                  STAGE {stageNo(banner.i)}
                </span>
                <span
                  className="lvl-banner-title glitch font-display text-[22px] uppercase leading-none"
                  data-text={SECTIONS[banner.i].label.toUpperCase()}
                >
                  {SECTIONS[banner.i].label}
                </span>
              </span>
            </div>
          </div>
        </div>
      )}

      <style href="glitch-level-nav" precedence="default">
        {LEVEL_NAV_CSS}
      </style>
    </>
  );
}

const LEVEL_NAV_CSS = `
.lvl-dot{transition:transform .25s var(--ease-pop),background-color .3s,box-shadow .3s,border-color .3s}
.lvl-dot.is-open{border-color:var(--color-muted);background:var(--color-void)}
.lvl-dot.is-visited{border-color:var(--c);background:var(--c)}
.lvl-dot.is-current{border-color:#fff;background:var(--c);box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 30%,transparent),0 0 14px var(--c)}
.lvl a:hover .lvl-dot,.lvl a:focus-visible .lvl-dot{transform:scale(1.35)}
/* The default 3px offset would push the ring off-screen and into the content. */
.lvl a:focus-visible{outline-offset:0}
.lvl-tip{box-shadow:0 0 8px #fff,0 0 14px var(--color-violet)}

.lvl-label{opacity:0;translate:6px -50%;transition:opacity .2s,translate .25s var(--ease-pop)}
.lvl a:hover .lvl-label,.lvl a:focus-visible .lvl-label{opacity:1;translate:0 -50%}

@media (prefers-reduced-motion:no-preference){
  .lvl-dot.is-current::after{content:"";position:absolute;inset:-4px;border-radius:9999px;border:1.5px solid var(--c);pointer-events:none;animation:lvl-pulse 1.9s ease-out infinite}
  .lvl-sprite{transform-origin:50% 100%;animation:lvl-in .45s var(--ease-pop)}
  .lvl-banner{animation:lvl-banner 1.65s cubic-bezier(.2,.8,.2,1) both}
  .lvl-banner[data-out]{animation:lvl-banner-out .2s cubic-bezier(.5,0,.9,.5) forwards}
  .lvl-banner-bar{animation:lvl-bar .5s var(--ease-pop) .1s both}
  .lvl-banner-title{animation:lvl-title .55s steps(1) .14s both}
}
@keyframes lvl-pulse{from{transform:scale(.6);opacity:.9}to{transform:scale(1.65);opacity:0}}
@keyframes lvl-in{from{transform:scale(0,1.6);opacity:0}to{transform:none;opacity:1}}
@keyframes lvl-banner{
  0%{clip-path:inset(0 100% 0 0);transform:translateX(-10px)}
  14%{clip-path:inset(0 0 0 0);transform:none}
  84%{clip-path:inset(0 0 0 0);opacity:1;transform:none}
  100%{clip-path:inset(0 0 0 100%);opacity:0;transform:translateX(10px)}
}
@keyframes lvl-banner-out{to{clip-path:inset(0 0 0 100%);opacity:0;transform:translateX(10px)}}
@keyframes lvl-bar{from{transform:scaleY(0)}to{transform:none}}
@keyframes lvl-title{
  0%{opacity:0}
  15%{opacity:1;clip-path:inset(0 0 60% 0);transform:translateX(-6px)}
  35%{clip-path:inset(45% 0 10% 0);transform:translateX(4px)}
  55%{clip-path:inset(10% 0 40% 0);transform:translateX(-2px)}
  75%{clip-path:inset(0);transform:none}
  100%{opacity:1}
}
`;
