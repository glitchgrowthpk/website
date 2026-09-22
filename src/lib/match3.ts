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
}

export type Board = (Gem | null)[];

export const idx = (r: number, c: number) => r * COLS + c;
export const rowOf = (i: number) => Math.floor(i / COLS);
export const colOf = (i: number) => i % COLS;

let seq = 1;
const mk = (type: number): Gem => ({ id: seq++, type });

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

export function clearCells(b: Board, cells: number[]): Board {
  const next = b.slice();
  for (const i of cells) next[i] = null;
  return next;
}

/** Drop everything into the holes and refill the top. */
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
    for (let r = write; r >= 0; r--) next[idx(r, c)] = mk(rand());
  }
  return next;
}

const rand = () => Math.floor(Math.random() * TYPES);

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

/** Damage for a clear: bigger runs and deeper cascades hit much harder. */
export function damageFor(cleared: number, cascade: number): number {
  const base = cleared * 5;
  const runBonus = cleared >= 5 ? 16 : cleared >= 4 ? 7 : 0;
  return Math.round((base + runBonus) * (1 + cascade * 0.5));
}
