import type { ReactNode } from "react";

export function SectionHead({
  index,
  kicker,
  title,
  lead,
  accent = "cyan",
}: {
  index: string;
  kicker: string;
  title: string;
  lead?: ReactNode;
  accent?: "cyan" | "magenta" | "lime" | "violet";
}) {
  const bar = {
    cyan: "bg-cyan",
    magenta: "bg-magenta",
    lime: "bg-lime",
    violet: "bg-violet",
  }[accent];

  return (
    <header className="mb-10 sm:mb-14">
      <div className="mb-4 flex items-center gap-3">
        <span className={`h-3 w-1.5 rounded-full ${bar}`} />
        <span className="label">{kicker}</span>
        <span className="mono ml-auto text-[11px] tracking-[0.2em] text-muted">
          {"// "}
          {index}
        </span>
      </div>
      <h2
        className="glitch font-display text-[clamp(2.1rem,6.4vw,4.4rem)] leading-[0.92]"
        data-text={title}
      >
        {title}
      </h2>
      {lead && (
        <p className="mt-4 max-w-2xl text-pretty text-base leading-relaxed text-muted sm:text-lg">
          {lead}
        </p>
      )}
    </header>
  );
}

export function Section({
  id,
  children,
  className = "",
}: {
  id: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={`relative mx-auto w-full max-w-[1400px] scroll-mt-20 px-5 py-20 sm:px-6 sm:py-28 ${className}`}
    >
      {children}
    </section>
  );
}
