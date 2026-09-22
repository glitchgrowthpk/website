"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { DEFAULT_CHARACTER } from "@/data/characters";
import { setSoundEnabled, sfx } from "@/lib/audio";

const TOTAL_COINS = 12;

interface GameState {
  characterId: string;
  setCharacterId: (id: string) => void;
  coins: string[];
  collect: (id: string) => void;
  coinCount: number;
  totalCoins: number;
  sound: boolean;
  toggleSound: () => void;
  controlling: boolean;
  setControlling: (v: boolean) => void;
  devMode: boolean;
  setDevMode: (v: boolean) => void;
  toast: string | null;
  pushToast: (msg: string) => void;
}

const Ctx = createContext<GameState | null>(null);

const KEY_CHAR = "glitch.character";
const KEY_COINS = "glitch.coins";
const KEY_SOUND = "glitch.sound";

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [characterId, setChar] = useState(DEFAULT_CHARACTER);
  const [coins, setCoins] = useState<string[]>([]);
  const [sound, setSound] = useState(false);
  const [controlling, setControlling] = useState(false);
  const [devMode, setDevMode] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Restore preferences after mount. This has to be an effect rather than a
  // lazy initialiser: localStorage does not exist during the server render, so
  // seeding state from it directly would break hydration. The single extra
  // render is intentional.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const c = localStorage.getItem(KEY_CHAR);
      if (c) setChar(c);
      const k = localStorage.getItem(KEY_COINS);
      if (k) setCoins(JSON.parse(k) as string[]);
      const s = localStorage.getItem(KEY_SOUND);
      if (s === "1") {
        setSound(true);
        setSoundEnabled(true);
      }
    } catch {
      /* no persisted state available */
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const pushToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3600);
  }, []);

  const setCharacterId = useCallback((id: string) => {
    setChar(id);
    try {
      localStorage.setItem(KEY_CHAR, id);
    } catch {
      /* ignore */
    }
  }, []);

  const collect = useCallback(
    (id: string) => {
      setCoins((prev) => {
        if (prev.includes(id)) return prev;
        const next = [...prev, id];
        try {
          localStorage.setItem(KEY_COINS, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        if (next.length >= TOTAL_COINS) {
          sfx.unlock();
          pushToast("ACHIEVEMENT — ALL 12 COINS COLLECTED");
        } else {
          sfx.coin();
        }
        return next;
      });
    },
    [pushToast],
  );

  const toggleSound = useCallback(() => {
    setSound((s) => {
      const next = !s;
      setSoundEnabled(next);
      try {
        localStorage.setItem(KEY_SOUND, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      if (next) sfx.select();
      return next;
    });
  }, []);

  const value = useMemo<GameState>(
    () => ({
      characterId,
      setCharacterId,
      coins,
      collect,
      coinCount: coins.length,
      totalCoins: TOTAL_COINS,
      sound,
      toggleSound,
      controlling,
      setControlling,
      devMode,
      setDevMode,
      toast,
      pushToast,
    }),
    [
      characterId,
      setCharacterId,
      coins,
      collect,
      sound,
      toggleSound,
      controlling,
      devMode,
      toast,
      pushToast,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGame() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useGame must be used inside GameProvider");
  return v;
}
