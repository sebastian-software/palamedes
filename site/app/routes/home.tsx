import { ButtonLink, Page, Section } from "@palamedes/site-ui"
import { FrameworkMatrix } from "~/components/frameworks/FrameworkMatrix"
import { CodeShowcase } from "~/components/home/CodeShowcase"
import { CompleteProof } from "~/components/home/CompleteProof"
import { CtaBand } from "~/components/home/CtaBand"
import { BenchmarkCommand } from "~/components/home/BenchmarkCommand"
import { HomeHero } from "~/components/home/HomeHero"
import { HomeFaq, HOME_FAQ } from "~/components/home/HomeFaq"
import { IntegrationBand } from "~/components/home/IntegrationBand"
import { ProofStrip } from "~/components/home/ProofStrip"
import { QuickInstall } from "~/components/home/QuickInstall"
import { QuestionRoutes } from "~/components/home/QuestionRoutes"
import { StatementBand } from "~/components/home/StatementBand"
import { BenchmarkLedger } from "~/components/proof/BenchmarkLedger"
import { BENCH_REALISTIC, BENCH_REALISTIC_WARM } from "~/data/bench"
import contentStats from "~/data/generated/content-stats.json"
import { decisionHref, REPO } from "~/data/links"
import { pageMeta } from "~/lib/meta"

export const handle = { layout: "bare" }

export function meta() {
  const title = "Palamedes — a durable i18n foundation for TypeScript"
  const description =
    "A clear, complete, and fast TypeScript i18n foundation with source-local messages, repository-owned catalogs, native tooling, and first-party integrations for modern frameworks."

  return [
    ...pageMeta({ title, description, path: "/" }),
    {
      "script:ld+json": {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: HOME_FAQ.map((entry) => ({
          "@type": "Question",
          name: entry.q,
          acceptedAnswer: { "@type": "Answer", text: entry.a },
        })),
      },
    },
  ]
}

export default function Home() {
  return (
    <Page>
      <HomeHero />
      <ProofStrip />

      <Section
        num="01 — Start from your question"
        eyebrow="Choose a path"
        title="The right evidence depends on the decision in front of you."
        lede="Begin with the question your team actually needs to answer. Every route returns to the same source-to-runtime model and its checked boundaries."
      >
        <QuestionRoutes />
      </Section>

      <IntegrationBand />

      <Section
        num="02 — Clear"
        eyebrow="Developer experience"
        title="Write the message where the interface happens."
        lede="Messages stay readable in TypeScript and JSX. Palamedes transforms them for extraction and runtime use without making developers manage parallel identifiers, generated wrappers, or a second authoring language."
      >
        <div className="grid grid-cols-[minmax(0,8fr)_minmax(16rem,4fr)] gap-8 max-grid:grid-cols-1">
          <CodeShowcase />
          <aside className="border border-hair px-6 py-6">
            <p className="micro text-[10px] tracking-label text-gray-spec">
              Start small, stay coherent
            </p>
            <h3 className="display-serif mt-3 text-[22px] leading-tight uppercase">
              Quick to adopt is useful. Safe to keep is the point.
            </h3>
            <p className="mt-4 text-[13.5px] leading-relaxed text-ink/85">
              The quickstart is one path into the system, not the product promise. The same message
              model continues through catalogs, CI, server rendering, locale routing, and large
              repositories.
            </p>
            <QuickInstall />
          </aside>
        </div>
      </Section>

      <Section
        num="03 — Complete"
        eyebrow="Already wired"
        title="Framework integrations and locale architectures are two different promises."
        lede="The adapter layer supplies tested glue code for each supported host. Separately, the example matrix proves four application shapes for locale selection and URLs. You do not have to turn generic compatibility into an architecture yourself."
      >
        <CompleteProof />
      </Section>

      <Section
        num="04 — Fast"
        eyebrow="Checked performance"
        title="Fast enough to stay out of the way."
        lede="The realistic workflow measures extraction and catalog updates across 1,500 files. The exact command, fixtures, machine details, and semantic checks remain available for reproduction."
      >
        <div className="space-y-8">
          <BenchmarkCommand />
          <BenchmarkLedger corpus={BENCH_REALISTIC} warm={BENCH_REALISTIC_WARM} />
          <ButtonLink variant="outline" href="/proof">
            Inspect benchmarks and verification
          </ButtonLink>
        </div>
      </Section>

      <StatementBand num="05 — Architecture" diagram href="/architecture">
        A native core handles extraction, catalogs, validation, merging, and compilation. Each
        framework adapter handles only its own routing, rendering, and locale conventions.
      </StatementBand>

      <Section
        num="06 — Verification"
        eyebrow="Executable evidence"
        title="The matrix is made of applications, not logos."
        lede={`Every cell represents implemented source. All ${contentStats.smokeExampleCount} examples are smoke-checked on relevant changes, while ${contentStats.browserExampleCount} browser-capable examples exercise SSR output, locale switching, and localized server actions on a schedule.`}
      >
        <FrameworkMatrix />
      </Section>

      <Section
        num="07 — Trust"
        eyebrow="Built for the long run"
        title="The tradeoffs are documented before you depend on them."
      >
        <div className="grid grid-cols-2 gap-12 max-grid:grid-cols-1">
          <div className="max-w-[44em] space-y-4 text-[15px] leading-relaxed">
            <p>
              Palamedes is maintained by Sebastian Software GmbH. It is the third generation of
              source-string-first i18n tooling from the same author, shaped by framework changes and
              enterprise migration work.
            </p>
            <p className="text-ink/80">
              The public boundary is as important as the capability: MIT-licensed source,
              repository-owned catalogs, and no hosted TMS, machine translation, or account
              requirement. Architecture, release behavior, security policy, and rejected
              alternatives are documented before you depend on them.
            </p>
          </div>
          <div className="space-y-2">
            <a href={decisionHref()} className="mono-nums block text-[13px] text-accent">
              Read the decision trail →
            </a>
            <a href="/proof" className="mono-nums block text-[13px] text-accent">
              Inspect the verification story →
            </a>
            <a href="/docs/stability" className="mono-nums block text-[13px] text-accent">
              Review stability and release discipline →
            </a>
            <a href={REPO} className="mono-nums block text-[13px] text-accent">
              Browse the source →
            </a>
          </div>
        </div>
      </Section>

      <Section
        num="08 — FAQ"
        eyebrow="Boundaries, stated plainly"
        title="What Palamedes does—and what it does not claim to do."
        lede="These answers are part of the page, the product boundary, and the structured data. They stay deliberately specific so a useful answer does not become a broader promise."
      >
        <HomeFaq />
      </Section>

      <CtaBand
        headline="Put a durable i18n model in your repository."
        primary={{ label: "Start the guided setup", href: "/get-started" }}
        secondary={{ label: "Read the migration guide", href: "/docs/migrate-from-lingui" }}
      />
    </Page>
  )
}
