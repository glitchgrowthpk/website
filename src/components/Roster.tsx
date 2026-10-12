"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ACCENT_HEX,
  CHARACTERS,
  byId,
  spriteSrc,
  type Character,
} from "@/data/characters";
import { useGame } from "@/lib/game-state";
import { sfx } from "@/lib/audio";
import { fx } from "@/lib/fx";
import { useFinePointer, useReducedMotion } from "@/lib/hooks";
import { Section, SectionHead } from "./Section";
import { Coin } from "./GameUi";

const STAT_LABELS = ["PWR", "SPD", "LCK"] as const;

/** How long the READY splash owns the screen. The CSS keyframes below share it. */
const SPLASH_MS = 900;
/** Cursor hops in a random roll. The gaps between them grow, so it decelerates. */
const ROLL_TICKS = 15;

/** A random integer in [0, n). Only ever called from handlers and timers. */
const randomInt = (n: number) => Math.floor(Math.random() * n);

/** The preview panel's impact when a fighter is locked in. */
const SLAM: Keyframe[] = [
  { transform: "scale(1.06) translateY(-6px)", filter: "brightness(1.7)" },
  { transform: "scale(.99)", offset: 0.6 },
  { transform: "scale(1)", filter: "none" },
];

function StatRow({
  label,
  v,
  hex,
  row,
}: {
  label: string;
  v: number;
  hex: string;
  row: number;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="mono w-8 text-[10px] tracking-[0.14em] text-muted">
        {label}
      </span>
      <div className="flex gap-1" aria-hidden="true">
        {Array.from({ length: 5 }).map((_, i) => (
          <span
            key={i}
            className="relative h-2.5 w-4 overflow-hidden rounded-[2px] bg-[#22223a] sm:w-5"
          >
            {i < v && (
              <span
                className="rst-fill absolute inset-0 origin-left"
                style={{
                  background: hex,
                  ["--rst-d" as string]: `${row * 90 + i * 55}ms`,
                }}
              />
            )}
          </span>
        ))}
      </div>
      <span className="sr-only">{v} of 5</span>
    </div>
  );
}

function Dice({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      className={`rst-dice shrink-0 ${spinning ? "rst-dice-roll" : ""}`}
    >
      <rect
        x="1.5"
        y="1.5"
        width="13"
        height="13"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <circle cx="5.2" cy="5.2" r="1.25" fill="currentColor" />
      <circle cx="8" cy="8" r="1.25" fill="currentColor" />
      <circle cx="10.8" cy="10.8" r="1.25" fill="currentColor" />
    </svg>
  );
}

/* ------------------------------------------------------------ READY splash */

/**
 * Fighting-game lock-in: an accent slash sweeps across the middle of the
 * viewport, the fighter slams in big, the name skids in and a READY! stamp
 * lands. Pure decoration — the choice itself is announced through the
 * section's live region — and never rendered under reduced motion.
 *
 * It sits just under the HUD (z-50), so the coin and level pills stay
 * readable while the rest of the page dims behind the band.
 */
function ReadySplash({ c, onDone }: { c: Character; onDone: () => void }) {
  const hex = ACCENT_HEX[c.accent];

  useEffect(() => {
    const t = window.setTimeout(onDone, SPLASH_MS + 40);
    return () => window.clearTimeout(t);
  }, [onDone]);

  return (
    <div
      aria-hidden="true"
      className="rst-splash pointer-events-none fixed inset-0 z-[49] overflow-hidden"
      style={{ ["--rst-hex" as string]: hex }}
    >
      <div className="rst-scrim absolute inset-0" />
      <div className="rst-shake absolute inset-0">
        <div className="rst-band-wrap">
          <div className="rst-band-thin rst-band-thin-a" />
          <div className="rst-band">
            <div className="rst-lines" />
          </div>
          <div className="rst-band-thin rst-band-thin-b" />
        </div>

        <div className="absolute inset-0 flex items-center justify-center gap-[clamp(8px,3vw,48px)] px-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={spriteSrc(c.id)}
            alt=""
            width={c.w}
            height={c.h}
            className="rst-hero sprite w-auto shrink-0"
          />
          <div className="rst-copy relative min-w-0">
            <p className="rst-name-in mono text-[clamp(10px,1.3vw,14px)] font-bold uppercase tracking-[0.3em] text-void">
              {c.role}
            </p>
            <p className="rst-name-in rst-name font-display leading-[0.9] text-ink">
              {c.name}
            </p>
            <span className="rst-stamp font-display absolute -bottom-[clamp(28px,4vw,58px)] right-0 whitespace-nowrap">
              READY!
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- preview tilt */

/**
 * Tilts the preview card toward a fine pointer, with the sprite and the glow
 * behind it drifting in opposite directions for depth. Everything is written
 * straight to the DOM from one rAF loop that stops as soon as it settles.
 */
function usePreviewTilt(enabled: boolean) {
  const tiltRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const spriteRef = useRef<HTMLDivElement>(null);
  const st = useRef({
    tx: 0,
    ty: 0,
    th: 0,
    x: 0,
    y: 0,
    h: 0,
    raf: 0,
    last: 0,
    rect: null as DOMRect | null,
  });

  const write = useCallback(() => {
    const s = st.current;
    const tilt = tiltRef.current;
    const at = s.h > 0.001 || Math.abs(s.x) > 0.001 || Math.abs(s.y) > 0.001;
    if (tilt) {
      tilt.style.transform = at
        ? `perspective(1100px) rotateX(${(-s.y * 7).toFixed(2)}deg) rotateY(${(s.x * 9).toFixed(2)}deg)`
        : "";
      tilt.style.setProperty("--rst-gx", `${(50 + s.x * 50).toFixed(1)}%`);
      tilt.style.setProperty("--rst-gy", `${(50 + s.y * 50).toFixed(1)}%`);
      tilt.style.setProperty("--rst-glare", s.h.toFixed(3));
    }
    if (spriteRef.current) {
      spriteRef.current.style.transform = at
        ? `translate3d(${(s.x * 10).toFixed(2)}px, ${(s.y * 6).toFixed(2)}px, 0)`
        : "";
    }
    if (glowRef.current) {
      glowRef.current.style.transform = at
        ? `translate3d(${(-s.x * 18).toFixed(2)}px, ${(-s.y * 10).toFixed(2)}px, 0)`
        : "";
    }
  }, []);

  const step = useCallback(
    function loop(now: number) {
      const s = st.current;
      const dt = s.last ? Math.min(48, now - s.last) : 16.7;
      s.last = now;
      // Frame-rate independent ease toward the pointer.
      const k = 1 - Math.pow(0.84, dt / 16.7);
      s.x += (s.tx - s.x) * k;
      s.y += (s.ty - s.y) * k;
      s.h += (s.th - s.h) * k;
      const settled =
        Math.abs(s.tx - s.x) < 0.002 &&
        Math.abs(s.ty - s.y) < 0.002 &&
        Math.abs(s.th - s.h) < 0.005;
      if (settled) {
        s.x = s.tx;
        s.y = s.ty;
        s.h = s.th;
      }
      write();
      if (settled) {
        s.raf = 0;
        s.last = 0;
        return;
      }
      s.raf = requestAnimationFrame(loop);
    },
    [write],
  );

  const kick = useCallback(() => {
    const s = st.current;
    if (!s.raf) s.raf = requestAnimationFrame(step);
  }, [step]);

  useEffect(() => {
    if (!enabled) return;
    const s = st.current;
    // The cached rect goes stale whenever the page moves under the pointer.
    const stale = () => {
      s.rect = null;
    };
    window.addEventListener("scroll", stale, { passive: true });
    window.addEventListener("resize", stale, { passive: true });
    return () => {
      window.removeEventListener("scroll", stale);
      window.removeEventListener("resize", stale);
      cancelAnimationFrame(s.raf);
      Object.assign(s, { tx: 0, ty: 0, th: 0, x: 0, y: 0, h: 0, raf: 0, last: 0 });
      write();
    };
  }, [enabled, write]);

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!enabled || e.pointerType === "touch") return;
    const s = st.current;
    // The listener sits on the untransformed wrapper, so this rect is the
    // card's resting position, not its tilted silhouette.
    if (!s.rect) s.rect = e.currentTarget.getBoundingClientRect();
    const r = s.rect;
    s.tx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
    s.ty = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
    s.th = 1;
    kick();
  };

  const onPointerLeave = () => {
    const s = st.current;
    s.tx = 0;
    s.ty = 0;
    s.th = 0;
    s.rect = null;
    kick();
  };

  return { tiltRef, glowRef, spriteRef, onPointerMove, onPointerLeave };
}

/* ----------------------------------------------------------------- roster */

export default function Roster() {
  const { characterId, setCharacterId, unlock, paused } = useGame();
  const reduced = useReducedMotion();
  const fine = useFinePointer();
  const [preview, setPreview] = useState<string>(characterId);
  const [rolling, setRolling] = useState(false);
  const [splash, setSplash] = useState<{ id: string; n: number } | null>(null);
  const [announce, setAnnounce] = useState("");
  const gridRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);
  const heroImgRef = useRef<HTMLImageElement>(null);
  const rollTimer = useRef(0);
  const splashCount = useRef(0);
  const pausedRef = useRef(paused);

  const { tiltRef, glowRef, spriteRef, onPointerMove, onPointerLeave } =
    usePreviewTilt(fine && !reduced);

  // Keep the preview in sync when the choice changes elsewhere (for example
  // from the hero card). Adjusting during render beats a sync effect.
  const [lastChoice, setLastChoice] = useState(characterId);
  if (lastChoice !== characterId) {
    setLastChoice(characterId);
    setPreview(characterId);
  }

  // Timers read the pause state through a ref so a roll in flight can wait
  // out the pause menu without being torn down and restarted.
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    const t = rollTimer;
    return () => window.clearTimeout(t.current);
  }, []);

  const endSplash = useCallback(() => setSplash(null), []);

  const active: Character = byId(preview);
  const hex = ACCENT_HEX[active.accent];
  const picked = characterId === active.id;

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

  const stopRoll = () => {
    window.clearTimeout(rollTimer.current);
    rollTimer.current = 0;
    setRolling(false);
  };

  const tileOf = (id: string) =>
    tileRefs.current[CHARACTERS.findIndex((c) => c.id === id)] ?? null;

  const choose = (id: string, how: "pick" | "random" = "pick") => {
    stopRoll();
    const c = byId(id);
    setCharacterId(id);
    setPreview(id);
    unlock("fighter");
    sfx.vs();
    fx.haptic(20);
    setAnnounce(
      how === "random"
        ? `Random pick: ${c.name}, ${c.role}. Ready!`
        : `${c.name} selected. Ready!`,
    );
    if (reduced) return;

    fx.flash(ACCENT_HEX[c.accent], 0.12);
    // Burst from the preview sprite if it is on screen; on a phone the
    // preview can be a full grid-height above, so fall back to the tile.
    const img = heroImgRef.current;
    const r = img?.getBoundingClientRect();
    const seen = r && r.bottom > 0 && r.top < window.innerHeight;
    fx.burstAt(seen ? img : tileOf(id), "select");
    panelRef.current?.animate(SLAM, {
      duration: 420,
      easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
    });
    splashCount.current += 1;
    setSplash({ id, n: splashCount.current });
  };

  /**
   * Character-select "random": the cursor hops across the grid, slowing down
   * like a roulette wheel, then locks in wherever it lands.
   */
  const roll = () => {
    if (rolling) return;
    const pool = CHARACTERS.filter((c) => c.id !== characterId);
    const target = pool[randomInt(pool.length)];
    if (reduced) {
      choose(target.id, "random");
      return;
    }
    const targetIdx = CHARACTERS.indexOf(target);
    let at = CHARACTERS.indexOf(active);
    let n = 0;
    setRolling(true);
    sfx.whoosh();

    const tick = () => {
      if (pausedRef.current || document.hidden) {
        rollTimer.current = window.setTimeout(tick, 150);
        return;
      }
      n++;
      if (n > ROLL_TICKS) {
        choose(target.id, "random");
        return;
      }
      let next = targetIdx;
      if (n < ROLL_TICKS) {
        // Never stand still, and keep the target out of the second-to-last
        // hop so the final tick always visibly lands somewhere new.
        do next = randomInt(CHARACTERS.length);
        while (next === at || (n === ROLL_TICKS - 1 && next === targetIdx));
      }
      at = next;
      setPreview(CHARACTERS[next].id);
      sfx.hover();
      const p = n / ROLL_TICKS;
      rollTimer.current = window.setTimeout(tick, 28 + 190 * p * p * p);
    };
    tick();
  };

  const focusIndex = (i: number) => {
    const clamped = Math.max(0, Math.min(CHARACTERS.length - 1, i));
    const el = tileRefs.current[clamped];
    if (el) {
      if (rolling) stopRoll();
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
        <div
          className="lg:sticky lg:top-24 lg:self-start"
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerLeave}
        >
          <div ref={tiltRef} className="rst-tilt">
            <div
              ref={panelRef}
              className="panel scanlines relative overflow-hidden p-5"
              style={{ borderColor: `${hex}55` }}
            >
              <div
                ref={glowRef}
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-40 opacity-25 blur-2xl transition-[background-color] duration-300"
                style={{ background: hex }}
              />

              <div
                ref={spriteRef}
                className="relative flex items-end justify-center"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={heroImgRef}
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

              {/* Keyed by character so the bars refill segment by segment on every change. */}
              <div
                key={active.id}
                className="rst-stats mt-4 space-y-2"
                data-anim={rolling ? undefined : ""}
              >
                {STAT_LABELS.map((l, i) => (
                  <StatRow key={l} label={l} v={active.stats[i]} hex={hex} row={i} />
                ))}
              </div>

              <p className="mt-4 min-h-[3.5rem] text-sm leading-relaxed text-muted">
                {active.bio}
              </p>

              {/* aria-disabled rather than disabled: a disabled button drops
                  keyboard focus to <body> the moment it is pressed. */}
              <button
                type="button"
                onClick={() => {
                  if (!picked) choose(active.id);
                }}
                aria-disabled={picked || undefined}
                data-cursor={picked ? undefined : "SELECT"}
                className="rst-cta mt-4 min-h-11 w-full rounded-lg px-4 py-3 font-display text-sm tracking-wide transition-all duration-200 aria-disabled:cursor-default"
                style={
                  picked
                    ? { background: "#1a1a28", color: hex, border: `1px solid ${hex}66` }
                    : { background: hex, color: "#06060a" }
                }
              >
                {picked ? "✓ SELECTED" : "SELECT FIGHTER"}
              </button>

              <span
                aria-hidden="true"
                className="rst-glare pointer-events-none absolute inset-0"
              />
            </div>
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
              // byId() falls back to the first fighter for an unknown id
              // (a stale save, say), so the roving tab stop does too —
              // otherwise no tile would be reachable with Tab.
              const focused = active.id === c.id;
              const hot = rolling && focused;
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
                  data-cursor="SELECT"
                  data-reveal="pop"
                  onKeyDown={(e) => onKeyDown(e, i)}
                  onFocus={() => {
                    if (!rolling) setPreview(c.id);
                  }}
                  onMouseEnter={() => {
                    if (rolling) return;
                    setPreview(c.id);
                    sfx.hover();
                  }}
                  onClick={() => choose(c.id)}
                  className={`rst-tile group relative aspect-square overflow-hidden rounded-xl border bg-gradient-to-b from-panel to-abyss p-1.5 transition-all duration-200 hover:-translate-y-1 ${
                    selected || hot
                      ? "border-transparent"
                      : focused
                        ? "border-edge"
                        : "border-edge/50"
                  } ${hot ? "rst-hot" : ""}`}
                  style={{
                    ["--chex" as string]: chex,
                    ["--reveal-delay" as string]: `${(i % 6) * 45 + Math.floor(i / 6) * 60}ms`,
                    ...(selected || hot
                      ? {
                          borderColor: chex,
                          boxShadow: hot
                            ? `0 0 0 2px ${chex}, 0 0 30px -4px ${chex}`
                            : `0 0 0 1px ${chex}, 0 8px 28px -12px ${chex}`,
                        }
                      : null),
                  }}
                >
                  <span
                    aria-hidden="true"
                    className={`absolute inset-x-0 bottom-0 h-1/2 blur-xl transition-opacity duration-300 group-hover:opacity-40 ${
                      hot ? "opacity-50" : "opacity-0"
                    }`}
                    style={{ background: chex }}
                  />
                  <span
                    aria-hidden="true"
                    className="rst-glint pointer-events-none absolute inset-y-0 left-0 w-3/5"
                  />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={spriteSrc(c.id)}
                    alt=""
                    width={c.w}
                    height={c.h}
                    loading="lazy"
                    className={`sprite relative mx-auto h-[68%] w-auto transition-transform duration-200 group-hover:scale-110 sm:h-[70%] ${
                      hot ? "scale-110" : ""
                    }`}
                  />
                  <span className="mono relative block truncate px-0.5 pb-0.5 text-center text-[9px] uppercase tracking-[0.1em] text-muted transition-colors group-hover:text-ink">
                    {c.name}
                  </span>
                  {selected && (
                    <span
                      className="rst-p1 mono absolute left-1.5 top-1.5 rounded px-1 py-0.5 text-[8px] font-bold tracking-[0.1em] text-void"
                      style={{ background: chex }}
                    >
                      P1
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <p className="mono text-[11px] uppercase tracking-[0.16em] text-muted">
              23 of 400+ shown · arrow keys to browse · enter to select
            </p>
            <button
              type="button"
              onClick={roll}
              aria-disabled={rolling}
              data-cursor="ROLL"
              onMouseEnter={() => sfx.hover()}
              className={`rst-random mono inline-flex min-h-10 min-w-[11.5rem] items-center justify-center gap-2 rounded-lg border px-3.5 py-2 text-[11px] uppercase tracking-[0.16em] transition-colors duration-200 ${
                rolling
                  ? "cursor-progress border-lime/70 bg-lime/10 text-lime"
                  : "border-edge bg-panel text-ink hover:border-lime/70 hover:text-lime focus-visible:text-lime"
              }`}
            >
              <Dice spinning={rolling} />
              {rolling ? (
                <>
                  <span className="sr-only">Rolling…</span>
                  {/* On a phone the hopping cursor can be a whole grid away,
                      so the button shows who it is passing over. Keyed so
                      every hop pops. */}
                  <span
                    key={active.id}
                    aria-hidden="true"
                    className="rst-tick flex min-w-0 items-center gap-1.5"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={spriteSrc(active.id)}
                      alt=""
                      width={active.w}
                      height={active.h}
                      className="h-6 w-6 shrink-0 object-contain"
                      style={{ filter: `drop-shadow(0 0 5px ${hex})` }}
                    />
                    <span className="max-w-[6.5rem] truncate">{active.name}</span>
                  </span>
                </>
              ) : (
                "Random"
              )}
            </button>
          </div>
        </div>
      </div>

      <p aria-live="polite" className="sr-only">
        {announce}
      </p>

      {splash && (
        <ReadySplash key={splash.n} c={byId(splash.id)} onDone={endSplash} />
      )}

      <style>{`
.rst-tilt{transform-origin:50% 50%;will-change:transform}
.rst-glare{opacity:var(--rst-glare,0);background:radial-gradient(380px circle at var(--rst-gx,50%) var(--rst-gy,50%),rgba(255,255,255,.09),transparent 65%)}
.rst-tile:focus-visible{outline-color:var(--chex);border-radius:.75rem}
.rst-random:focus-visible,.rst-cta:focus-visible{border-radius:.5rem}
.rst-hot{transition:none}
.rst-glint{transform:translateX(-130%) skewX(-18deg);background:linear-gradient(100deg,transparent 15%,rgba(255,255,255,.2) 48%,rgba(255,255,255,.04) 62%,transparent 80%)}
@media (prefers-reduced-motion:no-preference){
  .rst-tile:hover .rst-glint,.rst-tile:focus-visible .rst-glint{transform:translateX(260%) skewX(-18deg);transition:transform .6s cubic-bezier(.2,.8,.2,1)}
  .rst-p1{animation:rst-p1 .5s var(--ease-pop) both}
  .rst-hot{scale:1.05}
  .rst-stats[data-anim] .rst-fill{animation:rst-fill .4s var(--ease-pop) var(--rst-d,0ms) backwards}
  .rst-random:not([aria-disabled=true]):hover .rst-dice{animation:rst-wiggle .45s ease-in-out}
  .rst-dice-roll{animation:rst-spin .5s linear infinite}
  .rst-tick{animation:rst-tick .18s var(--ease-pop)}
  .rst-cta:not([aria-disabled=true]):active,.rst-random:not([aria-disabled=true]):active{scale:.96}
}
@keyframes rst-p1{0%{transform:scale(0) rotate(-20deg)}60%{transform:scale(1.35) rotate(6deg)}100%{transform:none}}
@keyframes rst-fill{from{transform:scaleX(0);filter:brightness(2.6)}60%{filter:brightness(1.5)}to{transform:scaleX(1);filter:none}}
@keyframes rst-wiggle{25%{transform:rotate(-16deg)}75%{transform:rotate(14deg)}}
@keyframes rst-spin{to{transform:rotate(360deg)}}
@keyframes rst-tick{from{transform:translateY(4px) scale(.7);opacity:.3}}

.rst-scrim{background:radial-gradient(120% 75% at 50% 50%,rgba(6,6,10,.35),rgba(6,6,10,.78));animation:rst-scrim ${SPLASH_MS}ms linear both}
.rst-shake{animation:rst-shake ${SPLASH_MS}ms linear both}
.rst-band-wrap{position:absolute;left:-25vw;right:-25vw;top:50%;height:clamp(132px,17vw,250px);transform:translateY(-50%) rotate(-7deg)}
.rst-band{position:absolute;inset:0;overflow:hidden;background:var(--rst-hex);box-shadow:0 0 0 3px #06060a,0 0 80px -10px var(--rst-hex);animation:rst-band ${SPLASH_MS}ms both}
.rst-lines{position:absolute;inset:0 -120px;background:repeating-linear-gradient(-62deg,transparent 0 26px,rgba(255,255,255,.18) 26px 30px,transparent 30px 58px,rgba(6,6,10,.12) 58px 70px);animation:rst-lines ${SPLASH_MS}ms linear both}
.rst-band-thin{position:absolute;left:0;right:0;height:clamp(6px,.9vw,12px)}
.rst-band-thin-a{bottom:calc(100% + clamp(8px,1.2vw,16px));background:#f2f3f7;animation:rst-band-r ${SPLASH_MS}ms both}
.rst-band-thin-b{top:calc(100% + clamp(8px,1.2vw,16px));background:#06060a;box-shadow:0 0 0 2px var(--rst-hex);animation:rst-band-r ${SPLASH_MS}ms both}
.rst-hero{height:clamp(150px,25vw,350px);filter:drop-shadow(0 0 22px var(--rst-hex)) drop-shadow(0 12px 0 rgba(6,6,10,.55));animation:rst-hero ${SPLASH_MS}ms both}
.rst-copy{transform:rotate(-7deg)}
.rst-name-in{animation:rst-name ${SPLASH_MS}ms both}
.rst-name{font-size:clamp(2.4rem,8.4vw,7.5rem);text-shadow:4px 4px 0 #06060a,-1px -1px 0 #06060a}
.rst-stamp{font-size:clamp(1.5rem,4.2vw,3.6rem);line-height:1;padding:.12em .32em .08em;color:#06060a;background:#f2f3f7;box-shadow:0 0 0 3px #06060a,7px 7px 0 3px #06060a;animation:rst-stamp ${SPLASH_MS}ms both}
@keyframes rst-scrim{0%{opacity:0}14%,78%{opacity:1}100%{opacity:0}}
@keyframes rst-shake{0%,42%{transform:none}44%{transform:translate(-7px,4px)}46%{transform:translate(6px,-5px)}48%{transform:translate(-4px,3px)}50%{transform:translate(2px,-1px)}52%,100%{transform:none}}
@keyframes rst-band{0%{transform:translateX(-102%);animation-timing-function:cubic-bezier(.16,1,.3,1)}18%{transform:translateX(0)}78%{transform:translateX(0);animation-timing-function:cubic-bezier(.55,0,.8,.25)}100%{transform:translateX(102%)}}
@keyframes rst-band-r{0%,6%{transform:translateX(102%);animation-timing-function:cubic-bezier(.16,1,.3,1)}24%{transform:translateX(0)}76%{transform:translateX(0);animation-timing-function:cubic-bezier(.55,0,.8,.25)}100%{transform:translateX(-102%)}}
@keyframes rst-lines{from{transform:translateX(0)}to{transform:translateX(-116px)}}
@keyframes rst-hero{0%,5%{opacity:0;transform:scale(2.5) translateY(-6%)}22%{opacity:1;transform:scale(1.08,.9) translateY(4%)}29%{transform:scale(.95,1.07) translateY(-2%)}36%,80%{opacity:1;transform:none}100%{opacity:0;transform:translateX(18vw) scale(.92)}}
@keyframes rst-name{0%,13%{opacity:0;transform:translateX(42vw) skewX(-24deg)}29%{opacity:1;transform:translateX(-14px) skewX(-8deg)}37%,80%{opacity:1;transform:skewX(-8deg)}100%{opacity:0;transform:translateX(-24vw) skewX(-8deg)}}
@keyframes rst-stamp{0%,37%{opacity:0;transform:rotate(-9deg) scale(2.8)}45%{opacity:1;transform:rotate(-9deg) scale(.9)}51%{transform:rotate(-9deg) scale(1.06)}57%,82%{opacity:1;transform:rotate(-9deg) scale(1)}100%{opacity:0;transform:rotate(-9deg) scale(1.25)}}
`}</style>
    </Section>
  );
}
