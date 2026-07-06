/* Comparison content, verbatim from docs/site/structure/pages/ComparisonPage.jsx. */

export const COMPARE_CRITERIA = [
  "Authoring",
  "Message identity",
  "Runtime access",
  "Catalog engine",
  "Extract + update (small corpus)",
  "Framework coverage",
  "Maturity & ecosystem",
]

export interface CompareTool {
  name: string
  accent?: boolean
  cells: string[]
}

export const COMPARE_TOOLS: CompareTool[] = [
  {
    name: "Palamedes",
    accent: true,
    cells: [
      "Macro-style, JSX-first",
      "message + context, stable across refactors",
      "One model: getI18n() everywhere",
      "Native (Rust/ferrocat), semantic merge & audits",
      "174 ms (checked report¹)",
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
      "2254 ms (same harness¹)",
      "Broad, community-verified",
      "Mature, large community, years of production use",
    ],
  },
]

export const COMPARE_FOOTNOTES = [
  "¹ Median of 7 runs on the realistic corpus (1,500 files, 6,000 messages, ~400k lines — half the files not even i18n), same semantic validation — methodology and raw reports in the repo.",
]
