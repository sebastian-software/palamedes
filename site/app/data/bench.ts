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
  /*
   * Speedup ratios. Not rendered in the chart (the bars carry the story), but
   * asserted against the checked-in report by scripts/verify-site-bench-data.mjs
   * so the numbers quoted in prose (hero, ProofStrip) can't silently drift.
   */
  ratios: { lingui: string; i18next: string }
}

export const BENCH_META = {
  generated: "2026-07-06",
  node: "v24.18.0",
  platform: "darwin/arm64",
  runs: 7,
  reportPath: "benchmarks/e2e-workflow/results/latest.md",
}

/*
 * Only BENCH_REALISTIC is charted on the site (home + proof). BENCH_SMALL and
 * BENCH_MEDIUM are kept as the checked-in reference for the smaller corpora:
 * they back the tables in the benchmark docs and are validated against the
 * report by scripts/verify-site-bench-data.mjs. Keep all three in sync with
 * benchmarks/e2e-workflow/results/latest.md (the drift guard enforces it).
 */
export const BENCH_SMALL: BenchCorpus = {
  id: "small",
  title: "Small corpus — 80 files, 640 messages (median of 7 runs)",
  corpus: "80 files, 640 messages",
  rows: [
    { tool: "Palamedes", medianMs: 31.64, accent: true },
    { tool: "i18next-parser", medianMs: 499.18 },
    { tool: "Lingui", medianMs: 674.05 },
  ],
  ratios: { lingui: "21.31×", i18next: "15.78×" },
}

export const BENCH_MEDIUM: BenchCorpus = {
  id: "medium",
  title: "Medium corpus — 240 files, 1920 messages (median of 7 runs)",
  corpus: "240 files, 1920 messages",
  rows: [
    { tool: "Palamedes", medianMs: 43.37, accent: true },
    { tool: "i18next-parser", medianMs: 546.32 },
    { tool: "Lingui", medianMs: 745.33 },
  ],
  ratios: { lingui: "17.19×", i18next: "12.60×" },
}

export const BENCH_REALISTIC: BenchCorpus = {
  id: "realistic",
  title: "Realistic corpus — 1,500 files across ~400k lines, 6,000 messages (median of 7 runs)",
  corpus: "1,500 files (750 with i18n), ~400k lines, 6,000 messages",
  rows: [
    { tool: "Palamedes", medianMs: 173.5, accent: true },
    { tool: "i18next-parser", medianMs: 1561.82 },
    { tool: "Lingui", medianMs: 2254.38 },
  ],
  ratios: { lingui: "12.99×", i18next: "9.00×" },
}
