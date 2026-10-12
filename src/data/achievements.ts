export interface Achievement {
  id: string;
  title: string;
  /** Shown once unlocked. */
  desc: string;
  /** Shown while locked. Secret achievements show only this. */
  hint: string;
  points: number;
  /** Character sprite id used as the badge art. */
  icon: string;
  secret?: boolean;
}

/**
 * The site's achievement list. Components unlock these by id through
 * `useGame().unlock(id)`; the provider handles persistence, the popup queue
 * and the Completionist check.
 */
export const ACHIEVEMENTS: Achievement[] = [
  {
    id: "press-start",
    title: "Press Start",
    desc: "Booted up the GlitchTech site.",
    hint: "Just show up.",
    points: 5,
    icon: "egg",
  },
  {
    id: "fighter",
    title: "Choose Wisely",
    desc: "Picked a fighter from the roster.",
    hint: "Visit the roster and make a choice.",
    points: 10,
    icon: "swordknight",
  },
  {
    id: "hands-on",
    title: "Hands On",
    desc: "Took direct control of your fighter.",
    hint: "Press G, or tap the control button.",
    points: 10,
    icon: "ninja",
  },
  {
    id: "parkour",
    title: "Parkour",
    desc: "Landed on 10 different parts of the page.",
    hint: "The cards are platforms. Jump on them.",
    points: 25,
    icon: "crimson",
  },
  {
    id: "first-coin",
    title: "Shiny",
    desc: "Found your first hidden coin.",
    hint: "Something gold is hiding on this page.",
    points: 5,
    icon: "raccoon",
  },
  {
    id: "collector",
    title: "Collector",
    desc: "Found every hidden coin on the site.",
    hint: "Find all the hidden coins.",
    points: 50,
    icon: "captain",
  },
  {
    id: "tourist",
    title: "Level Select",
    desc: "Visited every section of the site.",
    hint: "See every level, start to finish.",
    points: 20,
    icon: "duck",
  },
  {
    id: "pipeline",
    title: "Map Complete",
    desc: "Followed the pipeline from concept to live ops.",
    hint: "Ride the level map to the end.",
    points: 10,
    icon: "cucumber",
  },
  {
    id: "boss-slayer",
    title: "Boss Slayer",
    desc: "Defeated Taurus in the arcade.",
    hint: "Beat the arcade boss.",
    points: 40,
    icon: "minotaur",
  },
  {
    id: "combo",
    title: "Chain Reaction",
    desc: "Triggered a 3× cascade in the arcade.",
    hint: "Let the board do the work.",
    points: 20,
    icon: "chili",
  },
  {
    id: "window-shopper",
    title: "Window Shopper",
    desc: "Checked out one of our games on a store.",
    hint: "Visit a store listing.",
    points: 10,
    icon: "potato",
  },
  {
    id: "quest",
    title: "Quest Accepted",
    desc: "Started a conversation with the studio.",
    hint: "Talk to someone in the partner section.",
    points: 15,
    icon: "firefighter",
  },
  {
    id: "sound-check",
    title: "Sound Check",
    desc: "Turned on the sound or the soundtrack.",
    hint: "Everything here is synthesised. Listen.",
    points: 5,
    icon: "viking",
  },
  {
    id: "konami",
    title: "Up Up Down Down",
    desc: "Entered the Konami code.",
    hint: "A very old cheat code.",
    points: 30,
    icon: "dino",
    secret: true,
  },
  {
    id: "afk",
    title: "AFK",
    desc: "Left your fighter idle long enough to nap.",
    hint: "Sometimes the best move is no move.",
    points: 5,
    icon: "blackcat",
    secret: true,
  },
  {
    id: "completionist",
    title: "Completionist",
    desc: "Unlocked every other achievement.",
    hint: "Unlock everything else.",
    points: 100,
    icon: "reaper",
  },
];

export const ACHIEVEMENT_BY_ID: Record<string, Achievement> = Object.fromEntries(
  ACHIEVEMENTS.map((a) => [a.id, a]),
);

export const TOTAL_ACHIEVEMENTS = ACHIEVEMENTS.length;
