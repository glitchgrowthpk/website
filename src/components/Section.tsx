"use client";

import {
  useEffect,
  useEffectEvent,
  useRef,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { sfx } from "@/lib/audio";
import { useFinePointer, useReducedMotion } from "@/lib/hooks";

/* ------------------------------------------------------------- entrances */

/**
 * Plays a one-shot entrance when `ref` scrolls into view. The state lives in a
 * `data-stage` attribute on the element, not in React state:
 *
 *   (absent)  the finished, static look. It is what the server renders, what
 *             no-JS and reduced-motion visitors get, and where every entrance
 *             ends up once it has played.
 *   "armed"   still below the fold; CSS hides whatever is about to animate in.
 *   "play"    the entrance is running.
 *
 * Only elements that are below the fold at mount get armed, so nothing that is
 * already on screen blinks out and back in at hydration. Components style the
 * states themselves, inside `prefers-reduced-motion: no-preference`.
 */
export function useEntrance<T extends HTMLElement>(
  ref: RefObject<T | null>,
  {
    duration,
    onPlay,
    rootMargin = "0px 0px -14% 0px",
  }: {
    /** ms until the attribute is cleared — longer than the longest animation. */
    duration: number;
    onPlay?: (el: T) => void;
    rootMargin?: string;
  },
) {
  const play = useEffectEvent((el: T) => onPlay?.(el));

  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return;

    el.dataset.stage = "armed";
    let done = 0;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        el.dataset.stage = "play";
        play(el);
        done = window.setTimeout(() => delete el.dataset.stage, duration);
      },
      { rootMargin, threshold: 0 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      window.clearTimeout(done);
      delete el.dataset.stage;
    };
  }, [ref, duration, rootMargin]);
}

/* --------------------------------------------------------- title decoder */

const ACCENT_HEX = {
  cyan: "#00e5ff",
  magenta: "#ff2d77",
  lime: "#c8ff2e",
  violet: "#8b5cf6",
} as const;

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
/** Chance that a scrambling cell shows a ▓ ▒ ░ block instead of a glyph. */
const BLOCK_CHANCE = 0.08;

let measureCtx: CanvasRenderingContext2D | null = null;

/**
 * Scramble candidates for each distinct character of `text`: glyphs whose
 * advance is close to the real one, so a decoding line stays (almost) exactly
 * as long as the final line and never reflows.
 */
function glyphPools(text: string, font: string) {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  const ctx = measureCtx;
  const pools = new Map<string, string[]>();
  if (!ctx) return pools;
  ctx.font = font;
  const w = (g: string) => ctx.measureText(g).width;
  const letters = [...GLYPHS].map((g) => ({ g, w: w(g) }));

  for (const ch of new Set(text.replace(/\s/g, ""))) {
    const target = w(ch);
    let pick = letters.filter((c) => Math.abs(c.w - target) <= Math.max(target * 0.16, 1.5));
    if (pick.length < 4) {
      pick = [...letters]
        .sort((a, b) => Math.abs(a.w - target) - Math.abs(b.w - target))
        .slice(0, 6);
    }
    pools.set(
      ch,
      pick.map((c) => c.g),
    );
  }
  return pools;
}

/**
 * Where the browser wrapped the real title: the indices of the spaces that
 * end a visual line. The glyph layer reproduces those breaks exactly, so it
 * sits on top of the (transparent) real text line for line.
 */
function lineBreaks(node: Text, text: string) {
  const range = document.createRange();
  const breaks = new Set<number>();
  let prevTop = Number.NaN;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === " " || (i > 0 && text[i - 1] !== " ")) continue;
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    const r = range.getBoundingClientRect();
    if (r.top > prevTop + r.height * 0.5) breaks.add(i - 1);
    prevTop = r.top;
  }
  return breaks;
}

interface DecodeTiming {
  /** ms before the first character locks. */
  first: number;
  /** ms between the first and the last character locking. */
  spread: number;
  /** Typewriter tick per locked character. */
  tick: boolean;
}

/**
 * Scrambles `h2`'s title into random glyphs and decodes it left to right.
 * Returns a cancel function, or null if there was nothing to decode.
 * Everything is direct DOM work inside one rAF loop: the glyph layer gets one
 * span per character, and the h2's `data-text` (which the `.glitch`
 * colour-split layers print) mirrors what is on screen.
 */
function decodeTitle(
  h2: HTMLElement,
  real: HTMLElement,
  layer: HTMLElement,
  title: string,
  { first, spread, tick }: DecodeTiming,
  onDone: () => void,
) {
  const node = real.firstChild;
  if (!(node instanceof Text)) return null;

  const cs = getComputedStyle(h2);
  const pools = glyphPools(
    title,
    `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`,
  );
  const breaks = lineBreaks(node, title);

  /**
   * Paints a random stand-in for `ch` and returns it (for `data-text`). Now
   * and then the cell becomes a ▓ ▒ ░ block instead. Real block glyphs come
   * from a fallback font about a third wider than Anton's letters, which made
   * decoding lines jut out; so a block is drawn by CSS as a dither over a
   * same-width letter, and the line keeps its length.
   */
  const paint = (span: HTMLSpanElement, ch: string) => {
    const p = pools.get(ch);
    const g = p?.length ? p[Math.floor(Math.random() * p.length)] : ch;
    span.textContent = g;
    if (Math.random() < BLOCK_CHANCE) {
      span.className = "is-block";
      span.dataset.b = String(1 + Math.floor(Math.random() * 3));
    } else {
      span.className = "";
      delete span.dataset.b;
    }
    return g;
  };

  interface Cell {
    span: HTMLSpanElement;
    i: number;
    final: string;
    lockAt: number;
    next: number;
    /** 0 scrambling, 1 just locked (flash), 2 settled */
    state: 0 | 1 | 2;
  }

  const shown = [...title];
  const cells: Cell[] = [];
  const count = title.replace(/\s/g, "").length;
  layer.textContent = "";
  for (let i = 0; i < title.length; i++) {
    const ch = title[i];
    if (breaks.has(i)) {
      shown[i] = "\n";
      layer.append("\n");
    } else if (ch === " ") {
      layer.append(" ");
    } else {
      const k = cells.length;
      const span = document.createElement("span");
      shown[i] = paint(span, ch);
      layer.append(span);
      const t = count > 1 ? k / (count - 1) : 1;
      cells.push({
        span,
        i,
        final: ch,
        // ease-in a little, so the wave accelerates through the word
        lockAt: first + spread * (t * 0.7 + t * t * 0.3) + Math.random() * 18,
        next: Math.random() * 40,
        state: 0,
      });
    }
  }

  h2.setAttribute("data-decoding", "");
  h2.setAttribute("data-text", shown.join(""));

  let raf = 0;
  const t0 = performance.now();

  const finish = () => {
    cancelAnimationFrame(raf);
    layer.textContent = "";
    h2.removeAttribute("data-decoding");
    h2.setAttribute("data-text", title);
    onDone();
  };

  const step = (now: number) => {
    const t = now - t0;
    let changed = false;
    let live = 0;
    for (const c of cells) {
      if (c.state === 2) continue;
      if (c.state === 1) {
        if (t >= c.lockAt + 110) {
          c.span.className = "is-set";
          c.state = 2;
        } else live++;
        continue;
      }
      live++;
      if (t >= c.lockAt) {
        c.span.textContent = c.final;
        c.span.className = "is-lock";
        delete c.span.dataset.b;
        shown[c.i] = c.final;
        c.state = 1;
        changed = true;
        if (tick) sfx.type();
      } else if (t >= c.next) {
        shown[c.i] = paint(c.span, c.final);
        c.next = t + 42 + Math.random() * 46;
        changed = true;
      }
    }
    if (changed) h2.setAttribute("data-text", shown.join(""));
    if (live) raf = requestAnimationFrame(step);
    else finish();
  };
  raf = requestAnimationFrame(step);

  return finish;
}

/* ------------------------------------------------------------ components */

export function SectionHead({
  index,
  kicker,
  title,
  lead,
  accent = "cyan",
}: {
  index: string;
  kicker: string;
  title: string;
  lead?: ReactNode;
  accent?: "cyan" | "magenta" | "lime" | "violet";
}) {
  const bar = {
    cyan: "bg-cyan",
    magenta: "bg-magenta",
    lime: "bg-lime",
    violet: "bg-violet",
  }[accent];

  const headRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const realRef = useRef<HTMLSpanElement>(null);
  const layerRef = useRef<HTMLSpanElement>(null);
  /** Cancels the decode in flight, if any. */
  const cancelRef = useRef<(() => void) | null>(null);
  const fine = useFinePointer();
  const reduced = useReducedMotion();

  const decode = (timing: DecodeTiming) => {
    const h2 = titleRef.current;
    const real = realRef.current;
    const layer = layerRef.current;
    if (!h2 || !real || !layer || cancelRef.current) return;
    cancelRef.current = decodeTitle(h2, real, layer, title, timing, () => {
      cancelRef.current = null;
    });
  };

  useEntrance(headRef, {
    duration: 1800,
    onPlay: () => decode({ first: 170, spread: 480, tick: true }),
  });

  useEffect(() => () => cancelRef.current?.(), []);

  const onTitleEnter = (e: PointerEvent<HTMLHeadingElement>) => {
    if (e.pointerType !== "mouse" || !fine || reduced) return;
    if (headRef.current?.dataset.stage === "armed") return;
    decode({ first: 60, spread: 220, tick: false });
  };

  return (
    <header
      ref={headRef}
      className="sh mb-10 sm:mb-14"
      style={{ "--sh-accent": ACCENT_HEX[accent] } as CSSProperties}
    >
      <div className="mb-4 flex items-center gap-3">
        <span aria-hidden="true" className={`sh-bar h-3 w-1.5 rounded-full ${bar}`} />
        <span
          className="relative"
          style={{ "--sh-n": Math.max(1, kicker.length) } as CSSProperties}
        >
          <span className="sh-kick label block">{kicker}</span>
          <span aria-hidden="true" className="sh-caret label" />
        </span>
        <span className="sh-index mono ml-auto text-[11px] tracking-[0.2em] text-muted">
          {"// "}
          {index}
        </span>
      </div>
      <h2
        ref={titleRef}
        className="sh-title glitch font-display text-[clamp(2.1rem,6.4vw,4.4rem)] leading-[0.92]"
        data-text={title}
        onPointerEnter={onTitleEnter}
      >
        <span ref={realRef} className="sh-real">
          {title}
        </span>
        {/* Decode glyphs are drawn here, on top of the transparent real text. */}
        <span ref={layerRef} aria-hidden="true" className="sh-glyphs" />
      </h2>
      {lead && (
        <p className="sh-lead mt-4 max-w-2xl text-pretty text-base leading-relaxed text-muted sm:text-lg">
          {lead}
        </p>
      )}
      {/* One shared copy: React hoists and de-duplicates by href. */}
      <style href="glitch-section-head" precedence="default">
        {SECTION_HEAD_CSS}
      </style>
    </header>
  );
}

export function Section({
  id,
  children,
  className = "",
}: {
  id: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={`relative mx-auto w-full max-w-[1400px] scroll-mt-20 px-5 py-20 sm:px-6 sm:py-28 ${className}`}
    >
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------- css */

const SECTION_HEAD_CSS = `
.sh-glyphs{position:absolute;left:0;top:0;white-space:pre;pointer-events:none}
.sh-glyphs>span{color:var(--sh-accent);opacity:.88}
/* ▓ ▒ ░ blocks: a dither drawn over a transparent stand-in letter, so the
   cell keeps a letter's width. On the h2's 0.92 line an inline-block is
   Anton's cap height, near enough. */
.sh-glyphs>span.is-block{position:relative;display:inline-block;color:transparent}
.sh-glyphs>span.is-block::after{content:"";position:absolute;inset:.03em .045em;opacity:.85;
  background:var(--sh-dither) 0 0/max(4px,.08em) max(4px,.08em)}
.sh-glyphs>span[data-b="3"]{--sh-dither:conic-gradient(var(--sh-accent) 0 75%,transparent 0)}
.sh-glyphs>span[data-b="2"]{--sh-dither:repeating-conic-gradient(var(--sh-accent) 0 25%,transparent 0 50%)}
.sh-glyphs>span[data-b="1"]{--sh-dither:conic-gradient(var(--sh-accent) 0 25%,transparent 0)}
.sh-glyphs>span.is-lock{color:#fff;opacity:1;text-shadow:0 0 18px var(--sh-accent),0 0 2px #fff}
.sh-glyphs>span.is-set{color:inherit;opacity:1}
.sh-title[data-decoding] .sh-real{color:transparent}
.sh-title[data-decoding]::before,.sh-title[data-decoding]::after{white-space:pre}
/* The colour-split layers print data-text, and Chrome folds generated
   content into the heading's accessible name: the title read three times,
   or as scrambled glyphs mid-decode. Empty alt text keeps them visual only. */
.sh-title.glitch::before,.sh-title.glitch::after{content:attr(data-text) / ""}
.sh-caret{position:absolute;left:0;top:50%;width:.62em;height:1.25em;margin-top:-.66em;background:var(--sh-accent);opacity:0;pointer-events:none}

/* screen only: a heading printed while still armed must not come out blank */
@media screen and (prefers-reduced-motion:no-preference){
  .sh[data-stage="armed"] .sh-bar{transform:scaleY(0)}
  .sh[data-stage="armed"] .sh-kick{clip-path:inset(0 100% 0 0)}
  .sh[data-stage="armed"] .sh-index,.sh[data-stage="armed"] .sh-lead{opacity:0}
  .sh[data-stage="armed"] .sh-real{color:transparent}
  .sh[data-stage="armed"] .sh-title::before,.sh[data-stage="armed"] .sh-title::after{opacity:0}

  .sh[data-stage="play"] .sh-bar{animation:sh-bar .6s var(--ease-pop) .05s both}
  .sh[data-stage="play"] .sh-kick{animation:sh-type calc(var(--sh-n) * 34ms) steps(var(--sh-n),end) .1s both}
  .sh[data-stage="play"] .sh-caret{opacity:1;animation:sh-caret calc(var(--sh-n) * 34ms) steps(var(--sh-n),end) .1s both,sh-blink .95s steps(1) calc(var(--sh-n) * 34ms + .1s) forwards}
  .sh[data-stage="play"] .sh-index{animation:sh-index .6s steps(1) .3s both}
  .sh[data-stage="play"] .sh-lead{animation:sh-lead .7s cubic-bezier(.16,1,.3,1) .38s both}
}
@keyframes sh-bar{
  0%{transform:scaleY(0);box-shadow:0 0 0 0 transparent}
  55%{transform:scaleY(1.6);box-shadow:0 0 14px 2px var(--sh-accent)}
  100%{transform:scaleY(1);box-shadow:0 0 0 0 transparent}
}
@keyframes sh-type{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}
@keyframes sh-caret{from{transform:translateX(0)}to{transform:translateX(calc(var(--sh-n) * (1ch + .22em)))}}
@keyframes sh-blink{0%{opacity:1}25%{opacity:0}50%{opacity:1}75%,100%{opacity:0}}
@keyframes sh-index{
  0%{opacity:0}
  15%{opacity:1;transform:translateX(-6px);color:var(--sh-accent);text-shadow:2px 0 #ff2d77,-2px 0 #00e5ff}
  35%{opacity:.25;transform:translateX(3px)}
  55%{opacity:1;transform:translateX(-2px);text-shadow:-2px 0 #ff2d77,2px 0 #00e5ff}
  75%{transform:none;text-shadow:none;color:inherit}
  100%{opacity:1}
}
@keyframes sh-lead{from{opacity:0;filter:blur(6px)}to{opacity:1;filter:blur(0)}}
`;
