/**
 * Every collectible coin on the page. The HUD total is derived from this list,
 * so adding a `<Coin>` means adding its id here too — otherwise "collect them
 * all" becomes impossible.
 */
export const COINS = [
  { id: "hero", where: "Hero stage" },
  { id: "hero-sky", where: "Above the hero title" },
  { id: "stats", where: "Performance panel" },
  { id: "studio-thesis", where: "The thesis panel" },
  { id: "roster", where: "Roster grid" },
  { id: "portfolio", where: "Games grid" },
  { id: "arcade", where: "Arcade board" },
  { id: "pipeline", where: "Pipeline track" },
  { id: "strengths", where: "Portfolio strengths" },
  { id: "team", where: "Team roster" },
  { id: "partner", where: "Contact panel" },
  { id: "footer", where: "The very bottom" },
] as const;

export type CoinId = (typeof COINS)[number]["id"];

export const COIN_IDS: readonly string[] = COINS.map((c) => c.id);
export const TOTAL_COINS = COINS.length;

/** Points each coin is worth toward the visitor's level. */
export const COIN_POINTS = 5;
