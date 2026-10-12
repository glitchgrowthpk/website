"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CHARACTERS, DEFAULT_CHARACTER } from "@/data/characters";
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_BY_ID,
  TOTAL_ACHIEVEMENTS,
  type Achievement,
} from "@/data/achievements";
import { COIN_IDS, COIN_POINTS, TOTAL_COINS } from "@/data/coins";
import { SECTIONS } from "@/data/studio";
import { setSoundEnabled, sfx } from "@/lib/audio";
import { music } from "@/lib/music";
import { fx } from "@/lib/fx";

/* ------------------------------------------------------------------ types */

export type MenuTab = "main" | "levels" | "achievements" | "settings" | "controls";

export interface Settings {
  /** Sound effects. Off by default; persisted. */
  sound: boolean;
  /** Soundtrack. Off by default and never persisted — no surprise audio on a return visit. */
  music: boolean;
  /** Full-screen scanline + vignette overlay. */
  crt: boolean;
  /** Reticle cursor on fine-pointer devices. */
  cursor: boolean;
  /** Single-key shortcuts (G, P). Can be turned off per WCAG 2.1.4. */
  shortcuts: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  sound: false,
  music: false,
  crt: true,
  cursor: true,
  shortcuts: true,
};

interface GameState {
  /** True once persisted progress has been restored after mount. */
  ready: boolean;

  characterId: string;
  setCharacterId: (id: string) => void;

  coins: string[];
  /** Collect a coin. Pass the coin's screen position for a particle burst. */
  collect: (id: string, origin?: { x: number; y: number }) => void;
  coinCount: number;
  totalCoins: number;

  achievements: string[];
  /** Unlock an achievement by id. Idempotent; safe to call from any handler or effect. */
  unlock: (id: string) => void;
  hasAchievement: (id: string) => boolean;
  totalAchievements: number;
  /** Head of the popup queue — the achievement currently being announced. */
  popup: Achievement | null;
  /** Advance the popup queue. Called by the popup UI when one finishes. */
  nextPopup: () => void;

  /** Achievement points + coin points. */
  score: number;
  level: number;
  /** 0-1 progress toward the next level. */
  levelProgress: number;
  maxLevel: boolean;

  visited: string[];
  markVisited: (sectionId: string) => void;

  settings: Settings;
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  /** Compat aliases for the sound setting. */
  sound: boolean;
  toggleSound: () => void;

  controlling: boolean;
  setControlling: (v: boolean) => void;

  /** Which pause-menu screen is open, or null when closed. */
  menu: MenuTab | null;
  openMenu: (tab?: MenuTab) => void;
  closeMenu: () => void;
  /** True while anything modal is up. Game loops should freeze. */
  paused: boolean;

  devMode: boolean;
  setDevMode: (v: boolean) => void;
  toast: string | null;
  pushToast: (msg: string) => void;

  /** Wipe coins, achievements, visited sections and arcade records. */
  resetProgress: () => void;
}

const Ctx = createContext<GameState | null>(null);

const KEY_CHAR = "glitch.character";
const KEY_COINS = "glitch.coins";
const KEY_SOUND = "glitch.sound";
const KEY_ACH = "glitch.achievements";
const KEY_VISITED = "glitch.visited";
const KEY_SETTINGS = "glitch.settings";

/** Level n starts at LEVEL_STEP * (n - 1)^2 points. */
const LEVEL_STEP = 12;
const MAX_SCORE =
  ACHIEVEMENTS.reduce((n, a) => n + a.points, 0) + TOTAL_COINS * COIN_POINTS;

function levelFor(score: number) {
  const level = Math.floor(Math.sqrt(score / LEVEL_STEP)) + 1;
  const lo = LEVEL_STEP * (level - 1) ** 2;
  const hi = LEVEL_STEP * level ** 2;
  return { level, progress: Math.min(1, (score - lo) / (hi - lo)) };
}

const read = <T,>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode, quota) — progress just isn't kept */
  }
};

/* --------------------------------------------------------------- provider */

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [characterId, setChar] = useState(DEFAULT_CHARACTER);
  const [coins, setCoins] = useState<string[]>([]);
  const [achievements, setAchievements] = useState<string[]>([]);
  const [queue, setQueue] = useState<string[]>([]);
  const [visited, setVisited] = useState<string[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [controlling, setControllingState] = useState(false);
  const [menu, setMenu] = useState<MenuTab | null>(null);
  const [devMode, setDevMode] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Synchronous mirrors. Decisions (and their side effects: sounds, popups)
  // are made against these, never inside a state updater — React may run an
  // updater twice in development, which would double every sound.
  const readyRef = useRef(false);
  const coinsRef = useRef<Set<string>>(new Set());
  const achRef = useRef<Set<string>>(new Set());
  const visitedRef = useRef<Set<string>>(new Set());
  const settingsRef = useRef<Settings>(DEFAULT_SETTINGS);
  /** Unlocks requested before storage was restored; replayed afterwards. */
  const pending = useRef<string[]>([]);

  /* ---------- achievements ---------- */

  const unlock = useCallback((id: string) => {
    if (!ACHIEVEMENT_BY_ID[id]) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(`[game-state] unknown achievement "${id}"`);
      }
      return;
    }
    if (!readyRef.current) {
      if (!pending.current.includes(id)) pending.current.push(id);
      return;
    }
    const granted: string[] = [];
    const grant = (aid: string) => {
      if (achRef.current.has(aid)) return;
      achRef.current.add(aid);
      granted.push(aid);
    };
    grant(id);
    if (
      ACHIEVEMENTS.every((a) => a.id === "completionist" || achRef.current.has(a.id))
    ) {
      grant("completionist");
    }
    if (!granted.length) return;
    setAchievements([...achRef.current]);
    setQueue((q) => [...q, ...granted]);
  }, []);

  const nextPopup = useCallback(() => setQueue((q) => q.slice(1)), []);

  /* ---------- restore persisted state ---------- */

  // localStorage does not exist during the server render, so seeding state
  // from it in an initialiser would break hydration. Restoring after mount
  // costs one extra render, which is intentional.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const c = (() => {
      try {
        return localStorage.getItem(KEY_CHAR);
      } catch {
        return null;
      }
    })();
    // Ignore ids from older builds or hand-edited storage — an unknown id
    // would request a sprite that doesn't exist.
    if (c && CHARACTERS.some((ch) => ch.id === c)) setChar(c);

    const storedCoins = (read<string[]>(KEY_COINS) ?? []).filter((id) =>
      COIN_IDS.includes(id),
    );
    coinsRef.current = new Set(storedCoins);
    setCoins(storedCoins);

    const storedAch = (read<string[]>(KEY_ACH) ?? []).filter(
      (id) => ACHIEVEMENT_BY_ID[id],
    );
    achRef.current = new Set(storedAch);
    setAchievements(storedAch);

    const storedVisited = read<string[]>(KEY_VISITED) ?? [];
    visitedRef.current = new Set(storedVisited);
    setVisited(storedVisited);

    const storedSettings = read<Partial<Settings>>(KEY_SETTINGS) ?? {};
    // Older builds kept the sound flag on its own key.
    let legacySound: boolean | undefined;
    try {
      legacySound = localStorage.getItem(KEY_SOUND) === "1" ? true : undefined;
    } catch {
      /* ignore */
    }
    const next: Settings = {
      ...DEFAULT_SETTINGS,
      ...storedSettings,
      sound: storedSettings.sound ?? legacySound ?? DEFAULT_SETTINGS.sound,
      music: false,
    };
    settingsRef.current = next;
    setSettings(next);
    setSoundEnabled(next.sound);

    readyRef.current = true;
    setReady(true);

    const queued = pending.current;
    pending.current = [];
    queued.forEach(unlock);
  }, [unlock]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /* ---------- persistence ---------- */

  useEffect(() => {
    if (ready) write(KEY_COINS, coins);
  }, [ready, coins]);
  useEffect(() => {
    if (ready) write(KEY_ACH, achievements);
  }, [ready, achievements]);
  useEffect(() => {
    if (ready) write(KEY_VISITED, visited);
  }, [ready, visited]);
  useEffect(() => {
    if (!ready) return;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { music: _m, ...persisted } = settings;
    write(KEY_SETTINGS, persisted);
  }, [ready, settings]);

  // Global switches CSS can react to without subscribing to React state.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.crt = settings.crt ? "on" : "off";
    root.dataset.cursor = settings.cursor ? "on" : "off";
  }, [settings.crt, settings.cursor]);

  /* ---------- toast ---------- */

  const pushToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3600);
  }, []);

  /* ---------- character ---------- */

  const setCharacterId = useCallback((id: string) => {
    setChar(id);
    try {
      localStorage.setItem(KEY_CHAR, id);
    } catch {
      /* ignore */
    }
  }, []);

  /* ---------- coins ---------- */

  const collect = useCallback(
    (id: string, origin?: { x: number; y: number }) => {
      if (!readyRef.current || coinsRef.current.has(id)) return;
      if (!COIN_IDS.includes(id)) {
        if (process.env.NODE_ENV !== "production") {
          console.warn(`[game-state] coin "${id}" is not registered in data/coins.ts`);
        }
        return;
      }
      coinsRef.current.add(id);
      setCoins([...coinsRef.current]);
      sfx.coin();
      fx.haptic(15);
      if (origin) fx.burst(origin.x, origin.y, "coin");
      unlock("first-coin");
      if (coinsRef.current.size >= TOTAL_COINS) unlock("collector");
    },
    [unlock],
  );

  /* ---------- visited sections ---------- */

  const markVisited = useCallback(
    (sectionId: string) => {
      if (visitedRef.current.has(sectionId)) return;
      visitedRef.current.add(sectionId);
      setVisited([...visitedRef.current]);
      if (SECTIONS.every((s) => visitedRef.current.has(s.id))) unlock("tourist");
    },
    [unlock],
  );

  /* ---------- settings ---------- */

  const setSetting = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]) => {
      const prev = settingsRef.current;
      if (prev[key] === value) return;
      const next = { ...prev, [key]: value };
      settingsRef.current = next;
      setSettings(next);

      if (key === "sound") {
        setSoundEnabled(Boolean(value));
        if (value) {
          sfx.select();
          unlock("sound-check");
        }
      }
      if (key === "music") {
        if (value) {
          music.start();
          unlock("sound-check");
        } else {
          music.stop();
        }
      }
    },
    [unlock],
  );

  const toggleSound = useCallback(
    () => setSetting("sound", !settingsRef.current.sound),
    [setSetting],
  );

  /* ---------- control + menu ---------- */

  const setControlling = useCallback(
    (v: boolean) => {
      setControllingState(v);
      if (v) unlock("hands-on");
    },
    [unlock],
  );

  const openMenu = useCallback((tab: MenuTab = "main") => setMenu(tab), []);
  const closeMenu = useCallback(() => setMenu(null), []);

  /* ---------- reset ---------- */

  const resetProgress = useCallback(() => {
    coinsRef.current = new Set();
    achRef.current = new Set();
    visitedRef.current = new Set();
    setCoins([]);
    setAchievements([]);
    setVisited([]);
    setQueue([]);
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith("glitch.arcade"))
        .forEach((k) => localStorage.removeItem(k));
      // Session keys too, so the boot screen, stage banners and walker hints
      // all replay like a first visit.
      ["glitch.booted", "glitch.stages", "glitch.quips"].forEach((k) =>
        sessionStorage.removeItem(k),
      );
    } catch {
      /* ignore */
    }
  }, []);

  /* ---------- derived ---------- */

  const hasAchievement = useCallback(
    (id: string) => achievements.includes(id),
    [achievements],
  );

  const score = useMemo(
    () =>
      achievements.reduce((n, id) => n + (ACHIEVEMENT_BY_ID[id]?.points ?? 0), 0) +
      coins.length * COIN_POINTS,
    [achievements, coins],
  );
  const { level, progress: levelProgress } = levelFor(score);
  const maxLevel = score >= MAX_SCORE;

  const popup = queue.length ? (ACHIEVEMENT_BY_ID[queue[0]] ?? null) : null;

  const value = useMemo<GameState>(
    () => ({
      ready,
      characterId,
      setCharacterId,
      coins,
      collect,
      coinCount: coins.length,
      totalCoins: TOTAL_COINS,
      achievements,
      unlock,
      hasAchievement,
      totalAchievements: TOTAL_ACHIEVEMENTS,
      popup,
      nextPopup,
      score,
      level,
      levelProgress,
      maxLevel,
      visited,
      markVisited,
      settings,
      setSetting,
      sound: settings.sound,
      toggleSound,
      controlling,
      setControlling,
      menu,
      openMenu,
      closeMenu,
      paused: menu !== null,
      devMode,
      setDevMode,
      toast,
      pushToast,
      resetProgress,
    }),
    [
      ready,
      characterId,
      setCharacterId,
      coins,
      collect,
      achievements,
      unlock,
      hasAchievement,
      popup,
      nextPopup,
      score,
      level,
      levelProgress,
      maxLevel,
      visited,
      markVisited,
      settings,
      setSetting,
      toggleSound,
      controlling,
      setControlling,
      menu,
      openMenu,
      closeMenu,
      devMode,
      toast,
      pushToast,
      resetProgress,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGame() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useGame must be used inside GameProvider");
  return v;
}
