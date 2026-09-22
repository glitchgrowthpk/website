export type Accent = "cyan" | "magenta" | "lime" | "violet" | "amber";

export interface Character {
  id: string;
  name: string;
  role: string;
  accent: Accent;
  /** power / speed / luck, 1-5 */
  stats: [number, number, number];
  bio: string;
  /** natural sprite size in px at 1x */
  w: number;
  h: number;
}

export const CHARACTERS: Character[] = [
  { id: "swordknight", name: "Razorhelm", role: "Vanguard", accent: "cyan", stats: [5, 3, 2], bio: "The face of Sword Knight. Never removes the helmet, never explains why.", w: 140, h: 241 },
  { id: "vanguard", name: "Vantage", role: "Paladin", accent: "cyan", stats: [4, 3, 3], bio: "Carries a blade made of pure UI glow. Blocks first, asks later.", w: 132, h: 223 },
  { id: "crimson", name: "Crimson", role: "Ranger", accent: "magenta", stats: [3, 5, 3], bio: "Visor down, sprint on. Holds the studio record for fastest dungeon clear.", w: 128, h: 204 },
  { id: "ninja", name: "Nox", role: "Assassin", accent: "violet", stats: [4, 5, 2], bio: "Was in the last three frames of this page. You missed it.", w: 119, h: 196 },
  { id: "warlord", name: "Morgrim", role: "Warlord", accent: "violet", stats: [5, 2, 3], bio: "Six horns, one grudge. Runs the raid whether you signed up or not.", w: 124, h: 234 },
  { id: "reaper", name: "The Reaper", role: "Harvester", accent: "lime", stats: [5, 4, 1], bio: "Only shows up when your run is already over.", w: 118, h: 221 },
  { id: "captain", name: "Captain Red", role: "Commander", accent: "magenta", stats: [4, 3, 4], bio: "The plume is not regulation. Nobody has ever brought it up.", w: 123, h: 233 },
  { id: "viking", name: "Frosthorn", role: "Berserker", accent: "cyan", stats: [5, 3, 2], bio: "Charges in a straight line. It has worked out so far.", w: 123, h: 226 },
  { id: "firefighter", name: "Blaze", role: "Rescue", accent: "amber", stats: [3, 4, 5], bio: "The only one on the roster who pulls people out of the dungeon.", w: 142, h: 214 },
  { id: "skeleton", name: "Rattle", role: "Undead", accent: "cyan", stats: [2, 4, 5], bio: "Technically a former employee. Still attends stand-up.", w: 117, h: 206 },
  { id: "raccoon", name: "Bandit", role: "Rogue", accent: "amber", stats: [3, 5, 5], bio: "Took the coins on this page before you got here. Check your counter.", w: 123, h: 216 },
  { id: "orc", name: "Grunk", role: "Brute", accent: "lime", stats: [5, 2, 2], bio: "Two-handed hammer, one-handed opinions.", w: 199, h: 257 },
  { id: "minotaur", name: "Taurus", role: "Boss", accent: "magenta", stats: [5, 3, 1], bio: "The wall every soft launch runs into. Fight him in the arcade below.", w: 188, h: 324 },
  { id: "blackcat", name: "Midnight", role: "Familiar", accent: "violet", stats: [2, 5, 5], bio: "Walked across a level designer keyboard. We shipped it anyway.", w: 123, h: 213 },
  { id: "dino", name: "Rex", role: "Beast", accent: "lime", stats: [4, 3, 4], bio: "Small arms, enormous confidence.", w: 222, h: 219 },
  { id: "duck", name: "Sgt. Quack", role: "Support", accent: "amber", stats: [2, 4, 5], bio: "Rubber-duck debugging, but the duck fights back.", w: 143, h: 216 },
  { id: "egg", name: "The Egg", role: "???", accent: "cyan", stats: [1, 1, 5], bio: "Unhatched. Unreleased. Under NDA.", w: 85, h: 111 },
  { id: "cucumber", name: "Pickles", role: "Produce", accent: "lime", stats: [2, 3, 4], bio: "Calm under pressure. Literally brined for it.", w: 96, h: 233 },
  { id: "slice", name: "Slice", role: "Produce", accent: "lime", stats: [1, 4, 3], bio: "One third of Pickles. Holds a grudge about it.", w: 97, h: 96 },
  { id: "chunk", name: "Chunk", role: "Produce", accent: "lime", stats: [2, 3, 3], bio: "The middle child. Angriest of the three.", w: 96, h: 118 },
  { id: "cube", name: "Cube", role: "Produce", accent: "lime", stats: [1, 4, 4], bio: "Smallest hitbox on the roster. Uses it.", w: 86, h: 110 },
  { id: "chili", name: "Habanero", role: "Hothead", accent: "magenta", stats: [4, 4, 2], bio: "Damage over time, personality over everything.", w: 159, h: 218 },
  { id: "potato", name: "Spud", role: "Farmhand", accent: "amber", stats: [3, 2, 5], bio: "Brought a rake to a sword fight and won on economy.", w: 210, h: 209 },
];

export const DEFAULT_CHARACTER = "swordknight";

export const byId = (id: string): Character =>
  CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];

export const ACCENT_HEX: Record<Accent, string> = {
  cyan: "#00e5ff",
  magenta: "#ff2d77",
  lime: "#c8ff2e",
  violet: "#8b5cf6",
  amber: "#ffb020",
};

export const spriteSrc = (id: string) => `/characters/${id}.webp`;
