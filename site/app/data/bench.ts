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
  ratios: { lingui: string; formatjs: string; i18nextParser: string; i18nextCli: string }
}

export const BENCH_META = {
  generated: "2026-07-27",
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
    { tool: "Palamedes", medianMs: 32.69, accent: true },
    { tool: "Lingui", medianMs: 668.88 },
    { tool: "FormatJS", medianMs: 272.57 },
    { tool: "i18next-parser", medianMs: 516.72 },
    { tool: "i18next-cli", medianMs: 392.97 },
  ],
  ratios: {
    lingui: "20.46×",
    formatjs: "8.34×",
    i18nextParser: "15.81×",
    i18nextCli: "12.02×",
  },
}

export const BENCH_MEDIUM: BenchCorpus = {
  id: "medium",
  title: "Medium corpus — 240 files, 1920 messages (median of 7 runs)",
  corpus: "240 files, 1920 messages",
  rows: [
    { tool: "Palamedes", medianMs: 47.74, accent: true },
    { tool: "Lingui", medianMs: 736.15 },
    { tool: "FormatJS", medianMs: 298.06 },
    { tool: "i18next-parser", medianMs: 571.65 },
    { tool: "i18next-cli", medianMs: 572.93 },
  ],
  ratios: {
    lingui: "15.42×",
    formatjs: "6.24×",
    i18nextParser: "11.97×",
    i18nextCli: "12.00×",
  },
}

export const BENCH_REALISTIC: BenchCorpus = {
  id: "realistic",
  title: "Realistic corpus — 1,500 files across ~400k lines, 6,000 messages (median of 7 runs)",
  corpus: "1,500 files (750 with i18n), ~400k lines, 6,000 messages",
  rows: [
    { tool: "Palamedes", medianMs: 125.88, accent: true },
    { tool: "Lingui", medianMs: 2279.13 },
    { tool: "FormatJS", medianMs: 464.63 },
    { tool: "i18next-parser", medianMs: 1578.61 },
    { tool: "i18next-cli", medianMs: 5668.44 },
  ],
  ratios: {
    lingui: "18.11×",
    formatjs: "3.69×",
    i18nextParser: "12.54×",
    i18nextCli: "45.03×",
  },
}
