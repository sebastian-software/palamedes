import { ButtonLink } from "~/components/chrome/Button"
import { Page } from "~/components/chrome/Page"
import { pageMeta } from "~/lib/meta"
import { Reveal } from "~/components/chrome/Reveal"
import { Section } from "~/components/chrome/Section"
import { FrameworkMatrix } from "~/components/frameworks/FrameworkMatrix"
import { CodeShowcase } from "~/components/home/CodeShowcase"
import { CtaBand } from "~/components/home/CtaBand"
import { FeatureGrid } from "~/components/home/FeatureGrid"
import { PackageCards } from "~/components/home/PackageCards"
import { ProofStrip } from "~/components/home/ProofStrip"
import { QuickInstall } from "~/components/home/QuickInstall"
import { StatementBand } from "~/components/home/StatementBand"
import { TerminalCascade } from "~/components/home/TerminalCascade"
import { WorkflowFlow } from "~/components/home/WorkflowFlow"
import { BenchmarkChart } from "~/components/proof/BenchmarkChart"
import { BENCH_REALISTIC } from "~/data/bench"
import contentStats from "~/data/generated/content-stats.json"
import { HOME_MODEL_CARDS } from "~/data/features"
import { decisionHref, REPO } from "~/data/links"

export const handle = { layout: "bare" }

export function meta() {
  return pageMeta({
    title: "Palamedes — open-source i18n tooling for JavaScript and TypeScript",
    description:
      "Open-source i18n tooling with source-string-first authoring, repository-owned catalogs, one runtime model, and first-party integrations for modern JavaScript and TypeScript applications.",
    path: "/",
  })
}

export default function Home() {
  return (
    <Page>
      {/* ------------------------------------------------------------ hero */}
      <section className="grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-12 px-8 pt-16 pb-16 max-grid:grid-cols-1 max-tight:px-5">
        <div>
          <img
            src="/logo.svg"
            alt="Palamedes"
            width={104}
            height={104}
            className="mb-8 size-26 max-tight:size-20"
          />
          <p className="eyebrow">Open-source i18n tooling for JavaScript &amp; TypeScript</p>
          <h1 className="display-serif mt-6 text-display leading-[1.12] uppercase">
            <span className="block">One translation model.</span>
            <span className="block">From source to runtime.</span>
          </h1>
          <p className="mt-6 max-w-[38em] text-[16px]">
            Write messages where your UI happens, keep source-string-first <code>.po</code> catalogs
            in your repository, and use one small runtime model. First-party integrations cover
            Next.js, TanStack Start, SolidStart, Waku, React Router, Remix v3, and Vite. Backend
            servers use the same runtime model.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/get-started">Get started in 5 minutes</ButtonLink>
            <ButtonLink variant="outline" href="/frameworks">
              Explore integrations
            </ButtonLink>
          </div>
          <QuickInstall />
        </div>
        <Reveal delayMs={150}>
          <TerminalCascade />
        </Reveal>
      </section>

      <ProofStrip />

      {/* ----------------------------------------------------- 01 — model */}
      <Section
        num="01 — Model"
        title="Your i18n setup should stay coherent as your application changes."
        lede="New render environments and framework integrations should not reopen how your app identifies, extracts, and loads messages. Palamedes keeps authoring, catalogs, and runtime access coherent while each adapter handles its host-specific wiring."
      >
        <FeatureGrid cards={HOME_MODEL_CARDS} />
      </Section>

      {/* -------------------------------------------------- 02 — workflow */}
      <Section num="02 — Workflow" title="The whole workflow, honestly small.">
        <div className="space-y-8">
          <WorkflowFlow />
          <CodeShowcase />
        </div>
      </Section>

      {/* ----------------------------------------------------- 03 — proof */}
      <Section
        num="03 — Proof"
        title="We don't ask you to trust a slogan. The repo shows the work."
        lede="Every combination in the verified framework matrix is a real app, re-checked in CI through the same Playwright flow — with public demos where the hosting is ready. Every benchmark number links to a checked-in, re-runnable report."
      >
        <div className="space-y-10">
          <FrameworkMatrix />
          <BenchmarkChart corpus={BENCH_REALISTIC} />
          <ButtonLink variant="outline" href="/proof">
            All benchmarks &amp; the verification story
          </ButtonLink>
        </div>
      </Section>

      {/* ------------------------------------------------ 04 — positioning */}
      <StatementBand num="04 — Scope" diagram>
        Palamedes is the open-source local foundation for authoring, extraction, catalogs,
        validation, and runtime integration. First-party adapters connect that model to each
        supported host. Palamedes+ is the planned optional managed layer for translation automation
        and collaboration.
      </StatementBand>

      {/* ------------------------------------------------ 05 — maintainer */}
      <Section num="05 — Maintainer" title="Built from repeat experience, not a weekend take.">
        <div className="grid grid-cols-2 gap-12 max-grid:grid-cols-1">
          <p className="max-w-[44em] text-[15px] leading-relaxed">
            Palamedes is maintained by Sebastian Software GmbH. It is the third generation of
            source-string-first JavaScript i18n tooling from the same author — from gettext-style
            macro systems in qooxdoo to a full enterprise Lingui migration at Regrello (acquired by
            Salesforce in 2025). The lessons are written down as {contentStats.adrCount} ADRs before
            you depend on the tool.
          </p>
          <div className="space-y-2">
            <a href={decisionHref()} className="mono-nums block text-[13px] text-accent">
              The decision trail (ADRs) →
            </a>
            <a href="/blog" className="mono-nums block text-[13px] text-accent">
              Why this exists →
            </a>
          </div>
        </div>
      </Section>

      {/* -------------------------------------------------- 06 — packages */}
      <Section
        num="06 — Packages"
        title="Small packages, one model."
        lede="You own the code. You run the commands. Every piece is a scoped npm package your repo controls."
      >
        <PackageCards />
      </Section>

      <CtaBand
        headline="Your first working translation is 5 minutes away."
        primary={{ label: "Get started", href: "/get-started" }}
        secondary={{ label: "Star on GitHub", href: REPO }}
      />
    </Page>
  )
}
