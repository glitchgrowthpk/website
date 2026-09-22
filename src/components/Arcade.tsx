"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  COLS,
  ROWS,
  adjacent,
  clearCells,
  collapse,
  colOf,
  damageFor,
  findMatches,
  hasMove,
  idx,
  makeBoard,
  rowOf,
  swapped,
  type Board,
} from "@/lib/match3";
import { byId, spriteSrc } from "@/data/characters";
import { useGame } from "@/lib/game-state";
import { useReducedMotion } from "@/lib/hooks";
import { sfx } from "@/lib/audio";
import { Section, SectionHead } from "./Section";
import { Coin } from "./GameUi";

/** The five board pieces, drawn from the studio's own character IP. */
const GEMS = ["chili", "cube", "slice", "egg", "potato"];
const GEM_NAMES = ["Habanero", "Cube", "Slice", "Egg", "Spud"];
const GEM_TINT = ["#ff2d77", "#c8ff2e", "#7dd13f", "#e8e8f0", "#ffb020"];

const BOSS_HP = 260;
const HERO_HP = 100;
const BOSS_PERIOD = 7000;

type Phase = "idle" | "playing" | "won" | "lost";

interface Float {
  key: number;
  text: string;
  x: number;
  y: number;
  crit: boolean;
}

export default function Arcade() {
  const { characterId } = useGame();
  const reduced = useReducedMotion();

  // Seeded so the idle board is present in the server HTML and hydrates cleanly.
  const [board, setBoard] = useState<Board>(() => makeBoard(20260921));
  const [phase, setPhase] = useState<Phase>("idle");
  const [bossHp, setBossHp] = useState(BOSS_HP);
  const [heroHp, setHeroHp] = useState(HERO_HP);
  const [sel, setSel] = useState<number | null>(null);
  const [cursor, setCursor] = useState(idx(3, 3));
  const [clearing, setClearing] = useState<number[]>([]);
  const [shake, setShake] = useState(0);
  const [bossFlash, setBossFlash] = useState(0);
  const [combo, setCombo] = useState(0);
  const [floats, setFloats] = useState<Float[]>([]);
  const [announce, setAnnounce] = useState("");

  const busy = useRef(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const chargeRef = useRef<HTMLDivElement>(null);
  const secRef = useRef<HTMLSpanElement>(null);
  const floatKey = useRef(0);
  const dragFrom = useRef<{ i: number; x: number; y: number } | null>(null);
  const onScreen = useRef(true);

  const hero = byId(characterId);
  const boss = byId("minotaur");
  const pause = useCallback(
    (ms: number) => new Promise((r) => setTimeout(r, reduced ? 0 : ms)),
    [reduced],
  );

  /* ------------------------------------------------------------ lifecycle */

  const start = useCallback(() => {
    setBoard(makeBoard());
    setBossHp(BOSS_HP);
    setHeroHp(HERO_HP);
    setSel(null);
    setCombo(0);
    setFloats([]);
    setPhase("playing");
    setAnnounce("Fight started. Match three or more to attack.");
    sfx.select();
  }, []);

  // Only fight while the board is actually on screen — nobody should lose a
  // round because they scrolled away to read the portfolio.
  useEffect(() => {
    const el = boardRef.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      ([e]) => {
        onScreen.current = e.isIntersecting;
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  /**
   * Boss attack timer. The charge bar is written straight to the DOM so a
   * 60fps telegraph never re-renders the 49-tile board.
   */
  useEffect(() => {
    if (phase !== "playing") return;
    let raf = 0;
    let t0 = performance.now();
    let paused = 0;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);

      if (!onScreen.current || document.visibilityState !== "visible") {
        paused = now;
        return;
      }
      if (paused) {
        t0 += now - paused; // resume where the telegraph left off
        paused = 0;
      }

      const p = Math.min(1, (now - t0) / BOSS_PERIOD);
      if (chargeRef.current) chargeRef.current.style.width = `${p * 100}%`;
      if (secRef.current) {
        secRef.current.textContent = `${Math.ceil((1 - p) * (BOSS_PERIOD / 1000))}s`;
      }

      if (p >= 1) {
        t0 = now;
        const dmg = 9 + Math.floor(Math.random() * 7);
        setHeroHp((h) => {
          const next = Math.max(0, h - dmg);
          if (next === 0) {
            setPhase("lost");
            setAnnounce("Defeated. Taurus wins this round.");
            sfx.defeat();
          }
          return next;
        });
        setShake((s) => s + 1);
        sfx.hit();
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  const addFloat = (text: string, crit: boolean) => {
    floatKey.current += 1;
    const f: Float = {
      key: floatKey.current,
      text,
      x: 30 + Math.random() * 40,
      y: 30 + Math.random() * 20,
      crit,
    };
    setFloats((prev) => [...prev, f]);
    setTimeout(
      () => setFloats((prev) => prev.filter((p) => p.key !== f.key)),
      1000,
    );
  };

  /* ------------------------------------------------------------- resolve */

  const resolve = useCallback(
    async (from: Board) => {
      let b = from;
      let cascade = 0;
      let total = 0;

      for (;;) {
        const m = findMatches(b);
        if (!m.length) break;

        setClearing(m);
        sfx.match(cascade);
        setCombo(cascade + 1);
        const dmg = damageFor(m.length, cascade);
        total += dmg;
        addFloat(`-${dmg}`, m.length >= 4 || cascade > 0);

        // Land each hit as it happens so the bar tracks the damage numbers.
        setBossFlash((f) => f + 1);
        setBossHp((hp) => {
          const next = Math.max(0, hp - dmg);
          if (next === 0) {
            setPhase("won");
            setAnnounce("Victory. Taurus is down.");
            sfx.victory();
          }
          return next;
        });
        await pause(210);

        b = clearCells(b, m);
        setBoard(b);
        setClearing([]);
        await pause(70);

        b = collapse(b);
        setBoard(b);
        await pause(230);
        cascade++;
      }

      if (total) {
        setAnnounce(
          `${total} damage dealt${cascade > 1 ? ` with a ${cascade}x cascade` : ""}.`,
        );
      }

      // Deadlock guard — reshuffle rather than stranding the player.
      if (!hasMove(b)) {
        setAnnounce("No moves left — board reshuffled.");
        b = makeBoard();
        setBoard(b);
        await pause(200);
      }

      setCombo(0);
      busy.current = false;
    },
    [pause],
  );

  const attempt = useCallback(
    async (a: number, c: number) => {
      if (busy.current || phase !== "playing") return;
      if (!adjacent(a, c)) return;
      busy.current = true;
      setSel(null);
      sfx.swap();

      const next = swapped(board, a, c);
      setBoard(next);
      await pause(180);

      if (!findMatches(next).length) {
        setBoard(board); // bounce back
        setShake((s) => s + 1);
        setAnnounce("No match there.");
        await pause(180);
        busy.current = false;
        return;
      }
      await resolve(next);
    },
    [board, phase, resolve, pause],
  );

  /* -------------------------------------------------------------- input */

  const onCellDown = (i: number) => (e: React.PointerEvent) => {
    if (phase !== "playing") return;
    dragFrom.current = { i, x: e.clientX, y: e.clientY };
    setCursor(i);
    if (sel === null) {
      setSel(i);
    } else if (sel === i) {
      setSel(null);
    } else if (adjacent(sel, i)) {
      void attempt(sel, i);
    } else {
      setSel(i);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const from = dragFrom.current;
    dragFrom.current = null;
    if (!from || phase !== "playing") return;
    const dx = e.clientX - from.x;
    const dy = e.clientY - from.y;
    if (Math.abs(dx) < 16 && Math.abs(dy) < 16) return;

    const r = rowOf(from.i);
    const c = colOf(from.i);
    let target = -1;
    if (Math.abs(dx) > Math.abs(dy)) {
      const nc = c + (dx > 0 ? 1 : -1);
      if (nc >= 0 && nc < COLS) target = idx(r, nc);
    } else {
      const nr = r + (dy > 0 ? 1 : -1);
      if (nr >= 0 && nr < ROWS) target = idx(nr, c);
    }
    if (target >= 0) void attempt(from.i, target);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (phase !== "playing") return;
    const r = rowOf(cursor);
    const c = colOf(cursor);
    const move: Record<string, [number, number]> = {
      ArrowUp: [r - 1, c],
      ArrowDown: [r + 1, c],
      ArrowLeft: [r, c - 1],
      ArrowRight: [r, c + 1],
    };
    if (e.key in move) {
      e.preventDefault();
      const [nr, nc] = move[e.key];
      if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) return;
      const target = idx(nr, nc);
      if (sel !== null && adjacent(sel, target)) {
        void attempt(sel, target);
      } else {
        setCursor(target);
      }
      return;
    }
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      setSel((s) => (s === cursor ? null : cursor));
      sfx.hover();
    }
    if (e.key === "Escape") setSel(null);
  };

  /* -------------------------------------------------------------- render */

  const cellPct = 100 / COLS;

  return (
    <Section id="arcade">
      <SectionHead
        index="05"
        kicker="Playable demo"
        title="THE ARCADE"
        accent="violet"
        lead="Reading about a match-3 studio is not the same as playing one. This is a working board built for this page — clear gems to damage Taurus before he drops you. It is the same loop that powers Puzzle Warrior."
      />

      <div className="grid max-w-[960px] gap-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-5">
        {/* ---------------- board ---------------- */}
        <div
          key={shake}
          className="panel scanlines relative overflow-hidden p-3 motion-safe:animate-[shake_.32s_ease-out] sm:p-5"
        >
          <Coin id="arcade" label="the arcade board" className="bottom-1 left-3" />

          {/* HUD */}
          <div className="mb-3 flex items-center gap-3">
            <div className="flex-1">
              <div className="mb-1 flex items-baseline justify-between">
                <span className="mono text-[10px] uppercase tracking-[0.16em] text-muted">
                  {hero.name}
                </span>
                <span className="mono text-[10px] tabular-nums text-cyan">
                  {heroHp}/{HERO_HP}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-panel-2">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan to-lime transition-[width] duration-300"
                  style={{ width: `${(heroHp / HERO_HP) * 100}%` }}
                />
              </div>
            </div>

            {combo > 1 && (
              <span className="mono rounded border border-lime bg-lime/15 px-2 py-1 text-[11px] font-bold text-lime">
                {combo}× COMBO
              </span>
            )}

            <div className="flex-1">
              <div className="mb-1 flex items-baseline justify-between">
                <span className="mono text-[10px] uppercase tracking-[0.16em] text-magenta">
                  Taurus
                </span>
                <span className="mono text-[10px] tabular-nums text-magenta">
                  {bossHp}/{BOSS_HP}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-panel-2">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-magenta to-violet transition-[width] duration-300"
                  style={{ width: `${(bossHp / BOSS_HP) * 100}%` }}
                />
              </div>
            </div>
          </div>

          {/* grid */}
          <div
            ref={boardRef}
            role="application"
            aria-roledescription="Match three game board"
            aria-label="Match three board. Arrow keys move, space selects, arrow again swaps."
            tabIndex={phase === "playing" ? 0 : -1}
            onKeyDown={onKeyDown}
            onPointerUp={onPointerUp}
            className="relative mx-auto aspect-square w-full max-w-[520px] touch-none rounded-xl border border-edge bg-abyss/80"
          >
            {board.map((g, i) => {
              if (!g) return null;
              const r = rowOf(i);
              const c = colOf(i);
              const isClearing = clearing.includes(i);
              const isSel = sel === i;
              const isCursor = cursor === i && phase === "playing";
              return (
                <button
                  key={g.id}
                  type="button"
                  tabIndex={-1}
                  aria-label={`${GEM_NAMES[g.type]} at row ${r + 1}, column ${c + 1}`}
                  onPointerDown={onCellDown(i)}
                  className="absolute grid place-items-center transition-[left,top] duration-[220ms] ease-out"
                  style={{
                    left: `${c * cellPct}%`,
                    top: `${r * cellPct}%`,
                    width: `${cellPct}%`,
                    height: `${cellPct}%`,
                  }}
                >
                  <span
                    className={`grid h-[86%] w-[86%] place-items-center rounded-lg border transition-all duration-200 ${
                      isSel
                        ? "scale-110 border-cyan bg-cyan/20"
                        : isCursor
                          ? "border-ink/60 bg-panel-2/70"
                          : "border-transparent bg-panel-2/40"
                    } ${isClearing ? "scale-0 opacity-0" : "scale-100 opacity-100"}`}
                    style={
                      isSel
                        ? { boxShadow: "0 0 18px -4px #00e5ff" }
                        : undefined
                    }
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={spriteSrc(GEMS[g.type])}
                      alt=""
                      className="sprite h-[78%] w-auto"
                      style={{
                        filter: `drop-shadow(0 2px 6px ${GEM_TINT[g.type]}55)`,
                      }}
                      draggable={false}
                    />
                  </span>
                </button>
              );
            })}

            {/* damage numbers */}
            {floats.map((f) => (
              <span
                key={f.key}
                aria-hidden="true"
                className={`pointer-events-none absolute font-display tabular-nums motion-safe:animate-[rise_1s_ease-out_forwards] ${
                  f.crit ? "text-2xl text-lime" : "text-xl text-magenta"
                }`}
                style={{ left: `${f.x}%`, top: `${f.y}%` }}
              >
                {f.text}
              </span>
            ))}

            {/* overlays */}
            {phase !== "playing" && (
              <div className="absolute inset-0 grid place-items-center rounded-xl bg-void/88 backdrop-blur-sm">
                <div className="px-6 text-center">
                  {phase === "idle" && (
                    <>
                      <p className="font-display text-[clamp(1.6rem,5vw,2.4rem)] leading-none">
                        DUNGEON FIGHT
                      </p>
                      <p className="mx-auto mt-3 max-w-xs text-sm text-muted">
                        Match three or more to swing. Taurus hits back every few
                        seconds.
                      </p>
                    </>
                  )}
                  {phase === "won" && (
                    <>
                      <p className="font-display text-[clamp(1.8rem,6vw,3rem)] leading-none text-lime">
                        VICTORY
                      </p>
                      <p className="mx-auto mt-3 max-w-xs text-sm text-muted">
                        That is the Puzzle Warrior loop — a casual board driving
                        real combat.
                      </p>
                      <a
                        href="https://play.google.com/store/apps/details?id=com.glitchtech.puzzlewarrior.rpg"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mono mt-4 inline-block rounded-lg bg-lime px-4 py-2.5 text-[11px] uppercase tracking-[0.14em] text-void"
                      >
                        Play the real thing
                      </a>
                    </>
                  )}
                  {phase === "lost" && (
                    <>
                      <p className="font-display text-[clamp(1.8rem,6vw,3rem)] leading-none text-magenta">
                        DEFEATED
                      </p>
                      <p className="mx-auto mt-3 max-w-xs text-sm text-muted">
                        Taurus is the wall every soft launch runs into. Try a
                        different fighter.
                      </p>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={start}
                    className="mt-4 block w-full rounded-lg bg-gradient-to-r from-cyan to-violet px-6 py-3 font-display text-sm tracking-wide text-void transition-transform hover:scale-105 active:scale-95"
                  >
                    {phase === "idle" ? "PRESS START" : "FIGHT AGAIN"}
                  </button>
                </div>
              </div>
            )}
          </div>

          <p aria-live="polite" className="sr-only">
            {announce}
          </p>

          <p className="mono mt-3 text-center text-[10px] uppercase tracking-[0.14em] text-muted">
            Drag or tap two neighbours · arrow keys + space also work
          </p>
        </div>

        {/* ---------------- boss panel ---------------- */}
        <aside className="panel relative flex flex-col overflow-hidden p-5">
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-48 bg-magenta/20 blur-3xl"
          />
          <p className="label relative">Boss</p>
          <div key={bossFlash} className="relative mt-2 flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={spriteSrc(boss.id)}
              alt="Taurus, the minotaur boss"
              width={boss.w}
              height={boss.h}
              className={`sprite h-[170px] w-auto motion-safe:bob-slow ${
                bossFlash ? "motion-safe:animate-[flash_.3s_ease-out]" : ""
              }`}
            />
          </div>
          <p className="relative font-display text-2xl leading-none">TAURUS</p>
          <p className="mono relative text-[10px] uppercase tracking-[0.2em] text-magenta">
            Minotaur · Boss
          </p>

          {/* attack telegraph */}
          <div className="relative mt-4">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="mono text-[10px] uppercase tracking-[0.16em] text-muted">
                Next attack
              </span>
              <span ref={secRef} className="mono text-[10px] text-amber">
                {phase === "playing" ? `${BOSS_PERIOD / 1000}s` : "—"}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-panel-2">
              <div
                ref={chargeRef}
                className="h-full rounded-full bg-gradient-to-r from-amber to-magenta"
                style={{ width: "0%" }}
              />
            </div>
          </div>

          <div className="relative mt-5 space-y-2 border-t border-edge/60 pt-4">
            <p className="label">Board pieces</p>
            <ul className="grid grid-cols-5 gap-1.5">
              {GEMS.map((g, i) => (
                <li
                  key={g}
                  className="grid aspect-square place-items-center rounded-md border border-edge bg-panel-2/50"
                  title={GEM_NAMES[i]}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={spriteSrc(g)}
                    alt={GEM_NAMES[i]}
                    className="sprite h-[64%] w-auto"
                  />
                </li>
              ))}
            </ul>
            <p className="text-[12px] leading-relaxed text-muted">
              Every piece is original studio art. Four in a row crits, cascades
              multiply the hit.
            </p>
          </div>
        </aside>
      </div>

      <style>{`
        @keyframes rise{0%{transform:translateY(0) scale(.8);opacity:0}25%{transform:translateY(-10px) scale(1.15);opacity:1}100%{transform:translateY(-52px) scale(1);opacity:0}}
        @keyframes shake{0%,100%{transform:translateX(0)}22%{transform:translateX(-7px)}48%{transform:translateX(6px)}74%{transform:translateX(-3px)}}
        @keyframes flash{0%{filter:brightness(3.2) saturate(0)}100%{filter:none}}
      `}</style>
    </Section>
  );
}
