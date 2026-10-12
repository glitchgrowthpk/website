/**
 * Pure match-3 core. No React, no DOM — so the rules stay testable and the
 * view layer only worries about animation.
 */

export const COLS = 7;
export const ROWS = 7;
export const TYPES = 5;

export interface Gem {
  id: number;
  type: number;
  /**
   * How many rows this gem fell from above the board when it spawned. A view
   * hint for the drop-in animation only; the rules never read it.
   */
  drop?: number;
}

export type Board = (Gem | null)[];

export const idx = (r: number, c: number) => r * COLS + c;
export const rowOf = (i: number) => Math.floor(i / COLS);
export const colOf = (i: number) => i % COLS;

/** A random gem type, for live play (the idle board uses the seeded LCG below). */
const rand = () => Math.floor(Math.random() * TYPES);

let seq = 1;
const mk = (type: number, drop?: number): Gem =>
  drop ? { id: seq++, type, drop } : { id: seq++, type };

/** Indices that belong to a horizontal or vertical run of 3 or more. */
export function findMatches(b: Board): number[] {
  const hit = new Set<number>();

  for (let r = 0; r < ROWS; r++) {
    let run = 1;
    for (let c = 1; c <= COLS; c++) {
      const prev = b[idx(r, c - 1)];
      const cur = c < COLS ? b[idx(r, c)] : null;
      if (cur && prev && cur.type === prev.type) {
        run++;
      } else {
        if (run >= 3) for (let k = c - run; k < c; k++) hit.add(idx(r, k));
        run = 1;
      }
    }
  }

  for (let c = 0; c < COLS; c++) {
    let run = 1;
    for (let r = 1; r <= ROWS; r++) {
      const prev = b[idx(r - 1, c)];
      const cur = r < ROWS ? b[idx(r, c)] : null;
      if (cur && prev && cur.type === prev.type) {
        run++;
      } else {
        if (run >= 3) for (let k = r - run; k < r; k++) hit.add(idx(k, c));
        run = 1;
      }
    }
  }

  return [...hit];
}

/** Are two indices orthogonally adjacent? */
export function adjacent(a: number, b: number): boolean {
  const dr = Math.abs(rowOf(a) - rowOf(b));
  const dc = Math.abs(colOf(a) - colOf(b));
  return dr + dc === 1;
}

export function swapped(b: Board, a: number, c: number): Board {
  const next = b.slice();
  [next[a], next[c]] = [next[c], next[a]];
  return next;
}

/** True if any single swap would produce a match. */
export function hasMove(b: Board): boolean {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = idx(r, c);
      if (c + 1 < COLS) {
        if (findMatches(swapped(b, i, idx(r, c + 1))).length) return true;
      }
      if (r + 1 < ROWS) {
        if (findMatches(swapped(b, i, idx(r + 1, c))).length) return true;
      }
    }
  }
  return false;
}

/**
 * The legal swap that clears the most pieces straight away (ties go to the
 * first one found, scanning top-left to bottom-right), or null on a deadlock.
 * Used for the idle hint, so it never looks further than one move ahead.
 */
export function findMove(b: Board): [number, number] | null {
  let best: [number, number] | null = null;
  let bestSize = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = idx(r, c);
      const pairs: number[] = [];
      if (c + 1 < COLS) pairs.push(idx(r, c + 1));
      if (r + 1 < ROWS) pairs.push(idx(r + 1, c));
      for (const j of pairs) {
        const size = findMatches(swapped(b, i, j)).length;
        if (size > bestSize) {
          best = [i, j];
          bestSize = size;
        }
      }
    }
  }
  return best;
}

export function clearCells(b: Board, cells: number[]): Board {
  const next = b.slice();
  for (const i of cells) next[i] = null;
  return next;
}

/**
 * Drop everything into the holes and refill the top. New gems remember how far
 * they fell (`drop`) so the view can rain them in from above the board.
 */
export function collapse(b: Board): Board {
  const next = b.slice();
  for (let c = 0; c < COLS; c++) {
    let write = ROWS - 1;
    for (let r = ROWS - 1; r >= 0; r--) {
      const g = next[idx(r, c)];
      if (g) {
        next[idx(write, c)] = g;
        if (write !== r) next[idx(r, c)] = null;
        write--;
      }
    }
    const holes = write + 1;
    for (let r = write; r >= 0; r--) next[idx(r, c)] = mk(rand(), holes);
  }
  return next;
}

/** Deterministic LCG, so a seeded board renders identically on server and client. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return Math.floor((s / 0x100000000) * TYPES);
  };
}

/**
 * A fresh board with no freebies and at least one legal move.
 * Pass a seed for the idle board shown before the fight starts — it has to
 * match between the server render and hydration.
 */
export function makeBoard(seed?: number): Board {
  const next = seed === undefined ? rand : seeded(seed);
  for (let attempt = 0; attempt < 60; attempt++) {
    let fixed: Board = Array.from({ length: ROWS * COLS }, () => mk(next()));
    let guard = 0;
    while (findMatches(fixed).length && guard++ < 40) {
      const m = findMatches(fixed);
      const patched = fixed.slice();
      for (const i of m) patched[i] = mk(next());
      fixed = patched;
    }
    if (!findMatches(fixed).length && hasMove(fixed)) return fixed;
  }
  return Array.from({ length: ROWS * COLS }, () => mk(next()));
}

/* ----------------------------------------------------------------- combat */

/** Raw damage per piece cleared. */
const PER_PIECE = 4;
/** Pieces beyond this in one wave stop adding damage. */
const PIECE_CAP = 8;
/** Each cascade wave adds this much to the multiplier... */
const CASCADE_STEP = 0.25;
/** ...up to this many waves (so the multiplier tops out at 2x). */
const CASCADE_CAP = 4;
/** A critical hit, from a clear of four or more or from the fighter's luck roll. */
export const CRIT_MULT = 1.5;
/**
 * Most damage a single swap can do, however long its cascade runs. Without it
 * a lucky ten-wave refill could take Taurus from full to half in one move.
 */
export const TURN_CAP = 80;

export interface HitMods {
  /** Fighter damage multiplier (see `powerMult`). Defaults to 1. */
  power?: number;
  /** Whether the fighter's luck roll landed. Clears of 4+ always crit anyway. */
  lucky?: boolean;
  /** Damage already dealt by earlier waves of this turn, for the turn cap. */
  dealt?: number;
}

/** Clearing four or more at once always crits — the board's own reward for a big match. */
export const isCrit = (cleared: number, lucky = false) => lucky || cleared >= 4;

/**
 * Damage for one wave of a turn (the swap's own clear is wave 0, each
 * cascade after it is the next wave).
 *
 *   PER_PIECE x pieces (capped at PIECE_CAP)
 *   x (1 + 0.25 per cascade wave, capped at 2x)
 *   x 1.5 on a crit (four or more pieces, or a lucky roll)
 *   x the fighter's power multiplier
 *   then clipped so the whole turn never exceeds TURN_CAP (may return 0).
 *
 * A plain three-match does ~12 and an average turn ~25, so a fight takes
 * about 10 turns — roughly 30-90 seconds for a person — and is still winnable
 * by the weakest fighter with no coins. Pure, so the balance can be checked
 * in isolation.
 */
export function damageFor(
  cleared: number,
  cascade: number,
  { power = 1, lucky = false, dealt = 0 }: HitMods = {},
): number {
  const base = PER_PIECE * Math.min(cleared, PIECE_CAP);
  const chain = 1 + CASCADE_STEP * Math.min(cascade, CASCADE_CAP);
  const crit = isCrit(cleared, lucky) ? CRIT_MULT : 1;
  const raw = Math.max(1, Math.round(base * chain * crit * power));
  return Math.max(0, Math.min(raw, TURN_CAP - dealt));
}

/* -------------------------------------------------------------- fighters */

/** Fighter power stat (1-5) to a damage multiplier: 0.925x at 1, 1.225x at 5. */
export const powerMult = (pwr: number) => 0.85 + 0.075 * pwr;
/** Fighter speed stat (1-5) slows the boss: 6.4s between attacks at 1, 8s at 5. */
export const bossPeriodMs = (spd: number) => 6000 + 400 * spd;
/** Fighter luck stat (1-5) to a crit chance per clear: 4% per point. */
export const critChance = (lck: number) => 0.04 * lck;
/** Every hidden coin found on the page is worth this much extra max HP. */
export const HP_PER_COIN = 3;

/* ---------------------------------------------------------------- scoring */

/** Score bonus for a turn whose cascade went `depth` waves deep (1 = no cascade). */
export const cascadeBonus = (depth: number) =>
  depth > 1 ? 25 * ((depth - 1) * depth) / 2 : 0;

/** On a win: 10 points for every second under 90. */
export const timeBonus = (ms: number) =>
  Math.max(0, Math.round((90_000 - ms) / 100));
