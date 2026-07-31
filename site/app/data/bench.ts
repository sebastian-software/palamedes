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
  ratios: { lingui: string; formatjs: string; i18nextCli: string }
}

/*
 * The warm lane: what the *next* extract costs after an edit, which is the run
 * a developer triggers dozens of times a day. Palamedes reuses its extraction
 * cache here (ADR-019); the compared tools have no comparable local cache and
 * re-extract in full, so their warm medians equal their cold ones.
 *
 * That is why this shape carries no competitor row and no ratio field: warm is
 * a capability difference, not a like-for-like race, and it must never reach a
 * speedup claim. The only comparison it supports is Palamedes against its own
 * cold run. scripts/verify-site-bench-data.mjs asserts both medians and the
 * touched-file count against the report.
 */
export interface BenchWarm {
  id: "small" | "medium" | "realistic"
  corpus: string
  /** Source files edited before each warm run, per the report's warm lane. */
  touchedFiles: number
  coldMs: number
  warmMs: number
}

export const BENCH_META = {
  generated: "2026-07-31",
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
    { tool: "Palamedes", medianMs: 12.82, accent: true },
    { tool: "Lingui", medianMs: 690.97 },
    { tool: "React Intl", medianMs: 282.84 },
    { tool: "i18next-cli", medianMs: 404.93 },
  ],
  ratios: {
    lingui: "53.91×",
    formatjs: "22.07×",
    i18nextCli: "31.59×",
  },
}

export const BENCH_MEDIUM: BenchCorpus = {
  id: "medium",
  title: "Medium corpus — 240 files, 1920 messages (median of 7 runs)",
  corpus: "240 files, 1920 messages",
  rows: [
    { tool: "Palamedes", medianMs: 22.22, accent: true },
    { tool: "Lingui", medianMs: 761.69 },
    { tool: "React Intl", medianMs: 305.9 },
    { tool: "i18next-cli", medianMs: 618.69 },
  ],
  ratios: {
    lingui: "34.27×",
    formatjs: "13.76×",
    i18nextCli: "27.84×",
  },
}

export const BENCH_REALISTIC: BenchCorpus = {
  id: "realistic",
  title: "Realistic corpus — 1,500 files across ~400k lines, 6,000 messages (median of 7 runs)",
  corpus: "1,500 files (750 with i18n), ~400k lines, 6,000 messages",
  rows: [
    { tool: "Palamedes", medianMs: 82.14, accent: true },
    { tool: "Lingui", medianMs: 2405.52 },
    { tool: "React Intl", medianMs: 470.81 },
    { tool: "i18next-cli", medianMs: 6256.98 },
  ],
  ratios: {
    lingui: "29.29×",
    formatjs: "5.73×",
    i18nextCli: "76.18×",
  },
}

/*
 * Only BENCH_REALISTIC_WARM is rendered — it is passed to BenchmarkChart on
 * home, proof, and the topic pages, where it becomes a second, marked
 * Palamedes bar. The two smaller corpora are kept for the same reason as their
 * cold counterparts: they back the doc tables and are guarded against the
 * report.
 */
export const BENCH_SMALL_WARM: BenchWarm = {
  id: "small",
  corpus: "80 files, 640 messages",
  touchedFiles: 5,
  coldMs: 12.82,
  warmMs: 10.27,
}

export const BENCH_MEDIUM_WARM: BenchWarm = {
  id: "medium",
  corpus: "240 files, 1920 messages",
  touchedFiles: 5,
  coldMs: 22.22,
  warmMs: 14.05,
}

export const BENCH_REALISTIC_WARM: BenchWarm = {
  id: "realistic",
  corpus: "1,500 files (750 with i18n), ~400k lines, 6,000 messages",
  touchedFiles: 5,
  coldMs: 82.14,
  warmMs: 33.11,
}
