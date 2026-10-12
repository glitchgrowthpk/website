import { STUDIO } from "@/data/studio";
import { Coin } from "./GameUi";

const LINK =
  "mono inline-flex min-h-10 items-center text-[11px] uppercase tracking-[0.14em] text-muted transition-colors hover:text-cyan";

/** An 8×8 pixel-art up arrow. */
function PixelArrow() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 8 8"
      shapeRendering="crispEdges"
      fill="currentColor"
      aria-hidden="true"
      className="transition-[translate] duration-200 ease-[var(--ease-pop)] group-hover:-translate-y-1 group-focus-visible:-translate-y-1"
    >
      <rect x="3" y="0" width="2" height="1" />
      <rect x="2" y="1" width="4" height="1" />
      <rect x="1" y="2" width="6" height="1" />
      <rect x="0" y="3" width="8" height="1" />
      <rect x="3" y="4" width="2" height="4" />
    </svg>
  );
}

export default function Footer() {
  return (
    <footer className="relative border-t border-edge/70 bg-abyss">
      <Coin
        id="footer"
        label="the footer"
        className="right-[8%] top-5 md:-top-[18px] md:right-[30%]"
      />

      <div className="mx-auto flex max-w-[1400px] flex-col gap-6 px-5 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="font-display text-xl leading-none">
            GLITCH<span className="text-muted"> GAMES</span>
          </p>
          <p className="mono mt-2 text-[11px] uppercase tracking-[0.16em] text-muted">
            {STUDIO.name} · {STUDIO.location}
          </p>
        </div>

        <nav aria-label="Footer" className="flex flex-wrap gap-x-5">
          <a
            href={STUDIO.stores.play}
            target="_blank"
            rel="noopener noreferrer"
            className={LINK}
          >
            Google Play
          </a>
          <a
            href={STUDIO.stores.apple}
            target="_blank"
            rel="noopener noreferrer"
            className={LINK}
          >
            App Store
          </a>
          <a href={`mailto:${STUDIO.emails.partner}`} className={LINK}>
            Partnerships
          </a>
          <a href={`mailto:${STUDIO.emails.studio}`} className={LINK}>
            Studio
          </a>
        </nav>

        <div className="flex flex-col items-start gap-1 md:items-end">
          <a
            href="#top"
            data-cursor="TOP"
            className="group mono inline-flex min-h-10 items-center gap-2 rounded-md border border-edge bg-panel/60 px-3 text-[11px] uppercase tracking-[0.18em] text-ink transition-colors hover:border-lime hover:text-lime"
          >
            <PixelArrow />
            Back to start
          </a>
          <p className="mono text-[11px] tracking-[0.14em] text-muted">
            © {new Date().getFullYear()} {STUDIO.name}
          </p>
        </div>
      </div>
    </footer>
  );
}
