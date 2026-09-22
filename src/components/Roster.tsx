"use client";

import { useCallback, useRef, useState } from "react";
import {
  ACCENT_HEX,
  CHARACTERS,
  byId,
  spriteSrc,
  type Character,
} from "@/data/characters";
import { useGame } from "@/lib/game-state";
import { sfx } from "@/lib/audio";
import { Section, SectionHead } from "./Section";
import { Coin } from "./GameUi";

const STAT_LABELS = ["PWR", "SPD", "LCK"] as const;

function StatRow({ label, v, hex }: { label: string; v: number; hex: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="mono w-8 text-[10px] tracking-[0.14em] text-muted">
        {label}
      </span>
      <div className="flex gap-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <span
            key={i}
            className="h-2.5 w-4 rounded-[2px] transition-colors duration-300 sm:w-5"
            style={{ background: i < v ? hex : "#22223a" }}
          />
        ))}
      </div>
    </div>
  );
}

export default function Roster() {
  const { characterId, setCharacterId } = useGame();
  const [preview, setPreview] = useState<string>(characterId);
  const [slam, setSlam] = useState(0);
  const gridRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Keep the preview in sync when the choice changes elsewhere (for example
  // from the hero card). Adjusting during render beats a sync effect.
  const [lastChoice, setLastChoice] = useState(characterId);
  if (lastChoice !== characterId) {
    setLastChoice(characterId);
    setPreview(characterId);
  }

  const active: Character = byId(preview);
  const hex = ACCENT_HEX[active.accent];

  const columns = useCallback(() => {
    const tiles = tileRefs.current.filter(Boolean) as HTMLButtonElement[];
    if (tiles.length < 2) return 1;
    const top = tiles[0].offsetTop;
    let n = 0;
    for (const t of tiles) {
      if (t.offsetTop !== top) break;
      n++;
    }
    return Math.max(1, n);
  }, []);

  const focusIndex = (i: number) => {
    const clamped = Math.max(0, Math.min(CHARACTERS.length - 1, i));
    const el = tileRefs.current[clamped];
    if (el) {
      el.focus();
      setPreview(CHARACTERS[clamped].id);
      sfx.hover();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const cols = columns();
    const map: Record<string, number> = {
      ArrowRight: i + 1,
      ArrowLeft: i - 1,
      ArrowDown: i + cols,
      ArrowUp: i - cols,
      Home: 0,
      End: CHARACTERS.length - 1,
    };
    if (e.key in map) {
      e.preventDefault();
      focusIndex(map[e.key]);
      return;
    }
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      choose(CHARACTERS[i].id);
    }
  };

  const choose = (id: string) => {
    setCharacterId(id);
    setPreview(id);
    setSlam((s) => s + 1);
    sfx.select();
  };

  return (
    <Section id="roster">
      <SectionHead
        index="03"
        kicker="Original IP"
        title="CHOOSE YOUR FIGHTER"
        accent="lime"
        lead={
          <>
            Over <strong className="text-ink">400 original characters</strong>{" "}
            have been drawn in house. This is the Sword Knight cast — pick one and
            they will follow you through the rest of the site. Press{" "}
            <kbd className="mono rounded border border-edge bg-panel px-1.5 py-0.5 text-[11px] text-ink">
              G
            </kbd>{" "}
            afterwards and you can actually walk them around the page.
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)] lg:gap-8">
        {/* ---------- preview ---------- */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <div
            key={slam}
            className="panel scanlines relative overflow-hidden p-5 motion-safe:animate-[slam_.42s_var(--ease-pop)]"
            style={{ borderColor: `${hex}55` }}
          >
            <div
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-40 opacity-25 blur-2xl"
              style={{ background: hex }}
            />

            <div className="relative flex items-end justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={spriteSrc(active.id)}
                alt={`${active.name}, ${active.role}`}
                width={active.w}
                height={active.h}
                className="sprite h-[190px] w-auto motion-safe:bob-slow sm:h-[220px]"
              />
            </div>

            <div
              aria-hidden="true"
              className="mx-auto mb-5 h-3 w-32 rounded-[50%] bg-black/60 blur-[5px]"
            />

            <p
              className="mono text-[10px] uppercase tracking-[0.24em]"
              style={{ color: hex }}
            >
              {active.role}
            </p>
            <p className="font-display text-[clamp(1.6rem,4vw,2.2rem)] leading-none">
              {active.name}
            </p>

            <div className="mt-4 space-y-2">
              {STAT_LABELS.map((l, i) => (
                <StatRow key={l} label={l} v={active.stats[i]} hex={hex} />
              ))}
            </div>

            <p className="mt-4 min-h-[3.5rem] text-sm leading-relaxed text-muted">
              {active.bio}
            </p>

            <button
              type="button"
              onClick={() => choose(active.id)}
              disabled={characterId === active.id}
              className="mt-4 w-full rounded-lg px-4 py-3 font-display text-sm tracking-wide transition-all duration-200 disabled:cursor-default"
              style={
                characterId === active.id
                  ? { background: "#1a1a28", color: hex, border: `1px solid ${hex}66` }
                  : { background: hex, color: "#06060a" }
              }
            >
              {characterId === active.id ? "✓ SELECTED" : "SELECT FIGHTER"}
            </button>
          </div>
        </div>

        {/* ---------- grid ---------- */}
        <div className="relative">
          <Coin id="roster" label="the roster grid" className="-top-8 right-1" />
          <div
            ref={gridRef}
            role="radiogroup"
            aria-label="Choose your character"
            className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 md:grid-cols-5 xl:grid-cols-6"
          >
            {CHARACTERS.map((c, i) => {
              const selected = characterId === c.id;
              const focused = preview === c.id;
              const chex = ACCENT_HEX[c.accent];
              return (
                <button
                  key={c.id}
                  ref={(el) => {
                    tileRefs.current[i] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={focused ? 0 : -1}
                  onKeyDown={(e) => onKeyDown(e, i)}
                  onFocus={() => setPreview(c.id)}
                  onMouseEnter={() => {
                    setPreview(c.id);
                    sfx.hover();
                  }}
                  onClick={() => choose(c.id)}
                  className={`group relative aspect-square overflow-hidden rounded-xl border bg-gradient-to-b from-panel to-abyss p-1.5 transition-all duration-200 hover:-translate-y-1 ${
                    selected
                      ? "border-transparent"
                      : focused
                        ? "border-edge"
                        : "border-edge/50"
                  }`}
                  style={
                    selected
                      ? { borderColor: chex, boxShadow: `0 0 0 1px ${chex}, 0 8px 28px -12px ${chex}` }
                      : undefined
                  }
                >
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-1/2 opacity-0 blur-xl transition-opacity duration-300 group-hover:opacity-40"
                    style={{ background: chex }}
                  />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={spriteSrc(c.id)}
                    alt=""
                    width={c.w}
                    height={c.h}
                    loading="lazy"
                    className="sprite relative mx-auto h-[68%] w-auto transition-transform duration-200 group-hover:scale-110 sm:h-[70%]"
                  />
                  <span className="mono relative block truncate px-0.5 pb-0.5 text-center text-[9px] uppercase tracking-[0.1em] text-muted transition-colors group-hover:text-ink">
                    {c.name}
                  </span>
                  {selected && (
                    <span
                      className="mono absolute left-1.5 top-1.5 rounded px-1 py-0.5 text-[8px] font-bold tracking-[0.1em] text-void"
                      style={{ background: chex }}
                    >
                      P1
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <p className="mono mt-4 text-[11px] uppercase tracking-[0.16em] text-muted">
            23 of 400+ shown · arrow keys to browse · enter to select
          </p>
        </div>
      </div>

      <style>{`@keyframes slam{0%{transform:scale(1.06) translateY(-6px);filter:brightness(1.7)}60%{transform:scale(.99)}100%{transform:scale(1);filter:none}}`}</style>
    </Section>
  );
}
