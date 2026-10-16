import { Link } from "react-router";

import { ButtonLink, EditorialRail, Page, Section } from "@palamedes/site-ui";
import { CtaBand } from "~/components/home/CtaBand";
import { PageHero } from "~/components/marketing/PageHero";
import { BenchmarkLedger } from "~/components/proof/BenchmarkLedger";
import { BENCH_REALISTIC, BENCH_REALISTIC_WARM } from "~/data/bench";
import type { Topic } from "~/data/topics";

/*
 * One layout for every topic landing page, driven by data/topics.ts.
 *
 * Search-intent pages, so the order follows the reader rather than the
 * product: name the problem in their words first, including the symptoms they
 * would recognize, then the answer, then the evidence, then the questions they
 * were going to ask anyway. The FAQ is rendered, not just marked up — hidden
 * answers behind visible schema is how structured data gets ignored.
 */
export function TopicPage({ topic }: { topic: Topic }) {
  return (
    <Page>
      <PageHero
        kicker={topic.eyebrow}
        title={topic.headline}
        lede={topic.lede}
        actions={
          <>
            <ButtonLink href="/get-started">Try the guided quickstart</ButtonLink>
            <ButtonLink variant="outline" href="#faq">
              Jump to the questions
            </ButtonLink>
          </>
        }
      />

      <Section num="01 — The problem" title={topic.problem.title} lede={topic.problem.body}>
        <EditorialRail>
          <p className="micro text-[11px] tracking-label text-gray-spec">
            You are probably here because
          </p>
          <ul className="mt-3 space-y-2">
            {topic.problem.symptoms.map((symptom) => (
              <li
                key={symptom}
                className="flex max-w-[54em] gap-2.5 text-[16px] leading-relaxed text-ink/85"
              >
                <span aria-hidden className="mono-nums text-gray-spec">
                  ·
                </span>
                <span>{symptom}</span>
              </li>
            ))}
          </ul>
        </EditorialRail>
      </Section>

      <Section num="02 — The approach" title={topic.answer.title} lede={topic.answer.lede}>
        <div
          className={`hairline-grid ${
            topic.answer.points.length % 3 === 0 ? "grid-cols-3" : "grid-cols-2"
          } max-grid:grid-cols-2 max-tight:grid-cols-1`}
        >
          {topic.answer.points.map((point) => (
            <div key={point.title} className="bg-paper px-7 py-7">
              <h3 className="text-[18px] leading-snug font-bold">{point.title}</h3>
              <p className="mt-2 text-[15.5px] leading-relaxed text-ink/80">{point.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {topic.code ? (
        <Section num="03 — In code" title={topic.code.caption}>
          <div className="bg-paper">
            <p className="micro border-b border-hair px-5 py-3 text-[10px] tracking-label text-gray-spec">
              {topic.code.label}
            </p>
            <pre
              className="pmds-code overflow-x-auto border-0 px-5 py-4 font-mono text-[12.5px] leading-[1.7] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
              tabIndex={0}
            >
              {topic.code.code}
            </pre>
          </div>
          <p className="mt-5 max-w-[48em] text-[16px] leading-relaxed text-ink/80">
            {topic.code.note}
          </p>
        </Section>
      ) : null}

      <Section
        num={topic.code ? "04 — Evidence" : "03 — Evidence"}
        title={topic.evidence.title}
        lede={topic.evidence.lede}
      >
        {topic.evidence.chart ? (
          <BenchmarkLedger corpus={BENCH_REALISTIC} warm={BENCH_REALISTIC_WARM} />
        ) : (
          <dl className="hairline-grid grid-cols-4 max-grid:grid-cols-2 max-tight:grid-cols-1">
            {topic.evidence.items.map((item) => (
              <div key={item.label} className="bg-paper px-5 py-5">
                <dt className="micro text-[11px] tracking-label text-gray-spec">{item.label}</dt>
                <dd>
                  <span className="mono-nums mt-3 block text-[24px] text-accent">{item.value}</span>
                  <span className="mt-2 block text-[14.5px] leading-relaxed text-ink/80">
                    {item.note}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        )}
        <a href={topic.evidence.href} className="pmds-arrow-link mt-6">
          {topic.evidence.hrefLabel} →
        </a>
      </Section>

      <Section
        num={topic.code ? "05 — Questions" : "04 — Questions"}
        id="faq"
        title="Questions people actually ask"
        lede="Answered here rather than buried three pages into the documentation."
      >
        <dl className="border border-hair">
          {topic.faq.map((entry, index) => (
            <div
              key={entry.q}
              className={`px-7 py-6 max-tight:px-4 ${index > 0 ? "border-t border-hair" : ""}`}
            >
              <dt className="text-[18px] leading-snug font-bold">{entry.q}</dt>
              <dd className="mt-2 max-w-[48em] text-[16px] leading-relaxed text-ink/80">
                {entry.a}
              </dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section num={topic.code ? "06 — Keep reading" : "05 — Keep reading"} title="Related pages">
        <div className="hairline-grid grid-cols-3 max-tight:grid-cols-1">
          {/* Two topical links plus the hub: keeps the row full at three and
              guarantees every guide has a path back to the index. */}
          {[...topic.related.slice(0, 2), { label: "All guides", href: "/guides" }].map((link) => (
            <Link
              key={link.href}
              to={link.href}
              viewTransition
              className="group bg-paper px-7 py-7 transition-colors hover:bg-hover-fill"
            >
              <p className="text-[18px] leading-snug font-bold group-hover:text-accent">
                {link.label}
              </p>
              <span className="micro mt-3 inline-block text-[11px] tracking-label text-accent">
                Read →
              </span>
            </Link>
          ))}
        </div>
      </Section>

      <CtaBand
        headline="Every claim on this page is checked into the repository."
        primary={{ label: "See the proof", href: "/proof" }}
        secondary={{ label: "Try the guided quickstart", href: "/get-started" }}
      />
    </Page>
  );
}
