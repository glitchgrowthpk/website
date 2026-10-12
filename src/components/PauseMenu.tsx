"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useGame, type MenuTab, type Settings } from "@/lib/game-state";
import { ACHIEVEMENTS } from "@/data/achievements";
import { SECTIONS } from "@/data/studio";
import { ACCENT_HEX, byId, spriteSrc } from "@/data/characters";
import { sfx } from "@/lib/audio";
import { useIsTouch, useReducedMotion } from "@/lib/hooks";
import { AchievementBadge, trophyPill } from "./Achievements";

/* ------------------------------------------------------------------- data */

const TOTAL_POINTS = ACHIEVEMENTS.reduce((n, a) => n + a.points, 0);

const NAV = [
  { id: "resume", label: "Resume" },
  { id: "levels", label: "Level select" },
  { id: "achievements", label: "Achievements" },
  { id: "settings", label: "Settings" },
  { id: "controls", label: "Controls" },
] as const;

type NavId = (typeof NAV)[number]["id"];
type Screen = Exclude<MenuTab, "main">;

const SCREEN_TITLE: Record<Screen, string> = {
  levels: "Level select",
  achievements: "Achievements",
  settings: "Settings",
  controls: "Controls",
};

const SWITCHES: { key: keyof Settings; label: string; desc: string }[] = [
  { key: "sound", label: "Sound effects", desc: "Synthesised chiptune blips. Off until you say so." },
  { key: "music", label: "Soundtrack", desc: "A looping chiptune score. Never autoplays on your next visit." },
  { key: "crt", label: "CRT effect", desc: "Scanlines and a tube vignette over everything." },
  { key: "cursor", label: "Reticle cursor", desc: "Swap the pointer for a targeting reticle. Mouse and trackpad only." },
  { key: "shortcuts", label: "Keyboard shortcuts", desc: "G grabs control, P opens this menu. Turn off if they clash with your tools." },
];

/** `/` reads as "or", `+` as "then"; everything else is a key cap. */
const KEYBOARD_CONTROLS: { keys: string[]; action: string }[] = [
  { keys: ["G"], action: "Take control of your fighter" },
  { keys: ["←", "→", "/", "A", "D"], action: "Move" },
  { keys: ["↑", "/", "W", "/", "Space"], action: "Jump. Press again in the air to double jump" },
  { keys: ["↓", "/", "S"], action: "Drop through platforms" },
  { keys: ["Esc"], action: "Release control, close menus" },
  { keys: ["P"], action: "Open or close this menu" },
];

const TOUCH_CONTROLS: { keys: string[]; action: string }[] = [
  { keys: ["Take control"], action: "Tap the button under the headline to bring up the pad" },
  { keys: ["◀", "▶"], action: "Move" },
  { keys: ["▲", "/", "JUMP"], action: "Jump. Tap again in the air to double jump" },
  { keys: ["▼"], action: "Drop through platforms" },
  { keys: ["Release"], action: "Hand control back" },
  { keys: ["❚❚"], action: "Opens this menu, from the top bar" },
];

const ARCADE_CONTROLS: { keys: string[]; action: string }[] = [
  { keys: ["Drag", "/", "Tap"], action: "Swap a piece with its neighbour" },
  { keys: ["Arrows", "+", "Space"], action: "Move, pick a piece, then an arrow to swap" },
];

const KEY_NAMES: Record<string, string> = {
  "←": "Left arrow",
  "→": "Right arrow",
  "↑": "Up arrow",
  "↓": "Down arrow",
  "◀": "Left",
  "▶": "Right",
  "▲": "Up",
  "▼": "Down",
  "❚❚": "Pause button",
  "⌫": "Backspace",
};

/* ---------------------------------------------------------------- helpers */

const isTypingTarget = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
};

/**
 * True while the first-visit boot overlay is still up. html[data-booted] is
 * set before paint on repeat visits and by BootScreen when it finishes;
 * otherwise look for the overlay itself (the only thing on the z-80 layer).
 */
function bootVisible() {
  if (document.documentElement.hasAttribute("data-booted")) return false;
  const boot = document.querySelector(".bootscreen, [data-boot-screen], .z-\\[80\\]");
  return !!boot && boot.getClientRects().length > 0;
}

/** The section whose top has passed ~a third of the way down the viewport. */
function currentSection(): string {
  const probe = window.innerHeight * 0.35;
  let here: string = SECTIONS[0].id;
  for (const s of SECTIONS) {
    const el = document.getElementById(s.id);
    if (el && el.getBoundingClientRect().top <= probe) here = s.id;
  }
  return here;
}

/** The current screen's selectable items, in reading order. */
function menuItems(dlg: HTMLElement, tab: MenuTab): HTMLElement[] {
  // The main screen spans both columns (menu + level list); sub-screens rove
  // only inside their own content.
  const scope =
    tab === "main" ? dlg : (dlg.querySelector<HTMLElement>("[data-pm-screen]") ?? dlg);
  return [...scope.querySelectorAll<HTMLElement>("[data-pm-item]")].filter(
    (el) => el.getClientRects().length > 0,
  );
}

/** Moves the ▶ selector. A plain attribute, so hovering never re-renders. */
function markSelected(dlg: HTMLElement, el: Element | null) {
  dlg.querySelectorAll("[data-pm-sel]").forEach((n) => {
    if (n !== el) n.removeAttribute("data-pm-sel");
  });
  el?.setAttribute("data-pm-sel", "");
}

/** Restart a one-shot CSS animation class. */
function replay(el: Element | null, cls: string) {
  if (!(el instanceof HTMLElement)) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

/** Scroll to a section, update the hash and move keyboard focus there too. */
function travel(id: string, reduced: boolean) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: reduced ? "instant" : "smooth", block: "start" });
  const hash = `#${id}`;
  if (window.location.hash !== hash) {
    window.history.pushState(window.history.state, "", hash);
  }
  // Like an in-page link: the next Tab continues from the new level.
  const heading = el.querySelector<HTMLElement>("h1, h2") ?? el;
  if (!heading.hasAttribute("tabindex")) {
    heading.setAttribute("tabindex", "-1");
    heading.addEventListener("blur", () => heading.removeAttribute("tabindex"), {
      once: true,
    });
  }
  heading.focus({ preventScroll: true });
}

/* ------------------------------------------------------------------- menu */

/**
 * The pause menu: a native modal <dialog> that mirrors `useGame().menu`.
 * Opening it pauses every game loop (the provider derives `paused` from the
 * same state). It is also the site's navigation on small screens.
 */
export default function PauseMenu() {
  const { menu, openMenu, closeMenu, settings, controlling, setControlling } = useGame();
  const reduced = useReducedMotion();
  const open = menu !== null;
  const titleId = useId();

  const dialogRef = useRef<HTMLDialogElement>(null);
  /** Who had focus before the menu opened; it gets it back on close. */
  const opener = useRef<HTMLElement | null>(null);
  /** A level picked in the menu — travelled to once the dialog has closed. */
  const warpTo = useRef<string | null>(null);
  const closeTimer = useRef(0);
  const shownTab = useRef<MenuTab | null>(null);

  // Per-visit bookkeeping, adjusted during render (React's pattern for state
  // that follows a value): every open gets a fresh body (new "you are here",
  // no half-finished reset confirm), and the last screen stays rendered while
  // the dialog animates out.
  const [visit, setVisit] = useState<{ open: boolean; n: number; tab: MenuTab }>({
    open: false,
    n: 0,
    tab: "main",
  });
  if (open !== visit.open || (menu !== null && menu !== visit.tab)) {
    setVisit({
      open,
      n: open && !visit.open ? visit.n + 1 : visit.n,
      tab: menu ?? visit.tab,
    });
  }
  const tab = menu ?? visit.tab;

  /* ---------- state -> <dialog> ---------- */

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    window.clearTimeout(closeTimer.current);

    if (open) {
      delete dlg.dataset.closing;
      // Reopened mid fold-away: a level picked on the way out is cancelled.
      warpTo.current = null;
      if (!dlg.open) {
        const active = document.activeElement;
        opener.current =
          active instanceof HTMLElement && active !== document.body ? active : null;
        dlg.showModal();
      }
      return;
    }
    if (!dlg.open) return;
    if (reduced) {
      dlg.close();
      return;
    }
    // Let the panel fold away before the top layer lets go.
    dlg.dataset.closing = "";
    closeTimer.current = window.setTimeout(() => dlg.close(), 170);
  }, [open, reduced]);

  /* ---------- focus: first item on open, sensible item per screen ---------- */

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!open || !dlg) {
      shownTab.current = null;
      return;
    }
    const from = shownTab.current;
    shownTab.current = tab;
    if (from === tab) return;

    let target: HTMLElement | null = null;
    // Backing out of a screen lands on the item that opened it.
    if (tab === "main" && from) target = dlg.querySelector(`[data-pm-goto="${from}"]`);
    if (!target && tab === "levels") {
      target = dlg.querySelector('[data-pm-screen] [aria-current="location"]');
    }
    target ??= menuItems(dlg, tab)[0] ?? null;
    if (target) {
      target.focus();
      markSelected(dlg, target);
    }
  }, [open, tab]);

  /* ---------- <dialog> -> state (Esc, backdrop, native close) ---------- */

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;

    // Esc: run the animated close through state instead of snapping shut.
    const onCancel = (e: Event) => {
      e.preventDefault();
      closeMenu();
    };
    const onClose = () => {
      // The event is queued; if the menu was reopened in the meantime, it is
      // stale and must not shut the new visit.
      if (dlg.open) return;
      delete dlg.dataset.closing;
      markSelected(dlg, null);
      sfx.menuClose();
      closeMenu();

      const warp = warpTo.current;
      const back = opener.current;
      warpTo.current = null;
      opener.current = null;
      if (warp) {
        travel(warp, reduced);
      } else if (back?.isConnected) {
        back.focus({ preventScroll: true });
      } else if (back) {
        // The opener is gone (an achievement popup); the trophy pill is its home.
        trophyPill()?.focus({ preventScroll: true });
      }
    };

    // A click on the dimmed backdrop targets the <dialog> itself.
    let downOnBackdrop = false;
    const onDown = (e: PointerEvent) => {
      downOnBackdrop = e.target === dlg;
    };
    const onClick = (e: MouseEvent) => {
      if (downOnBackdrop && e.target === dlg) closeMenu();
      downOnBackdrop = false;
    };

    dlg.addEventListener("cancel", onCancel);
    dlg.addEventListener("close", onClose);
    dlg.addEventListener("pointerdown", onDown);
    dlg.addEventListener("click", onClick);
    return () => {
      dlg.removeEventListener("cancel", onCancel);
      dlg.removeEventListener("close", onClose);
      dlg.removeEventListener("pointerdown", onDown);
      dlg.removeEventListener("click", onClick);
    };
  }, [closeMenu, reduced]);

  /* ---------- keyboard ---------- */

  useEffect(() => {
    if (open) {
      const dlg = dialogRef.current;
      // Capture phase on window: the menu sees keys first, and nothing behind
      // the modal (platformer, page shortcuts) reacts while it is up.
      // Default actions still run — Tab, Enter/Space on buttons, Esc → cancel.
      const onKey = (e: KeyboardEvent) => {
        e.stopPropagation();
        if (!dlg || e.ctrlKey || e.metaKey || e.altKey) return;
        const k = e.key;

        // A mouse can park the ▶ on an item without moving focus. While focus
        // sits in the item list (not on Back, Close…), Enter/Space act on what
        // the ▶ shows, so the selector never lies about what will happen.
        if (k === "Enter" || k === " ") {
          const sel = dlg.querySelector<HTMLElement>("[data-pm-sel]");
          const act = document.activeElement;
          const inList =
            !act || act === document.body || act === dlg || !!act.closest("[data-pm-item]");
          if (!sel || sel === act || !inList) return;
          e.preventDefault();
          sel.focus();
          if (sel instanceof HTMLButtonElement) sel.click();
          return;
        }

        if (k === "ArrowDown" || k === "ArrowUp" || k === "Home" || k === "End") {
          e.preventDefault();
          const list = menuItems(dlg, tab);
          if (!list.length) return;
          // Step from the ▶ (where the eye is), else from focus.
          let cur = list.findIndex((el) => el.hasAttribute("data-pm-sel"));
          if (cur < 0) cur = list.indexOf(document.activeElement as HTMLElement);
          const step = k === "ArrowDown" ? 1 : -1;
          const i =
            k === "Home"
              ? 0
              : k === "End"
                ? list.length - 1
                : cur < 0
                  ? step > 0
                    ? 0
                    : list.length - 1
                  : (cur + step + list.length) % list.length;
          list[i].focus();
          markSelected(dlg, list[i]);
          sfx.menuMove();
          return;
        }
        if ((k === "ArrowLeft" || k === "Backspace") && tab !== "main") {
          e.preventDefault();
          sfx.back();
          openMenu("main");
          return;
        }
        if ((k === "p" || k === "P") && settings.shortcuts && !e.repeat) {
          e.preventDefault();
          closeMenu();
        }
      };
      window.addEventListener("keydown", onKey, true);
      return () => window.removeEventListener("keydown", onKey, true);
    }

    // Closed: P opens it from anywhere.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "p" && e.key !== "P") return;
      if (e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!settings.shortcuts || isTypingTarget(e.target) || bootVisible()) return;
      e.preventDefault();
      sfx.menuOpen();
      openMenu("main");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, tab, settings.shortcuts, openMenu, closeMenu]);

  /* ---------- actions ---------- */

  const go = (t: MenuTab) => {
    sfx.select();
    openMenu(t);
  };
  const back = () => {
    sfx.back();
    openMenu("main");
  };
  const warp = (id: string) => {
    sfx.select();
    warpTo.current = id;
    // Under control the camera follows the fighter and would drag the page
    // straight back; hand control back so the trip sticks.
    if (controlling) setControlling(false);
    closeMenu();
  };

  // The ▶ follows keyboard focus. A mouse only moves the ▶: focus (and with
  // it screen magnifiers and scroll position) stays where the keyboard left it.
  // Focus landing on a control outside the item list (Back, Close) clears it.
  const onFocus = (e: React.FocusEvent) => {
    if (!dialogRef.current) return;
    markSelected(dialogRef.current, (e.target as Element).closest("[data-pm-item]"));
  };
  // pointermove, not pointerover: Chrome fires boundary events when the menu
  // opens (or a screen slides in) under a resting mouse, which would yank the
  // ▶ off the item the keyboard just chose. Only a mouse that moves claims it.
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || !dialogRef.current) return;
    if (!e.movementX && !e.movementY) return;
    const item = (e.target as Element).closest<HTMLElement>("[data-pm-item]");
    if (!item || item.hasAttribute("data-pm-sel")) return;
    markSelected(dialogRef.current, item);
    sfx.hover();
  };

  return (
    <>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className="pm-dialog"
        onFocus={onFocus}
        onPointerMove={onPointerMove}
      >
        <MenuBody
          key={visit.n}
          open={open}
          tab={tab}
          titleId={titleId}
          go={go}
          back={back}
          warp={warp}
          resume={closeMenu}
        />
      </dialog>
      <style>{CSS}</style>
    </>
  );
}

/* ------------------------------------------------------------------- body */

function MenuBody({
  open,
  tab,
  titleId,
  go,
  back,
  warp,
  resume,
}: {
  open: boolean;
  tab: MenuTab;
  titleId: string;
  go: (t: MenuTab) => void;
  back: () => void;
  warp: (id: string) => void;
  resume: () => void;
}) {
  const g = useGame();
  const touch = useIsTouch();
  // Read once per visit: this body remounts every time the menu opens.
  const [here] = useState(() => (open ? currentSection() : SECTIONS[0].id));

  const fighter = byId(g.characterId);
  const seen = SECTIONS.filter((s) => g.visited.includes(s.id)).length;

  const hint: Record<NavId, string> = {
    resume: touch ? "" : "Esc",
    levels: `${seen}/${SECTIONS.length}`,
    achievements: `${g.achievements.length}/${g.totalAchievements}`,
    settings: "",
    controls: "",
  };

  return (
    <div className="pm-panel panel scanlines relative flex min-h-full flex-col">
      <Corners />

      {/* ---------- title + fighter ---------- */}
      <div className="relative flex items-end gap-4 border-b border-edge/80 px-5 pb-4 pr-16 pt-5 md:px-8 md:pr-20 md:pt-6">
        <div aria-hidden="true" className="grid-floor pointer-events-none absolute inset-0 opacity-30 [mask-image:linear-gradient(to_top,#000,transparent_85%)]" />
        <div className="relative min-w-0 flex-1">
          <p className="label flex items-center gap-2">
            <span className="pm-blink inline-block h-2 w-2 rounded-[1px] bg-magenta" />
            Game paused
          </p>
          {/* The glitch layers repeat the word in generated content, which
              would otherwise name the dialog "PAUSED PAUSED PAUSED". */}
          <h2
            id={titleId}
            className="mt-1 font-display text-[clamp(3.3rem,10vw,6.4rem)] leading-[0.82] [@media(min-width:768px)_and_(max-height:720px)]:text-[4.2rem]"
          >
            <span aria-hidden="true" className="pm-title glitch" data-text="PAUSED">
              PAUSED
            </span>
            <span className="sr-only">Paused</span>
          </h2>
        </div>

        <figure className="relative -mb-4 flex shrink-0 items-end gap-3">
          <span
            aria-hidden="true"
            className="absolute bottom-1 left-1/2 h-24 w-28 -translate-x-1/2 rounded-full opacity-40 blur-2xl md:left-[60px]"
            style={{ background: ACCENT_HEX[fighter.accent] }}
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={spriteSrc(fighter.id)}
            alt=""
            width={fighter.w}
            height={fighter.h}
            loading="lazy"
            decoding="async"
            className="sprite bob-slow relative h-[84px] w-auto max-w-[96px] object-contain object-bottom md:h-[140px] md:max-w-[150px] [@media(min-width:768px)_and_(max-height:720px)]:h-[100px]"
          />
          <figcaption className="relative hidden pb-4 sm:block">
            <span className="mono block text-[10px] uppercase tracking-[0.2em] text-muted">
              P1 · {fighter.role}
            </span>
            <span className="block font-display text-xl leading-tight">{fighter.name}</span>
            <button
              type="button"
              onClick={() => warp("roster")}
              className="mono mt-1.5 inline-flex min-h-[28px] items-center text-[10px] uppercase tracking-[0.16em] text-cyan hover:underline"
            >
              Change fighter →
            </button>
          </figcaption>
        </figure>

        <button
          type="button"
          onClick={resume}
          aria-label="Resume"
          aria-keyshortcuts="Escape"
          className="mono absolute right-3 top-3 z-10 flex h-10 items-center gap-1.5 rounded-md border border-edge bg-panel/80 px-2.5 text-[10px] uppercase tracking-[0.16em] text-muted transition-colors hover:border-magenta hover:text-ink md:right-4 md:top-4"
        >
          {!touch && <span aria-hidden="true">Esc</span>}
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* ---------- status strip ---------- */}
      <StatusStrip seen={seen} />

      {/* ---------- menu + screen ---------- */}
      <div className="grid flex-1 md:min-h-0 md:grid-cols-[236px_minmax(0,1fr)]">
        <nav
          aria-label="Pause menu"
          className={`border-edge/80 px-4 pb-2 pt-4 md:flex md:min-h-0 md:flex-col md:overflow-y-auto md:overscroll-contain md:border-r md:p-5 ${
            tab === "main" ? "" : "max-md:hidden"
          }`}
        >
          <ul className="space-y-1">
            {NAV.map((n, i) => {
              const current = tab === n.id;
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    data-pm-item=""
                    data-pm-goto={n.id}
                    aria-current={current ? "page" : undefined}
                    aria-keyshortcuts={n.id === "resume" ? "Escape" : undefined}
                    onClick={() => {
                      if (n.id === "resume") resume();
                      else if (!current) go(n.id);
                    }}
                    className="pm-item pm-nav flex min-h-[46px] w-full items-center gap-2 rounded-lg px-3 text-left"
                    style={{ ["--i" as string]: i }}
                  >
                    <span aria-hidden="true" className="pm-caret">▶</span>
                    <span className="font-display text-[19px] uppercase tracking-wide">{n.label}</span>
                    {hint[n.id] && (
                      <span
                        aria-hidden={n.id === "resume" ? true : undefined}
                        className="mono ml-auto text-[10px] uppercase tracking-[0.14em] tabular-nums text-muted"
                      >
                        {hint[n.id]}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          {!touch && (
            <dl className="mono mt-auto hidden grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 pt-6 text-[10px] uppercase tracking-[0.14em] text-muted md:grid [@media(max-height:740px)]:hidden!">
              <dt className="flex gap-1">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
              </dt>
              <dd>Select</dd>
              <dt>
                <Kbd>Enter</Kbd>
              </dt>
              <dd>Pick</dd>
              <dt>
                <Kbd>⌫</Kbd>
              </dt>
              <dd>Back</dd>
              <dt>
                <Kbd>Esc</Kbd>
              </dt>
              <dd>Resume</dd>
            </dl>
          )}
        </nav>

        <div className="px-4 pb-8 pt-3 md:min-h-0 md:overflow-y-auto md:overscroll-contain md:p-6">
          <div
            key={tab}
            data-pm-screen={tab}
            className={`pm-screen ${tab === "main" ? "pm-from-left" : "pm-from-right"}`}
          >
            {tab === "main" ? (
              <>
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h3 className="label">Level select</h3>
                  <span className="mono text-[10px] uppercase tracking-[0.14em] text-muted">
                    Jump to any part of the page
                  </span>
                </div>
                <LevelList here={here} visited={g.visited} compact warp={warp} />
              </>
            ) : (
              <>
                {/* sticky on phones, where the dialog itself is the scroller */}
                <div className="mb-5 flex items-center gap-3 max-md:sticky max-md:top-0 max-md:z-20 max-md:-mx-4 max-md:border-b max-md:border-edge/60 max-md:bg-abyss/95 max-md:px-4 max-md:py-3 max-md:backdrop-blur">
                  <h3 className="font-display text-[clamp(1.9rem,4vw,2.5rem)] uppercase leading-none">
                    {SCREEN_TITLE[tab]}
                  </h3>
                  <button
                    type="button"
                    onClick={back}
                    aria-keyshortcuts="Backspace"
                    className="mono ml-auto flex h-10 items-center gap-2 rounded-md border border-edge bg-panel-2/60 px-3 text-[10px] uppercase tracking-[0.16em] text-muted transition-colors hover:border-cyan hover:text-ink"
                  >
                    <span aria-hidden="true">◀</span> Back
                  </button>
                </div>
                {tab === "levels" && (
                  <LevelList here={here} visited={g.visited} warp={warp} />
                )}
                {tab === "achievements" && <AchievementsScreen />}
                {tab === "settings" && <SettingsScreen />}
                {tab === "controls" && <ControlsScreen />}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- status */

function StatusStrip({ seen }: { seen: number }) {
  const { level, levelProgress, maxLevel, score, coinCount, totalCoins, achievements, totalAchievements } =
    useGame();
  const fill = maxLevel ? 1 : levelProgress;

  return (
    <ul className="grid grid-cols-3 gap-2 border-b border-edge/80 bg-void/40 px-4 py-3 md:grid-cols-[1.8fr_1fr_1fr_1fr] md:px-8">
      <li
        className="pm-stat col-span-3 flex items-center gap-3 rounded-lg border border-lime/30 bg-lime/[0.04] px-3 py-2 md:col-span-1"
        style={{ ["--i" as string]: 0 }}
      >
        <span className="font-display text-[26px] leading-none text-lime">
          {maxLevel ? "MAX" : `LV ${level}`}
        </span>
        <span className="min-w-0 flex-1">
          <span className="mono flex justify-between gap-2 text-[10px] uppercase tracking-[0.14em] text-muted">
            <span>
              <span className="text-ink tabular-nums">{score}</span> XP
            </span>
            <span>{maxLevel ? "Maxed out" : `Next LV ${level + 1}`}</span>
          </span>
          <span
            role="progressbar"
            aria-label={maxLevel ? "Level progress: max level" : `Progress to level ${level + 1}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(fill * 100)}
            className="mt-1.5 block h-2 overflow-hidden rounded-full bg-panel-2"
          >
            <span
              className="pm-fill block h-full origin-left rounded-full bg-gradient-to-r from-lime to-cyan"
              style={{ transform: `scaleX(${fill})` }}
            />
          </span>
        </span>
      </li>
      <Stat i={1} value={`${coinCount}/${totalCoins}`} label="Coins">
        <span className="inline-block h-3 w-3 rounded-full bg-gradient-to-br from-amber to-magenta" />
      </Stat>
      <Stat i={2} value={`${achievements.length}/${totalAchievements}`} label="Achievements">
        <svg width="12" height="12" viewBox="0 0 24 24" className="text-amber">
          <path
            d="M7 3h10v3h3v3a5 5 0 0 1-4.6 5A5 5 0 0 1 13 16.9V19h3v2H8v-2h3v-2.1A5 5 0 0 1 8.6 14 5 5 0 0 1 4 9V6h3V3zm0 5H6v1a3 3 0 0 0 1.2 2.4C7.1 10.6 7 9.8 7 9V8zm10 0v1c0 .8-.1 1.6-.2 2.4A3 3 0 0 0 18 9V8h-1z"
            fill="currentColor"
          />
        </svg>
      </Stat>
      <Stat i={3} value={`${seen}/${SECTIONS.length}`} label="Visited">
        <svg width="12" height="12" viewBox="0 0 24 24" className="text-cyan">
          <path d="M5 21V4h11l-1.5 4L16 12H7v9H5z" fill="currentColor" />
        </svg>
      </Stat>
    </ul>
  );
}

function Stat({
  i,
  value,
  label,
  children,
}: {
  i: number;
  value: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <li
      className="pm-stat flex min-w-0 flex-col justify-center rounded-lg border border-edge bg-panel-2/50 px-2.5 py-2"
      style={{ ["--i" as string]: i }}
    >
      <span className="flex items-center gap-1.5 font-display text-xl leading-none tabular-nums">
        <span aria-hidden="true" className="grid place-items-center">
          {children}
        </span>
        {value}
      </span>
      <span className="mono mt-1 truncate text-[9.5px] uppercase tracking-[0.12em] text-muted">
        {label}
      </span>
    </li>
  );
}

/* ----------------------------------------------------------------- levels */

function LevelList({
  here,
  visited,
  compact = false,
  warp,
}: {
  here: string;
  visited: string[];
  compact?: boolean;
  warp: (id: string) => void;
}) {
  return (
    <ol className={compact ? "space-y-1.5" : "space-y-2"}>
      {SECTIONS.map((s, i) => {
        const isHere = s.id === here;
        const seen = visited.includes(s.id);
        return (
          <li key={s.id}>
            <button
              type="button"
              data-pm-item=""
              data-cursor="WARP"
              aria-current={isHere ? "location" : undefined}
              onClick={() => warp(s.id)}
              className={`pm-item pm-level flex w-full items-center gap-3 rounded-lg border px-3 text-left ${
                compact ? "min-h-[44px] py-1.5" : "min-h-[64px] py-3"
              } ${isHere ? "border-cyan/50 bg-cyan/[0.06]" : "border-edge bg-panel-2/50"}`}
            >
              <span aria-hidden="true" className="pm-caret">▶</span>
              <span className="mono text-[11px] tabular-nums text-muted">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span
                className={`font-display uppercase leading-none tracking-wide ${
                  compact ? "text-[20px]" : "text-[clamp(1.6rem,3.4vw,2.2rem)]"
                }`}
              >
                {s.label}
              </span>
              <span className="ml-auto flex shrink-0 items-center gap-2.5">
                {isHere && (
                  <span className="mono flex items-center gap-1.5 rounded bg-cyan px-1.5 py-1 text-[9px] font-bold uppercase leading-none tracking-[0.14em] text-void">
                    <span className="sr-only">, </span>
                    <span aria-hidden="true" className="pm-blink inline-block h-1.5 w-1.5 rounded-full bg-void" />
                    You are here
                  </span>
                )}
                <span
                  className={`grid h-6 w-6 place-items-center rounded-full border ${
                    seen ? "border-lime bg-lime/15 text-lime" : "border-edge text-transparent"
                  }`}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 12.5l4.2 4.2L19 7" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="sr-only">{seen ? ", visited" : ", not visited yet"}</span>
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/* ----------------------------------------------------------- achievements */

function AchievementsScreen() {
  const { achievements } = useGame();
  const got = new Set(achievements);
  const points = ACHIEVEMENTS.reduce((n, a) => n + (got.has(a.id) ? a.points : 0), 0);
  const latest = achievements[achievements.length - 1];

  return (
    <>
      <div className="mb-4 rounded-xl border border-edge bg-panel-2/40 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="flex items-baseline gap-2">
            <span className="font-display text-[34px] leading-none text-lime tabular-nums">
              {got.size}
            </span>
            <span className="font-display text-xl leading-none text-muted">/{ACHIEVEMENTS.length}</span>
            <span className="mono text-[10px] uppercase tracking-[0.18em] text-muted">unlocked</span>
          </p>
          <p className="mono text-[11px] uppercase tracking-[0.14em] text-muted">
            <span className="text-ink tabular-nums">{points}</span>/{TOTAL_POINTS} XP earned
          </p>
        </div>
        <span
          role="progressbar"
          aria-label="Achievements unlocked"
          aria-valuemin={0}
          aria-valuemax={ACHIEVEMENTS.length}
          aria-valuenow={got.size}
          className="mt-3 block h-2.5 overflow-hidden rounded-full bg-void"
        >
          <span
            className="pm-fill block h-full origin-left rounded-full bg-gradient-to-r from-lime via-cyan to-violet"
            style={{ transform: `scaleX(${got.size / ACHIEVEMENTS.length})` }}
          />
        </span>
      </div>

      <ul className="grid gap-2 sm:grid-cols-2">
        {ACHIEVEMENTS.map((a, i) => {
          const on = got.has(a.id);
          const secret = !on && a.secret;
          return (
            <li
              key={a.id}
              tabIndex={-1}
              data-pm-item=""
              className={`pm-item pm-card relative flex items-start gap-3 rounded-xl border p-3 ${
                on ? "border-lime/30 bg-lime/[0.035]" : "border-edge bg-panel-2/40"
              }`}
              style={{ ["--i" as string]: i }}
            >
              <AchievementBadge icon={a.icon} unlocked={on} size={52} lazy className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2">
                  <span className={`font-display text-[18px] leading-tight ${on ? "text-ink" : "text-ink/75"}`}>
                    {secret ? (
                      <>
                        <span aria-hidden="true">???</span>
                        <span className="sr-only">Secret achievement</span>
                      </>
                    ) : (
                      a.title
                    )}
                  </span>
                  {on && a.id === latest && (
                    <span className="mono rounded bg-lime px-1 py-0.5 text-[8.5px] font-bold uppercase leading-none tracking-[0.14em] text-void">
                      Latest
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-[13px] leading-snug text-muted">{on ? a.desc : a.hint}</p>
                <p className="mono mt-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em]">
                  {on ? (
                    <span className="flex items-center gap-1.5 text-lime">
                      <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M5 12.5l4.2 4.2L19 7" stroke="currentColor" strokeWidth="3.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Unlocked · +{a.points} XP
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-muted">
                      <svg width="10" height="10" viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M7 10V7a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h1zm2 0h6V7a3 3 0 0 0-6 0v3z"
                          fill="currentColor"
                        />
                      </svg>
                      Locked · {a.points} XP
                    </span>
                  )}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/* --------------------------------------------------------------- settings */

function SettingsScreen() {
  const { settings, setSetting, resetProgress } = useGame();
  const [confirming, setConfirming] = useState(false);
  const [wiped, setWiped] = useState(false);
  const resetBtn = useRef<HTMLButtonElement>(null);
  const cancelBtn = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(confirming);
  const confirmId = useId();

  // Keep focus on the step the visitor is looking at. Compared against the
  // previous value (not a first-run flag) so a dev double-mount stays put.
  useEffect(() => {
    if (wasConfirming.current === confirming) return;
    wasConfirming.current = confirming;
    (confirming ? cancelBtn : resetBtn).current?.focus();
  }, [confirming]);

  useEffect(() => {
    if (!wiped) return;
    const t = window.setTimeout(() => setWiped(false), 4000);
    return () => window.clearTimeout(t);
  }, [wiped]);

  const toggle = (key: keyof Settings, btn: HTMLElement) => {
    const next = !settings[key];
    // Turning sound on plays its own confirmation; turning it off has to beep
    // before the switch goes quiet.
    if (key !== "sound" || settings.sound) sfx.select();
    setSetting(key, next);
    replay(btn.querySelector(".pm-knob"), "pm-squash");
    if (next) replay(btn.querySelector(".pm-sparks"), "pm-go");
  };

  return (
    <>
      <ul className="space-y-2">
        {SWITCHES.map((s, i) => (
          <SwitchRow
            key={s.key}
            i={i}
            label={s.label}
            desc={s.desc}
            on={settings[s.key]}
            onToggle={(btn) => toggle(s.key, btn)}
          />
        ))}
      </ul>

      <div className="mt-5 rounded-xl border border-magenta/30 bg-magenta/[0.04] p-4">
        {!confirming ? (
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-[180px] flex-1">
              <p className="font-display text-lg uppercase leading-tight">Reset progress</p>
              <p className="mt-0.5 text-[13px] text-muted">
                Start a fresh save file. Your settings and fighter stay put.
              </p>
            </div>
            <button
              ref={resetBtn}
              type="button"
              data-pm-item=""
              onClick={() => {
                sfx.select();
                setWiped(false);
                setConfirming(true);
              }}
              className="pm-item pm-btn mono min-h-[42px] rounded-md border border-magenta/60 px-4 text-[11px] uppercase tracking-[0.16em] text-magenta transition-colors hover:bg-magenta/10"
            >
              <span aria-hidden="true" className="pm-caret">▶</span>
              Reset progress
            </button>
          </div>
        ) : (
          <div role="group" aria-labelledby={confirmId}>
            <p id={confirmId} className="text-[15px] font-medium text-ink">
              This wipes coins, achievements and arcade records.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                data-pm-item=""
                onClick={() => {
                  resetProgress();
                  sfx.defeat();
                  setConfirming(false);
                  setWiped(true);
                }}
                className="pm-item pm-btn mono min-h-[42px] rounded-md bg-magenta px-4 text-[11px] font-bold uppercase tracking-[0.16em] text-void transition-[filter] hover:brightness-110"
              >
                <span aria-hidden="true" className="pm-caret">▶</span>
                Yes, reset
              </button>
              <button
                ref={cancelBtn}
                type="button"
                data-pm-item=""
                onClick={() => {
                  sfx.back();
                  setConfirming(false);
                }}
                className="pm-item pm-btn mono min-h-[42px] rounded-md border border-edge bg-panel-2/60 px-4 text-[11px] uppercase tracking-[0.16em] text-ink transition-colors hover:border-cyan"
              >
                <span aria-hidden="true" className="pm-caret">▶</span>
                Cancel
              </button>
            </div>
          </div>
        )}
        <p role="status" aria-live="polite" className="mono text-[11px] uppercase tracking-[0.16em] text-lime empty:hidden [&:not(:empty)]:mt-3">
          {wiped ? "Progress wiped. Fresh save file loaded." : ""}
        </p>
      </div>
    </>
  );
}

function SwitchRow({
  i,
  label,
  desc,
  on,
  onToggle,
}: {
  i: number;
  label: string;
  desc: string;
  on: boolean;
  onToggle: (btn: HTMLElement) => void;
}) {
  const id = useId();
  return (
    <li>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={`${id}-l`}
        aria-describedby={`${id}-d`}
        data-pm-item=""
        onClick={(e) => onToggle(e.currentTarget)}
        className="pm-item pm-switch pm-card flex w-full items-center gap-3 rounded-xl border border-edge bg-panel-2/40 px-3.5 py-3 text-left"
        style={{ ["--i" as string]: i }}
      >
        <span aria-hidden="true" className="pm-caret">▶</span>
        <span className="min-w-0 flex-1">
          <span id={`${id}-l`} className="block font-display text-[19px] uppercase leading-tight tracking-wide">
            {label}
          </span>
          <span id={`${id}-d`} className="mt-0.5 block text-[13px] leading-snug text-muted">
            {desc}
          </span>
        </span>
        <span aria-hidden="true" className={`mono w-7 text-right text-[10px] font-bold tracking-[0.14em] ${on ? "text-lime" : "text-muted"}`}>
          {on ? "ON" : "OFF"}
        </span>
        <span aria-hidden="true" className="pm-track">
          <span className="pm-knob" />
          <span className="pm-sparks">
            {Array.from({ length: 6 }).map((_, n) => (
              <span key={n} style={{ ["--a" as string]: `${n * 60 + 30}deg` }} />
            ))}
          </span>
        </span>
      </button>
    </li>
  );
}

/* --------------------------------------------------------------- controls */

function ControlsScreen() {
  const { settings } = useGame();
  const touch = useIsTouch();
  const reduced = useReducedMotion();
  const rows = touch ? TOUCH_CONTROLS : KEYBOARD_CONTROLS;

  return (
    <>
      {reduced && (
        <p className="mb-3 rounded-lg border border-amber/40 bg-amber/[0.06] px-3 py-2 text-[13px] text-ink/90">
          Reduced motion is on, so your fighter stays parked. The arcade still plays.
        </p>
      )}
      {!touch && !settings.shortcuts && (
        <p className="mb-3 rounded-lg border border-amber/40 bg-amber/[0.06] px-3 py-2 text-[13px] text-ink/90">
          Single-key shortcuts (G, P) are off. Switch them back on in Settings.
        </p>
      )}

      <h4 className="label mb-2">{touch ? "Your fighter · touch" : "Your fighter · keyboard"}</h4>
      <ControlRows rows={rows} from={0} />

      <h4 className="label mb-2 mt-5">Arcade</h4>
      <ControlRows rows={ARCADE_CONTROLS} from={rows.length} />

      <p className="mono mt-6 flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-violet">
        <span aria-hidden="true">✦</span>
        Some cheat codes never die. One of them still works here.
      </p>
    </>
  );
}

function ControlRows({ rows, from }: { rows: { keys: string[]; action: string }[]; from: number }) {
  return (
    <ul className="space-y-1.5">
      {rows.map((r, i) => (
        <li
          key={r.action}
          tabIndex={-1}
          data-pm-item=""
          className="pm-item pm-card flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-edge bg-panel-2/40 px-3 py-2.5"
          style={{ ["--i" as string]: from + i }}
        >
          <span className="flex min-w-[104px] flex-wrap items-center gap-1 sm:min-w-[148px]">
            {r.keys.map((k, n) =>
              k === "/" || k === "+" ? (
                <span key={n} className="mono px-0.5 text-[11px] text-muted">
                  <span aria-hidden="true">{k}</span>
                  <span className="sr-only">{k === "/" ? " or " : " then "}</span>
                </span>
              ) : (
                <Kbd key={n}>{k}</Kbd>
              ),
            )}
          </span>
          <span className="min-w-0 flex-1 text-[14px] text-ink/90">{r.action}</span>
        </li>
      ))}
    </ul>
  );
}

function Kbd({ children }: { children: string }) {
  const name = KEY_NAMES[children];
  return (
    <kbd className="mono inline-grid h-7 min-w-[28px] place-items-center rounded-md border border-b-[3px] border-edge bg-panel-2 px-1.5 text-[11px] font-semibold normal-case tracking-normal text-ink">
      {name ? (
        <>
          <span aria-hidden="true">{children}</span>
          <span className="sr-only">{name}</span>
        </>
      ) : (
        children
      )}
    </kbd>
  );
}

function Corners() {
  const c = "absolute h-4 w-4 border-cyan/70";
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-2 z-10 hidden md:block">
      <span className={`${c} left-0 top-0 border-l-2 border-t-2`} />
      <span className={`${c} right-0 top-0 border-r-2 border-t-2`} />
      <span className={`${c} bottom-0 left-0 border-b-2 border-l-2`} />
      <span className={`${c} bottom-0 right-0 border-b-2 border-r-2`} />
    </span>
  );
}

/* -------------------------------------------------------------------- css */

const CSS = `
.pm-dialog {
  position: fixed;
  inset: 0;
  margin: 0;
  padding: 0;
  border: 0;
  width: 100%;
  height: 100dvh;
  max-width: none;
  max-height: none;
  background: transparent;
  color: var(--color-ink);
  overflow-y: auto;
  overscroll-behavior: contain;
}
/* Desktop: a fixed console window whose two columns scroll on their own. */
@media (min-width: 768px) and (min-height: 600px) {
  .pm-dialog {
    margin: auto;
    width: min(920px, calc(100vw - 48px));
    height: min(780px, calc(100dvh - 48px));
    overflow: visible;
  }
  .pm-panel { height: 100%; min-height: 0; overflow: hidden; }
}
/* Short landscape screens keep the two columns but scroll as one, like
   phones — a fixed window would leave the screen content a sliver. */
@media (min-width: 768px) and (max-height: 599.98px) {
  .pm-dialog {
    margin: 12px auto;
    width: min(920px, calc(100vw - 48px));
    height: calc(100dvh - 24px);
  }
}
@media (max-width: 767.98px) {
  .pm-panel.panel { border-radius: 0; border-width: 0; }
}
.pm-dialog::backdrop {
  background:
    repeating-linear-gradient(to bottom, rgba(255, 255, 255, 0.03) 0 1px, transparent 1px 3px),
    radial-gradient(110% 80% at 50% 45%, rgba(139, 92, 246, 0.12), transparent 65%),
    rgba(6, 6, 10, 0.8);
  backdrop-filter: blur(6px) saturate(0.85);
  -webkit-backdrop-filter: blur(6px) saturate(0.85);
}
/* Phones: the opaque full-screen panel hides the backdrop, so skip the blur
   (it would re-render every frame behind the CRT roll bar). */
@media (max-width: 767.98px) {
  .pm-dialog::backdrop { backdrop-filter: none; -webkit-backdrop-filter: none; }
}
.pm-panel { box-shadow: 0 0 0 1px rgba(0, 229, 255, 0.08), 0 30px 80px rgba(0, 0, 0, 0.6), 0 0 60px rgba(139, 92, 246, 0.12); }

/* The reticle cannot draw above the top layer. Cursor.tsx already steps aside
   while a modal is open; this makes sure the menu never ends up pointerless. */
.pm-dialog, .pm-dialog * { cursor: default !important; }
.pm-dialog button, .pm-dialog button * { cursor: pointer !important; }

/* Freeze the page behind the modal without shifting it. */
html:has(.pm-dialog[open]) { scrollbar-gutter: stable; }
html:has(.pm-dialog[open]) body { overflow: hidden; }

/* ---------- selector ---------- */
.pm-caret {
  display: inline-block;
  flex-shrink: 0;
  width: 0;
  overflow: hidden;
  opacity: 0;
  color: var(--color-lime);
  font-size: 11px;
  line-height: 1;
  transition: width 0.18s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.18s;
}
.pm-item[data-pm-sel] .pm-caret { width: 13px; opacity: 1; }
.pm-btn[data-pm-sel] .pm-caret { margin-right: 6px; color: currentColor; }

.pm-item { transition: background-color 0.18s, border-color 0.18s, box-shadow 0.18s, color 0.18s, transform 0.12s; }
.pm-item:active { transform: scale(0.985); }

.pm-nav { color: rgba(242, 243, 247, 0.74); }
.pm-nav[aria-current="page"] { color: var(--color-cyan); }
.pm-nav[data-pm-sel] {
  color: var(--color-ink);
  background: linear-gradient(90deg, rgba(200, 255, 46, 0.12), rgba(26, 26, 40, 0.9) 70%);
  box-shadow: inset 3px 0 0 var(--color-lime);
}
.pm-nav[aria-current="page"][data-pm-sel] { color: var(--color-cyan); }

.pm-level[data-pm-sel], .pm-card[data-pm-sel] {
  border-color: var(--color-cyan);
  background-color: rgba(0, 229, 255, 0.07);
  box-shadow: 0 0 0 1px rgba(0, 229, 255, 0.3), 0 0 26px rgba(0, 229, 255, 0.14);
}
/* The global focus ring resets border-radius to 4px; keep each item's shape. */
.pm-item.rounded-md:focus-visible { border-radius: 0.375rem; }
.pm-item.rounded-lg:focus-visible { border-radius: 0.5rem; }
.pm-item.rounded-xl:focus-visible { border-radius: 0.75rem; }

/* The selection glow already marks these; keep the focus ring tight to it. */
.pm-level:focus-visible, .pm-card:focus-visible { outline-width: 2px; outline-offset: 2px; }
.pm-card:focus:not(:focus-visible) { outline: none; }

/* ---------- switches ---------- */
.pm-track {
  position: relative;
  flex-shrink: 0;
  width: 48px;
  height: 28px;
  border-radius: 99px;
  background: var(--color-void);
  border: 1px solid var(--color-edge);
  transition: background-color 0.2s, border-color 0.2s;
}
.pm-knob {
  position: absolute;
  top: 4px;
  left: 4px;
  width: 18px;
  height: 18px;
  border-radius: 99px;
  background: var(--color-muted);
  transition: translate 0.3s var(--ease-pop), background-color 0.2s, box-shadow 0.2s;
}
.pm-switch[aria-checked="true"] .pm-track { background: rgba(200, 255, 46, 0.16); border-color: var(--color-lime); }
.pm-switch[aria-checked="true"] .pm-knob {
  translate: 20px 0;
  background: var(--color-lime);
  box-shadow: 0 0 12px rgba(200, 255, 46, 0.7);
}
.pm-sparks { position: absolute; left: 33px; top: 13px; width: 0; height: 0; }
.pm-sparks > span {
  position: absolute;
  left: -2px;
  top: -2px;
  width: 4px;
  height: 4px;
  background: var(--color-lime);
  opacity: 0;
}

@media (prefers-reduced-motion: no-preference) {
  .pm-dialog[open] { animation: pm-in 0.34s cubic-bezier(0.16, 1, 0.3, 1); }
  .pm-dialog[open]::backdrop { animation: pm-fade 0.26s ease-out; }
  .pm-dialog[data-closing] { animation: pm-out 0.17s cubic-bezier(0.7, 0, 0.84, 0) forwards; }
  .pm-dialog[data-closing]::backdrop { animation: pm-fade 0.17s ease-in reverse forwards; }

  .pm-title { animation: pm-title 0.55s steps(1) 0.08s backwards; }
  .pm-nav { animation: pm-rise 0.4s cubic-bezier(0.16, 1, 0.3, 1) backwards; animation-delay: calc(90ms + var(--i) * 45ms); }
  .pm-stat { animation: pm-pop 0.45s var(--ease-pop) backwards; animation-delay: calc(70ms + var(--i) * 55ms); }
  .pm-fill { animation: pm-fill 0.9s 0.25s cubic-bezier(0.16, 1, 0.3, 1) backwards; }
  .pm-from-right { animation: pm-from-right 0.32s cubic-bezier(0.16, 1, 0.3, 1); }
  .pm-from-left { animation: pm-from-left 0.32s cubic-bezier(0.16, 1, 0.3, 1); }
  .pm-card { animation: pm-rise 0.36s cubic-bezier(0.16, 1, 0.3, 1) backwards; animation-delay: calc(var(--i) * 24ms); }
  .pm-item[data-pm-sel] .pm-caret { animation: pm-nudge 0.9s ease-in-out infinite; }
  .pm-blink { animation: pm-blink 1.1s steps(1) infinite; }
  .pm-knob.pm-squash { animation: pm-squash 0.36s var(--ease-pop); }
  .pm-sparks.pm-go > span { animation: pm-spark 0.5s cubic-bezier(0.16, 1, 0.3, 1); }
}

@keyframes pm-in {
  from { opacity: 0; transform: translateY(12px) scale(0.95); }
  55% { opacity: 1; }
  to { opacity: 1; transform: none; }
}
@keyframes pm-out { to { opacity: 0; transform: scale(0.97); } }
@keyframes pm-fade { from { opacity: 0; } }
@keyframes pm-title {
  0% { opacity: 0; }
  14% { opacity: 1; clip-path: inset(0 0 64% 0); translate: -10px 0; text-shadow: 4px 0 #ff2d77, -4px 0 #00e5ff; }
  32% { clip-path: inset(46% 0 10% 0); translate: 8px 0; text-shadow: -4px 0 #ff2d77, 4px 0 #00e5ff; }
  50% { clip-path: inset(12% 0 40% 0); translate: -4px 0; }
  70% { clip-path: inset(0); translate: 2px 0; text-shadow: none; }
  86% { translate: 0 0; }
}
@keyframes pm-rise { from { opacity: 0; transform: translateY(10px); } }
@keyframes pm-pop { from { opacity: 0; transform: scale(0.86); } }
@keyframes pm-fill { from { transform: scaleX(0); } }
@keyframes pm-from-right { from { opacity: 0; transform: translateX(18px); } }
@keyframes pm-from-left { from { opacity: 0; transform: translateX(-18px); } }
@keyframes pm-nudge { 0%, 100% { translate: 0 0; } 50% { translate: 3px 0; } }
@keyframes pm-blink { 50% { opacity: 0.15; } }
@keyframes pm-squash {
  0% { scale: 1; }
  35% { scale: 1.5 0.72; }
  70% { scale: 0.92 1.1; }
  100% { scale: 1; }
}
@keyframes pm-spark {
  0% { opacity: 1; transform: rotate(var(--a)) translateX(5px) scale(1); }
  100% { opacity: 0; transform: rotate(var(--a)) translateX(24px) scale(0.3); }
}
`;
