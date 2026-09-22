import { STUDIO } from "@/data/studio";

export default function Footer() {
  return (
    <footer className="relative border-t border-edge/70 bg-abyss">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-6 px-5 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="font-display text-xl leading-none">
            GLITCH<span className="text-muted"> GAMES</span>
          </p>
          <p className="mono mt-2 text-[11px] uppercase tracking-[0.16em] text-muted">
            {STUDIO.name} · {STUDIO.location}
          </p>
        </div>

        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
          <a
            href={STUDIO.stores.play}
            target="_blank"
            rel="noopener noreferrer"
            className="mono text-[11px] uppercase tracking-[0.14em] text-muted transition-colors hover:text-cyan"
          >
            Google Play
          </a>
          <a
            href={STUDIO.stores.apple}
            target="_blank"
            rel="noopener noreferrer"
            className="mono text-[11px] uppercase tracking-[0.14em] text-muted transition-colors hover:text-cyan"
          >
            App Store
          </a>
          <a
            href={`mailto:${STUDIO.emails.partner}`}
            className="mono text-[11px] uppercase tracking-[0.14em] text-muted transition-colors hover:text-cyan"
          >
            Partnerships
          </a>
          <a
            href={`mailto:${STUDIO.emails.studio}`}
            className="mono text-[11px] uppercase tracking-[0.14em] text-muted transition-colors hover:text-cyan"
          >
            Studio
          </a>
        </nav>

        <p className="mono text-[11px] tracking-[0.14em] text-muted">
          © {new Date().getFullYear()} {STUDIO.name}
        </p>
      </div>
    </footer>
  );
}
