/*
 * Comparison content. Benchmark cells are derived from bench.ts, which is
 * asserted against benchmarks/e2e-workflow/results/latest.md by
 * scripts/verify-site-bench-data.mjs — so these numbers cannot drift from
 * the checked report.
 */

import { BENCH_REALISTIC } from "./bench"

function realisticMedian(tool: string): string {
  const row = BENCH_REALISTIC.rows.find((candidate) => candidate.tool === tool)
  if (!row) throw new Error(`compare.ts: no realistic bench row for ${tool}`)
  return `${Math.round(row.medianMs)} ms`
}

export const COMPARE_CRITERIA = [
  "Authoring",
  "Message identity",
  "Runtime access",
  "Catalog engine",
  "Extract + update (realistic corpus)",
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
      `${realisticMedian("Palamedes")} (checked report¹)`,
      "5 families browser-verified in CI; Remix v3 smoke-verified",
      "New — honest about it; a numbered ADR series documents the tradeoffs",
    ],
  },
  {
    name: "Lingui",
    cells: [
      "Macro-style, JSX-first",
      "Configurable ID strategies",
      "Multiple entry points (i18n, hooks, macros)",
      "JS-based tooling with plugin ecosystem",
      `${realisticMedian("Lingui")} (same harness¹)`,
      "Broad, community-verified",
      "Mature, large community, years of production use",
    ],
  },
]

export const COMPARE_FOOTNOTES = [
  "¹ Median of 7 runs on the realistic corpus (1,500 files, 6,000 messages, ~400k lines — half the files not even i18n), same semantic validation — methodology and raw reports in the repo.",
]
