/**
 * Route: /compare
 * Job: catch the "Palamedes vs X" search intent and answer it honestly.
 * Follows the messaging rules in docs/site/comparison.mdx: no competitor
 * bashing, clear "when to pick the other tool" sections — honesty here is
 * the conversion strategy.
 */

export function ComparisonPage() {
  return (
    <Page title="Palamedes vs Lingui, next-intl, and General Translation — an honest comparison">
      <SiteNav />

      <Hero
        eyebrow="Comparison"
        headline="Narrower than the alternatives. On purpose."
        subline="Palamedes is for teams that like compile-time authoring and
          want the stack under it to feel smaller, steadier, and easier to
          trust. Here is how that compares — including when you should pick
          something else."
        primary={{ label: "Compare with Lingui", href: "#lingui" }}
        secondary={{ label: "See the proof", href: "/proof" }}
      />

      {/* ---------------------------------------------------------- lingui */}
      <Section id="lingui">
        <h2>Palamedes vs Lingui</h2>
        <p>
          Lingui is the closest neighbor — same authoring instinct, same
          source-string-first heart. Palamedes is the stricter end state of
          that idea: one runtime model instead of several entry points, one
          native engine for catalogs instead of plugin layers, and adapters
          that stay thin.
        </p>
        <CompareTable
          criteria={[
            "Authoring",
            "Message identity",
            "Runtime access",
            "Catalog engine",
            "Extract + update (small corpus)",
            "Framework coverage",
            "Maturity & ecosystem",
          ]}
          tools={[
            {
              name: "Palamedes",
              cells: [
                "Macro-style, JSX-first",
                "message + context, stable across refactors",
                "One model: getI18n() everywhere",
                "Native (Rust/ferrocat), semantic merge & audits",
                "33.53 ms (checked report¹)",
                "5 families browser-verified in CI",
                "New — honest about it; 16 ADRs document the tradeoffs",
              ],
            },
            {
              name: "Lingui",
              cells: [
                "Macro-style, JSX-first",
                "Configurable ID strategies",
                "Multiple entry points (i18n, hooks, macros)",
                "JS-based tooling with plugin ecosystem",
                "657.00 ms (same harness¹)",
                "Broad, community-verified",
                "Mature, large community, years of production use",
              ],
            },
          ]}
          footnotes={[
            "¹ Median of 7 runs, same corpus and semantic validation — methodology and raw reports in the repo.",
          ]}
        />
        <Callout tone="honest">
          Pick Lingui if you need its ecosystem breadth or plugins Palamedes
          doesn't have yet. If you're starting fresh — or mid-migration
          anyway — the playbook shows how existing .po catalogs usually carry
          over unchanged.
        </Callout>
        <LinkList
          links={[
            { label: "Detailed comparison", href: "…/docs/comparison-with-lingui.md" },
            { label: "Migration playbook", href: "…/docs/migrate-from-lingui.md" },
          ]}
        />
      </Section>

      {/* ------------------------------------------------------- next-intl */}
      <Section id="next-intl">
        <h2>Palamedes vs next-intl</h2>
        <p>
          Different mental model, both valid. next-intl centers on message
          files with keys and is deeply Next.js-native. Palamedes centers on
          source strings in your components and stays framework-portable.
        </p>
        <FeatureGrid
          columns={2}
          cards={[
            {
              icon: "check",
              title: "Pick next-intl when…",
              body: "You are all-in on Next.js, prefer key-based message files as the source of truth, and want the most Next-idiomatic API.",
            },
            {
              icon: "check",
              title: "Pick Palamedes when…",
              body: "You write messages in code, want .po catalogs translators already know, or expect to outlive your current framework choice.",
            },
          ]}
        />
      </Section>

      {/* ---------------------------------------------- general translation */}
      <Section id="gt">
        <h2>Palamedes vs General Translation</h2>
        <p>
          A category difference, not a feature race. GT is a translation
          platform — hosted workflows, AI translation, delivery. Palamedes is
          local-first tooling: your repo owns the catalogs, the QA, and the
          history. The two concerns can even stack: Palamedes as the local
          foundation, a service layer on top.
        </p>
      </Section>

      {/* -------------------------------------------------- the honest bit */}
      <StatementBand
        text="Every tool on this page is good software. The question is which
          tradeoffs match your team — ours are written down in 16 ADRs, so
          you can check before you commit."
      />

      <CtaBand
        headline="Judge it by the receipts, not the copy."
        primary={{ label: "See the proof", href: "/proof" }}
        secondary={{ label: "Try the 5-minute quickstart", href: "/get-started" }}
      />

      <SiteFooter />
    </Page>
  )
}
