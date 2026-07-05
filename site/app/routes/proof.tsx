import { ButtonLink } from "~/components/chrome/Button"
import { Page } from "~/components/chrome/Page"
import { pageMeta } from "~/lib/meta"
import { Section } from "~/components/chrome/Section"
import { CtaBand } from "~/components/home/CtaBand"
import { FeatureGrid } from "~/components/home/FeatureGrid"
import { BenchmarkChart } from "~/components/proof/BenchmarkChart"
import { ScreenshotStrip } from "~/components/proof/ScreenshotStrip"
import { BENCH_MEDIUM, BENCH_SMALL } from "~/data/bench"
import { CATALOG_QA_CARDS } from "~/data/features"
import { decisionHref, docsHref, repoHref } from "~/data/links"

export const handle = { layout: "bare" }

export function meta() {
  return pageMeta({
    title: "Palamedes — benchmarks, verification, and the decision trail",
    description:
      "Claims you can re-run: checked-in extract/update benchmarks against Lingui and i18next-parser, 20 browser-verified example apps, and 16 architecture decision records.",
    path: "/proof",
  })
}

const VERIFICATION_STEPS = [
  {
    title: "Build",
    body: "All 20 example apps build against the workspace packages — no mocked integrations.",
  },
  {
    title: "Drive",
    body: "A Playwright flow loads each app, checks SSR output, switches locales, and exercises localized server actions.",
  },
  {
    title: "Capture",
    body: "Screenshots are versioned in the repo, so 'works across frameworks' is a diffable artifact, not a slide.",
  },
]

export default function Proof() {
  return (
    <Page>
      <section className="relative overflow-hidden px-8 pt-16 pb-14 max-tight:px-5">
        {/* Style break: oversized ghosted section digit behind the hero. */}
        <span
          aria-hidden
          className="ghost-glyph absolute -top-10 right-4 text-[220px] leading-none select-none"
        >
          01
        </span>
        <p className="eyebrow">Proof</p>
        <h1 className="mt-6 text-display leading-[0.98] font-bold tracking-[-0.03em] text-balance">
          Claims you can re-run.
        </h1>
        <p className="mt-6 max-w-[38em]">
          Every number on this page comes from a checked-in, machine-readable report with fixtures
          and commands in the repo. If a claim can't be re-run, we don't make it.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href={docsHref("benchmark-e2e-workflow")}>Re-run the benchmarks</ButtonLink>
          <ButtonLink variant="outline" href={repoHref("benchmarks/e2e-workflow/results", "tree")}>
            Browse checked-in reports
          </ButtonLink>
        </div>
      </section>

      <Section
        num="01 — Benchmarks"
        title="The workflow you feel every day: extract & update."
        lede="The end-to-end benchmark measures what a developer actually waits for: scan sources, extract messages, update catalogs, write files. Same generated message inventory, rendered into each tool's idiomatic source shape, semantically validated after every run."
      >
        <div className="space-y-8">
          <BenchmarkChart corpus={BENCH_SMALL} />
          <BenchmarkChart corpus={BENCH_MEDIUM} />
          <div className="max-w-[56em] border-l-4 border-accent pl-4">
            <p className="micro text-[10px] text-gray-spec">Honest note</p>
            <p className="mt-1 text-[13.5px]">
              These are machine-local numbers from the checked-in report, not a marketing average.
              Your hardware will differ; the ratios are the signal. Commands to reproduce:{" "}
              <code>pnpm benchmark:e2e-workflow</code>.
            </p>
          </div>
        </div>
      </Section>

      <Section
        num="02 — Verification"
        title="20 apps, verified in a real browser, on every change."
      >
        <div className="hairline-grid mb-10 grid-cols-3 max-tight:grid-cols-1">
          {VERIFICATION_STEPS.map((step, index) => (
            <div key={step.title} className="bg-paper px-6 py-6">
              <p className="mono-nums text-[11px] text-accent">0{index + 1}</p>
              <h3 className="mt-3 text-[15px] font-bold">{step.title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink/85">{step.body}</p>
            </div>
          ))}
        </div>
        <ScreenshotStrip />
      </Section>

      <Section
        num="03 — Catalog quality"
        title="Fast would be worthless if the catalogs were wrong."
        lede="Catalog semantics live in one dedicated engine (ferrocat): parsing, merging, structured audits, and ICU authoring diagnostics. The benchmark harness validates every tool run semantically — message inventories are compared, not just timed."
      >
        <FeatureGrid cards={CATALOG_QA_CARDS} sectionIndex="03" />
      </Section>

      <Section
        num="04 — Decision trail"
        title="16 decisions, written down before you depend on them."
        lede="The ADRs cover message identity, the native boundary, adapter architecture — and, just as deliberately, what Palamedes refuses to own. Reading them is the fastest way to know if our tradeoffs match yours."
      >
        <div className="space-y-2">
          <a href={decisionHref()} className="mono-nums block text-[13px] text-accent">
            ADR index →
          </a>
          <a href={docsHref("stability")} className="mono-nums block text-[13px] text-accent">
            Stability &amp; versioning policy →
          </a>
          <a href={docsHref("principles")} className="mono-nums block text-[13px] text-accent">
            Palamedes principles →
          </a>
        </div>
      </Section>

      <CtaBand
        headline="Convinced by the receipts? The quickstart takes 5 minutes."
        primary={{ label: "Get started", href: "/get-started" }}
        secondary={{ label: "Compare with your current tool", href: "/compare" }}
      />
    </Page>
  )
}
