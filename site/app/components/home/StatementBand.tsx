import type { ReactNode } from "react";

/*
 * A navy statement band for the one sentence a page most wants remembered —
 * an honest trade-off, a position. The meander marks the break in rhythm.
 */
export function StatementBand({
  num,
  href,
  children,
}: {
  num: string;
  /** Optional route to the detailed evidence behind this statement. */
  href?: string;
  children: ReactNode;
}) {
  return (
    <section className="pmds-band pmds-band--mist relative" aria-label={num}>
      <div className="meander absolute inset-x-0 top-0" aria-hidden />
      <p className="pmds-kicker">{num}</p>
      <p className="mt-8 max-w-[48rem] text-[clamp(1.25rem,1rem+1vw,1.85rem)] leading-[1.5] text-ink/90">
        {children}
      </p>
      {href ? (
        <a href={href} className="pmds-arrow-link mt-8">
          Inspect the evidence →
        </a>
      ) : null}
    </section>
  );
}
