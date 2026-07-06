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
  id: "small" | "medium" | "realistic"
  title: string
  corpus: string
  rows: BenchRow[]
  ratios: { lingui: string; i18next: string }
}

export const BENCH_META = {
  generated: "2026-07-06",
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
    { tool: "Palamedes", medianMs: 33.41, accent: true },
    { tool: "i18next-parser", medianMs: 531.39 },
    { tool: "Lingui", medianMs: 738.18 },
  ],
  ratios: { lingui: "22.10×", i18next: "15.91×" },
}

export const BENCH_MEDIUM: BenchCorpus = {
  id: "medium",
  title: "Medium corpus — 240 files, 1920 messages (median of 7 runs)",
  corpus: "240 files, 1920 messages",
  rows: [
    { tool: "Palamedes", medianMs: 46.27, accent: true },
    { tool: "i18next-parser", medianMs: 583 },
    { tool: "Lingui", medianMs: 800.75 },
  ],
  ratios: { lingui: "17.31×", i18next: "12.60×" },
}

export const BENCH_REALISTIC: BenchCorpus = {
  id: "realistic",
  title: "Realistic corpus — 400 files, 10,000 messages (median of 7 runs)",
  corpus: "400 files, 10,000 messages",
  rows: [
    { tool: "Palamedes", medianMs: 83.75, accent: true },
    { tool: "i18next-parser", medianMs: 787.15 },
    { tool: "Lingui", medianMs: 1060.24 },
  ],
  ratios: { lingui: "12.66×", i18next: "9.40×" },
}
