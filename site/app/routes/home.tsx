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
import { BenchmarkChart } from "~/components/proof/BenchmarkChart"
import { BENCH_SMALL } from "~/data/bench"
import { HOME_MODEL_CARDS } from "~/data/features"
import { decisionHref, DEMO_NEXTJS_COOKIE, REPO } from "~/data/links"

export const handle = { layout: "bare" }

export function meta() {
  return pageMeta({
    title: "Palamedes — i18n that survives your next framework migration",
    description:
      "Open-source i18n tooling for JavaScript & TypeScript: one translation model across Next.js, TanStack Start, SolidStart, Waku, and React Router, with a Rust core and source-string-first .po catalogs.",
    path: "/",
  })
}

export default function Home() {
  return (
    <Page>
      {/* ------------------------------------------------------------ hero */}
      <section className="grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-12 px-8 pt-16 pb-16 max-grid:grid-cols-1 max-tight:px-5">
        <div>
          <p className="eyebrow">Open-source i18n tooling for JavaScript &amp; TypeScript</p>
          <h1 className="mt-6 text-display leading-[0.98] font-bold tracking-[-0.03em] text-balance">
            One translation model. Every&nbsp;framework.
          </h1>
          <p className="mt-6 max-w-[38em] text-[16px]">
            Write messages where your UI happens. Keep source-string-first <code>.po</code> catalogs
            your translators can actually read. Ship the same runtime model across Next.js, TanStack
            Start, SolidStart, Waku, and React Router — with a Rust core that ran the checked
            small-corpus extract/update benchmark 21.0× faster than Lingui on the recorded
            machine-local run.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/get-started">Get started in 5 minutes</ButtonLink>
            <ButtonLink variant="outline" href={DEMO_NEXTJS_COOKIE}>
              See it live
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
        title="Your i18n setup should not splinter when your framework changes."
        lede="Most teams relearn internationalization with every migration: new runtime, new message IDs, new catalog quirks. Palamedes keeps the parts you touch every day stable — and lets the framework be the only thing that changes."
      >
        <FeatureGrid cards={HOME_MODEL_CARDS} />
      </Section>

      {/* -------------------------------------------------- 02 — workflow */}
      <Section num="02 — Workflow" title="The whole workflow, honestly small.">
        <CodeShowcase />
      </Section>

      {/* ----------------------------------------------------- 03 — proof */}
      <Section
        num="03 — Proof"
        title="We don't ask you to trust a slogan. The repo shows the work."
        lede="Every framework/strategy combination is a real app, re-verified in CI through the same Playwright flow — with public demos where the hosting is ready. Every benchmark number links to a checked-in, re-runnable report."
      >
        <div className="space-y-10">
          <FrameworkMatrix />
          <BenchmarkChart corpus={BENCH_SMALL} />
          <ButtonLink variant="outline" href="/proof">
            All benchmarks &amp; the verification story
          </ButtonLink>
        </div>
      </Section>

      {/* ------------------------------------------------ 04 — positioning */}
      <StatementBand num="04 — Positioning" diagram>
        Palamedes is narrower than some alternatives on purpose: compile-time authoring,
        source-string-first catalogs, and a local workflow your repo owns — with a Rust core doing
        the careful work.
      </StatementBand>

      {/* ------------------------------------------------ 05 — maintainer */}
      <Section num="05 — Maintainer" title="Built from repeat experience, not a weekend take.">
        <div className="grid grid-cols-2 gap-12 max-grid:grid-cols-1">
          <p className="max-w-[44em] text-[15px] leading-relaxed">
            Palamedes is maintained by Sebastian Software GmbH. It is the third generation of
            source-string-first JavaScript i18n tooling from the same author — from gettext-style
            macro systems in qooxdoo to a full enterprise Lingui migration at Regrello (acquired by
            Salesforce in 2025). The lessons are written down as 16 ADRs before you depend on the
            tool.
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
