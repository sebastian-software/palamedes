import { ButtonLink, Page, Section } from "@palamedes/site-ui";
import { FrameworkMatrix } from "~/components/frameworks/FrameworkMatrix";
import { CodeShowcase } from "~/components/home/CodeShowcase";
import { CompleteProof } from "~/components/home/CompleteProof";
import { CtaBand } from "~/components/home/CtaBand";
import { FeatureGrid } from "~/components/home/FeatureGrid";
import { BenchmarkCommand } from "~/components/home/BenchmarkCommand";
import { HomeHero } from "~/components/home/HomeHero";
import { HomeFaq, HOME_FAQ } from "~/components/home/HomeFaq";
import { IntegrationBand } from "~/components/home/IntegrationBand";
import { ProofStrip } from "~/components/home/ProofStrip";
import { QuickInstall } from "~/components/home/QuickInstall";
import { QuestionRoutes } from "~/components/home/QuestionRoutes";
import { StatementBand } from "~/components/home/StatementBand";
import { BenchmarkLedger } from "~/components/proof/BenchmarkLedger";
import { BENCH_REALISTIC, BENCH_REALISTIC_WARM } from "~/data/bench";
import { RUNTIME_BENEFITS } from "~/data/features";
import contentStats from "~/data/generated/content-stats.json";
import { decisionHref, REPO } from "~/data/links";
import { pageMeta } from "~/lib/meta";

export const handle = { layout: "bare" };

export function meta() {
  const title = "Palamedes — a durable i18n foundation for TypeScript";
  const description =
    "A clear, complete, and fast TypeScript i18n foundation with source-local messages, repository-owned catalogs, native tooling, and first-party integrations for modern frameworks.";

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
  ];
}

export default function Home() {
  return (
    <Page className="pmds-home">
      <HomeHero />
      <ProofStrip />

      <Section
        num="01 — Clear"
        eyebrow="Developer experience"
        title="Write the message where the interface happens."
        lede="Use t for text and ready-made Trans and Plural macros for rich copy and choices. Messages stay readable beside your components; the build turns them into compiled lookups. Your translators work with the source messages in repository-owned catalogs."
      >
        <div className="grid grid-cols-[minmax(0,8fr)_minmax(16rem,4fr)] gap-8 max-grid:grid-cols-1">
          <CodeShowcase />
          <aside className="border border-hair px-6 py-6">
            <p className="micro text-[10px] tracking-label text-gray-spec">
              Components for real copy
            </p>
            <h3 className="display-serif mt-3 text-[22px] leading-tight uppercase">
              Rich text. Plurals. One authoring model.
            </h3>
            <p className="mt-4 text-[13.5px] leading-relaxed text-ink/85">
              Keep links and emphasis inside the translated sentence. Let plural rules select the
              right copy for each language. The adapter supplies the compiled messages before your
              component runs.
            </p>
            <QuickInstall />
            <ButtonLink variant="small" className="mt-5" href="/get-started#install">
              Set up your framework
            </ButtonLink>
          </aside>
        </div>
      </Section>

      <Section
        num="02 — Complete"
        eyebrow="Already wired"
        title="The integration is already built for your framework."
        lede="First-party adapters connect message authoring, server rendering, browser delivery, and localized server functions. Start from a checked application, choose its locale policy, and keep catalog loading inside the adapter."
      >
        <CompleteProof />
      </Section>

      <IntegrationBand />

      <Section
        num="03 — Fast"
        eyebrow="Checked performance"
        title="Less work in the browser, on the server, and in your toolchain."
        lede="Macros become compiled message lookups. Browser adapters deliver active-locale fragments along the module graph, and server requests reuse immutable catalogs. The native CLI keeps extraction and catalog updates fast as the source tree grows."
      >
        <div className="space-y-8">
          <FeatureGrid cards={RUNTIME_BENEFITS} />
          <ButtonLink variant="outline" href="/message-splitting">
            Watch translation fragments load
          </ButtonLink>
          <BenchmarkCommand />
          <BenchmarkLedger corpus={BENCH_REALISTIC} warm={BENCH_REALISTIC_WARM} />
          <ButtonLink variant="outline" href="/proof">
            Inspect benchmarks and verification
          </ButtonLink>
        </div>
      </Section>

      <Section
        num="04 — Your next step"
        eyebrow="Choose a path"
        title="Try it in your stack, then inspect what matters to your team."
        lede="Set up a first translation yourself or with the repository's agent skill. Explore locale policy, architecture, and reproducible evidence as your application needs them."
      >
        <QuestionRoutes />
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
              The public boundary is as important as the capability: MIT OR Apache-2.0 source,
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
        title="What to know before you adopt it."
        lede="Check integration stability, catalog ownership, and how Palamedes fits your translation workflow."
      >
        <HomeFaq />
      </Section>

      <CtaBand
        headline="Put a durable i18n model in your repository."
        primary={{ label: "Start the guided setup", href: "/get-started" }}
        secondary={{ label: "Read the migration guide", href: "/docs/migrate-from-lingui" }}
      />
    </Page>
  );
}
