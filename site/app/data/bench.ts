/*
 * End-to-end extract + catalog-update benchmark numbers, quoted from the
 * checked-in report benchmarks/e2e-workflow/results/latest.md.
 *
 * These values are intentionally hardcoded: the page prose quotes them
 * verbatim, so they must be edited consciously. Drift protection lives in
 * scripts/verify-site-bench-data.mjs, which parses latest.md on every site
 * build and fails when these constants no longer match the report.
 */

export interface BenchRow {
  tool: string
  medianMs: number
  accent?: boolean
}

export interface BenchCorpus {
  id: "small" | "medium"
  title: string
  corpus: string
  rows: BenchRow[]
  ratios: { lingui: string; i18next: string }
}

export const BENCH_META = {
  generated: "2026-07-03",
  node: "v24.18.0",
  platform: "darwin/arm64",
  runs: 7,
  reportPath: "benchmarks/e2e-workflow/results/latest.md",
}

export const BENCH_SMALL: BenchCorpus = {
  id: "small",
  title: "Small corpus — 80 files, 640 messages (median of 7 runs)",
  corpus: "80 files, 640 messages",
  rows: [
    { tool: "Palamedes", medianMs: 33.53, accent: true },
    { tool: "i18next-parser", medianMs: 477.58 },
    { tool: "Lingui", medianMs: 657.0 },
  ],
  ratios: { lingui: "19.59×", i18next: "14.24×" },
}

export const BENCH_MEDIUM: BenchCorpus = {
  id: "medium",
  title: "Medium corpus — 240 files, 1920 messages (median of 7 runs)",
  corpus: "240 files, 1920 messages",
  rows: [
    { tool: "Palamedes", medianMs: 42.92, accent: true },
    { tool: "i18next-parser", medianMs: 534.15 },
    { tool: "Lingui", medianMs: 728.56 },
  ],
  ratios: { lingui: "16.98×", i18next: "12.45×" },
}
