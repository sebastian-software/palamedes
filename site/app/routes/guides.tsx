import { Link } from "react-router"

import { ButtonLink } from "~/components/chrome/Button"
import { Page } from "~/components/chrome/Page"
import { Section } from "~/components/chrome/Section"
import { CtaBand } from "~/components/home/CtaBand"
import { docsHref } from "~/data/links"
import { TOPICS } from "~/data/topics"
import { pageMeta } from "~/lib/meta"

export const handle = { layout: "bare" }

export function meta() {
  return pageMeta({
    title: "Palamedes guides — server components, ICU, locale routing and performance",
    description:
      "Guides to the decisions that actually cost you time in a JavaScript i18n project: server-component rendering, ICU MessageFormat, locale routing strategies, and extraction performance. Each one is backed by something checked into the repository.",
    path: "/guides",
  })
}

/*
 * The hub exists so topic pages have one home as their number grows, rather
 * than four footer entries that would become twelve. It is also a plain
 * crawlable index — every guide is one link from here and from the footer.
 */
export default function Guides() {
  return (
    <Page>
      <section className="px-8 pt-16 pb-14 max-tight:px-5">
        <p className="eyebrow">Guides</p>
        <h1 className="mt-6 max-w-[13em] text-display leading-[0.98] font-bold tracking-[-0.03em] text-balance">
          The decisions that actually cost you time.
        </h1>
        <p className="mt-6 max-w-[42em]">
          Not a tutorial index. These are the four questions that get expensive when answered late
          in a JavaScript i18n project — and each answer here is anchored to something you can
          re-run from the repository rather than to an opinion.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="/get-started">Try the 5-minute quickstart</ButtonLink>
          <ButtonLink variant="outline" href={docsHref()}>
            Browse the documentation
          </ButtonLink>
        </div>
      </section>

      <Section
        num="01 — Guides"
        title="Start with the one that is biting you."
        lede="Each page names the problem in the terms you would recognise it by, then the approach, then the evidence, then the questions people ask afterwards."
      >
        <div className="hairline-grid grid-cols-2 max-tight:grid-cols-1">
          {TOPICS.map((topic) => (
            <Link
              key={topic.slug}
              to={`/${topic.slug}`}
              viewTransition
              className="group bg-paper px-6 py-6 transition-colors hover:bg-hover-fill"
            >
              <p className="micro text-[10px] tracking-label text-gray-spec">{topic.eyebrow}</p>
              <h2 className="mt-3 text-[17px] font-bold group-hover:text-accent">
                {topic.headline}
              </h2>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink/85">
                {topic.problem.title}
              </p>
              <span className="micro mt-4 inline-block text-[12px] text-accent">
                Read the guide →
              </span>
            </Link>
          ))}
        </div>
      </Section>

      <Section
        num="02 — Elsewhere"
        title="Looking for something else?"
        lede="Guides answer a question. These answer a different kind."
      >
        <div className="hairline-grid grid-cols-3 max-tight:grid-cols-1">
          <Link
            to="/compare"
            viewTransition
            className="group bg-paper px-6 py-5 transition-colors hover:bg-hover-fill"
          >
            <p className="text-[14px] font-bold group-hover:text-accent">
              Weighing Palamedes against another library
            </p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink/85">
              Eight head-to-head comparisons, each opening with what the other project does better.
            </p>
          </Link>
          <Link
            to="/proof"
            viewTransition
            className="group bg-paper px-6 py-5 transition-colors hover:bg-hover-fill"
          >
            <p className="text-[14px] font-bold group-hover:text-accent">
              Checking the claims yourself
            </p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink/85">
              Benchmarks, the ICU proof, the verified example matrix and the decision records.
            </p>
          </Link>
          <a
            href={docsHref()}
            className="group bg-paper px-6 py-5 transition-colors hover:bg-hover-fill"
          >
            <p className="text-[14px] font-bold group-hover:text-accent">
              Implementing something specific
            </p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink/85">
              The reference documentation: configuration, CLI, API and troubleshooting.
            </p>
          </a>
        </div>
      </Section>

      <CtaBand
        headline="Every guide is backed by something you can re-run."
        primary={{ label: "See the proof", href: "/proof" }}
        secondary={{ label: "Get started", href: "/get-started" }}
      />
    </Page>
  )
}
