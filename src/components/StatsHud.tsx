"use client";

import { HEADLINE_STATS, PERF_STATS } from "@/data/studio";
import { useCountUp, useInView } from "@/lib/hooks";
import { Section, SectionHead } from "./Section";
import { Coin } from "./GameUi";

const ACCENT = {
  cyan: { text: "text-cyan", bg: "bg-cyan", glow: "shadow-[0_0_24px_-6px_#00e5ff]" },
  magenta: { text: "text-magenta", bg: "bg-magenta", glow: "shadow-[0_0_24px_-6px_#ff2d77]" },
  lime: { text: "text-lime", bg: "bg-lime", glow: "shadow-[0_0_24px_-6px_#c8ff2e]" },
  violet: { text: "text-violet", bg: "bg-violet", glow: "shadow-[0_0_24px_-6px_#8b5cf6]" },
} as const;

function StatTile({
  value,
  suffix,
  label,
  accent,
  run,
}: {
  value: number;
  suffix: string;
  label: string;
  accent: keyof typeof ACCENT;
  run: boolean;
}) {
  const n = useCountUp(value, run);
  const a = ACCENT[accent];
  return (
    <div
      data-solid=""
      className={`panel relative overflow-hidden p-5 transition-transform duration-300 hover:-translate-y-1 sm:p-6 ${a.glow}`}
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${a.bg}`} />
      <p className="font-display text-[clamp(2.2rem,5.4vw,3.4rem)] leading-none tabular-nums">
        {n}
        <span className={a.text}>{suffix}</span>
      </p>
      <p className="label mt-3">{label}</p>
    </div>
  );
}

function PerfBar({
  label,
  display,
  fill,
  note,
  accent,
  run,
  delay,
}: {
  label: string;
  display: string;
  fill: number;
  note: string;
  accent: keyof typeof ACCENT;
  run: boolean;
  delay: number;
}) {
  const a = ACCENT[accent];
  return (
    <div className="py-3.5">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="mono text-[11px] uppercase tracking-[0.16em] text-muted">
          {label}
        </span>
        <span className={`font-display text-lg tabular-nums ${a.text}`}>
          {display}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-panel-2">
        <div
          className={`h-full rounded-full ${a.bg} transition-[width] duration-[1100ms] ease-out`}
          style={{
            width: run ? `${fill * 100}%` : "0%",
            transitionDelay: `${delay}ms`,
          }}
        />
      </div>
      <p className="mono mt-1.5 text-[10px] uppercase tracking-[0.16em] text-muted">
        {note}
      </p>
    </div>
  );
}

export default function StatsHud() {
  const { ref, inView } = useInView<HTMLDivElement>();

  return (
    <Section id="studio">
      <SectionHead
        index="02"
        kicker="Who we are"
        title="STUDIO SNAPSHOT"
        accent="magenta"
        lead="A small dedicated studio in Pakistan, trying to make a global impact. Design, art, engineering, user acquisition and live ops all happen in house — which is why a concept can reach soft launch in weeks, not quarters."
      />

      <div ref={ref}>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {HEADLINE_STATS.map((s) => (
            <StatTile
              key={s.label}
              value={s.value}
              suffix={s.suffix}
              label={s.label}
              accent={s.accent}
              run={inView}
            />
          ))}
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1.25fr_1fr]">
          <div className="panel relative p-5 sm:p-7">
            <Coin id="stats" label="the performance panel" className="right-5 top-4" />
            <div className="mb-2 flex items-center gap-2">
              <span className="label">Live performance</span>
              <span className="mono rounded border border-cyan/40 bg-cyan/10 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] text-cyan">
                Puzzle Warrior
              </span>
            </div>
            <div className="divide-y divide-edge/60">
              {PERF_STATS.map((p, i) => (
                <PerfBar key={p.label} {...p} run={inView} delay={i * 130} />
              ))}
            </div>
          </div>

          <div className="panel flex flex-col justify-between gap-6 p-5 sm:p-7">
            <div>
              <p className="label mb-3">The thesis</p>
              <p className="text-pretty text-base leading-relaxed text-ink/90">
                Hybrid-casual lives or dies on two numbers: what it costs to buy a
                player, and whether they come back tomorrow. We build small, test
                in market early, and only scale the titles that clear both bars.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-edge bg-panel-2/60 p-3.5">
                <p className="font-display text-2xl text-lime">1¢</p>
                <p className="label mt-1.5">Best CPI achieved</p>
              </div>
              <div className="rounded-lg border border-edge bg-panel-2/60 p-3.5">
                <p className="font-display text-2xl text-cyan">100%</p>
                <p className="label mt-1.5">Made in house</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
