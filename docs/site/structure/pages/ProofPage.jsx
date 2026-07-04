/**
 * Route: /proof
 * Job: the evidence page. For the visitor who liked the promise but wants
 * receipts: benchmarks with methodology, the CI verification story, and the
 * architectural decision trail. Tone: disciplined, zero hype.
 */

export function ProofPage() {
  return (
    <Page title="Palamedes — benchmarks, verification, and the decision trail">
      <SiteNav />

      <Hero
        eyebrow="Proof"
        headline="Claims you can re-run."
        subline="Every number on this page comes from a checked-in,
          machine-readable report with fixtures and commands in the repo.
          If a claim can't be re-run, we don't make it."
        primary={{
          label: "Re-run the benchmarks",
          href: "…/docs/benchmark-e2e-workflow.md",
        }}
        secondary={{
          label: "Browse checked-in reports",
          href: "…/benchmarks/e2e-workflow/results/",
        }}
      />

      {/* ------------------------------------------------------ benchmarks */}
      <Section id="benchmarks">
        <h2>The workflow you feel every day: extract & update.</h2>
        <p>
          The end-to-end benchmark measures what a developer actually waits
          for: scan sources, extract messages, update catalogs, write files.
          Same generated message inventory, rendered into each tool's
          idiomatic source shape, semantically validated after every run.
        </p>
        <BenchmarkChart
          title="Small corpus — 80 files, 640 messages (median of 7 runs)"
          rows={[
            { tool: "Palamedes", median: "33.53 ms" },
            { tool: "i18next-parser 9.4", median: "477.58 ms" },
            { tool: "Lingui 6.4", median: "657.00 ms" },
          ]}
          methodologyHref="…/docs/benchmark-e2e-workflow.md"
        />
        <BenchmarkChart
          title="Medium corpus (median of 7 runs)"
          rows={[
            { tool: "Palamedes", median: "42.92 ms" },
            /* fill from benchmarks/e2e-workflow/results/latest.md */
          ]}
          methodologyHref="…/docs/benchmark-e2e-workflow.md"
        />
        <Callout tone="honest">
          These are machine-local numbers from the checked-in report, not a
          marketing average. Your hardware will differ; the ratios are the
          signal. Commands to reproduce: <code>pnpm benchmark:e2e-workflow</code>.
        </Callout>
      </Section>

      {/* ----------------------------------------------------- verification */}
      <Section id="verification">
        <h2>20 apps, verified in a real browser, on every change.</h2>
        <StepFlow
          steps={[
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
          ]}
        />
        <Screenshot
          src="…/docs/site/assets/palamedes-localized-matrix.png"
          alt="The same booking UI rendered in English, German, and Spanish"
          caption="One demo, three locales: copy, plural seat counts, currency, and dates change together."
          href="…/docs/example-screenshots/README.md"
        />
      </Section>

      {/* ------------------------------------------------- catalog quality */}
      <Section id="catalog-qa">
        <h2>Fast would be worthless if the catalogs were wrong.</h2>
        <p>
          Catalog semantics live in one dedicated engine (ferrocat): parsing,
          merging, structured audits, and ICU authoring diagnostics. The
          benchmark harness validates every tool run semantically — message
          inventories are compared, not just timed.
        </p>
        <FeatureGrid
          columns={3}
          cards={[
            {
              icon: "shield",
              title: "Structured audits",
              body: "Machine-readable catalog audits catch missing translations, stale entries, and metadata drift in CI.",
            },
            {
              icon: "brackets",
              title: "ICU diagnostics",
              body: "Authoring mistakes in plural/select syntax are flagged at extract time, not at runtime in production.",
            },
            {
              icon: "merge",
              title: "Semantic merging",
              body: "A Git merge driver resolves catalog conflicts by meaning, not by line — no more broken .po files after rebases.",
            },
          ]}
        />
      </Section>

      {/* --------------------------------------------------- decision trail */}
      <Section id="adrs">
        <h2>16 decisions, written down before you depend on them.</h2>
        <p>
          The ADRs cover message identity, the native boundary, adapter
          architecture — and, just as deliberately, what Palamedes refuses to
          own. Reading them is the fastest way to know if our tradeoffs match
          yours.
        </p>
        <LinkList
          links={[
            { label: "ADR index", href: "…/adr/" },
            { label: "Stability & versioning policy", href: "…/docs/stability.md" },
            { label: "Palamedes principles", href: "…/docs/principles.md" },
          ]}
        />
      </Section>

      <CtaBand
        headline="Convinced by the receipts? The quickstart takes 5 minutes."
        primary={{ label: "Get started", href: "/get-started" }}
        secondary={{ label: "Compare with your current tool", href: "/compare" }}
      />

      <SiteFooter />
    </Page>
  )
}
