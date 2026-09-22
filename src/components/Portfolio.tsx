"use client";

import Image from "next/image";
import { useMemo, useRef, useState } from "react";
import { GAMES, GENRES, type Game, type Genre } from "@/data/games";
import { sfx } from "@/lib/audio";
import { useReducedMotion } from "@/lib/hooks";
import { Section, SectionHead } from "./Section";
import { Coin } from "./GameUi";

const GENRE_ACCENT: Record<Genre, string> = {
  Puzzle: "#00e5ff",
  Casual: "#c8ff2e",
  Strategy: "#ff2d77",
  RPG: "#8b5cf6",
};

function StoreLink({
  href,
  children,
  accent,
}: {
  href: string;
  children: React.ReactNode;
  accent: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      onMouseEnter={() => sfx.hover()}
      className="mono flex flex-1 items-center justify-center gap-1.5 rounded-md border border-edge bg-panel-2/70 px-2 py-2 text-[10px] uppercase tracking-[0.12em] text-muted transition-colors hover:text-void"
      style={{ ["--a" as string]: accent }}
      onMouseOver={(e) => {
        e.currentTarget.style.background = accent;
        e.currentTarget.style.borderColor = accent;
        e.currentTarget.style.color = "#06060a";
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.background = "";
        e.currentTarget.style.borderColor = "";
        e.currentTarget.style.color = "";
      }}
    >
      {children}
    </a>
  );
}

function GameCard({ game, reduced }: { game: Game; reduced: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const accent = GENRE_ACCENT[game.genre];

  const onMove = (e: React.PointerEvent) => {
    if (reduced || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    ref.current.style.transform = `perspective(900px) rotateY(${px * 11}deg) rotateX(${-py * 11}deg) translateY(-6px)`;
  };
  const reset = () => {
    if (ref.current) ref.current.style.transform = "";
  };

  return (
    <article
      ref={ref}
      data-solid=""
      onPointerMove={onMove}
      onPointerLeave={reset}
      className="panel group relative flex flex-col overflow-hidden p-4 transition-transform duration-200 ease-out will-change-transform"
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

      <div className="flex items-start gap-3.5">
        <div className="relative shrink-0">
          <Image
            src={`/games/${game.slug}.webp`}
            alt=""
            width={72}
            height={72}
            className="rounded-[18px] border border-edge shadow-lg transition-transform duration-300 group-hover:scale-105"
            sizes="72px"
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

      <p className="mt-3.5 flex-1 text-pretty text-[13px] leading-relaxed text-muted">
        {game.tagline}
      </p>

      {/* install meter */}
      <div className="mt-3.5">
        <div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
          <div
            className="h-full rounded-full transition-[width] duration-700 ease-out"
            style={{ width: `${game.reach * 100}%`, background: accent }}
          />
        </div>
      </div>

      <div className="mt-3.5 flex gap-2">
        {game.play && (
          <StoreLink href={game.play} accent={accent}>
            Google Play
          </StoreLink>
        )}
        {game.ios && (
          <StoreLink href={game.ios} accent={accent}>
            App Store
          </StoreLink>
        )}
      </div>
    </article>
  );
}

export default function Portfolio() {
  const [filter, setFilter] = useState<Genre | "All">("All");
  const reduced = useReducedMotion();

  const shown = useMemo(
    () => (filter === "All" ? GAMES : GAMES.filter((g) => g.genre === filter)),
    [filter],
  );

  const counts = useMemo(() => {
    const m = new Map<string, number>([["All", GAMES.length]]);
    GENRES.forEach((g) => m.set(g, GAMES.filter((x) => x.genre === g).length));
    return m;
  }, []);

  return (
    <Section id="portfolio">
      <SectionHead
        index="04"
        kicker="Shipped and live"
        title="THE PORTFOLIO"
        accent="cyan"
        lead="Twelve titles on Google Play and the App Store, every icon and screenshot made in house. Tap through to any store listing."
      />

      <div
        role="tablist"
        aria-label="Filter games by genre"
        className="mb-8 flex flex-wrap gap-2"
      >
        {(["All", ...GENRES] as const).map((g) => {
          const on = filter === g;
          const accent = g === "All" ? "#f2f3f7" : GENRE_ACCENT[g];
          return (
            <button
              key={g}
              role="tab"
              aria-selected={on}
              onClick={() => {
                setFilter(g);
                sfx.swap();
              }}
              onMouseEnter={() => sfx.hover()}
              className={`mono rounded-lg border px-3.5 py-2 text-[11px] uppercase tracking-[0.14em] transition-all duration-200 ${
                on ? "text-void" : "border-edge bg-panel text-muted hover:text-ink"
              }`}
              style={on ? { background: accent, borderColor: accent } : undefined}
            >
              {g}
              <span className={on ? "opacity-70" : "text-muted"}>
                {" "}
                {counts.get(g)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="relative">
        <Coin id="portfolio" label="the games grid" className="-top-9 left-1/2" />
        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
          {shown.map((g) => (
            <GameCard key={g.slug} game={g} reduced={reduced} />
          ))}
        </div>
      </div>

      <p aria-live="polite" className="sr-only">
        Showing {shown.length} of {GAMES.length} games.
      </p>
    </Section>
  );
}
