export const STUDIO = {
  name: "GlitchTech Games",
  mission:
    "On a mission to create global best sellers in hybrid-casual and puzzle games.",
  blurb: "We build casual and hybrid-casual mobile games, and we ship them fast.",
  location: "Pakistan",
  emails: {
    studio: "studio@glitchtech.games",
    partner: "Partner@glitchtech.co",
  },
  stores: {
    play: "https://play.google.com/store/apps/dev?id=5877831210343090035",
    apple: "https://apps.apple.com/us/developer/lystn/id1586089517",
  },
};

export const HEADLINE_STATS = [
  { value: 12, suffix: "", label: "Titles shipped", accent: "cyan" },
  { value: 220, suffix: "K+", label: "Total installs", accent: "magenta" },
  { value: 400, suffix: "+", label: "Original characters", accent: "lime" },
  { value: 13, suffix: "", label: "Titles built", accent: "violet" },
] as const;

export const PERF_STATS = [
  { label: "Day 1 retention", display: "42%", fill: 0.84, note: "Puzzle Warrior", accent: "cyan" },
  { label: "Day 7 retention", display: "11%", fill: 0.55, note: "Puzzle Warrior", accent: "magenta" },
  { label: "Avg. session", display: "23min", fill: 0.76, note: "Across portfolio", accent: "lime" },
  { label: "Cost per install", display: "$0.01", fill: 0.95, note: "South America", accent: "violet" },
] as const;

export const PIPELINE = [
  { n: "01", stage: "Concept", phase: "BUILD", body: "Lock the core mechanic and the creative direction." },
  { n: "02", stage: "Prototype", phase: "BUILD", body: "Build the playable loop and the first art pass." },
  { n: "03", stage: "Art & UX", phase: "BUILD", body: "Create the identity, UX and store-ready assets." },
  { n: "04", stage: "Soft launch", phase: "VALIDATE", body: "Test CPI and day-1 retention signals in market." },
  { n: "05", stage: "Live ops", phase: "GROW", body: "Improve balance and ship new content and events." },
] as const;

export const STRENGTHS = [
  {
    n: "01",
    title: "Sort & colour puzzle",
    body: "The deepest part of the portfolio. Clean rules, endless level supply, ASMR-grade feedback.",
    proof: ["Water Flow 100K+", "Balloon Fill 10K+", "Queue Panic"],
    accent: "cyan",
    char: "cucumber",
  },
  {
    n: "02",
    title: "Puzzle + RPG hybrids",
    body: "A casual board bolted onto real progression. This is where the retention numbers come from.",
    proof: ["Puzzle Warrior 50K+", "Battle Order 50K+"],
    accent: "magenta",
    char: "swordknight",
  },
  {
    n: "03",
    title: "Arcade & defense",
    body: "Short-session pressure loops with a meta layer underneath. Fast to prototype, fast to read.",
    proof: ["Pirates Attack 10K+", "Block Race", "Color Car Escape"],
    accent: "lime",
    char: "orc",
  },
] as const;

export const DISCIPLINES = [
  { char: "swordknight", role: "Game design", body: "Core loops, level curves and economy models." },
  { char: "crimson", role: "Art direction", body: "Characters, UI and store creative, all in house." },
  { char: "vanguard", role: "Unity dev", body: "Client, tooling and the live build pipeline." },
  { char: "raccoon", role: "UA & ASO", body: "Creative testing, CPI hunting, store listings." },
  { char: "firefighter", role: "Live ops", body: "Balance passes, events and content drops." },
] as const;

export const SECTIONS = [
  { id: "top", label: "Start" },
  { id: "studio", label: "Studio" },
  { id: "roster", label: "Roster" },
  { id: "portfolio", label: "Games" },
  { id: "arcade", label: "Arcade" },
  { id: "pipeline", label: "Pipeline" },
  { id: "partner", label: "Partner" },
] as const;
