"use client";

import { useEffect, useId, useRef, useState } from "react";
import { DISCIPLINES, STUDIO } from "@/data/studio";
import { ACCENT_HEX, byId, spriteSrc } from "@/data/characters";
import { QUEST, TEAM_SKILLS, questMailto, type QuestPath } from "@/data/dialogue";
import { useGame } from "@/lib/game-state";
import { useInView, useReducedMotion } from "@/lib/hooks";
import { sfx } from "@/lib/audio";
import { fx } from "@/lib/fx";
import { Section, SectionHead } from "./Section";
import { Coin } from "./GameUi";

/** Each discipline's class skill gets its own voice. */
const SKILL_SFX = [
  () => sfx.select(),
  () => sfx.swap(),
  () => sfx.match(4),
  () => sfx.jump(),
  () => sfx.heal(),
];

/* ------------------------------------------------------------- team card */

function TeamCard({
  d,
  index,
  reduced,
}: {
  d: (typeof DISCIPLINES)[number];
  index: number;
  reduced: boolean;
}) {
  const hex = ACCENT_HEX[byId(d.char).accent];
  const skill = TEAM_SKILLS[d.role] ?? "";
  const cardRef = useRef<HTMLLIElement>(null);
  const spriteRef = useRef<HTMLImageElement>(null);
  const ringRef = useRef<HTMLSpanElement>(null);
  const tagRef = useRef<HTMLSpanElement>(null);

  /** Hop, flash the class colour, pop the skill name. Ignored while one is playing. */
  const cast = () => {
    const card = cardRef.current;
    const sprite = spriteRef.current;
    const ring = ringRef.current;
    const tag = tagRef.current;
    if (!card || !sprite || !ring || !tag || card.dataset.skill !== undefined) return;
    if (typeof tag.animate !== "function") return;
    card.dataset.skill = "";
    SKILL_SFX[index % SKILL_SFX.length]();
    const release = () => {
      delete card.dataset.skill;
    };

    if (reduced) {
      // No movement: the skill name simply appears and fades.
      tag
        .animate(
          [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }],
          { duration: 1200 },
        )
        .finished.then(release, release);
      return;
    }

    sprite.animate(
      [
        { transform: "translateY(0) scale(1, 1)" },
        { transform: "translateY(3px) scale(1.14, 0.84)", offset: 0.14 },
        { transform: "translateY(-22px) scale(0.9, 1.12)", offset: 0.42 },
        { transform: "translateY(0) scale(1.12, 0.88)", offset: 0.68 },
        { transform: "translateY(0) scale(0.97, 1.03)", offset: 0.84 },
        { transform: "translateY(0) scale(1, 1)" },
      ],
      { duration: 600, easing: "cubic-bezier(0.3, 0.7, 0.3, 1)" },
    );
    ring.animate(
      [
        { opacity: 0, transform: "scale(0.3)" },
        { opacity: 0.95, transform: "scale(0.9)", offset: 0.35 },
        { opacity: 0, transform: "scale(1.7)" },
      ],
      { duration: 620, delay: 120, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    );
    tag
      .animate(
        [
          { opacity: 0, transform: "translateY(10px) scale(0.7)" },
          { opacity: 1, transform: "translateY(-6px) scale(1.06)", offset: 0.22 },
          { opacity: 1, transform: "translateY(-10px) scale(1)", offset: 0.75 },
          { opacity: 0, transform: "translateY(-18px) scale(1)" },
        ],
        { duration: 1100, delay: 150, easing: "ease-out", fill: "backwards" },
      )
      .finished.then(release, release);
    window.setTimeout(() => {
      if (!ring.isConnected) return;
      fx.burstAt(ring, {
        count: 10,
        colors: [hex, "#ffffff"],
        speed: 230,
        gravity: 480,
        size: 3,
        life: 0.5,
      });
    }, 260);
  };

  return (
    <li
      ref={cardRef}
      data-solid=""
      data-reveal="pop"
      onPointerEnter={(e) => e.pointerType === "mouse" && cast()}
      onClick={cast}
      className="panel group relative flex items-center gap-3 overflow-hidden p-4 transition-[translate,border-color,box-shadow] duration-300 hover:-translate-y-1 data-[skill]:border-[var(--acc)] data-[skill]:shadow-[0_14px_36px_-20px_var(--acc)] lg:flex-col lg:items-start"
      style={{
        ["--acc" as string]: hex,
        ["--reveal-delay" as string]: `${index * 80}ms`,
      }}
    >
      <span aria-hidden="true" className="mono absolute right-3 top-3 text-[10px] text-muted/40">
        0{index + 1}
      </span>
      {/* class-colour wash while the skill plays */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -left-10 -top-10 h-36 w-36 rounded-full opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-20 group-data-[skill]:opacity-35"
        style={{ background: hex }}
      />

      <button
        type="button"
        onFocus={cast}
        aria-label={`${d.role} class skill: ${skill}`}
        className="relative shrink-0 rounded-xl"
      >
        <span
          ref={ringRef}
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 -ml-9 -mt-9 h-[72px] w-[72px] rounded-full border-2 opacity-0"
          style={{ borderColor: hex, boxShadow: `0 0 18px ${hex}, inset 0 0 12px ${hex}` }}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={spriteRef}
          src={spriteSrc(d.char)}
          alt=""
          loading="lazy"
          className="sprite relative h-[72px] w-auto origin-bottom transition-[translate] duration-300 group-hover:-translate-y-1 lg:h-[96px]"
        />
        <span
          ref={tagRef}
          aria-hidden="true"
          className="mono pointer-events-none absolute left-0 top-0 z-[1] whitespace-nowrap rounded border bg-void/90 px-1.5 py-1 text-[9.5px] font-bold uppercase leading-none tracking-[0.14em] opacity-0"
          style={{ color: hex, borderColor: `${hex}88`, textShadow: `0 0 8px ${hex}` }}
        >
          {skill}
        </span>
      </button>

      <div className="relative">
        <h3 className="font-display text-base leading-tight">{d.role}</h3>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{d.body}</p>
      </div>
    </li>
  );
}

/* --------------------------------------------------------- quest dialogue */

type LineId = "greeting" | "back" | QuestPath;

const ITEM =
  "flex min-h-10 w-full items-center gap-2.5 rounded-md px-2 py-2 text-left leading-tight transition-colors hover:bg-panel-2/80 focus-visible:bg-panel-2/80";

function Caret({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`quest-caret inline-block w-3 shrink-0 text-[11px] leading-none text-amber transition-opacity duration-150 ${
        on ? "opacity-100" : "opacity-0"
      }`}
      data-on={on ? "" : undefined}
    >
      ▶
    </span>
  );
}

/**
 * An RPG dialogue box: an NPC types a line, the visitor picks a reply from a
 * menu, and the chosen path ends in a pre-filled email. An extra, playful way
 * into the same inboxes as the buttons above it — never a replacement.
 */
function QuestDialogue() {
  const { unlock, paused } = useGame();
  const reduced = useReducedMotion();
  const { ref: boxRef, inView } = useInView<HTMLDivElement>();
  const hintId = useId();

  const [node, setNode] = useState<LineId>("greeting");
  /** The line that has finished typing. When it equals `node` the menu shows. */
  const [typed, setTyped] = useState<LineId | null>(null);
  const [sel, setSel] = useState(0);

  const visRef = useRef<HTMLSpanElement>(null);
  const restRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const skipRef = useRef<HTMLButtonElement>(null);
  const pausedRef = useRef(paused);
  /** Set by handlers when focus was inside the box and must follow the content. */
  const wantFocus = useRef(false);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const npc = byId(QUEST.npc);
  const choice = QUEST.choices.find((c) => c.id === node) ?? null;
  const line = choice ? choice.reply : node === "back" ? QUEST.back : QUEST.greeting;
  const done = reduced || typed === node;
  /** The line hasn't finished. Skip stays a tab stop for all of it — even
   *  before typing starts — so keyboard visitors never tab past the box. */
  const pending = !done;
  const typing = inView && pending;

  // Typewriter. Characters are written straight into two spans — the typed
  // part and the not-yet-typed remainder, kept invisible so line wrapping
  // never jumps — so typing never re-renders the section. Screen readers get
  // the whole line at once from the live region instead.
  useEffect(() => {
    const vis = visRef.current;
    const rest = restRef.current;
    if (!vis || !rest) return;

    if (done || !inView) {
      vis.textContent = done ? line : "";
      rest.textContent = done ? "" : line;
      return;
    }

    vis.textContent = "";
    rest.textContent = line;

    let i = 0;
    let t = 0;
    const tick = () => {
      if (pausedRef.current) {
        t = window.setTimeout(tick, 150);
        return;
      }
      i++;
      vis.textContent = line.slice(0, i);
      rest.textContent = line.slice(i);
      const ch = line[i - 1];
      if (i % 3 === 1 && ch !== " ") sfx.type();
      if (i >= line.length) {
        if (document.activeElement === skipRef.current) wantFocus.current = true;
        setTyped(node);
        return;
      }
      const beat = /[.!?]/.test(ch) && line[i] === " " ? 240 : /[,—]/.test(ch) ? 110 : 24;
      t = window.setTimeout(tick, beat);
    };
    t = window.setTimeout(tick, 260);
    return () => window.clearTimeout(t);
  }, [inView, done, line, node]);

  // Keep keyboard focus with the conversation as buttons come and go.
  useEffect(() => {
    if (!wantFocus.current) return;
    wantFocus.current = false;
    const target = pending
      ? skipRef.current
      : menuRef.current?.querySelector<HTMLElement>("[data-item]");
    target?.focus({ preventScroll: true });
  }, [pending, node]);

  const focusInside = () => !!boxRef.current?.contains(document.activeElement);

  const skip = () => {
    if (!pending) return;
    wantFocus.current = focusInside();
    sfx.menuMove();
    setTyped(node);
  };

  const choose = (id: QuestPath) => {
    wantFocus.current = focusInside();
    sfx.select();
    setSel(0);
    setNode(id);
  };

  const goBack = () => {
    wantFocus.current = focusInside();
    sfx.back();
    setSel(0);
    setNode("back");
  };

  const accept = (e: React.MouseEvent<HTMLAnchorElement>) => {
    unlock("quest");
    sfx.select();
    fx.burstAt(e.currentTarget, "confetti");
  };

  const point = (i: number) => {
    if (i === sel) return;
    setSel(i);
    sfx.menuMove();
  };

  // Up / Down walk the menu like a game menu; Tab still works as normal.
  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>("[data-item]") ?? [],
    );
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const n = items.length;
    const j =
      e.key === "ArrowDown"
        ? (i + 1) % n
        : e.key === "ArrowUp"
          ? (i - 1 + n) % n
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? n - 1
              : -1;
    if (j < 0) return;
    e.preventDefault();
    items[j].focus();
  };

  const hover = (i: number) => (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") point(i);
  };

  const choiceCls = (on: boolean) =>
    `${ITEM} font-display text-[15px] tracking-wide ${on ? "text-ink" : "text-ink/75"}`;

  return (
    <div
      ref={boxRef}
      role="group"
      aria-label={`${QUEST.boxLabel}: ${npc.name}`}
      className="relative mt-10"
    >
      {/* name plate */}
      <span className="absolute -top-3 left-4 z-[2] inline-flex items-center gap-1.5 rounded-[5px] bg-amber px-2.5 py-1 font-display text-[13px] leading-none tracking-wide text-void shadow-[0_0_18px_-4px_rgba(255,176,32,0.8)]">
        {npc.name.toUpperCase()}
        <span className="mono text-[9px] font-bold uppercase tracking-[0.16em] text-void/70">
          {npc.role}
        </span>
      </span>

      {/* Always holds the whole current line, so it reads in place, before
          the choices; a change of line (a reply, "back") is announced. */}
      <p aria-live="polite" className="sr-only">
        {line}
      </p>

      <div className="relative rounded-xl border-2 border-edge bg-void/85 p-4 pt-6 shadow-[inset_0_0_0_1px_rgba(255,176,32,0.16),0_22px_44px_-28px_rgba(255,176,32,0.55)] sm:p-5 sm:pt-7">
        {/* pixel corners */}
        <span aria-hidden="true" className="absolute left-1 top-1 h-1.5 w-1.5 bg-amber/70" />
        <span aria-hidden="true" className="absolute right-1 top-1 h-1.5 w-1.5 bg-amber/70" />
        <span aria-hidden="true" className="absolute bottom-1 left-1 h-1.5 w-1.5 bg-amber/70" />
        <span aria-hidden="true" className="absolute bottom-1 right-1 h-1.5 w-1.5 bg-amber/70" />

        {/* Below sm the menu drops under the portrait and takes the full width. */}
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3.5 sm:grid-rows-[auto_1fr] sm:gap-x-4">
          {/* portrait */}
          <div
            aria-hidden="true"
            className="relative h-[68px] w-[68px] shrink-0 overflow-hidden rounded-lg border-2 border-amber/50 bg-gradient-to-b from-amber/30 via-panel-2 to-void sm:row-span-2 sm:h-20 sm:w-20"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={spriteSrc(npc.id)}
              alt=""
              loading="lazy"
              className={`quest-npc sprite absolute -bottom-3 left-1/2 h-[118%] w-auto max-w-none -translate-x-1/2 ${
                typing ? "quest-npc-talk" : ""
              }`}
            />
            <span className="absolute inset-0 bg-[repeating-linear-gradient(to_bottom,rgba(255,255,255,0.05)_0_1px,transparent_1px_3px)]" />
          </div>

          {/* The line: a full copy sizes the box (and is what visitors without
              JavaScript read); the typed text sits on top of it. */}
          <p
            aria-hidden="true"
            onClick={skip}
            className={`grid self-start text-[14.5px] leading-relaxed text-ink/90 ${pending ? "cursor-pointer" : ""}`}
          >
            <span className="[grid-area:1/1] [.js_&]:invisible">{line}</span>
            <span className="[grid-area:1/1]">
              <span ref={visRef} />
              {/* An empty inline, so the caret never changes where lines wrap.
                  It blinks while the box waits to scroll into view. */}
              {pending && (
                <span
                  data-wait={typing ? undefined : ""}
                  className="quest-cursor relative [:root:not(.js)_&]:hidden"
                />
              )}
              <span ref={restRef} className="opacity-0" />
            </span>
          </p>

          <div
            ref={menuRef}
            role="group"
            aria-label={QUEST.choicesLabel}
            onKeyDown={onMenuKey}
            className="relative col-span-2 mt-3 min-h-[128px] sm:col-span-1 sm:col-start-2 sm:row-start-2"
          >
            {pending && (
              <button
                ref={skipRef}
                type="button"
                onClick={skip}
                aria-label={QUEST.skipLabel}
                className="mono absolute bottom-0 right-0 inline-flex min-h-10 items-center gap-1.5 rounded-md px-2 text-[10px] uppercase tracking-[0.18em] text-muted transition-colors hover:text-amber [:root:not(.js)_&]:hidden"
              >
                {QUEST.skip}
                <span aria-hidden="true" className="quest-skip text-[8px] tracking-[-0.1em]">
                  ▶▶
                </span>
              </button>
            )}

            {done && !choice && (
              <ul className="flex flex-col gap-1">
                {QUEST.choices.map((c, i) => (
                  <li key={c.id} className="quest-in" style={{ ["--qi" as string]: `${i * 70}ms` }}>
                    <button
                      type="button"
                      data-item=""
                      data-cursor="TALK"
                      onClick={() => choose(c.id)}
                      onFocus={() => point(i)}
                      onPointerEnter={hover(i)}
                      className={choiceCls(sel === i)}
                    >
                      <Caret on={sel === i} />
                      {c.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {done && choice && (
              <div className="flex flex-col gap-1">
                <div className="quest-in flex items-center gap-2.5 px-2 py-1">
                  <Caret on={sel === 0} />
                  <div>
                    <a
                      href={questMailto(choice)}
                      data-item=""
                      data-magnetic=""
                      data-cursor="ACCEPT"
                      aria-describedby={hintId}
                      onClick={accept}
                      onFocus={() => point(0)}
                      onPointerEnter={hover(0)}
                      className="group inline-flex min-h-11 items-center gap-2 rounded-lg bg-gradient-to-r from-amber to-magenta px-4 py-3 font-display text-sm tracking-wide text-void shadow-[0_10px_30px_-12px_rgba(255,45,119,0.8)] transition-[scale,filter] duration-200 hover:scale-[1.04] hover:brightness-110 active:scale-95"
                    >
                      {QUEST.accept}
                      <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">
                        →
                      </span>
                    </a>
                    <p id={hintId} className="mono mt-1.5 text-[10px] tracking-[0.08em] text-muted">
                      {QUEST.acceptHint} ·{" "}
                      <span className="whitespace-nowrap">{choice.email}</span>
                    </p>
                  </div>
                </div>
                <div className="quest-in" style={{ ["--qi" as string]: "90ms" }}>
                  <button
                    type="button"
                    data-item=""
                    onClick={goBack}
                    onFocus={() => point(1)}
                    onPointerEnter={hover(1)}
                    className={`${ITEM} mono text-[11px] uppercase tracking-[0.18em] ${
                      sel === 1 ? "text-ink" : "text-ink/75"
                    }`}
                  >
                    <Caret on={sel === 1} />
                    <span aria-hidden="true">←</span> {QUEST.backLabel}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}

/* --------------------------------------------------------------- section */

export default function Partner() {
  const { unlock } = useGame();
  const reduced = useReducedMotion();

  const shop = (e: React.MouseEvent<HTMLAnchorElement>) => {
    unlock("window-shopper");
    sfx.select();
    fx.burstAt(e.currentTarget.querySelector("[data-icon]"), "click");
  };

  return (
    <Section id="partner" className="pb-10">
      <style>{PARTNER_CSS}</style>
      <SectionHead
        index="07"
        kicker="The team"
        title="JOIN THE PARTY"
        accent="magenta"
        lead="A small local studio with agility. Five disciplines, one room, no outsourcing — which is what makes the ship cadence possible."
      />

      {/* ---------------- party roster ---------------- */}
      <div className="relative mb-14">
        <Coin
          id="team"
          label="the team cards"
          className="-top-10 right-3 sm:-top-12 lg:left-[38%] lg:right-auto"
        />
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:gap-4">
          {DISCIPLINES.map((d, i) => (
            <TeamCard key={d.role} d={d} index={i} reduced={reduced} />
          ))}
        </ul>
      </div>

      {/* ---------------- contact ---------------- */}
      <div className="relative grid gap-4 lg:grid-cols-[1.15fr_1fr] lg:items-start">
        <Coin id="partner" label="the contact panel" className="-top-4 left-8" />

        <div data-reveal="" className="panel scanlines relative overflow-hidden p-6 sm:p-9">
          <div
            aria-hidden="true"
            className="absolute -left-20 -top-20 h-64 w-64 rounded-full bg-violet/25 blur-3xl"
          />
          <p className="label relative">Open quest</p>
          <h3 className="relative mt-3 font-display text-[clamp(1.7rem,4.6vw,2.8rem)] leading-[0.95]">
            LOOKING FOR A<br />
            <span className="bg-gradient-to-r from-cyan to-magenta bg-clip-text text-transparent">
              PUBLISHING PARTNER
            </span>
          </h3>
          <p className="relative mt-4 max-w-md text-pretty text-[15px] leading-relaxed text-muted">
            We have the pipeline, the art and the release cadence. What we want is
            a partner with UA muscle to take a proven loop global. Prototypes,
            metrics and the full deck are available on request.
          </p>

          <div className="relative mt-7 flex flex-wrap gap-3">
            <a
              href={`mailto:${STUDIO.emails.partner}?subject=Publishing%20partnership%20%E2%80%94%20GlitchTech%20Games`}
              onMouseEnter={() => sfx.hover()}
              data-magnetic=""
              data-cursor="EMAIL"
              className="group inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan to-violet px-5 py-3.5 font-display text-sm tracking-wide text-void transition-[scale] duration-200 hover:scale-[1.04] active:scale-95"
            >
              PITCH US
              <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">
                →
              </span>
            </a>
            <a
              href={`mailto:${STUDIO.emails.studio}`}
              onMouseEnter={() => sfx.hover()}
              data-cursor="EMAIL"
              className="inline-flex items-center rounded-lg border border-edge bg-panel/70 px-5 py-3.5 font-display text-sm tracking-wide transition-colors hover:border-lime hover:text-lime"
            >
              GENERAL ENQUIRIES
            </a>
          </div>

          <QuestDialogue />

          <dl className="relative mt-7 grid gap-3 border-t border-edge/60 pt-6 sm:grid-cols-2">
            <div>
              <dt className="label mb-1.5">Partnerships</dt>
              <dd>
                <a
                  className="mono break-all text-[13px] text-cyan hover:underline"
                  href={`mailto:${STUDIO.emails.partner}`}
                >
                  {STUDIO.emails.partner}
                </a>
              </dd>
            </div>
            <div>
              <dt className="label mb-1.5">Studio</dt>
              <dd>
                <a
                  className="mono break-all text-[13px] text-cyan hover:underline"
                  href={`mailto:${STUDIO.emails.studio}`}
                >
                  {STUDIO.emails.studio}
                </a>
              </dd>
            </div>
          </dl>
        </div>

        {/* Store rail. On lg it rides along beside the (much taller) quest
            panel instead of stretching to match it with a hole in the middle.
            The reveal sits on the inner panel: never on a sticky element. */}
        <div className="lg:sticky lg:top-24">
          <div
            data-reveal=""
            style={{ ["--reveal-delay" as string]: "120ms" }}
            className="panel flex flex-col gap-4 p-6 sm:p-7"
          >
            <p className="label">Play the catalogue</p>
            <a
              href={STUDIO.stores.play}
              target="_blank"
              rel="noopener noreferrer"
              onMouseEnter={() => sfx.hover()}
              onClick={shop}
              data-cursor="PLAY"
              className="store-link group relative flex items-center gap-4 overflow-hidden rounded-xl border border-edge bg-panel-2/50 p-4 transition-colors hover:border-lime"
            >
              <span aria-hidden="true" className="store-shine" />
              <span
                data-icon=""
                className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-lime to-cyan text-void transition-[scale,rotate] duration-300 ease-[var(--ease-pop)] group-hover:-rotate-6 group-hover:scale-110"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 3l12 9-12 9V3z" fill="currentColor" />
                </svg>
              </span>
              <span className="min-w-0">
                <span className="block font-display text-base leading-tight">
                  Google Play
                </span>
                <span className="mono block text-[10px] uppercase tracking-[0.14em] text-muted">
                  12 titles · 220K+ installs
                </span>
              </span>
              <span aria-hidden="true" className="ml-auto text-muted transition-[translate,color] group-hover:translate-x-1 group-hover:text-lime">
                →
              </span>
            </a>

            <a
              href={STUDIO.stores.apple}
              target="_blank"
              rel="noopener noreferrer"
              onMouseEnter={() => sfx.hover()}
              onClick={shop}
              data-cursor="PLAY"
              className="store-link group relative flex items-center gap-4 overflow-hidden rounded-xl border border-edge bg-panel-2/50 p-4 transition-colors hover:border-cyan"
            >
              <span aria-hidden="true" className="store-shine" />
              <span
                data-icon=""
                className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-ink to-muted text-void transition-[scale,rotate] duration-300 ease-[var(--ease-pop)] group-hover:-rotate-6 group-hover:scale-110"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M16.4 12.7c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.15-2.8.85-3.5.85s-1.8-.83-3-.8c-1.5.02-2.9.88-3.7 2.24-1.6 2.75-.4 6.8 1.1 9 .75 1.1 1.6 2.3 2.8 2.26 1.1-.05 1.5-.72 2.9-.72s1.7.72 2.9.7c1.2-.02 1.95-1.1 2.7-2.2.85-1.26 1.2-2.5 1.2-2.56-.03-.01-2.3-.88-2.3-3.5z"
                    fill="currentColor"
                  />
                </svg>
              </span>
              <span className="min-w-0">
                <span className="block font-display text-base leading-tight">
                  App Store
                </span>
                <span className="mono block text-[10px] uppercase tracking-[0.14em] text-muted">
                  Live on iPhone & iPad
                </span>
              </span>
              <span aria-hidden="true" className="ml-auto text-muted transition-[translate,color] group-hover:translate-x-1 group-hover:text-cyan">
                →
              </span>
            </a>

            <div className="mt-auto rounded-xl border border-dashed border-edge p-4">
              <p className="label mb-2">Based in</p>
              <p className="font-display text-xl leading-none">
                {STUDIO.location}
              </p>
              <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
                Inspired by the Turkish hyper-casual studios, built here — with the
                whole pipeline under one roof.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}

const PARTNER_CSS = `
.store-shine {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(105deg, transparent 35%, rgba(255, 255, 255, 0.07) 50%, transparent 65%);
  translate: -120% 0;
}
@media (prefers-reduced-motion: no-preference) {
  .store-link:hover .store-shine,
  .store-link:focus-visible .store-shine {
    translate: 120% 0;
    transition: translate 0.7s cubic-bezier(0.2, 0.7, 0.2, 1);
  }
  .quest-in { animation: quest-in 0.38s cubic-bezier(0.2, 0.9, 0.3, 1.2) var(--qi, 0ms) backwards; }
  .quest-caret[data-on] { animation: quest-caret 0.9s steps(2, jump-none) infinite; }
  .quest-npc-talk { animation: quest-talk 0.2s ease-in-out infinite alternate; }
  .quest-skip { animation: quest-skip 0.8s ease-in-out infinite; }
  .quest-cursor[data-wait]::after { animation: quest-blink 1s steps(1) infinite; }
}
.quest-npc { transform-origin: 50% 100%; }
.quest-cursor::after {
  content: "";
  position: absolute;
  left: 2px;
  top: 0.12em;
  width: 0.45em;
  height: 1.05em;
  background: var(--color-amber);
  box-shadow: 0 0 8px rgba(255, 176, 32, 0.6);
}
@keyframes quest-in {
  from { opacity: 0; translate: -10px 0; }
}
@keyframes quest-caret {
  0%   { translate: 0 0; }
  100% { translate: 3px 0; }
}
@keyframes quest-talk {
  from { transform: scale(1, 1); }
  to   { transform: scale(1.03, 0.96) translateY(1px); }
}
@keyframes quest-blink {
  50% { opacity: 0; }
}
@keyframes quest-skip {
  0%, 100% { opacity: 0.5; translate: 0 0; }
  50%      { opacity: 1; translate: 2px 0; }
}
`;
