/**
 * Route: /
 * Job: convert a skeptical JavaScript developer in under 60 seconds of
 * scrolling — promise, proof, code, path. Every number links to evidence.
 */

export function HomePage() {
  return (
    <Page title="Palamedes — i18n that survives your next framework migration">
      <SiteNav />

      <Hero
        eyebrow="Open-source i18n tooling for JavaScript & TypeScript"
        headline="One translation model. Every framework."
        subline="Write messages where your UI happens. Keep source-string-first
          .po catalogs your translators can actually read. Ship the same
          runtime model across Next.js, TanStack Start, SolidStart, Waku, and
          React Router — powered by a Rust core that finishes extraction
          before other tools finish starting."
        primary={{ label: "Get started in 5 minutes", href: "/get-started" }}
        secondary={{
          label: "See it live",
          href: "https://nextjs-cookie.examples.palamedes.dev",
        }}
        visual={
          <LocaleMatrixAnimation
            fallbackSrc="…/docs/site/assets/palamedes-localized-matrix.png"
          />
        }
      />

      <ProofStrip
        stats={[
          {
            value: "20",
            label: "browser-verified example apps",
            href: "/frameworks",
          },
          {
            value: "5 × 4",
            label: "frameworks × locale strategies",
            href: "/frameworks",
          },
          {
            value: "19.6×",
            label: "faster extract/update than Lingui",
            href: "/proof",
          },
          {
            value: "16",
            label: "ADRs documenting every tradeoff",
            href: "…/adr/",
          },
        ]}
      />

      {/* ------------------------------------------------ the core promise */}
      <Section id="model">
        <h2>Your i18n setup should not splinter when your framework changes.</h2>
        <p>
          Most teams relearn internationalization with every migration: new
          runtime, new message IDs, new catalog quirks. Palamedes keeps the
          parts you touch every day stable — and lets the framework be the
          only thing that changes.
        </p>
        <FeatureGrid
          columns={3}
          cards={[
            {
              icon: "pen",
              title: "Write messages in place",
              body: "Macro-style authoring next to your JSX. No message-ID bookkeeping, no separate dictionary files to keep in sync.",
              href: "/get-started",
            },
            {
              icon: "fingerprint",
              title: "One identity model",
              body: "Messages are identified by message + context — stable across refactors, frameworks, and years of catalog history.",
              href: "…/adr/003-source-string-first-message-identity.md",
            },
            {
              icon: "plug",
              title: "One runtime call",
              body: "getI18n() resolves the active instance everywhere: server components, client islands, backend request handlers.",
              href: "…/adr/005-universal-geti18n-runtime-model.md",
            },
          ]}
        />
      </Section>

      {/* --------------------------------------------------- code showcase */}
      <Section id="code" theme="dark">
        <h2>The whole workflow, honestly small.</h2>
        <CodeShowcase
          tabs={[
            {
              label: "Write",
              language: "tsx",
              caption: "Messages live where the UI happens.",
              code: `
import { t, plural } from "@palamedes/core/macro"
import { Trans } from "@palamedes/react"

export function Booking({ seats }: { seats: number }) {
  return (
    <>
      <h1>{t\`Your trip to Lisbon\`}</h1>
      <p>{plural(seats, { one: "# seat left", other: "# seats left" })}</p>
      <Trans>Free cancellation until <b>24 hours</b> before departure.</Trans>
    </>
  )
}`,
            },
            {
              label: "Extract",
              language: "bash",
              caption: "One native command scans, extracts, and updates catalogs.",
              code: `
$ pmds extract

  en  3 messages  (1 new)
  de  3 messages  (1 missing translation)

  done in 34 ms`,
            },
            {
              label: "Translate",
              language: "po",
              caption: "Source-string-first .po — readable by translators and every TMS.",
              code: `
#: src/Booking.tsx:7
msgid "Your trip to Lisbon"
msgstr "Deine Reise nach Lissabon"

#: src/Booking.tsx:8
msgid "{seats, plural, one {# seat left} other {# seats left}}"
msgstr "{seats, plural, one {# Platz frei} other {# Plätze frei}}"`,
            },
          ]}
          result={{
            title: "Rendered",
            content: "The same component, in every locale, in every framework.",
          }}
        />
      </Section>

      {/* ---------------------------------------------------- proof teaser */}
      <Section id="proof">
        <h2>We don't ask you to trust a slogan. The repo shows the work.</h2>
        <p>
          Every framework/strategy combination is a real app, deployed live and
          re-verified in CI through the same Playwright flow. Every benchmark
          number links to a checked-in, re-runnable report.
        </p>
        <FrameworkMatrix
          frameworks={[
            { name: "Next.js", slug: "nextjs" },
            { name: "TanStack Start", slug: "tanstack" },
            { name: "SolidStart", slug: "solidstart" },
            { name: "Waku", slug: "waku" },
            { name: "React Router", slug: "react-router" },
          ]}
          strategies={[
            { name: "Cookie", slug: "cookie" },
            { name: "Route", slug: "route" },
            { name: "Subdomain", slug: "subdomain" },
            { name: "TLD", slug: "tld" },
          ]}
          demoUrl={(f, s) => `https://${f}-${s}.examples.palamedes.dev`}
        />
        <BenchmarkChart
          title="End-to-end extract + catalog update (small corpus, median)"
          rows={[
            { tool: "Palamedes", median: "33.53 ms" },
            { tool: "i18next-parser", median: "477.58 ms" },
            { tool: "Lingui", median: "657.00 ms" },
          ]}
          methodologyHref="…/docs/benchmark-e2e-workflow.md"
        />
        <Button variant="secondary" href="/proof">
          All benchmarks & the verification story
        </Button>
      </Section>

      {/* ------------------------------------------------------ positioning */}
      <StatementBand
        text="Palamedes is narrower than some alternatives on purpose:
          compile-time authoring, source-string-first catalogs, and a local
          workflow your repo owns — with a Rust core doing the careful work."
      />

      {/* ------------------------------------------------------- who builds */}
      <Section id="maintainer" layout="two-column">
        <h2>Built from repeat experience, not a weekend take.</h2>
        <p>
          Palamedes is maintained by Sebastian Software GmbH. It is the third
          generation of source-string-first JavaScript i18n tooling from the
          same author — from gettext-style macro systems in qooxdoo to a
          full enterprise Lingui migration at Regrello (acquired by
          Salesforce in 2025). The lessons are written down as 16 ADRs before
          you depend on the tool.
        </p>
        <LinkList
          links={[
            { label: "The decision trail (ADRs)", href: "…/adr/" },
            { label: "Why this exists", href: "/blog" },
          ]}
        />
      </Section>

      <CtaBand
        headline="Your first working translation is 5 minutes away."
        primary={{ label: "Get started", href: "/get-started" }}
        secondary={{
          label: "Star on GitHub",
          href: "https://github.com/sebastian-software/palamedes",
        }}
      />

      <SiteFooter />
    </Page>
  )
}
