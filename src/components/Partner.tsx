"use client";

import { DISCIPLINES, STUDIO } from "@/data/studio";
import { spriteSrc } from "@/data/characters";
import { sfx } from "@/lib/audio";
import { Section, SectionHead } from "./Section";
import { Coin } from "./GameUi";

export default function Partner() {
  return (
    <Section id="partner" className="pb-10">
      <SectionHead
        index="07"
        kicker="The team"
        title="JOIN THE PARTY"
        accent="magenta"
        lead="A small local studio with agility. Five disciplines, one room, no outsourcing — which is what makes the ship cadence possible."
      />

      {/* ---------------- party roster ---------------- */}
      <ul className="mb-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:gap-4">
        {DISCIPLINES.map((d, i) => (
          <li
            key={d.role}
            data-solid=""
            className="panel group relative flex items-center gap-3 overflow-hidden p-4 transition-transform duration-300 hover:-translate-y-1 lg:flex-col lg:items-start"
          >
            <span aria-hidden="true" className="mono absolute right-3 top-3 text-[10px] text-muted/40">
              0{i + 1}
            </span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={spriteSrc(d.char)}
              alt=""
              loading="lazy"
              className="sprite h-[72px] w-auto shrink-0 transition-transform duration-300 group-hover:-translate-y-1 lg:h-[96px]"
            />
            <div>
              <h3 className="font-display text-base leading-tight">{d.role}</h3>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
                {d.body}
              </p>
            </div>
          </li>
        ))}
      </ul>

      {/* ---------------- contact ---------------- */}
      <div className="relative grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <Coin id="partner" label="the contact panel" className="-top-4 left-8" />

        <div className="panel scanlines relative overflow-hidden p-6 sm:p-9">
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
              className="group inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan to-violet px-5 py-3.5 font-display text-sm tracking-wide text-void transition-transform duration-200 hover:scale-[1.04] active:scale-95"
            >
              PITCH US
              <span className="transition-transform group-hover:translate-x-1">
                →
              </span>
            </a>
            <a
              href={`mailto:${STUDIO.emails.studio}`}
              onMouseEnter={() => sfx.hover()}
              className="inline-flex items-center rounded-lg border border-edge bg-panel/70 px-5 py-3.5 font-display text-sm tracking-wide transition-colors hover:border-lime hover:text-lime"
            >
              GENERAL ENQUIRIES
            </a>
          </div>

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

        {/* store rail */}
        <div className="panel flex flex-col gap-4 p-6 sm:p-7">
          <p className="label">Play the catalogue</p>
          <a
            href={STUDIO.stores.play}
            target="_blank"
            rel="noopener noreferrer"
            onMouseEnter={() => sfx.hover()}
            className="group flex items-center gap-4 rounded-xl border border-edge bg-panel-2/50 p-4 transition-colors hover:border-lime"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-lime to-cyan text-void">
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
            <span className="ml-auto text-muted transition-transform group-hover:translate-x-1">
              →
            </span>
          </a>

          <a
            href={STUDIO.stores.apple}
            target="_blank"
            rel="noopener noreferrer"
            onMouseEnter={() => sfx.hover()}
            className="group flex items-center gap-4 rounded-xl border border-edge bg-panel-2/50 p-4 transition-colors hover:border-cyan"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-ink to-muted text-void">
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
            <span className="ml-auto text-muted transition-transform group-hover:translate-x-1">
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
    </Section>
  );
}
