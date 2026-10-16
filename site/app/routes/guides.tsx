import { Link } from "react-router";

import { ButtonLink, Page, Section } from "@palamedes/site-ui";
import { PageHero } from "~/components/marketing/PageHero";
import { CtaBand } from "~/components/home/CtaBand";
import { StreamlineIcon } from "~/components/icons/StreamlineIcon";
import { docsHref } from "~/data/links";
import { TOPICS } from "~/data/topics";
import { pageMeta } from "~/lib/meta";

export const handle = { layout: "bare" };

export function meta() {
  return pageMeta({
    title: "Palamedes guides — server components, ICU, locale routing and performance",
    description:
      "Guides to the decisions that actually cost you time in a TypeScript i18n project: server-component rendering, ICU MessageFormat, locale routing strategies, and extraction performance. Each one is backed by something checked into the repository.",
    path: "/guides",
  });
}

/*
 * The hub exists so topic pages have one home as their number grows, rather
 * than four footer entries that would become twelve. It is also a plain
 * crawlable index — every guide is one link from here and from the footer.
 */
export default function Guides() {
  return (
    <Page>
      <PageHero
        kicker="Guides"
        title="The decisions that actually cost you time."
        lede="Four questions get expensive when a TypeScript i18n project answers them late: server components, message syntax, URL strategy, and build speed. Each guide explains the choice in plain terms and backs it with something you can re-run."
        actions={
          <>
            <ButtonLink href="/get-started">Follow the guided quickstart</ButtonLink>
            <ButtonLink variant="outline" href={docsHref()}>
              Browse the documentation
            </ButtonLink>
          </>
        }
      />

      <Section
        num="01 — Guides"
        title="Start with the one that is biting you."
        lede="Each page names the problem in the terms you would recognize it by, then the approach, then the evidence, then the questions people ask afterwards."
      >
        <div className="hairline-grid grid-cols-2 max-tight:grid-cols-1">
          {TOPICS.map((topic) => (
            <Link
              key={topic.slug}
              to={`/${topic.slug}`}
              viewTransition
              className="group bg-paper px-7 py-8 transition-colors hover:bg-hover-fill"
            >
              <div className="flex items-start justify-between gap-4">
                <p className="micro text-[11px] tracking-label text-accent">{topic.eyebrow}</p>
                <StreamlineIcon name={topic.icon} />
              </div>
              <h2 className="mt-4 text-[21px] leading-snug font-bold tracking-[-0.01em] group-hover:text-accent">
                {topic.headline}
              </h2>
              <p className="mt-3 text-[16px] leading-relaxed text-ink/80">{topic.problem.title}</p>
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
            className="group bg-paper px-7 py-7 transition-colors hover:bg-hover-fill"
          >
            <p className="text-[17px] font-bold group-hover:text-accent">
              Weighing Palamedes against another library
            </p>
            <p className="mt-2 text-[15px] leading-relaxed text-ink/80">
              Eight head-to-head comparisons, each opening with what the other project does better.
            </p>
          </Link>
          <Link
            to="/proof"
            viewTransition
            className="group bg-paper px-7 py-7 transition-colors hover:bg-hover-fill"
          >
            <p className="text-[17px] font-bold group-hover:text-accent">
              Checking the claims yourself
            </p>
            <p className="mt-2 text-[15px] leading-relaxed text-ink/80">
              Benchmarks, the ICU proof, the verified example matrix and the decision records.
            </p>
          </Link>
          <a
            href={docsHref()}
            className="group bg-paper px-7 py-7 transition-colors hover:bg-hover-fill"
          >
            <p className="text-[17px] font-bold group-hover:text-accent">
              Implementing something specific
            </p>
            <p className="mt-2 text-[15px] leading-relaxed text-ink/80">
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
  );
}
