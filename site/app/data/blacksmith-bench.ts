import data from "./generated/blacksmith-bench.json";

export type BenchmarkPlatform = "linux-x86-64" | "macos-arm64";
export interface PlatformBenchmarkData {
  status: "pending" | "measured";
  runUrl?: string;
  revision?: string;
  reportPath?: string;
  platforms: {
    id: BenchmarkPlatform;
    label: string;
    arch: string;
    cpu?: string;
    node?: string;
    measured?: string;
    repetitions?: number;
    runs?: number;
    warmup?: number;
  }[];
  profiles: {
    id: string;
    frameworks: {
      id: string;
      rows: {
        tool: string;
        scope: string;
        values: Record<
          BenchmarkPlatform,
          { status: "validated" | "not-equivalent"; medianMs?: number }
        >;
      }[];
    }[];
  }[];
}

export const blacksmithBench = data as PlatformBenchmarkData;
