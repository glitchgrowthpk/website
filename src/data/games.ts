export type Genre = "Puzzle" | "Casual" | "Strategy" | "RPG";

export interface Game {
  slug: string;
  title: string;
  short: string;
  genre: Genre;
  installs: string;
  /** 0-1, used for the install meter */
  reach: number;
  rating?: number;
  tagline: string;
  play?: string;
  ios?: string;
}

const PLAY = "https://play.google.com/store/apps/details?id=";
const APPLE = "https://apps.apple.com/us/app/";

export const GAMES: Game[] = [
  {
    slug: "water-flow",
    title: "Water Flow: Color Sort Games",
    short: "Water Flow",
    genre: "Puzzle",
    installs: "100K+",
    reach: 1,
    rating: 3.7,
    tagline: "Pour, sort and separate every colour until the pipes run clean.",
    play: PLAY + "com.glitchtech.waterwalls.games",
    ios: APPLE + "water-valves-sort-puzzle-game/id6741197663",
  },
  {
    slug: "battle-order",
    title: "Battle Order: Merge Defense TD",
    short: "Battle Order",
    genre: "Strategy",
    installs: "50K+",
    reach: 0.72,
    rating: 3.8,
    tagline: "Merge heroes into a kingdom-sized wall and hold the line.",
    play: PLAY + "com.Glitch.BattleOrder",
    ios: APPLE + "battle-order-tower-defence-td/id6736828786",
  },
  {
    slug: "puzzle-warrior",
    title: "Puzzle Warrior: Dungeon Fight",
    short: "Puzzle Warrior",
    genre: "RPG",
    installs: "50K+",
    reach: 0.72,
    tagline: "A match-3 board that swings a real sword. Match, power up, save the realm.",
    play: PLAY + "com.glitchtech.puzzlewarrior.rpg",
    ios: APPLE + "puzzle-warrior-dungeon-fight/id6479637146",
  },
  {
    slug: "balloon-fill",
    title: "Balloon Fill: Color Match Game",
    short: "Balloon Fill",
    genre: "Casual",
    installs: "10K+",
    reach: 0.5,
    rating: 4.6,
    tagline: "The most satisfying colour-match ASMR loop we have ever shipped.",
    play: PLAY + "com.glitchtech.balloon.game",
    ios: APPLE + "balloon-fill-color-match-asmr/id6737333681",
  },
  {
    slug: "pirates-attack",
    title: "Pirates Attack: Gold Defense",
    short: "Pirates Attack",
    genre: "Casual",
    installs: "10K+",
    reach: 0.5,
    rating: 3.1,
    tagline: "Defend the hoard. Every wave wants your gold more than the last.",
    play: PLAY + "com.glitchtech.piratesattack.defense",
  },
  {
    slug: "block-race",
    title: "Block Race: Block Puzzle Games",
    short: "Block Race",
    genre: "Casual",
    installs: "500+",
    reach: 0.34,
    tagline: "Classic block puzzle with a race pulse under the board.",
    play: PLAY + "com.tetrisrun.block.puzzle",
  },
  {
    slug: "blender-jam",
    title: "Blender Jam: Juice Match Game",
    short: "Blender Jam",
    genre: "Puzzle",
    installs: "500+",
    reach: 0.34,
    tagline: "Match the fruit, pull the lever, watch the whole thing liquefy.",
    play: PLAY + "com.glitchtech.fruitjam.juicepuzzle",
    ios: APPLE + "fruit-sort-match-juice-game/id6747580078",
  },
  {
    slug: "queue-panic",
    title: "Queue Panic: Sorting Puzzle",
    short: "Queue Panic",
    genre: "Casual",
    installs: "100+",
    reach: 0.22,
    tagline: "Bureaucracy as a sorting puzzle. Stamp fast, stamp right.",
    play: PLAY + "com.glitchtech.queuepanic.sortinggame",
  },
  {
    slug: "ice-cream-spin",
    title: "Ice Cream Spin: Sorting Game",
    short: "Ice Cream Spin",
    genre: "Puzzle",
    installs: "100+",
    reach: 0.22,
    tagline: "Spin the stand, sort the scoops, never drop a cone.",
    play: PLAY + "com.glitchtech.icecream.match.sortgame",
  },
  {
    slug: "sword-knight",
    title: "Sword Knight: Idle RPG Games",
    short: "Sword Knight",
    genre: "RPG",
    installs: "100+",
    reach: 0.22,
    tagline: "Match gear, power up the knight, let the idle loop do the rest.",
    play: PLAY + "com.glitchtech.swordknight",
  },
  {
    slug: "color-room",
    title: "Color Room Puzzle: Escape Game",
    short: "Color Room",
    genre: "Puzzle",
    installs: "100+",
    reach: 0.22,
    tagline: "Every room is a lock. Every colour is a key.",
    play: PLAY + "com.glitchtech.colorrooms.puzzlegame",
    ios: APPLE + "color-room-puzzle-escape-game/id6747668639",
  },
  {
    slug: "color-car",
    title: "Color Car Escape: Bus Jam 3D",
    short: "Color Car Escape",
    genre: "Puzzle",
    installs: "100+",
    reach: 0.22,
    tagline: "Untangle the lot before the horn section loses its mind.",
    play: PLAY + "com.glitchtech.coloredescape.carjam",
    ios: APPLE + "color-car-escape-bus-jam-3d/id6747579004",
  },
];

export const GENRES: Genre[] = ["Puzzle", "Casual", "Strategy", "RPG"];
