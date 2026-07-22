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
  generated: "2026-07-22",
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
    { tool: "Palamedes", medianMs: 43.88, accent: true },
    { tool: "Lingui", medianMs: 1143.37 },
    { tool: "FormatJS", medianMs: 291.08 },
    { tool: "i18next-parser", medianMs: 512.98 },
    { tool: "i18next-cli", medianMs: 378.21 },
  ],
  ratios: {
    lingui: "26.06×",
    formatjs: "6.63×",
    i18nextParser: "11.69×",
    i18nextCli: "8.62×",
  },
}

export const BENCH_MEDIUM: BenchCorpus = {
  id: "medium",
  title: "Medium corpus — 240 files, 1920 messages (median of 7 runs)",
  corpus: "240 files, 1920 messages",
  rows: [
    { tool: "Palamedes", medianMs: 46.93, accent: true },
    { tool: "Lingui", medianMs: 760.77 },
    { tool: "FormatJS", medianMs: 299.82 },
    { tool: "i18next-parser", medianMs: 569.17 },
    { tool: "i18next-cli", medianMs: 584.74 },
  ],
  ratios: {
    lingui: "16.21×",
    formatjs: "6.39×",
    i18nextParser: "12.13×",
    i18nextCli: "12.46×",
  },
}

export const BENCH_REALISTIC: BenchCorpus = {
  id: "realistic",
  title: "Realistic corpus — 1,500 files across ~400k lines, 6,000 messages (median of 7 runs)",
  corpus: "1,500 files (750 with i18n), ~400k lines, 6,000 messages",
  rows: [
    { tool: "Palamedes", medianMs: 179.87, accent: true },
    { tool: "Lingui", medianMs: 2238.75 },
    { tool: "FormatJS", medianMs: 474.62 },
    { tool: "i18next-parser", medianMs: 1641.15 },
    { tool: "i18next-cli", medianMs: 6612.71 },
  ],
  ratios: {
    lingui: "12.45×",
    formatjs: "2.64×",
    i18nextParser: "9.12×",
    i18nextCli: "36.76×",
  },
}
