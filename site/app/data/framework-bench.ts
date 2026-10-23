import data from "./generated/framework-bench.json";
import {
  BENCH_META,
  BENCH_REALISTIC,
  BENCH_REALISTIC_WARM,
  type BenchRow,
  type BenchWarm,
} from "./bench";

export const frameworkBench = data;
export const BENCHMARK_FRAMEWORKS = [
  { id: "react", label: "React" },
  { id: "vue", label: "Vue" },
  { id: "svelte", label: "Svelte" },
  { id: "solid", label: "Solid" },
] as const;
export type BenchmarkFramework = (typeof BENCHMARK_FRAMEWORKS)[number]["id"];

export interface BenchmarkView {
  framework: BenchmarkFramework;
  label: string;
  corpus: string;
  rows: BenchRow[];
  warm?: BenchWarm;
  meta: { generated: string; node: string; platform: string; runs: number; cpu?: string };
  command: string;
  reportPath: string;
}

export function benchmarkView(framework: BenchmarkFramework): BenchmarkView {
  if (framework === "react")
    return {
      framework,
      label: "React",
      corpus: BENCH_REALISTIC.corpus,
      rows: BENCH_REALISTIC.rows.filter((row) => row.tool !== "React Intl"),
      warm: BENCH_REALISTIC_WARM,
      meta: BENCH_META,
      command: "pnpm benchmark:e2e-workflow",
      reportPath: BENCH_META.reportPath,
    };
  const profile = frameworkBench.profiles.find((item) => item.id === "realistic")!;
  const selected = profile.frameworks.find((item) => item.id === framework)!;
  const rows = selected.rows.flatMap((row, order) =>
    row.medianMs === undefined
      ? []
      : [
          {
            tool: row.tool,
            displayName: row.tool,
            medianMs: row.medianMs,
            scope: row.scope,
            sameScope: row.scope === "extract + catalog update" && row.tool !== "Palamedes",
            accent: row.tool === "Palamedes",
            order,
          },
        ],
  );
  return {
    framework,
    label: selected.label,
    corpus: `${selected.rows.find((row) => row.files !== undefined)!.files!.toLocaleString("en-US")} files, ${profile.messages.toLocaleString("en-US")} messages`,
    rows,
    meta: frameworkBench.meta,
    command: "pnpm benchmark:framework-workflow",
    reportPath: frameworkBench.meta.reportPath,
  };
}
