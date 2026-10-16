import { Reveal } from "@palamedes/site-ui";
import type { ReactNode } from "react";

export type BandTone = "paper" | "parchment" | "navy";

/*
 * A full-width marketing band. Tone carries the page rhythm — paper for
 * explanation, parchment for context, navy for the few statements that should
 * stop the scroll. Content is centered on one shared measure by padding, so
 * bands need no inner wrapper and subpage sections can share the same rule.
 */
export function Band({
  id,
  tone = "paper",
  label,
  labelledBy,
  className = "",
  children,
}: {
  id?: string;
  tone?: BandTone;
  label?: string;
  labelledBy?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-label={label}
      aria-labelledby={labelledBy}
      className={`pmds-band pmds-band--${tone} ${className}`}
    >
      {children}
    </section>
  );
}

export function BandHeader({
  id,
  kicker,
  title,
  lede,
  center = false,
  children,
}: {
  id?: string;
  kicker?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  center?: boolean;
  children?: ReactNode;
}) {
  return (
    <Reveal>
      <header className={`pmds-band-header${center ? " pmds-band-header--center" : ""}`}>
        {kicker ? <p className="pmds-kicker">{kicker}</p> : null}
        <h2 id={id} className="pmds-title">
          {title}
        </h2>
        {lede ? <p className="pmds-lede">{lede}</p> : null}
        {children}
      </header>
    </Reveal>
  );
}
