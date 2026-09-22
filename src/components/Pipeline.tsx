"use client";

import { PIPELINE, STRENGTHS } from "@/data/studio";
import { spriteSrc } from "@/data/characters";
import { useInView } from "@/lib/hooks";
import { Section, SectionHead } from "./Section";
import { Coin } from "./GameUi";

const PHASE_COLOR: Record<string, string> = {
  BUILD: "#00e5ff",
  VALIDATE: "#ffb020",
  GROW: "#c8ff2e",
};

const ACCENT: Record<string, string> = {
  cyan: "#00e5ff",
  magenta: "#ff2d77",
  lime: "#c8ff2e",
};

export default function Pipeline() {
  const { ref, inView } = useInView<HTMLDivElement>();

  return (
    <Section id="pipeline">
      <SectionHead
        index="06"
        kicker="How we build"
        title="THE LEVEL MAP"
        accent="lime"
        lead="Five stages from an idea to a live title. Nothing gets scaled until the soft-launch numbers earn it."
      />

      {/* ---------------- stage track ---------------- */}
      <div ref={ref} className="relative">
        <Coin id="pipeline" label="the pipeline track" className="-top-4 right-6" />

        {/* connecting rail */}
        <div
          aria-hidden="true"
          className="absolute left-0 right-0 top-[38px] hidden h-[2px] bg-panel-2 lg:block"
        >
          <div
            className="h-full bg-gradient-to-r from-cyan via-amber to-lime transition-[width] duration-[1600ms] ease-out"
            style={{ width: inView ? "100%" : "0%" }}
          />
        </div>

        <ol className="relative grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:gap-4">
          {PIPELINE.map((p, i) => (
            <li key={p.n} className="relative">
              <div
                className="mb-4 hidden lg:block"
                style={{
                  transitionDelay: `${i * 220}ms`,
                }}
              >
                <span
                  className="grid h-[76px] w-[76px] place-items-center rounded-full border-2 bg-void font-display text-xl transition-all duration-500"
                  style={{
                    borderColor: inView ? PHASE_COLOR[p.phase] : "#2a2a3d",
                    color: inView ? PHASE_COLOR[p.phase] : "#8a8fa3",
                    transitionDelay: `${i * 220}ms`,
                    boxShadow: inView
                      ? `0 0 26px -8px ${PHASE_COLOR[p.phase]}`
                      : "none",
                  }}
                >
                  {p.n}
                </span>
              </div>

              <div
                data-solid=""
                className="panel h-full p-4 transition-transform duration-300 hover:-translate-y-1"
              >
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-display text-lg lg:hidden">{p.n}</span>
                  <span
                    className="mono rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em]"
                    style={{
                      color: PHASE_COLOR[p.phase],
                      borderColor: `${PHASE_COLOR[p.phase]}55`,
                      background: `${PHASE_COLOR[p.phase]}12`,
                    }}
                  >
                    {p.phase}
                  </span>
                </div>
                <h3 className="font-display text-lg leading-tight">{p.stage}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-muted">
                  {p.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* ---------------- strengths ---------------- */}
      <div className="mt-20 sm:mt-24">
        <div className="mb-8 flex items-center gap-3">
          <span className="h-3 w-1.5 rounded-full bg-violet" />
          <h3 className="font-display text-[clamp(1.5rem,3.6vw,2.2rem)] leading-none">
            WHERE THE PORTFOLIO IS DEEPEST
          </h3>
        </div>

        <div className="grid gap-3 sm:gap-4 lg:grid-cols-3">
          {STRENGTHS.map((s) => {
            const hex = ACCENT[s.accent];
            return (
              <article
                key={s.n}
                data-solid=""
                className="panel group relative flex flex-col overflow-hidden p-5 transition-transform duration-300 hover:-translate-y-1.5 sm:p-6"
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 top-0 h-[2px]"
                  style={{ background: hex }}
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-30"
                  style={{ background: hex }}
                />

                <div className="flex items-start justify-between gap-3">
                  <span
                    className="font-display text-4xl leading-none opacity-30"
                    style={{ color: hex }}
                  >
                    {s.n}
                  </span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={spriteSrc(s.char)}
                    alt=""
                    loading="lazy"
                    className="sprite h-16 w-auto opacity-80 transition-transform duration-300 group-hover:-translate-y-1 group-hover:scale-110"
                  />
                </div>

                <h4 className="mt-3 font-display text-xl leading-tight">
                  {s.title}
                </h4>
                <p className="mt-2.5 flex-1 text-[13.5px] leading-relaxed text-muted">
                  {s.body}
                </p>

                <div className="mt-4 border-t border-edge/60 pt-3">
                  <p className="label mb-2">Proof</p>
                  <ul className="flex flex-wrap gap-1.5">
                    {s.proof.map((p) => (
                      <li
                        key={p}
                        className="mono rounded border border-edge bg-panel-2/60 px-2 py-1 text-[10px] uppercase tracking-[0.1em] text-muted"
                      >
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </Section>
  );
}
