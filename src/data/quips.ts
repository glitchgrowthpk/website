/**
 * One-liners the ambient walker says about the section on screen.
 *
 * Shown at most once per section per session, only after the section has been
 * in view for a few seconds, and never while the visitor is driving. Keep them
 * short (under ~60 characters), dry, and true — no invented studio facts.
 */
export interface Quip {
  line: string;
  /**
   * Used on touch devices or when single-key shortcuts are turned off, for
   * lines that would otherwise mention a key the visitor cannot press.
   */
  alt?: string;
  /**
   * An achievement id: once the visitor has earned it, the line has nothing
   * left to teach and is skipped (no point telling someone who has already
   * walked the page how to take control).
   */
  skipIf?: string;
}

/** Keyed by section id (see SECTIONS in data/studio.ts). */
export const QUIPS: Record<string, Quip> = {
  top: {
    line: "Press G and I'll walk wherever you want.",
    alt: "Take control and I'll walk wherever you want.",
    skipIf: "hands-on",
  },
  studio: { line: "Those stat tiles are platforms. Try standing on one." },
  roster: { line: "Pick me. Or don't. I'll follow you either way." },
  portfolio: { line: "Every one of these icons was drawn in house." },
  arcade: { line: "Four in a row crits. Taurus hates that." },
  pipeline: { line: "Five stages, one map. Ride it to the end." },
  partner: { line: "This is the part where you say hello." },
};
