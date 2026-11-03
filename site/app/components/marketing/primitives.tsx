import { ArdoContentContainer } from "ardo/ui";
import type { ReactNode } from "ardo/react";
import { ArdoLink } from "ardo/runtime";

export function Page({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`pmds-page ${className}`}>{children}</div>;
}

export function ButtonLink({
  href,
  children,
  variant = "primary",
  className = "",
  ariaLabel,
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "outline" | "small";
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <ArdoLink
      to={href}
      aria-label={ariaLabel}
      className={`pmds-button pmds-button--${variant} ${className}`}
    >
      {children}
    </ArdoLink>
  );
}

export function EditorialRail({
  children,
  tone = "structural",
  className = "",
}: {
  children: ReactNode;
  tone?: "structural" | "emphasis";
  className?: string;
}) {
  return (
    <aside className={`pmds-editorial-rail pmds-editorial-rail--${tone} ${className}`}>
      {children}
    </aside>
  );
}

export function Section({
  num,
  title,
  eyebrow,
  lede,
  id,
  children,
}: {
  num?: string;
  title?: ReactNode;
  eyebrow?: string;
  lede?: ReactNode;
  id?: string;
  children?: ReactNode;
}) {
  return (
    <section id={id} className="pmds-section">
      <ArdoContentContainer>
        {num ? <p className="pmds-kicker pmds-section-number">{num}</p> : null}
        {eyebrow ? <p className="pmds-kicker">{eyebrow}</p> : null}
        {title ? <h2 className="pmds-title">{title}</h2> : null}
        {lede ? <p className="pmds-lede">{lede}</p> : null}
        {children ? <div className="mt-10">{children}</div> : null}
      </ArdoContentContainer>
    </section>
  );
}
