"use client";

import Image from "next/image";
import {
  ViewTransition,
  addTransitionType,
  startTransition,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { GAMES, GENRES, type Game, type Genre } from "@/data/games";
import { sfx } from "@/lib/audio";
import { fx } from "@/lib/fx";
import { useGame } from "@/lib/game-state";
import { useFinePointer, useReducedMotion } from "@/lib/hooks";
import { Section, SectionHead } from "./Section";
import { Coin } from "./GameUi";

const GENRE_ACCENT: Record<Genre, string> = {
  Puzzle: "#00e5ff",
  Casual: "#c8ff2e",
  Strategy: "#ff2d77",
  RPG: "#8b5cf6",
};

type SortKey = "installs" | "rating" | "az";

const SORTS: { key: SortKey; label: string; said: string }[] = [
  { key: "installs", label: "Most installed", said: "Most installed first." },
  { key: "rating", label: "Top rated", said: "Top rated first." },
  { key: "az", label: "A–Z", said: "Sorted A to Z." },
];

/** Transition type for grid reshuffles, so the CSS below only touches ours. */
const SHUFFLE = "pf-shuffle";

/**
 * Cards only animate for our own reshuffles. Any other transition on the page
 * (another section's startTransition, say) leaves them alone, even if it
 * happens to move the grid.
 */
const ONLY_SHUFFLE = (cls: string) => ({ [SHUFFLE]: cls, default: "none" });
const CARD_ENTER = ONLY_SHUFFLE("pf-enter");
const CARD_EXIT = ONLY_SHUFFLE("pf-exit");
const CARD_MOVE = ONLY_SHUFFLE("pf-move");

/* ---------------------------------------------------------- sliding pill */

function placePill(group: HTMLElement, pill: HTMLElement, animate: boolean) {
  const on = group.querySelector<HTMLElement>('[aria-pressed="true"]');
  if (!on) return;
  if (!animate) pill.style.transition = "none";
  pill.style.transform = `translate3d(${on.offsetLeft}px, ${on.offsetTop}px, 0)`;
  pill.style.width = `${on.offsetWidth}px`;
  pill.style.height = `${on.offsetHeight}px`;
  pill.style.backgroundColor = on.dataset.pill ?? "";
  if (!animate) {
    void pill.offsetWidth; // commit the jump before transitions come back
    pill.style.transition = "";
  }
  group.dataset.pillReady = "";
}

/**
 * One highlight that slides between the pressed buttons of a toggle group.
 * Until it has measured, the pressed button paints its own colours, so the
 * server HTML (and a visitor without JavaScript) still shows the selection.
 */
function useSlidingPill(active: string) {
  const groupRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);

  useLayoutEffect(() => {
    const g = groupRef.current;
    const p = pillRef.current;
    if (!g || !p) return;
    placePill(g, p, placed.current);
    placed.current = true;
  }, [active]);

  // Wrapping and font loading move the buttons; follow them without sliding.
  useEffect(() => {
    const g = groupRef.current;
    const p = pillRef.current;
    if (!g || !p || !("ResizeObserver" in window)) return;
    const ro = new ResizeObserver(() => placePill(g, p, false));
    ro.observe(g);
    return () => ro.disconnect();
  }, []);

  return { groupRef, pillRef };
}

/* ------------------------------------------------------------ store link */

function StoreLink({
  href,
  children,
  accent,
  game,
  onShop,
}: {
  href: string;
  children: React.ReactNode;
  accent: string;
  game: string;
  onShop: (el: HTMLElement) => void;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-cursor="PLAY"
      onClick={(e) => {
        e.stopPropagation();
        onShop(e.currentTarget);
      }}
      onMouseEnter={() => sfx.hover()}
      className="pf-store mono group/store flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-md border border-edge bg-panel-2/70 px-2 py-2 text-[10px] uppercase tracking-[0.12em] text-muted transition-colors hover:border-(--a) hover:bg-(--a) hover:text-void focus-visible:border-(--a) focus-visible:bg-(--a) focus-visible:text-void"
      style={{ ["--a" as string]: accent }}
    >
      <span className="sr-only">{game} on </span>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
      <svg
        viewBox="0 0 10 10"
        width="8"
        height="8"
        aria-hidden="true"
        className="shrink-0 opacity-60 transition-transform duration-200 group-hover/store:-translate-y-px group-hover/store:translate-x-px group-hover/store:opacity-100"
      >
        <path
          d="M2 8 8 2M3.5 2H8v4.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
      </svg>
    </a>
  );
}

/* ------------------------------------------------------------- game card */

function GameCard({
  game,
  index,
  reveal,
  tilt,
  track,
  onShop,
}: {
  game: Game;
  index: number;
  /** Play the scroll-in entrance. Off once the visitor starts filtering. */
  reveal: boolean;
  /** 3D tilt toward the pointer (fine pointer, motion allowed). */
  tilt: boolean;
  /** Follow the pointer with the holo foil (fine pointer). */
  track: boolean;
  onShop: (el: HTMLElement) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const st = useRef({ x: 0, y: 0, raf: 0, rect: null as DOMRect | null, sx: 0, sy: 0 });
  const accent = GENRE_ACCENT[game.genre];

  useEffect(() => {
    const s = st.current;
    return () => cancelAnimationFrame(s.raf);
  }, []);

  // One write per frame, however many pointer events arrive in between.
  const apply = () => {
    const s = st.current;
    s.raf = 0;
    const el = ref.current;
    const r = s.rect;
    if (!el || !r) return;
    // The rect is cached on enter; correct it for any scroll since then
    // rather than re-measuring a card that is already tilted.
    const left = r.left - (window.scrollX - s.sx);
    const top = r.top - (window.scrollY - s.sy);
    const px = Math.max(0, Math.min(1, (s.x - left) / r.width));
    const py = Math.max(0, Math.min(1, (s.y - top) / r.height));
    if (tilt) {
      el.style.transform = `perspective(900px) rotateY(${((px - 0.5) * 11).toFixed(2)}deg) rotateX(${(-(py - 0.5) * 11).toFixed(2)}deg) translateY(-6px)`;
    }
    el.style.setProperty("--pf-mx", `${(px * 100).toFixed(1)}%`);
    el.style.setProperty("--pf-my", `${(py * 100).toFixed(1)}%`);
    el.style.setProperty("--pf-o", "1");
  };

  const onEnter = (e: React.PointerEvent<HTMLElement>) => {
    if (!track || e.pointerType === "touch") return;
    const s = st.current;
    s.rect = e.currentTarget.getBoundingClientRect();
    s.sx = window.scrollX;
    s.sy = window.scrollY;
    // The foil layers are not painted at all until a pointer is over the card.
    e.currentTarget.dataset.lit = "";
  };

  const onMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!track || e.pointerType === "touch") return;
    const s = st.current;
    if (!s.rect) onEnter(e);
    s.x = e.clientX;
    s.y = e.clientY;
    if (!s.raf) s.raf = requestAnimationFrame(apply);
  };

  const reset = () => {
    const s = st.current;
    cancelAnimationFrame(s.raf);
    s.raf = 0;
    s.rect = null;
    const el = ref.current;
    if (!el) return;
    el.style.transform = "";
    el.style.setProperty("--pf-o", "0");
    delete el.dataset.lit;
  };

  return (
    <article
      ref={ref}
      data-solid=""
      data-reveal={reveal ? "" : undefined}
      onPointerEnter={onEnter}
      onPointerMove={onMove}
      onPointerLeave={reset}
      className="pf-card panel group relative flex flex-col overflow-hidden p-4 transition-transform duration-200 ease-out will-change-transform"
      style={{
        ["--pf-accent" as string]: accent,
        ["--reveal-delay" as string]: `${(index % 4) * 70}ms`,
      }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[2px] opacity-70"
        style={{ background: accent }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -inset-16 -z-10 opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-25"
        style={{ background: accent }}
      />
      <span aria-hidden="true" className="pf-holo pointer-events-none absolute inset-0" />

      <div className="relative flex items-start gap-3.5">
        <div className="relative shrink-0 overflow-hidden rounded-[18px] transition-transform duration-300 group-hover:scale-105">
          <Image
            src={`/games/${game.slug}.webp`}
            alt=""
            width={72}
            height={72}
            className="rounded-[18px] border border-edge shadow-lg"
            sizes="72px"
          />
          <span
            aria-hidden="true"
            className="pf-foil pointer-events-none absolute inset-0 rounded-[18px]"
          />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-pretty text-[15px] font-semibold leading-snug text-ink">
            {game.short}
          </h3>
          <p className="mono mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] uppercase tracking-[0.14em]">
            <span style={{ color: accent }}>{game.genre}</span>
            <span className="text-muted/50">·</span>
            <span className="text-muted">{game.installs}</span>
            {game.rating && (
              <>
                <span className="text-muted/50">·</span>
                <span className="text-amber">★ {game.rating}</span>
              </>
            )}
          </p>
        </div>
      </div>

      <p className="relative mt-3.5 flex-1 text-pretty text-[13px] leading-relaxed text-muted">
        {game.tagline}
      </p>

      {/* install meter */}
      <div className="relative mt-3.5">
        <div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
          <div
            className="pf-meter h-full origin-left rounded-full transition-[width] duration-700 ease-out"
            style={{ width: `${game.reach * 100}%`, background: accent }}
          />
        </div>
      </div>

      <div className="relative mt-3.5 flex gap-2">
        {game.play && (
          <StoreLink href={game.play} accent={accent} game={game.short} onShop={onShop}>
            Google Play
          </StoreLink>
        )}
        {game.ios && (
          <StoreLink href={game.ios} accent={accent} game={game.short} onShop={onShop}>
            App Store
          </StoreLink>
        )}
      </div>

      <span aria-hidden="true" className="pf-glare pointer-events-none absolute inset-0" />
    </article>
  );
}

/* -------------------------------------------------------------- portfolio */

export default function Portfolio() {
  const { unlock } = useGame();
  const [filter, setFilter] = useState<Genre | "All">("All");
  const [sort, setSort] = useState<SortKey>("installs");
  // The scroll-in entrance belongs to the first render only; after that the
  // view transitions own every card that appears.
  const [shuffled, setShuffled] = useState(false);
  const reduced = useReducedMotion();
  const fine = useFinePointer();

  const { groupRef: genreGroupRef, pillRef: genrePillRef } = useSlidingPill(filter);
  const { groupRef: sortGroupRef, pillRef: sortPillRef } = useSlidingPill(sort);

  const shown = useMemo(() => {
    const list = filter === "All" ? GAMES : GAMES.filter((g) => g.genre === filter);
    if (sort === "installs") return list; // the data is already in install order
    const out = [...list];
    if (sort === "rating") out.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
    else out.sort((a, b) => a.short.localeCompare(b.short));
    return out;
  }, [filter, sort]);

  const counts = useMemo(() => {
    const m = new Map<string, number>([["All", GAMES.length]]);
    GENRES.forEach((g) => m.set(g, GAMES.filter((x) => x.genre === g).length));
    return m;
  }, []);

  // What the visitor last asked for. While a transition is pending the
  // rendered `filter` / `sort` still show the previous state, so rapid clicks
  // are compared against this instead.
  const wanted = useRef<{ filter: Genre | "All"; sort: SortKey }>({
    filter: "All",
    sort: "installs",
  });

  /** Re-deal the grid inside a view transition so the cards morph into place. */
  const reshuffle = (update: () => void) => {
    sfx.swap();
    startTransition(() => {
      addTransitionType(SHUFFLE);
      setShuffled(true);
      update();
    });
  };

  const pickFilter = (g: Genre | "All") => {
    if (wanted.current.filter === g) return;
    wanted.current.filter = g;
    reshuffle(() => setFilter(g));
  };

  const pickSort = (key: SortKey) => {
    if (wanted.current.sort === key) return;
    wanted.current.sort = key;
    reshuffle(() => setSort(key));
  };

  const onShop = (el: HTMLElement) => {
    unlock("window-shopper");
    fx.burstAt(el, "click");
    sfx.select();
  };

  // Cards ripple into their new slots rather than all moving at once.
  const stagger = shown
    .map(
      (g, i) =>
        `::view-transition-group(pf-card-${g.slug}),::view-transition-new(pf-card-${g.slug}){animation-delay:${Math.min(i, 11) * 22}ms}`,
    )
    .join("");

  const sortLabel = SORTS.find((s) => s.key === sort) ?? SORTS[0];

  return (
    <Section id="portfolio">
      <SectionHead
        index="04"
        kicker="Shipped and live"
        title="THE PORTFOLIO"
        accent="cyan"
        lead="Twelve titles on Google Play and the App Store, every icon and screenshot made in house. Tap through to any store listing."
      />

      <div className="mb-8 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <div
          ref={genreGroupRef}
          role="group"
          aria-label="Filter games by genre"
          className="pf-chips relative isolate flex flex-wrap gap-2"
        >
          <span
            ref={genrePillRef}
            aria-hidden="true"
            className="pf-pill pointer-events-none absolute left-0 top-0 z-[1] rounded-lg"
          />
          {(["All", ...GENRES] as const).map((g) => {
            const on = filter === g;
            const accent = g === "All" ? "#f2f3f7" : GENRE_ACCENT[g];
            return (
              <button
                key={g}
                type="button"
                aria-pressed={on}
                data-pill={accent}
                onClick={() => pickFilter(g)}
                onMouseEnter={() => sfx.hover()}
                className={`pf-chip mono min-h-10 rounded-lg border px-3.5 py-2 text-[11px] uppercase tracking-[0.14em] transition-colors duration-200 ${
                  on ? "text-void" : "border-edge bg-panel text-muted hover:text-ink"
                }`}
                style={{ ["--chip" as string]: accent }}
              >
                <span className="relative z-[2]">
                  {g}
                  <span className={on ? "opacity-70" : "text-muted"}>
                    {" "}
                    {counts.get(g)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <span id="pf-sort-label" className="label">
            Sort
          </span>
          <div
            ref={sortGroupRef}
            role="group"
            aria-labelledby="pf-sort-label"
            className="pf-chips pf-sort relative isolate flex rounded-lg border border-edge bg-panel p-[3px]"
          >
            <span
              ref={sortPillRef}
              aria-hidden="true"
              className="pf-pill pointer-events-none absolute left-0 top-0 z-[1] rounded-md"
            />
            {SORTS.map((s) => {
              const on = sort === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  aria-pressed={on}
                  data-pill="#1a1a28"
                  onClick={() => pickSort(s.key)}
                  onMouseEnter={() => sfx.hover()}
                  className={`pf-chip mono min-h-[34px] whitespace-nowrap pointer-coarse:min-h-10 rounded-md border border-transparent px-3 text-[10px] uppercase tracking-[0.14em] transition-colors duration-200 ${
                    on ? "text-ink" : "text-muted hover:text-ink"
                  }`}
                  style={{ ["--chip" as string]: "#1a1a28" }}
                >
                  <span className="relative z-[2]">{s.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="relative">
        <Coin id="portfolio" label="the games grid" className="-top-9 left-1/2" />
        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
          {shown.map((g, i) => (
            <ViewTransition
              key={g.slug}
              name={`pf-card-${g.slug}`}
              enter={CARD_ENTER}
              exit={CARD_EXIT}
              update={CARD_MOVE}
              default="none"
            >
              <GameCard
                game={g}
                index={i}
                reveal={!shuffled}
                tilt={fine && !reduced}
                track={fine}
                onShop={onShop}
              />
            </ViewTransition>
          ))}
        </div>
      </div>

      <p aria-live="polite" className="sr-only">
        Showing {shown.length} of {GAMES.length} games. {sortLabel.said}
      </p>

      <style>{`
.pf-chip[aria-pressed=true]{background:var(--chip);border-color:var(--chip)}
.pf-sort .pf-chip[aria-pressed=true]{box-shadow:inset 0 0 0 1px rgba(0,229,255,.5)}
.pf-chip:focus-visible{border-radius:.5rem}
.pf-sort .pf-chip:focus-visible,.pf-store:focus-visible{border-radius:.375rem}
.pf-chips[data-pill-ready]>.pf-chip[aria-pressed=true]{background:transparent;border-color:transparent;box-shadow:none}
.pf-pill{opacity:0;transition:transform .42s var(--ease-pop),width .42s var(--ease-pop),height .3s ease,background-color .3s ease}
.pf-chips[data-pill-ready]>.pf-pill{opacity:1}
.pf-sort>.pf-pill{box-shadow:inset 0 0 0 1px rgba(0,229,255,.55),0 0 18px -6px rgba(0,229,255,.8)}

.pf-card{--pf-mx:50%;--pf-my:50%;--pf-o:0}
.pf-holo{opacity:calc(var(--pf-o)*.4);mix-blend-mode:screen;background:repeating-linear-gradient(112deg,rgba(255,45,119,0) 0%,rgba(255,45,119,.5) 1.6%,rgba(255,176,32,.45) 3.2%,rgba(200,255,46,.4) 4.8%,rgba(0,229,255,.5) 6.4%,rgba(139,92,246,.5) 8%,rgba(139,92,246,0) 9.6%,rgba(139,92,246,0) 13%);background-size:200% 200%;background-position:var(--pf-mx) var(--pf-my);-webkit-mask-image:radial-gradient(farthest-side circle at var(--pf-mx) var(--pf-my),#000 0%,rgba(0,0,0,.45) 55%,transparent 100%);mask-image:radial-gradient(farthest-side circle at var(--pf-mx) var(--pf-my),#000 0%,rgba(0,0,0,.45) 55%,transparent 100%);visibility:hidden;transition:opacity .35s ease-out,visibility 0s linear .35s}
.pf-foil{opacity:calc(var(--pf-o)*.8);mix-blend-mode:color-dodge;background:repeating-linear-gradient(125deg,rgba(255,45,119,0) 0%,rgba(255,45,119,.6) 6%,rgba(255,176,32,.55) 11%,rgba(200,255,46,.5) 16%,rgba(0,229,255,.6) 21%,rgba(139,92,246,.6) 26%,rgba(139,92,246,0) 32%,rgba(139,92,246,0) 44%);background-size:300% 300%;background-position:var(--pf-mx) var(--pf-my);visibility:hidden;transition:opacity .35s ease-out,visibility 0s linear .35s}
.pf-glare{opacity:var(--pf-o);background:radial-gradient(farthest-corner circle at var(--pf-mx) var(--pf-my),rgba(255,255,255,.07),rgba(255,255,255,.015) 35%,transparent 60%);visibility:hidden;transition:opacity .35s ease-out,visibility 0s linear .35s}
.pf-card[data-lit]>.pf-holo,.pf-card[data-lit]>.pf-glare,.pf-card[data-lit] .pf-foil{visibility:visible;transition:opacity .35s ease-out,visibility 0s}
@media (hover:none){
  .pf-holo,.pf-foil{visibility:visible}
  .pf-holo{opacity:.18;--pf-mx:22%;--pf-my:12%}
  .pf-foil{opacity:.3;background-position:35% 30%}
}

@media (prefers-reduced-motion:no-preference){
  .pf-chip{transition-property:color,background-color,border-color,scale}
  .pf-chip[aria-pressed=false]:active{scale:.94}
  .pf-card[data-reveal][data-revealed=""] .pf-meter{animation:pf-meter 1.1s cubic-bezier(.16,1,.3,1) calc(var(--reveal-delay,0ms) + 220ms) backwards}
}
@keyframes pf-meter{from{transform:scaleX(0)}}

::view-transition-group(.pf-move){animation-duration:.52s;animation-timing-function:cubic-bezier(.2,.9,.25,1.04)}
::view-transition-new(.pf-enter):only-child{animation:pf-vt-in .38s cubic-bezier(.2,.9,.25,1) .1s both}
::view-transition-old(.pf-exit):only-child{animation:pf-vt-out .2s ease-in both}
:root:active-view-transition-type(${SHUFFLE})::view-transition-old(root){display:none}
:root:active-view-transition-type(${SHUFFLE})::view-transition-new(root){animation:none}
@keyframes pf-vt-in{from{opacity:0;transform:translateY(18px) scale(.86);filter:blur(4px)}}
@keyframes pf-vt-out{to{opacity:0;transform:scale(.88);filter:blur(4px)}}
${stagger}
`}</style>
    </Section>
  );
}
