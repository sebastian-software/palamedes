import type { ReactNode } from "react";

/*
 * The opening of every marketing subpage: a kicker that names the page's job,
 * an inscription-scale headline, one plain-language paragraph, and the actions
 * that answer the visitor's entry question. An optional aside carries the
 * page's own specimen or summary beside the copy on wide screens.
 */
export function PageHero({
  kicker,
  title,
  lede,
  actions,
  aside,
  children,
}: {
  kicker: ReactNode;
  title: ReactNode;
  lede: ReactNode;
  actions?: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="pmds-page-hero">
      <div
        className={
          aside
            ? "grid grid-cols-1 items-start gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,1fr)]"
            : undefined
        }
      >
        <div className="max-w-[52rem]">
          <p className="pmds-kicker">{kicker}</p>
          <h1 className="pmds-page-title">{title}</h1>
          <p className="pmds-page-lede">{lede}</p>
          {actions ? <div className="mt-9 flex flex-wrap gap-3">{actions}</div> : null}
          {children}
        </div>
        {aside ? <div className="min-w-0">{aside}</div> : null}
      </div>
    </section>
  );
}
