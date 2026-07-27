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
    { tool: "Palamedes", medianMs: 35.98, accent: true },
    { tool: "Lingui", medianMs: 658.17 },
    { tool: "FormatJS", medianMs: 275.79 },
    { tool: "i18next-parser", medianMs: 506.04 },
    { tool: "i18next-cli", medianMs: 382.87 },
  ],
  ratios: {
    lingui: "18.29×",
    formatjs: "7.66×",
    i18nextParser: "14.06×",
    i18nextCli: "10.64×",
  },
}

export const BENCH_MEDIUM: BenchCorpus = {
  id: "medium",
  title: "Medium corpus — 240 files, 1920 messages (median of 7 runs)",
  corpus: "240 files, 1920 messages",
  rows: [
    { tool: "Palamedes", medianMs: 47.68, accent: true },
    { tool: "Lingui", medianMs: 732.81 },
    { tool: "FormatJS", medianMs: 293.86 },
    { tool: "i18next-parser", medianMs: 565.67 },
    { tool: "i18next-cli", medianMs: 568.56 },
  ],
  ratios: {
    lingui: "15.37×",
    formatjs: "6.16×",
    i18nextParser: "11.86×",
    i18nextCli: "11.93×",
  },
}

export const BENCH_REALISTIC: BenchCorpus = {
  id: "realistic",
  title: "Realistic corpus — 1,500 files across ~400k lines, 6,000 messages (median of 7 runs)",
  corpus: "1,500 files (750 with i18n), ~400k lines, 6,000 messages",
  rows: [
    { tool: "Palamedes", medianMs: 192.94, accent: true },
    { tool: "Lingui", medianMs: 2342.49 },
    { tool: "FormatJS", medianMs: 472.18 },
    { tool: "i18next-parser", medianMs: 1540.72 },
    { tool: "i18next-cli", medianMs: 5804.35 },
  ],
  ratios: {
    lingui: "12.14×",
    formatjs: "2.45×",
    i18nextParser: "7.99×",
    i18nextCli: "30.08×",
  },
}
