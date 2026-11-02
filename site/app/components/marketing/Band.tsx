import type { ReactNode } from "ardo/react";

export type BandTone = "paper" | "parchment";

/** Product-content section; spacing and optional tone stay local to this site. */
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
    <div>
      <header className={`pmds-band-header${center ? " pmds-band-header--center" : ""}`}>
        {kicker ? <p className="pmds-kicker">{kicker}</p> : null}
        <h2 id={id} className="pmds-title">
          {title}
        </h2>
        {lede ? <p className="pmds-lede">{lede}</p> : null}
        {children}
      </header>
    </div>
  );
}
