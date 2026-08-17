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
  /** Public presentation metadata. Every measured tool must state its scope. */
  displayName: string
  scope: string
  sameScope: boolean
  order: number
}

export interface BenchCorpus {
  id: "small" | "medium" | "realistic"
  title: string
  corpus: string
  rows: BenchRow[]
  /*
   * Speedup ratios. The public ledger derives deliberately rounded factors
   * from the exact medians. These exact ratios are asserted against the
   * checked-in report by scripts/verify-site-bench-data.mjs, so numbers quoted
   * in prose can't silently drift.
   */
  ratios: { lingui: string; formatjs: string; i18nextCli: string; gt: string }
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
  generated: "2026-08-05",
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
    {
      tool: "Palamedes",
      medianMs: 14.11,
      accent: true,
      displayName: "Palamedes",
      scope: "extract + catalog update",
      sameScope: false,
      order: 0,
    },
    {
      tool: "Lingui",
      medianMs: 747.18,
      displayName: "Lingui",
      scope: "extract + catalog update",
      sameScope: true,
      order: 2,
    },
    {
      tool: "React Intl",
      medianMs: 288.59,
      displayName: "React Intl",
      scope: "extraction only · narrower scope",
      sameScope: false,
      order: 1,
    },
    {
      tool: "i18next-cli",
      medianMs: 625.87,
      displayName: "i18next-cli",
      scope: "extract + catalog update",
      sameScope: true,
      order: 4,
    },
    {
      tool: "General Translation",
      medianMs: 577.89,
      displayName: "GT",
      scope: "extract + catalog update",
      sameScope: true,
      order: 3,
    },
  ],
  ratios: {
    lingui: "52.94×",
    formatjs: "20.45×",
    i18nextCli: "44.35×",
    gt: "40.95×",
  },
}

export const BENCH_MEDIUM: BenchCorpus = {
  id: "medium",
  title: "Medium corpus — 240 files, 1920 messages (median of 7 runs)",
  corpus: "240 files, 1920 messages",
  rows: [
    {
      tool: "Palamedes",
      medianMs: 23.8,
      accent: true,
      displayName: "Palamedes",
      scope: "extract + catalog update",
      sameScope: false,
      order: 0,
    },
    {
      tool: "Lingui",
      medianMs: 836.69,
      displayName: "Lingui",
      scope: "extract + catalog update",
      sameScope: true,
      order: 2,
    },
    {
      tool: "React Intl",
      medianMs: 344.09,
      displayName: "React Intl",
      scope: "extraction only · narrower scope",
      sameScope: false,
      order: 1,
    },
    {
      tool: "i18next-cli",
      medianMs: 658.4,
      displayName: "i18next-cli",
      scope: "extract + catalog update",
      sameScope: true,
      order: 4,
    },
    {
      tool: "General Translation",
      medianMs: 669.27,
      displayName: "GT",
      scope: "extract + catalog update",
      sameScope: true,
      order: 3,
    },
  ],
  ratios: {
    lingui: "35.15×",
    formatjs: "14.46×",
    i18nextCli: "27.66×",
    gt: "28.12×",
  },
}

export const BENCH_REALISTIC: BenchCorpus = {
  id: "realistic",
  title: "Realistic corpus — 1,500 files across ~400k lines, 6,000 messages (median of 7 runs)",
  corpus: "1,500 files (750 with i18n), ~400k lines, 6,000 messages",
  rows: [
    {
      tool: "Palamedes",
      medianMs: 83.89,
      accent: true,
      displayName: "Palamedes",
      scope: "extract + catalog update",
      sameScope: false,
      order: 0,
    },
    {
      tool: "Lingui",
      medianMs: 2480.24,
      displayName: "Lingui",
      scope: "extract + catalog update",
      sameScope: true,
      order: 2,
    },
    {
      tool: "React Intl",
      medianMs: 475.85,
      displayName: "React Intl",
      scope: "extraction only · narrower scope",
      sameScope: false,
      order: 1,
    },
    {
      tool: "i18next-cli",
      medianMs: 6644.63,
      displayName: "i18next-cli",
      scope: "extract + catalog update",
      sameScope: true,
      order: 4,
    },
    {
      tool: "General Translation",
      medianMs: 6116.43,
      displayName: "GT",
      scope: "extract + catalog update",
      sameScope: true,
      order: 3,
    },
  ],
  ratios: {
    lingui: "29.57×",
    formatjs: "5.67×",
    i18nextCli: "79.21×",
    gt: "72.91×",
  },
}

/*
 * Only BENCH_REALISTIC_WARM is rendered — it is passed to BenchmarkLedger on
 * home, proof, and the topic pages, where it becomes a separate capability
 * callout. The two smaller corpora are kept for the same reason as their cold
 * counterparts: they back the doc tables and are guarded against the report.
 */
export const BENCH_SMALL_WARM: BenchWarm = {
  id: "small",
  corpus: "80 files, 640 messages",
  touchedFiles: 5,
  coldMs: 14.11,
  warmMs: 10.76,
}

export const BENCH_MEDIUM_WARM: BenchWarm = {
  id: "medium",
  corpus: "240 files, 1920 messages",
  touchedFiles: 5,
  coldMs: 23.8,
  warmMs: 15.16,
}

export const BENCH_REALISTIC_WARM: BenchWarm = {
  id: "realistic",
  corpus: "1,500 files (750 with i18n), ~400k lines, 6,000 messages",
  touchedFiles: 5,
  coldMs: 83.89,
  warmMs: 33.08,
}

export function displayBenchmarkTime(ms: number): string {
  const roundedMs = Math.round(ms)
  if (roundedMs < 1000) {
    return `${roundedMs.toLocaleString("en-US")} ms`
  }
  return `${(ms / 1000).toFixed(1)} s`
}

export function displayBenchmarkFactor(row: BenchRow, baselineMs: number): string {
  return row.accent ? "1×" : `${Math.floor(row.medianMs / baselineMs)}×`
}
