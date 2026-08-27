import { Link } from "react-router"

import { ButtonLink, EditorialRail, Page, Section } from "@palamedes/site-ui"
import { CtaBand } from "~/components/home/CtaBand"
import { FrameworkPackageStats } from "~/components/frameworks/FrameworkPackageStats"
import type { FrameworkLanding, FrameworkLandingFact } from "~/data/framework-landing"
import { STRATEGY_CARDS } from "~/data/features"
import { docsHref } from "~/data/links"
import { cellFor } from "~/data/matrix"

function Facts({ facts }: { facts: FrameworkLandingFact[] }) {
  return (
    <dl className="hairline-grid grid-cols-4 max-grid:grid-cols-2 max-tight:grid-cols-1">
      {facts.map((fact) => (
        <div key={fact.label} className="bg-paper px-5 py-5">
          <dt className="micro text-[10px] tracking-label text-gray-spec">{fact.label}</dt>
          <dd className="mono-nums mt-2 text-[17px] text-accent">{fact.value}</dd>
          <p className="mt-2 text-[12.5px] leading-relaxed text-ink/85">{fact.note}</p>
        </div>
      ))}
    </dl>
  )
}

function StrategyGrid({ page }: { page: FrameworkLanding }) {
  const matrixSlug = page.strategies.matrixSlug

  return (
    <div className="hairline-grid grid-cols-4 max-grid:grid-cols-2 max-tight:grid-cols-1">
      {STRATEGY_CARDS.map((strategy) => {
        const cell = matrixSlug ? cellFor(matrixSlug, strategy.slug) : undefined
        return (
          <div key={strategy.title} className="bg-paper px-5 py-5">
            <h3 className="text-[15px] font-bold">{strategy.title}</h3>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink/85">{strategy.body}</p>
            {cell ? (
              <p className="mono-nums mt-4 flex flex-wrap gap-3 text-[11px]">
                {cell.demoLinks?.[0] ? (
                  <a href={cell.demoLinks[0].href} className="text-accent hover:text-ink">
                    <span aria-hidden>{cell.status === "live" ? "● " : "◌ "}</span>open demo
                    {cell.status === "provisioning" ? (
                      <span className="sr-only"> (host pending)</span>
                    ) : null}
                  </a>
                ) : (
                  <span className="text-gray-spec">◌ local / CI</span>
                )}
                <a href={cell.sourceHref} className="text-gray-spec hover:text-accent">
                  source →
                </a>
              </p>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

export function FrameworkLandingPage({ page }: { page: FrameworkLanding }) {
  return (
    <Page>
      <section className="px-8 pt-16 pb-14 max-tight:px-5">
        <p className="eyebrow">{page.eyebrow}</p>
        <h1 className="mt-6 max-w-[15em] text-display leading-[0.98] font-bold tracking-[-0.03em] text-balance">
          {page.headline}
        </h1>
        <p className="mt-6 max-w-[44em]">{page.lede}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href={page.primary.href}>{page.primary.label}</ButtonLink>
          <ButtonLink variant="outline" href={page.secondary.href}>
            {page.secondary.label}
          </ButtonLink>
        </div>
        <div className="mt-12">
          <Facts facts={page.facts} />
          <FrameworkPackageStats path={page.path} />
        </div>
      </section>

      <Section num="01 — The framework problem" title={page.problem.title} lede={page.problem.lede}>
        <EditorialRail>
          <p className="micro text-[10px] tracking-label text-gray-spec">
            What the integration has to get right
          </p>
          <ul className="mt-3 space-y-2">
            {page.problem.points.map((point) => (
              <li
                key={point}
                className="flex max-w-[56em] gap-2.5 text-[13.5px] leading-relaxed text-ink/85"
              >
                <span aria-hidden className="mono-nums text-gray-spec">
                  ·
                </span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </EditorialRail>
      </Section>

      <Section num="02 — The Palamedes model" title={page.approach.title} lede={page.approach.lede}>
        <div className="hairline-grid grid-cols-3 max-grid:grid-cols-2 max-tight:grid-cols-1">
          {page.approach.points.map((point) => (
            <div key={point.title} className="bg-paper px-6 py-6">
              <h3 className="text-[15px] font-bold">{point.title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink/85">{point.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section num="03 — In TypeScript" title={page.code.caption}>
        <div className="border border-hair bg-paper">
          <p className="micro border-b border-hair px-5 py-3 text-[10px] tracking-label text-gray-spec">
            {page.code.label}
          </p>
          <pre
            className="overflow-x-auto bg-ink px-5 py-4 font-mono text-[12.5px] leading-[1.7] text-paper/85 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-paper"
            tabIndex={0}
          >
            <code>{page.code.source}</code>
          </pre>
        </div>
        <p className="mt-4 max-w-[54em] text-[13.5px] leading-relaxed text-ink/85">
          {page.code.note}
        </p>
      </Section>

      <Section
        num="04 — Locale strategy"
        title={`Choose the URL model that fits your ${page.name} product.`}
        lede={page.strategies.lede}
      >
        <StrategyGrid page={page} />
        <Link
          to="/locale-routing"
          viewTransition
          className="mono-nums mt-6 inline-block text-[13px] text-accent"
        >
          Compare the four locale strategies →
        </Link>
      </Section>

      <Section num="05 — Proof and boundaries" title={page.proof.title} lede={page.proof.lede}>
        <Facts facts={page.proof.facts} />
        <EditorialRail tone="emphasis" className="mt-8">
          <h3 className="text-[15px] font-bold">{page.boundary.title}</h3>
          <p className="mt-2 max-w-[56em] text-[13.5px] leading-relaxed text-ink/85">
            {page.boundary.body}
          </p>
          {page.boundary.link ? (
            <ButtonLink variant="small" className="mt-4" href={page.boundary.link.href}>
              {page.boundary.link.label}
            </ButtonLink>
          ) : null}
        </EditorialRail>
      </Section>

      <Section
        num="06 — Questions"
        id="faq"
        title={`${page.name} i18n questions, answered`}
        lede="The short version of the decisions that usually block an implementation."
      >
        <dl className="border border-hair">
          {page.faq.map((entry, index) => (
            <div
              key={entry.q}
              className={`px-6 py-5 max-tight:px-4 ${index > 0 ? "border-t border-hair" : ""}`}
            >
              <dt className="text-[15px] font-bold">{entry.q}</dt>
              <dd className="mt-2 max-w-[58em] text-[13.5px] leading-relaxed text-ink/85">
                {entry.a}
              </dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section num="07 — Keep exploring" title="See how the same model meets a different host.">
        <div className="hairline-grid grid-cols-3 max-tight:grid-cols-1">
          {page.related.map((related) => (
            <Link
              key={related.href}
              to={related.href}
              viewTransition
              className="group bg-paper px-6 py-5 transition-colors hover:bg-hover-fill"
            >
              <p className="text-[14px] font-bold group-hover:text-accent">{related.label}</p>
              <span className="micro mt-2 inline-block text-[12px] text-accent">Open page →</span>
            </Link>
          ))}
        </div>
        <a
          href={docsHref("framework-example-notes")}
          className="mono-nums mt-6 inline-block text-[13px] text-accent"
        >
          Read the framework verification notes →
        </a>
      </Section>

      <CtaBand
        headline={page.finalCta.headline}
        primary={page.finalCta.primary}
        secondary={page.finalCta.secondary}
      />
    </Page>
  )
}
