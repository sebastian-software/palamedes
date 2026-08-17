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
  ratios: { lingui: string; formatjs: string; fbtee: string; i18nextCli: string; gt: string }
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
  generated: "2026-08-14",
  node: "v24.19.0",
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
      medianMs: 11.93,
      accent: true,
      displayName: "Palamedes",
      scope: "extract + catalog update",
      sameScope: false,
      order: 0,
    },
    {
      tool: "Lingui",
      medianMs: 618.1,
      displayName: "Lingui",
      scope: "extract + catalog update",
      sameScope: true,
      order: 2,
    },
    {
      tool: "React Intl",
      medianMs: 229.11,
      displayName: "React Intl",
      scope: "extraction only · narrower scope",
      sameScope: false,
      order: 1,
    },
    {
      tool: "fbtee",
      medianMs: 537.28,
      displayName: "fbtee",
      scope: "collect + two-catalog update · two CLI commands",
      sameScope: true,
      order: 3,
    },
    {
      tool: "i18next-cli",
      medianMs: 326.62,
      displayName: "i18next-cli",
      scope: "extract + catalog update",
      sameScope: true,
      order: 5,
    },
    {
      tool: "General Translation",
      medianMs: 443.86,
      displayName: "General Translation",
      scope: "extract + catalog update",
      sameScope: true,
      order: 4,
    },
  ],
  ratios: {
    lingui: "51.83×",
    formatjs: "19.21×",
    fbtee: "45.05×",
    i18nextCli: "27.39×",
    gt: "37.22×",
  },
}

export const BENCH_MEDIUM: BenchCorpus = {
  id: "medium",
  title: "Medium corpus — 240 files, 1920 messages (median of 7 runs)",
  corpus: "240 files, 1920 messages",
  rows: [
    {
      tool: "Palamedes",
      medianMs: 21.12,
      accent: true,
      displayName: "Palamedes",
      scope: "extract + catalog update",
      sameScope: false,
      order: 0,
    },
    {
      tool: "Lingui",
      medianMs: 691.2,
      displayName: "Lingui",
      scope: "extract + catalog update",
      sameScope: true,
      order: 2,
    },
    {
      tool: "React Intl",
      medianMs: 246.85,
      displayName: "React Intl",
      scope: "extraction only · narrower scope",
      sameScope: false,
      order: 1,
    },
    {
      tool: "fbtee",
      medianMs: 1058.43,
      displayName: "fbtee",
      scope: "collect + two-catalog update · two CLI commands",
      sameScope: true,
      order: 3,
    },
    {
      tool: "i18next-cli",
      medianMs: 518.95,
      displayName: "i18next-cli",
      scope: "extract + catalog update",
      sameScope: true,
      order: 5,
    },
    {
      tool: "General Translation",
      medianMs: 510.98,
      displayName: "General Translation",
      scope: "extract + catalog update",
      sameScope: true,
      order: 4,
    },
  ],
  ratios: {
    lingui: "32.72×",
    formatjs: "11.69×",
    fbtee: "50.11×",
    i18nextCli: "24.57×",
    gt: "24.19×",
  },
}

export const BENCH_REALISTIC: BenchCorpus = {
  id: "realistic",
  title: "Realistic corpus — 1,500 files across ~400k lines, 6,000 messages (median of 7 runs)",
  corpus: "1,500 files (750 with i18n), ~400k lines, 6,000 messages",
  rows: [
    {
      tool: "Palamedes",
      medianMs: 72.55,
      accent: true,
      displayName: "Palamedes",
      scope: "extract + catalog update",
      sameScope: false,
      order: 0,
    },
    {
      tool: "Lingui",
      medianMs: 2199.62,
      displayName: "Lingui",
      scope: "extract + catalog update",
      sameScope: true,
      order: 2,
    },
    {
      tool: "React Intl",
      medianMs: 424.33,
      displayName: "React Intl",
      scope: "extraction only · narrower scope",
      sameScope: false,
      order: 1,
    },
    {
      tool: "fbtee",
      medianMs: 7262.88,
      displayName: "fbtee",
      scope: "collect + two-catalog update · two CLI commands",
      sameScope: true,
      order: 3,
    },
    {
      tool: "i18next-cli",
      medianMs: 5817.65,
      displayName: "i18next-cli",
      scope: "extract + catalog update",
      sameScope: true,
      order: 5,
    },
    {
      tool: "General Translation",
      medianMs: 5107.94,
      displayName: "General Translation",
      scope: "extract + catalog update",
      sameScope: true,
      order: 4,
    },
  ],
  ratios: {
    lingui: "30.32×",
    formatjs: "5.85×",
    fbtee: "100.12×",
    i18nextCli: "80.19×",
    gt: "70.41×",
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
  coldMs: 11.93,
  warmMs: 9.09,
}

export const BENCH_MEDIUM_WARM: BenchWarm = {
  id: "medium",
  corpus: "240 files, 1920 messages",
  touchedFiles: 5,
  coldMs: 21.12,
  warmMs: 12.87,
}

export const BENCH_REALISTIC_WARM: BenchWarm = {
  id: "realistic",
  corpus: "1,500 files (750 with i18n), ~400k lines, 6,000 messages",
  touchedFiles: 5,
  coldMs: 72.55,
  warmMs: 46.72,
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
