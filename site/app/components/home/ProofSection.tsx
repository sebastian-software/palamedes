import { ArdoLink as Link } from "ardo/runtime";

import { Band, BandHeader } from "~/components/marketing/Band";
import contentStats from "~/data/generated/content-stats.json";
import { decisionHref, REPO } from "~/data/links";

/*
 * Counts come from generated repository stats, so they move with the example
 * inventory and the decision trail instead of being retyped here.
 */
const FIGURES = [
  {
    value: contentStats.demoCount,
    label: "example applications, built and smoke-checked in the production image",
  },
  {
    value: contentStats.demoCount,
    label: "of them checked in a real browser: language switching, formatting, and lazy catalogs",
  },
  {
    value: contentStats.adrCount,
    label: "written design decisions, including the alternatives that were rejected",
  },
] as const;

const LINKS = [
  { label: "The verified app matrix", href: "/frameworks#frontend-frameworks", internal: true },
  { label: "How everything is verified", href: "/proof", internal: true },
  { label: "The decision trail", href: decisionHref(), internal: true },
  { label: "Stability and release discipline", href: "/docs/stability", internal: false },
  { label: "The source on GitHub", href: REPO, internal: false },
] as const;

export function ProofSection() {
  return (
    <Band labelledBy="proof-title">
      <BandHeader
        id="proof-title"
        kicker="The receipts"
        title="Don’t take our word for it."
        lede="Every claim on this page points to something you can run, read, or re-check. The framework support is made of real applications, one per framework and URL shape — not a wall of logos."
      />
      <ul className="mt-14 grid grid-cols-1 gap-px border border-hair bg-hair md:grid-cols-3">
        {FIGURES.map((figure, index) => (
          <li key={figure.label} className="bg-paper">
            <p className="px-6 py-7">
              <span className="mono-nums block text-[clamp(2.75rem,5vw,4rem)] leading-none font-medium tracking-[-0.03em] text-accent">
                {figure.value}
              </span>
              <span className="mt-4 block text-[15.5px] leading-relaxed text-ink/80">
                {figure.label}
              </span>
            </p>
          </li>
        ))}
      </ul>
      <ul className="mt-10 flex flex-wrap gap-x-8 gap-y-1">
        {LINKS.map((link) => (
          <li key={link.href}>
            {link.internal ? (
              <Link to={link.href} className="pmds-arrow-link">
                {link.label} →
              </Link>
            ) : (
              <a href={link.href} className="pmds-arrow-link">
                {link.label} →
              </a>
            )}
          </li>
        ))}
      </ul>
    </Band>
  );
}
