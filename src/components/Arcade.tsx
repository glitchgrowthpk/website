"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  COLS,
  HP_PER_COIN,
  ROWS,
  TURN_CAP,
  adjacent,
  bossPeriodMs,
  cascadeBonus,
  clearCells,
  collapse,
  colOf,
  critChance,
  damageFor,
  findMatches,
  findMove,
  hasMove,
  idx,
  isCrit,
  makeBoard,
  powerMult,
  rowOf,
  swapped,
  timeBonus,
  type Board,
} from "@/lib/match3";
import { ACCENT_HEX, DEFAULT_CHARACTER, byId, spriteSrc } from "@/data/characters";
import { useGame } from "@/lib/game-state";
import { useReducedMotion } from "@/lib/hooks";
import { sfx } from "@/lib/audio";
import { fx } from "@/lib/fx";
import { music } from "@/lib/music";
import { Section, SectionHead } from "./Section";
import { Coin } from "./GameUi";

/** The five board pieces, drawn from the studio's own character IP. */
const GEMS = ["chili", "cube", "slice", "egg", "potato"];
const GEM_NAMES = ["Habanero", "Cube", "Slice", "Egg", "Spud"];
const GEM_TINT = ["#ff2d77", "#c8ff2e", "#7dd13f", "#e8e8f0", "#ffb020"];

const BOSS_HP = 260;
const HERO_HP = 100;
/** Taurus hits for 8-14. With 100 HP that is ~9 hits, so even the slowest fighter gets about a minute. */
const BOSS_HIT_MIN = 8;
const BOSS_HIT_MAX = 14;
/** Past this much of the charge, Taurus visibly winds up. */
const ENRAGE_AT = 0.8;
/** Below this share of his health the soundtrack goes to its finale layer. */
const LOW_HP = 0.3;
/** Idle time during a fight before a valid swap is pointed out. */
const HINT_AFTER = 5000;
/** Share of the board that must be visible for Taurus to keep swinging. */
const ON_SCREEN = 0.35;
/** Longest single step the boss timer will take, so one janky frame never skips the telegraph. */
const MAX_STEP = 250;

/** Personal best. Every arcade key starts with "glitch.arcade" so resetProgress clears it. */
const BEST_KEY = "glitch.arcade.best";
const BEST_EVENT = "glitch:arcade-best";

type Phase = "idle" | "playing" | "won" | "lost";
type Tone = "cyan" | "lime" | "magenta" | "amber";

interface Float {
  key: number;
  text: string;
  /** Small label above the number, e.g. "CRIT!". */
  tag?: string;
  x: number;
  y: number;
  /** "max" marks a cascade wave that cleared after the turn already hit TURN_CAP. */
  kind: "dmg" | "big" | "crit" | "hurt" | "max";
}

interface Callout {
  key: number;
  text: string;
  sub?: string;
  tone: Tone;
}

interface Best {
  score: number;
  /** Fight time in ms. */
  time: number;
  character: string;
}

interface Result {
  time: number;
  score: number;
  record: boolean;
}

const TONE_HEX: Record<Tone, string> = {
  cyan: "#00e5ff",
  lime: "#c8ff2e",
  magenta: "#ff2d77",
  amber: "#ffb020",
};

/* --------------------------------------------------------------- helpers */

const fmtTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** "+22.5%", "−7.5%", "±0%" — the fighter's damage modifier in plain numbers. */
const fmtPct = (mult: number) => {
  const v = Math.round((mult - 1) * 1000) / 10;
  if (v === 0) return "±0%";
  return `${v > 0 ? "+" : "−"}${Math.abs(v)}%`;
};

const cellName = (i: number) => `row ${rowOf(i) + 1}, column ${colOf(i) + 1}`;

/** Callout for a cascade that has reached `depth` waves. */
const comboCall = (depth: number): Pick<Callout, "text" | "tone"> =>
  depth >= 4
    ? { text: "GLITCHTASTIC!", tone: "magenta" }
    : depth === 3
      ? { text: "GREAT!", tone: "lime" }
      : { text: "NICE!", tone: "cyan" };

/** Give every gem on a brand-new board a full-height drop so it rains in. */
const rain = (b: Board): Board => b.map((g) => (g ? { ...g, drop: ROWS } : g));

/** Fire-and-forget Web Animations call; quietly does nothing where unsupported. */
function play(
  el: Element | null,
  frames: Keyframe[],
  duration: number,
  easing = "ease-out",
) {
  if (!el || typeof el.animate !== "function") return;
  el.animate(frames, { duration, easing });
}

const SHAKE: Keyframe[] = [
  { transform: "translateX(0)" },
  { transform: "translateX(-7px)", offset: 0.22 },
  { transform: "translateX(6px)", offset: 0.48 },
  { transform: "translateX(-3px)", offset: 0.74 },
  { transform: "translateX(0)" },
];
const FLASH: Keyframe[] = [
  { filter: "brightness(3.2) saturate(0)" },
  { filter: "brightness(1) saturate(1)" },
];
const PULSE: Keyframe[] = [
  { opacity: 0 },
  { opacity: 1, offset: 0.18 },
  { opacity: 0 },
];
const LUNGE: Keyframe[] = [
  { transform: "none" },
  { transform: "translateX(-18px) scale(1.06)", offset: 0.3 },
  { transform: "none" },
];
/** Knockback grows with the cascade, so a deep chain visibly rocks him. */
const knock = (wave: number, crit: boolean): Keyframe[] => {
  const px = Math.min(26, 9 + wave * 4 + (crit ? 6 : 0));
  return [
    { transform: "none" },
    { transform: `translateX(${px}px) rotate(${px / 3}deg) scale(0.95, 1.05)`, offset: 0.22 },
    { transform: "none" },
  ];
};

/* ------------------------------------------------------- personal best */

// A tiny external store over localStorage, so the record can be read without
// touching storage during render (the server snapshot is simply "none yet").
function subscribeBest(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(BEST_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(BEST_EVENT, cb);
  };
}
const bestSnapshot = () => {
  try {
    return localStorage.getItem(BEST_KEY);
  } catch {
    return null;
  }
};
const bestServerSnapshot = () => null;

function parseBest(raw: string | null): Best | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Best>;
    if (typeof v.score !== "number" || typeof v.time !== "number") return null;
    return {
      score: v.score,
      time: v.time,
      character: typeof v.character === "string" ? v.character : DEFAULT_CHARACTER,
    };
  } catch {
    return null;
  }
}

function saveBest(b: Best) {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(b));
    window.dispatchEvent(new Event(BEST_EVENT));
  } catch {
    /* storage unavailable — the record just isn't kept */
  }
}

/* ------------------------------------------------------------- component */

export default function Arcade() {
  const { characterId, coinCount, totalCoins, unlock, paused } = useGame();
  const reduced = useReducedMotion();

  // Seeded so the idle board is present in the server HTML and hydrates cleanly.
  const [board, setBoard] = useState<Board>(() => makeBoard(20260921));
  const [phase, setPhase] = useState<Phase>("idle");
  const [bossHp, setBossHp] = useState(BOSS_HP);
  /** Damage taken rather than HP left, so a coin found mid-fight raises both max and current HP. */
  const [heroDmg, setHeroDmg] = useState(0);
  const [score, setScore] = useState(0);
  const [sel, setSel] = useState<number | null>(null);
  const [cursor, setCursor] = useState(idx(3, 3));
  const [clearing, setClearing] = useState<number[]>([]);
  const [hint, setHint] = useState<[number, number] | null>(null);
  /** Bumped on every player input; restarts the idle-hint timer. */
  const [activity, setActivity] = useState(0);
  const [floats, setFloats] = useState<Float[]>([]);
  const [callout, setCallout] = useState<Callout | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [announce, setAnnounce] = useState("");

  const bestRaw = useSyncExternalStore(subscribeBest, bestSnapshot, bestServerSnapshot);
  const best = useMemo(() => parseBest(bestRaw), [bestRaw]);

  // Synchronous mirrors. Game decisions (and their sounds) are made against
  // these, never inside a state updater, which React may run twice.
  const phaseRef = useRef<Phase>("idle");
  const bossHpRef = useRef(BOSS_HP);
  const heroDmgRef = useRef(0);
  const scoreRef = useRef(0);
  /** Active fight time — excludes time spent paused, hidden or scrolled away. */
  const elapsed = useRef(0);
  /** Incremented per fight, so a cascade still resolving from the last one bows out. */
  const round = useRef(0);
  const busy = useRef(false);
  const onScreen = useRef(true);
  const pausedRef = useRef(false);
  const stats = useRef({ period: bossPeriodMs(3) });
  const attackRef = useRef<() => void>(() => {});
  const wakeRef = useRef<() => void>(() => {});
  const resumeQueue = useRef<(() => void)[]>([]);
  const focusOnPhase = useRef(false);
  const floatKey = useRef(0);
  const calloutKey = useRef(0);
  const dragFrom = useRef<{ i: number; x: number; y: number } | null>(null);
  const prevCoins = useRef(coinCount);

  const panelRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const vignetteRef = useRef<HTMLDivElement>(null);
  const heroBarRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const bossWrapRef = useRef<HTMLDivElement>(null);
  const bossImgRef = useRef<HTMLImageElement>(null);
  const bossMiniRef = useRef<HTMLImageElement>(null);
  const chargeRef = useRef<HTMLDivElement>(null);
  const secRef = useRef<HTMLSpanElement>(null);
  const miniChargeRef = useRef<HTMLDivElement>(null);
  const againRef = useRef<HTMLButtonElement>(null);

  /* ------------------------------------------------------------ loadout */

  const hero = byId(characterId);
  const boss = byId("minotaur");
  const [pwr, spd, lck] = hero.stats;
  const power = powerMult(pwr);
  const period = bossPeriodMs(spd);
  const luck = critChance(lck);
  const maxHp = HERO_HP + HP_PER_COIN * coinCount;
  const heroHp = Math.max(0, maxHp - heroDmg);
  const bossLow = bossHp > 0 && bossHp < BOSS_HP * LOW_HP;

  useEffect(() => {
    stats.current = { period };
  }, [period]);

  /* ------------------------------------------------------------- timing */

  /** A delay that also holds while the pause menu is open. */
  const wait = useCallback(
    (ms: number) =>
      new Promise<void>((done) => {
        window.setTimeout(
          () => (pausedRef.current ? resumeQueue.current.push(done) : done()),
          reduced ? 0 : ms,
        );
      }),
    [reduced],
  );

  useEffect(() => {
    pausedRef.current = paused;
    if (paused) return;
    const queued = resumeQueue.current;
    resumeQueue.current = [];
    queued.forEach((done) => done());
    wakeRef.current();
  }, [paused]);

  // Only fight while the board is actually on screen — nobody should lose a
  // round because they scrolled away to read the portfolio. Judged by the
  // ratio: `isIntersecting` stays true while any sliver of the board shows.
  useEffect(() => {
    const el = boardRef.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      ([e]) => {
        onScreen.current = e.intersectionRatio >= ON_SCREEN;
        if (onScreen.current) wakeRef.current();
      },
      { threshold: [0, ON_SCREEN] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  /**
   * Boss attack timer. The charge bars are written straight to the DOM so a
   * 60fps telegraph never re-renders the 49-tile board. The loop stops itself
   * whenever the fight is paused, hidden or off screen, and `wake` restarts it
   * exactly where the charge left off.
   */
  useEffect(() => {
    if (phase !== "playing") return;
    const bar = chargeRef.current;
    const mini = miniChargeRef.current;
    const sec = secRef.current;
    const aside = asideRef.current;
    const panel = panelRef.current;

    let raf = 0;
    let last = 0;
    let charge = 0;
    let shownSec = "";
    let hot = false;

    const running = () =>
      onScreen.current && !pausedRef.current && document.visibilityState === "visible";

    const paint = (p: number, ms: number) => {
      const t = `scaleX(${p})`;
      if (bar) bar.style.transform = t;
      if (mini) mini.style.transform = t;
      // Tenths, so a 7.2s fighter timer reads as 7.2 rather than rounding up to 8.
      const s = `${((1 - p) * (ms / 1000)).toFixed(1)}s`;
      if (s !== shownSec && sec) {
        shownSec = s;
        sec.textContent = s;
      }
      const enraged = p >= ENRAGE_AT;
      if (enraged !== hot) {
        hot = enraged;
        aside?.toggleAttribute("data-enraged", hot);
        panel?.toggleAttribute("data-enraged", hot);
      }
    };

    const tick = (now: number) => {
      if (!running()) {
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(tick);
      // Clamp the step so one long frame never skips the telegraph. Generous
      // enough that a 10fps phone still keeps real time (and an honest clock).
      const dt = last ? Math.min(now - last, MAX_STEP) : 0;
      last = now;
      elapsed.current += dt;
      charge += dt;
      const ms = stats.current.period;
      if (charge >= ms) {
        charge = 0;
        attackRef.current();
      }
      paint(charge / ms, ms);
    };

    const wake = () => {
      if (raf || !running()) return;
      last = 0;
      raf = requestAnimationFrame(tick);
    };

    // Stop outright when the tab hides, so coming back starts a fresh step
    // instead of resuming a frame that is minutes long.
    const onVisibility = () => {
      if (document.visibilityState === "visible") return wake();
      cancelAnimationFrame(raf);
      raf = 0;
    };

    wakeRef.current = wake;
    paint(0, stats.current.period);
    wake();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      wakeRef.current = () => {};
      document.removeEventListener("visibilitychange", onVisibility);
      if (bar) bar.style.transform = "scaleX(0)";
      if (mini) mini.style.transform = "scaleX(0)";
      if (sec) sec.textContent = "";
      aside?.removeAttribute("data-enraged");
      panel?.removeAttribute("data-enraged");
    };
  }, [phase]);

  /* -------------------------------------------------------------- juice */

  const addFloat = (text: string, kind: Float["kind"], x: number, y: number, tag?: string) => {
    floatKey.current += 1;
    const f: Float = { key: floatKey.current, text, tag, x, y, kind };
    setFloats((prev) => [...prev, f]);
    window.setTimeout(() => setFloats((prev) => prev.filter((p) => p.key !== f.key)), 1000);
  };

  const showCallout = (text: string, tone: Tone, sub?: string) => {
    calloutKey.current += 1;
    const key = calloutKey.current;
    setCallout({ key, text, tone, sub });
    window.setTimeout(() => setCallout((c) => (c && c.key === key ? null : c)), 950);
  };

  /** Tinted particles from every cleared cell, capped so big clears stay cheap. */
  const burstCells = (b: Board, cells: number[]) => {
    const el = boardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cw = r.width / COLS;
    const ch = r.height / ROWS;
    const count = Math.max(2, Math.min(6, Math.floor(40 / cells.length)));
    for (const i of cells) {
      const g = b[i];
      if (!g) continue;
      fx.burst(r.left + (colOf(i) + 0.5) * cw, r.top + (rowOf(i) + 0.5) * ch, {
        count,
        colors: [GEM_TINT[g.type], "#ffffff"],
        speed: 260,
        gravity: 820,
        size: 3,
        life: 0.55,
      });
    }
  };

  const hitBoss = (wave: number, crit: boolean) => {
    fx.burstAt(bossImgRef.current, "hit");
    if (reduced) return;
    play(bossWrapRef.current, knock(wave, crit), 380, "cubic-bezier(.2,.9,.3,1)");
    play(bossImgRef.current, FLASH, 300);
    play(bossMiniRef.current, FLASH, 300);
  };

  /* ------------------------------------------------------------ lifecycle */

  const start = () => {
    round.current += 1;
    busy.current = false;
    phaseRef.current = "playing";
    bossHpRef.current = BOSS_HP;
    heroDmgRef.current = 0;
    scoreRef.current = 0;
    elapsed.current = 0;
    focusOnPhase.current = true;

    setBoard(rain(makeBoard()));
    setBossHp(BOSS_HP);
    setHeroDmg(0);
    setScore(0);
    setSel(null);
    setHint(null);
    setClearing([]);
    setFloats([]);
    setResult(null);
    setCursor(idx(3, 3));
    setPhase("playing");
    showCallout("FIGHT!", "amber");
    setAnnounce("Fight started. Match three or more to attack.");
    sfx.vs();
  };

  const finish = (won: boolean) => {
    phaseRef.current = won ? "won" : "lost";
    const time = elapsed.current;
    const total = scoreRef.current + (won ? timeBonus(time) : 0);
    scoreRef.current = total;

    let record = false;
    if (won) {
      const prev = parseBest(bestSnapshot());
      record = !prev || total > prev.score;
      if (record) saveBest({ score: total, time: Math.round(time), character: characterId });
      unlock("boss-slayer");
      sfx.victory();
      showCallout("K.O.!", "lime");
      const el = boardRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        fx.burst(r.left + r.width / 2, r.top + r.height * 0.45, "confetti");
      }
      fx.flash("#c8ff2e", 0.12);
      setAnnounce(
        `Victory. Taurus is down in ${fmtTime(time)}. Score ${total}${record ? ", a new record" : ""}.`,
      );
    } else {
      sfx.defeat();
      fx.flash("#ff2d77", 0.14);
      setAnnounce("Defeated. Taurus wins this round.");
    }

    // If the player was on the board, hand focus to the replay button.
    focusOnPhase.current = !!boardRef.current?.contains(document.activeElement);
    setScore(total);
    setResult({ time, score: total, record });
    setSel(null);
    setHint(null);
    setPhase(won ? "won" : "lost");
  };

  // Keep focus somewhere sensible as the overlay comes and goes.
  useEffect(() => {
    if (!focusOnPhase.current) return;
    focusOnPhase.current = false;
    if (phase === "playing") boardRef.current?.focus({ preventScroll: true });
    else if (phase !== "idle") againRef.current?.focus({ preventScroll: true });
  }, [phase]);

  /** Taurus's attack — called from the timer loop through `attackRef`. */
  const bossAttack = () => {
    if (phaseRef.current !== "playing") return;
    const dmg = BOSS_HIT_MIN + Math.floor(Math.random() * (BOSS_HIT_MAX - BOSS_HIT_MIN + 1));
    heroDmgRef.current += dmg;
    setHeroDmg(heroDmgRef.current);
    addFloat(`-${dmg}`, "hurt", 18, 24);
    sfx.hit();
    fx.haptic(30);
    if (!reduced) {
      play(panelRef.current, SHAKE, 320);
      play(vignetteRef.current, PULSE, 560);
      play(bossWrapRef.current, LUNGE, 420);
    }
    const left = maxHp - heroDmgRef.current;
    const was = left + dmg;
    if (left <= 0) {
      finish(false);
      return;
    }
    // Every hit is on screen (bar, number, shake), but a screen reader only
    // hears the hits that change the picture, not one line every few seconds.
    if (left <= maxHp * 0.25 && was > maxHp * 0.25) {
      setAnnounce(`Low health. Taurus hits for ${dmg}, ${left} HP left.`);
    } else if (left <= maxHp * 0.5 && was > maxHp * 0.5) {
      setAnnounce(`Half health. Taurus hits for ${dmg}, ${left} HP left.`);
    }
  };

  useEffect(() => {
    attackRef.current = bossAttack;
  });

  // A coin found mid-fight is +3 max HP on the spot — make it feel like a heal.
  useEffect(() => {
    const gained = coinCount - prevCoins.current;
    prevCoins.current = coinCount;
    if (gained <= 0 || phase !== "playing") return;
    sfx.heal();
    fx.burstAt(heroBarRef.current, {
      count: 14,
      colors: ["#00e5ff", "#c8ff2e"],
      speed: 220,
      gravity: -120,
      size: 3,
      life: 0.7,
    });
  }, [coinCount, phase]);

  // Soundtrack follows the fight: action while playing, finale when he is low.
  useEffect(() => {
    music.setIntensity(phase === "playing" ? (bossLow ? 2 : 1) : 0);
  }, [phase, bossLow]);
  useEffect(() => () => music.setIntensity(0), []);

  /* ---------------------------------------------------------------- hint */

  useEffect(() => {
    if (phase !== "playing" || paused) return;
    let t = 0;
    const fire = () => {
      if (busy.current) return;
      // Wait for the player to come back rather than talking to an empty room.
      if (!onScreen.current) {
        t = window.setTimeout(fire, 1000);
        return;
      }
      const mv = findMove(board);
      if (!mv) return;
      setHint(mv);
      setAnnounce(`Hint: try swapping ${cellName(mv[0])} with ${cellName(mv[1])}.`);
    };
    t = window.setTimeout(fire, HINT_AFTER);
    return () => window.clearTimeout(t);
  }, [phase, paused, board, activity]);

  /** Any player input clears the hint and restarts its timer. */
  const poke = () => {
    setHint(null);
    setActivity((a) => a + 1);
  };

  /* ------------------------------------------------------------- resolve */

  const resolve = async (from: Board, fight: number) => {
    let b = from;
    let wave = 0;
    let dealt = 0;
    let crits = 0;
    let capped = false;
    const live = () => round.current === fight && phaseRef.current === "playing";

    for (;;) {
      const m = findMatches(b);
      if (!m.length) break;

      const lucky = Math.random() < luck;
      const crit = isCrit(m.length, lucky);
      const dmg = damageFor(m.length, wave, { power, lucky, dealt });
      dealt += dmg;
      if (crit && dmg) crits++;
      const depth = wave + 1;

      setClearing(m);
      sfx.match(wave);
      fx.haptic(10);
      burstCells(b, m);
      if (depth >= 2) {
        const call = comboCall(depth);
        showCallout(call.text, call.tone, `${depth}× COMBO`);
      }
      if (depth >= 3) unlock("combo");

      // Land each hit as it happens so the bar tracks the damage numbers.
      const before = bossHpRef.current;
      const after = Math.max(0, before - dmg);
      bossHpRef.current = after;
      setBossHp(after);
      // Score: damage that actually landed, plus the cascade bonus this wave adds.
      scoreRef.current += before - after + cascadeBonus(depth) - cascadeBonus(wave);
      setScore(scoreRef.current);

      // Damage numbers rise from the middle of what was cleared.
      let sx = 0;
      let sy = 0;
      for (const i of m) {
        sx += colOf(i) + 0.5;
        sy += rowOf(i) + 0.5;
      }
      const x = Math.min(80, Math.max(14, (sx / m.length / COLS) * 100 + (Math.random() * 8 - 4)));
      const y = Math.min(84, Math.max(16, (sy / m.length / ROWS) * 100));
      if (dmg > 0) {
        capped = dealt >= TURN_CAP;
        addFloat(
          `-${dmg}`,
          crit ? "crit" : wave > 0 ? "big" : "dmg",
          x,
          y,
          capped ? "MAX HIT" : lucky || crit ? "CRIT!" : undefined,
        );
        hitBoss(wave, crit);
      } else {
        // The turn already hit its cap: the cascade still clears (and still
        // scores), it just can't hurt him any more. Say so instead of going quiet.
        addFloat("MAX", "max", x, y);
      }

      if (after === 0) {
        // K.O. freezes the board mid-cascade — the last hit is the moment.
        busy.current = false;
        finish(true);
        return;
      }

      await wait(210);
      if (!live()) return;
      b = clearCells(b, m);
      setBoard(b);
      setClearing([]);
      await wait(70);
      if (!live()) return;
      b = collapse(b);
      setBoard(b);
      await wait(260);
      if (!live()) return;
      wave++;
    }

    if (dealt) {
      setAnnounce(
        `${dealt} damage dealt${wave > 1 ? ` with a ${wave}x cascade` : ""}${
          crits ? ", critical hit" : ""
        }${capped ? ", max hit" : ""}. Taurus has ${bossHpRef.current} HP left.`,
      );
    }

    // Deadlock guard — reshuffle rather than stranding the player.
    if (!hasMove(b)) {
      setAnnounce("No moves left — board reshuffled.");
      b = rain(makeBoard());
      setBoard(b);
      await wait(400);
      if (!live()) return;
    }

    busy.current = false;
  };

  const attempt = async (a: number, c: number) => {
    if (busy.current || phaseRef.current !== "playing") return;
    if (!adjacent(a, c)) return;
    busy.current = true;
    const fight = round.current;
    setSel(null);
    setHint(null);
    sfx.swap();

    const next = swapped(board, a, c);
    setBoard(next);
    await wait(200);
    if (round.current !== fight || phaseRef.current !== "playing") return;

    if (!findMatches(next).length) {
      setBoard(board); // bounce back
      sfx.error();
      fx.haptic([8, 40, 8]);
      if (!reduced) play(panelRef.current, SHAKE, 320);
      setAnnounce("No match there.");
      await wait(200);
      busy.current = false;
      return;
    }
    await resolve(next, fight);
  };

  /* -------------------------------------------------------------- input */

  const cellFrom = (e: React.PointerEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
    return el ? Number(el.dataset.i) : -1;
  };

  /** Tap-tap: the first tile is picked up, a neighbour swaps, anything else re-picks. */
  const pick = (i: number) => {
    poke();
    setCursor(i);
    if (sel === null) {
      setSel(i);
      sfx.hover();
    } else if (sel === i) {
      setSel(null);
    } else if (adjacent(sel, i)) {
      void attempt(sel, i);
    } else {
      setSel(i);
      sfx.hover();
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (phase !== "playing" || e.button > 0) return;
    const i = cellFrom(e);
    if (i < 0) return;
    // Keep keyboard focus on the board itself, never on a tile that may vanish.
    e.preventDefault();
    boardRef.current?.focus({ preventScroll: true });
    // A pointer on the board proves it is on screen, even if the observer is late.
    onScreen.current = true;
    wakeRef.current();
    dragFrom.current = { i, x: e.clientX, y: e.clientY };
    pick(i);
  };

  /**
   * Clicks that come with no pointer behind them (a screen reader activating a
   * tile, voice control) still play. Real pointer clicks are already handled
   * on pointerdown, and they report a click count of at least 1.
   */
  const onClick = (e: React.MouseEvent) => {
    if (phase !== "playing" || e.detail !== 0) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
    if (!el) return;
    boardRef.current?.focus({ preventScroll: true });
    pick(Number(el.dataset.i));
  };

  /** Swap as soon as a drag clearly leaves its tile — no need to let go first. */
  const dragSwap = (e: React.PointerEvent) => {
    const from = dragFrom.current;
    if (!from || phase !== "playing") return;
    const dx = e.clientX - from.x;
    const dy = e.clientY - from.y;
    if (Math.abs(dx) < 16 && Math.abs(dy) < 16) return;
    dragFrom.current = null;

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

  const onPointerUp = (e: React.PointerEvent) => {
    dragSwap(e);
    dragFrom.current = null;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (phase !== "playing" || e.ctrlKey || e.metaKey || e.altKey) return;
    const r = rowOf(cursor);
    const c = colOf(cursor);
    const move: Record<string, [number, number]> = {
      ArrowUp: [r - 1, c],
      ArrowDown: [r + 1, c],
      ArrowLeft: [r, c - 1],
      ArrowRight: [r, c + 1],
    };
    // The focused board owns these keys: don't also walk the platformer
    // character around when control mode happens to be on.
    if (e.key in move || e.key === " " || e.key === "Enter") e.stopPropagation();
    if (e.key in move) {
      e.preventDefault();
      poke();
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
      poke();
      setSel((s) => (s === cursor ? null : cursor));
      sfx.hover();
    }
    if (e.key === "Escape") {
      poke();
      setSel(null);
    }
  };

  /* -------------------------------------------------------------- render */

  const cellPct = 100 / COLS;
  const playing = phase === "playing";
  const shownHint = playing ? hint : null;
  const accent = ACCENT_HEX[hero.accent];

  // Tiles render in a stable order (by gem id, which only ever grows) rather
  // than board order. If React had to move a tile's DOM node after a swap or
  // a collapse, the browser would drop its slide transition and replay its
  // rain-in animation, so the tile would teleport and fall from the sky again.
  const tiles = useMemo(
    () =>
      board
        .flatMap((g, i) => (g ? [{ g, i }] : []))
        .sort((a, b) => a.g.id - b.g.id),
    [board],
  );

  const loadout: { k: string; v: number; effect: string; pip: string }[] = [
    { k: "PWR", v: pwr, effect: `${fmtPct(power)} dmg`, pip: "bg-magenta" },
    { k: "SPD", v: spd, effect: `${(period / 1000).toFixed(1)}s boss timer`, pip: "bg-cyan" },
    { k: "LCK", v: lck, effect: `${Math.round(luck * 100)}% crit`, pip: "bg-lime" },
  ];

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
          ref={panelRef}
          data-solid=""
          data-reveal=""
          className="arcade-panel panel scanlines relative flex flex-col justify-center overflow-hidden p-3 sm:p-5"
        >
          {/* hero-hit vignette, pulsed by the Web Animations API */}
          <div
            ref={vignetteRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-10 rounded-[14px] opacity-0"
            style={{
              boxShadow:
                "inset 0 0 70px 6px rgba(255,45,119,.55), inset 0 0 0 2px rgba(255,45,119,.7)",
            }}
          />

          <Coin id="arcade" label="the arcade board" className="bottom-1 left-3" />

          {/* HUD */}
          <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-3">
            <div className="min-w-0">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={spriteSrc(hero.id)}
                    alt=""
                    aria-hidden="true"
                    className="sprite hidden h-5 w-auto sm:block"
                  />
                  <span className="mono truncate text-[10px] uppercase tracking-[0.16em] text-muted">
                    {hero.name}
                  </span>
                </span>
                <span className="mono text-[10px] tabular-nums text-cyan">
                  {heroHp}/{maxHp}
                </span>
              </div>
              <div ref={heroBarRef} className="relative h-2 overflow-hidden rounded-full bg-panel-2">
                <div
                  className="arcade-ghost absolute inset-y-0 left-0 rounded-full bg-ink/70"
                  style={{ width: `${(heroHp / maxHp) * 100}%` }}
                />
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-cyan to-lime transition-[width] duration-300"
                  style={{ width: `${(heroHp / maxHp) * 100}%` }}
                />
              </div>
            </div>

            <div className="flex min-w-[3.25rem] flex-col items-center leading-none">
              <span className="mono text-[10px] uppercase tracking-[0.16em] text-muted">
                Score
              </span>
              <span
                key={score}
                className="mt-1 font-display text-lg tabular-nums text-ink motion-safe:animate-[arcade-tick_.3s_cubic-bezier(.34,1.56,.64,1)]"
              >
                {score}
              </span>
            </div>

            <div className="min-w-0">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    ref={bossMiniRef}
                    src={spriteSrc(boss.id)}
                    alt=""
                    aria-hidden="true"
                    className="sprite hidden h-5 w-auto sm:block"
                  />
                  <span className="mono truncate text-[10px] uppercase tracking-[0.16em] text-magenta">
                    Taurus
                  </span>
                </span>
                <span className="mono text-[10px] tabular-nums text-magenta">
                  {bossHp}/{BOSS_HP}
                </span>
              </div>
              <div className="relative h-2 overflow-hidden rounded-full bg-panel-2">
                <div
                  className="arcade-ghost absolute inset-y-0 left-0 rounded-full bg-ink/70"
                  style={{ width: `${(bossHp / BOSS_HP) * 100}%` }}
                />
                <div
                  className={`absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-magenta to-violet transition-[width] duration-300 ${
                    bossLow && playing ? "arcade-low" : ""
                  }`}
                  style={{ width: `${(bossHp / BOSS_HP) * 100}%` }}
                />
              </div>
            </div>
          </div>

          {/* compact telegraph for small screens, where the boss panel sits below the board */}
          <div className="arcade-mini mb-3 flex items-center gap-2 lg:hidden" aria-hidden="true">
            <span className="mono text-[10px] uppercase tracking-[0.16em] text-muted">
              Next attack
            </span>
            <div className="arcade-mini-track h-1.5 flex-1 overflow-hidden rounded-full bg-panel-2">
              <div
                ref={miniChargeRef}
                className="h-full origin-left rounded-full bg-gradient-to-r from-amber to-magenta"
                style={{ transform: "scaleX(0)" }}
              />
            </div>
          </div>

          {/* grid */}
          <div
            ref={boardRef}
            role="application"
            aria-roledescription="Match three game board"
            aria-label="Match three board. Arrow keys move, space selects, arrow again swaps."
            tabIndex={playing ? 0 : -1}
            // Focus stays on the board; screen readers follow the keyboard
            // cursor through the tile it points at.
            aria-activedescendant={playing ? `arcade-cell-${cursor}` : undefined}
            data-cursor={playing ? "SWAP" : undefined}
            onKeyDown={onKeyDown}
            onClick={onClick}
            onPointerDown={onPointerDown}
            onPointerMove={dragSwap}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              dragFrom.current = null;
            }}
            onMouseDown={(e) => {
              // A clicked tile must not steal focus from the board (it may be cleared a moment later).
              if ((e.target as HTMLElement).closest("[data-i]")) e.preventDefault();
            }}
            className="group/board relative mx-auto aspect-square w-full max-w-[520px] touch-none select-none overflow-hidden rounded-xl border border-edge bg-abyss/80"
          >
            {tiles.map(({ g, i }) => {
              const r = rowOf(i);
              const c = colOf(i);
              const isClearing = clearing.includes(i);
              const isSel = sel === i;
              const isHint = !!shownHint && (shownHint[0] === i || shownHint[1] === i);
              const isCursor = cursor === i && playing;

              let look = "border-transparent bg-panel-2/40";
              if (isClearing) look = "arcade-clear border-transparent bg-panel-2/40";
              else if (isSel) look = "arcade-pick border-cyan bg-cyan/20 shadow-[0_0_18px_-4px_#00e5ff]";
              else if (isHint) look = "arcade-hint border-lime/80 bg-lime/10";
              else if (isCursor)
                look =
                  "border-transparent bg-panel-2/40 group-focus-visible/board:border-ink/70 group-focus-visible/board:bg-panel-2/80";

              const drop =
                g.drop && !reduced
                  ? ({
                      ["--arcade-drop" as string]: g.drop,
                      animation: `arcade-drop ${220 + 34 * g.drop}ms ${
                        g.drop >= ROWS ? c * 32 : 0
                      }ms both`,
                    } as React.CSSProperties)
                  : undefined;

              // The two hinted tiles lean toward each other, the classic "swap us" nudge.
              const mate = shownHint && isHint ? (shownHint[0] === i ? shownHint[1] : shownHint[0]) : -1;
              const nudge =
                mate >= 0
                  ? ({
                      ["--arcade-hx" as string]: colOf(mate) - c,
                      ["--arcade-hy" as string]: rowOf(mate) - r,
                    } as React.CSSProperties)
                  : undefined;

              return (
                <button
                  key={g.id}
                  id={`arcade-cell-${i}`}
                  type="button"
                  tabIndex={-1}
                  data-i={i}
                  aria-label={`${GEM_NAMES[g.type]} at row ${r + 1}, column ${c + 1}${
                    isSel ? ", selected" : isHint ? ", hint" : ""
                  }`}
                  className="group/tile absolute left-0 top-0 grid place-items-center transition-transform duration-[260ms] ease-[cubic-bezier(.3,1.35,.6,1)]"
                  style={{
                    width: `${cellPct}%`,
                    height: `${cellPct}%`,
                    transform: `translate(${c * 100}%, ${r * 100}%)`,
                  }}
                >
                  {/* Visual layers ignore the pointer: hit-testing always lands on the
                      cell button, never on a neighbour that is still raining in. */}
                  <span
                    className="pointer-events-none grid h-full w-full place-items-center"
                    style={drop}
                  >
                    <span
                      className={`grid h-[86%] w-[86%] place-items-center rounded-lg border transition-[background-color,border-color,box-shadow] duration-200 group-hover/tile:bg-panel-2/80 ${look}`}
                      style={nudge}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={spriteSrc(GEMS[g.type])}
                        alt=""
                        className="sprite h-[78%] w-auto transition-transform duration-200 group-hover/tile:-translate-y-[3px]"
                        style={{
                          filter: `drop-shadow(0 2px 6px ${GEM_TINT[g.type]}55)`,
                        }}
                        draggable={false}
                      />
                    </span>
                  </span>
                </button>
              );
            })}

            {/* damage numbers */}
            {floats.map((f) => (
              <span
                key={f.key}
                aria-hidden="true"
                className={`pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center font-display leading-none tabular-nums motion-safe:animate-[arcade-rise_1s_ease-out_forwards] ${
                  f.kind === "crit" || f.kind === "big"
                    ? "text-2xl text-lime sm:text-3xl"
                    : f.kind === "max"
                      ? "text-lg tracking-wider text-amber sm:text-xl"
                      : "text-xl text-magenta sm:text-2xl"
                }`}
                style={{
                  left: `${f.x}%`,
                  top: `${f.y}%`,
                  textShadow: "0 2px 0 #06060a, 0 0 14px currentColor",
                }}
              >
                {f.tag && (
                  <span className="mono mb-0.5 text-[10px] font-bold tracking-[0.18em] text-amber">
                    {f.tag}
                  </span>
                )}
                {f.text}
              </span>
            ))}

            {/* combo announcer */}
            {callout && (
              <div
                key={callout.key}
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-10 grid place-items-center"
              >
                <div className="flex flex-col items-center motion-safe:animate-[arcade-callout_.95s_ease-out_forwards]">
                  <span
                    className="font-display text-[clamp(2.4rem,10vw,4.2rem)] leading-none tracking-wide"
                    style={{
                      color: TONE_HEX[callout.tone],
                      textShadow: `0 0 26px ${TONE_HEX[callout.tone]}99, 3px 3px 0 #06060a, -2px 0 0 #ff2d7799, 2px 0 0 #00e5ff99`,
                    }}
                  >
                    {callout.text}
                  </span>
                  {callout.sub && (
                    <span className="mono mt-2 rounded border border-lime bg-void/80 px-2 py-1 text-[11px] font-bold text-lime">
                      {callout.sub}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* overlays */}
            {!playing && (
              <div
                className={`absolute inset-0 z-20 grid place-items-center overflow-y-auto rounded-xl bg-void/88 backdrop-blur-sm ${
                  phase === "idle" ? "" : "motion-safe:animate-[arcade-overlay_.45s_ease-out_.7s_backwards]"
                }`}
              >
                <div className="px-5 py-4 text-center sm:px-6">
                  {phase === "idle" && (
                    <>
                      <div aria-hidden="true" className="mb-3 flex items-end justify-center gap-3 sm:mb-4 sm:gap-4">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={spriteSrc(hero.id)}
                          alt=""
                          className="sprite h-12 w-auto motion-safe:animate-[bob_2.4s_ease-in-out_infinite] sm:h-16"
                        />
                        <span className="pb-1 font-display text-xl text-magenta sm:text-2xl">VS</span>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={spriteSrc(boss.id)}
                          alt=""
                          className="sprite h-14 w-auto -scale-x-100 motion-safe:animate-[bob_3.6s_ease-in-out_infinite] sm:h-20"
                        />
                      </div>
                      <p className="font-display text-[clamp(1.6rem,5vw,2.4rem)] leading-none">
                        DUNGEON FIGHT
                      </p>
                      <p className="mx-auto mt-3 max-w-xs text-sm text-muted">
                        Match three or more to swing. Taurus hits back every few
                        seconds.
                      </p>
                      {best && (
                        <p className="mono mt-3 text-[10px] uppercase tracking-[0.16em] text-amber">
                          Best {best.score} · {fmtTime(best.time)} · {byId(best.character).name}
                        </p>
                      )}
                    </>
                  )}
                  {phase === "won" && (
                    <>
                      <p className="font-display text-[clamp(1.8rem,6vw,3rem)] leading-none text-lime">
                        VICTORY
                      </p>
                      {result && (
                        <dl className="mx-auto mt-3 flex justify-center gap-2">
                          <div className="rounded-lg border border-edge bg-panel/80 px-3 py-1.5">
                            <dt className="mono text-[10px] uppercase tracking-[0.16em] text-muted">Time</dt>
                            <dd className="font-display text-xl leading-tight tabular-nums">
                              {fmtTime(result.time)}
                            </dd>
                          </div>
                          <div className="rounded-lg border border-edge bg-panel/80 px-3 py-1.5">
                            <dt className="mono text-[10px] uppercase tracking-[0.16em] text-muted">Score</dt>
                            <dd className="font-display text-xl leading-tight tabular-nums">
                              {result.score}
                            </dd>
                          </div>
                        </dl>
                      )}
                      {result?.record ? (
                        <p className="mono mt-2 inline-block rounded border border-lime bg-lime/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.16em] text-lime motion-safe:animate-[arcade-record_1.2s_ease-in-out_infinite]">
                          New record
                        </p>
                      ) : (
                        best && (
                          <p className="mono mt-2 text-[10px] uppercase tracking-[0.16em] text-amber">
                            Best {best.score}
                          </p>
                        )
                      )}
                      <p className="mx-auto mt-2 max-w-xs text-sm text-muted">
                        That is the Puzzle Warrior loop — a casual board driving
                        real combat.
                      </p>
                      <a
                        href="https://play.google.com/store/apps/details?id=com.glitchtech.puzzlewarrior.rpg"
                        target="_blank"
                        rel="noopener noreferrer"
                        data-cursor="OPEN"
                        onClick={() => unlock("window-shopper")}
                        className="mono mt-3 inline-block rounded-lg bg-lime px-4 py-2.5 text-[11px] uppercase tracking-[0.14em] text-void"
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
                      {result && (
                        <p className="mono mt-2 text-[10px] uppercase tracking-[0.16em] text-amber">
                          Score {result.score}
                        </p>
                      )}
                    </>
                  )}
                  <button
                    ref={againRef}
                    type="button"
                    onClick={start}
                    data-cursor="PLAY"
                    data-magnetic=""
                    className="mt-4 block w-full rounded-lg bg-gradient-to-r from-cyan to-violet px-6 py-3 font-display text-sm tracking-wide text-void transition-transform hover:scale-105 active:scale-95"
                  >
                    {phase === "idle" ? "PRESS START" : "FIGHT AGAIN"}
                  </button>
                  {phase === "lost" && (
                    <a
                      href="#roster"
                      className="mono mt-1 inline-block px-2 py-3 text-[10px] uppercase tracking-[0.16em] text-cyan underline-offset-4 hover:underline"
                    >
                      Change fighter
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>

          <p aria-live="polite" className="sr-only">
            {announce}
          </p>

          <p className="mono mt-3 px-9 text-center text-[10px] uppercase tracking-[0.14em] text-muted sm:px-0">
            Drag or tap two neighbours · arrow keys + space also work
          </p>
        </div>

        {/* ---------------- boss panel ---------------- */}
        <aside
          ref={asideRef}
          data-solid=""
          data-reveal=""
          style={{ ["--reveal-delay" as string]: "120ms" }}
          className="arcade-boss panel relative flex flex-col overflow-hidden p-5"
        >
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-48 bg-magenta/20 blur-3xl"
          />
          {/* enrage telegraph glow */}
          <div
            aria-hidden="true"
            className="arcade-enrage pointer-events-none absolute inset-0 rounded-[14px] opacity-0"
          />
          <p className="label relative">Boss</p>
          <div className="relative mt-2 flex justify-center">
            <div ref={bossWrapRef}>
              <div className={phase === "won" ? "" : "bob-slow"}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={bossImgRef}
                  src={spriteSrc(boss.id)}
                  alt="Taurus, the minotaur boss"
                  width={boss.w}
                  height={boss.h}
                  className={`arcade-boss-img sprite h-[150px] w-auto transition-[rotate,translate,opacity] duration-500 sm:h-[170px] lg:h-[136px] ${
                    phase === "won" ? "translate-y-3 -rotate-12 opacity-70" : ""
                  }`}
                  style={
                    phase === "won"
                      ? { filter: "grayscale(1) brightness(.7) drop-shadow(0 6px 10px rgba(0,0,0,.55))" }
                      : undefined
                  }
                />
              </div>
            </div>
          </div>
          <p className="relative font-display text-2xl leading-none">TAURUS</p>
          <p className="mono relative text-[10px] uppercase tracking-[0.2em] text-magenta">
            Minotaur · Boss
          </p>

          {/* attack telegraph */}
          <div className="relative mt-4">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="mono text-[10px] uppercase tracking-[0.16em] text-muted">
                Next attack
              </span>
              <span className="flex items-center gap-2">
                <span className="arcade-warn mono hidden text-[10px] font-bold uppercase tracking-[0.16em] text-magenta">
                  Winding up
                </span>
                <span
                  ref={secRef}
                  className="mono text-[10px] tabular-nums text-amber empty:before:content-['—']"
                />
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-panel-2">
              <div
                ref={chargeRef}
                className="h-full origin-left rounded-full bg-gradient-to-r from-amber to-magenta"
                style={{ transform: "scaleX(0)" }}
              />
            </div>
          </div>

          {/* loadout: the chosen fighter and found coins change the fight */}
          <div className="relative mt-4 border-t border-edge/60 pt-4">
            <div className="flex items-center justify-between gap-2">
              <p className="label">Loadout</p>
              <a
                href="#roster"
                className="mono -my-3 py-3 text-[10px] uppercase tracking-[0.14em] text-cyan underline-offset-4 hover:underline"
              >
                Change fighter
              </a>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <span
                className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border bg-panel-2/60"
                style={{ borderColor: `${accent}99`, boxShadow: `0 0 16px -6px ${accent}` }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={spriteSrc(hero.id)}
                  alt=""
                  className="sprite h-9 max-w-[38px] object-contain"
                />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-display text-lg leading-none">
                  {hero.name}
                </span>
                <span className="mono mt-1 block text-[10px] uppercase tracking-[0.16em] text-muted">
                  {hero.role}
                </span>
              </span>
            </div>
            <ul className="mono mt-3 space-y-1 text-[11px]">
              {loadout.map((s) => (
                <li key={s.k} className="flex items-center gap-2">
                  <span className="w-7 text-muted">{s.k}</span>
                  <span aria-hidden="true" className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <span
                        key={n}
                        className={`h-2 w-1.5 rounded-[1px] ${n <= s.v ? s.pip : "bg-edge"}`}
                      />
                    ))}
                  </span>
                  <span className="tabular-nums text-ink">{s.v}</span>
                  <span aria-hidden="true" className="text-muted">
                    →
                  </span>
                  <span className="sr-only">:</span>
                  <span className="truncate text-ink">{s.effect}</span>
                </li>
              ))}
              <li className="flex items-center gap-2">
                <span className="text-amber">COINS</span>
                <span className="tabular-nums text-ink">
                  {coinCount}/{totalCoins}
                </span>
                <span aria-hidden="true" className="text-muted">
                  →
                </span>
                <span className="sr-only">:</span>
                <span className="text-ink">+{HP_PER_COIN * coinCount} HP</span>
              </li>
            </ul>
            <p className="mt-2 text-[12px] leading-snug text-muted">
              {coinCount < totalCoins
                ? "Find hidden coins on the page for more HP."
                : "Every coin found. Max HP."}
            </p>
          </div>

          <div className="relative mt-4 space-y-2 border-t border-edge/60 pt-4">
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
        @keyframes arcade-rise{0%{transform:translateY(0) scale(.6);opacity:0}18%{transform:translateY(-8px) scale(1.25);opacity:1}32%{transform:translateY(-12px) scale(1)}100%{transform:translateY(-56px) scale(1);opacity:0}}
        @keyframes arcade-tick{0%{transform:scale(1.4);color:#c8ff2e}100%{transform:scale(1)}}
        @keyframes arcade-drop{
          0%{transform:translateY(calc(var(--arcade-drop,1) * -100%));animation-timing-function:cubic-bezier(.5,0,.9,.5)}
          70%{transform:translateY(0) scale(1.1,.84);animation-timing-function:cubic-bezier(.2,.8,.3,1)}
          86%{transform:translateY(-4%) scale(.96,1.05)}
          100%{transform:none}
        }
        @keyframes arcade-clear{0%{transform:scale(1);opacity:1}35%{transform:scale(1.3) rotate(-8deg);filter:brightness(2.4);opacity:1}100%{transform:scale(0) rotate(16deg);filter:brightness(2.4);opacity:0}}
        @keyframes arcade-pick{0%{transform:scale(1)}45%{transform:scale(1.2,.9)}75%{transform:scale(1.06,1.14)}100%{transform:scale(1.1)}}
        @keyframes arcade-hint{0%,100%{transform:scale(1);translate:0 0;box-shadow:0 0 0 0 rgba(200,255,46,0)}50%{transform:scale(1.05);translate:calc(var(--arcade-hx,0) * 4%) calc(var(--arcade-hy,0) * 4%);box-shadow:0 0 22px -2px rgba(200,255,46,.75)}}
        @keyframes arcade-callout{0%{transform:scale(.3) rotate(-10deg);opacity:0}16%{transform:scale(1.2) rotate(3deg);opacity:1}28%{transform:scale(1) rotate(0)}78%{transform:scale(1);opacity:1}100%{transform:translateY(-16px) scale(1.04);opacity:0}}
        @keyframes arcade-overlay{from{opacity:0}}
        @keyframes arcade-record{0%,100%{box-shadow:0 0 0 0 rgba(200,255,46,0)}50%{box-shadow:0 0 18px 0 rgba(200,255,46,.55)}}
        @keyframes arcade-pulse{from{opacity:.45}to{opacity:1}}
        @keyframes arcade-tremble{0%,100%{translate:0 0}25%{translate:-1.5px 0}75%{translate:1.5px 0}}
        @keyframes arcade-low{0%,100%{filter:none}50%{filter:brightness(1.6)}}

        .arcade-pick{animation:arcade-pick .3s cubic-bezier(.34,1.56,.64,1) forwards}
        .arcade-clear{animation:arcade-clear .22s ease-in forwards}
        .arcade-hint{animation:arcade-hint 1.1s ease-in-out infinite}
        .arcade-ghost{transition:width .5s cubic-bezier(.4,0,.2,1) .35s}

        .arcade-enrage{box-shadow:inset 0 0 0 1px rgba(255,45,119,.85),inset 0 0 48px -8px rgba(255,45,119,.6),0 0 0 1px rgba(255,45,119,.35);transition:opacity .2s}
        .arcade-boss[data-enraged] .arcade-enrage{opacity:1}
        .arcade-boss[data-enraged] .arcade-warn{display:inline}
        .arcade-panel[data-enraged] .arcade-mini-track{box-shadow:0 0 0 1px rgba(255,45,119,.8),0 0 12px rgba(255,45,119,.6)}
        @media (prefers-reduced-motion: no-preference){
          .arcade-boss[data-enraged] .arcade-enrage{animation:arcade-pulse .45s ease-in-out infinite alternate}
          .arcade-boss[data-enraged] .arcade-boss-img{animation:arcade-tremble .14s linear infinite}
          .arcade-boss[data-enraged] .arcade-warn{animation:arcade-pulse .45s ease-in-out infinite alternate}
          .arcade-panel[data-enraged] .arcade-mini-track{animation:arcade-pulse .45s ease-in-out infinite alternate}
          .arcade-low{animation:arcade-low 1s ease-in-out infinite}
        }
      `}</style>
    </Section>
  );
}
