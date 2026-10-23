import { readFile } from "node:fs/promises";
import path from "node:path";
import { RUNNERS } from "../src/blacksmith-report.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const readJson = async (file) => JSON.parse(await readFile(path.join(root, file), "utf8"));
export const original = {
  react: await readJson("benchmarks/e2e-workflow/results/latest.json"),
  frameworks: await readJson("benchmarks/e2e-workflow/results/frameworks/latest.json"),
};
export const expected = {
  platform: "macos-arm64",
  revision: "a".repeat(40),
  runId: "123",
  attempt: "1",
};

export function campaign(platform = expected.platform) {
  const runner = RUNNERS[platform];
  return [1, 2, 3].map((repetition) => {
    const { react, frameworks } = structuredClone(original);
    const environment = {
      platform: runner.platform,
      arch: runner.arch,
      node: "v24.22.0",
      cpu: "fixture CPU",
      cpuCount: platform === "macos-arm64" ? 6 : 4,
    };
    Object.assign(react.environment, environment, { nodeVersion: environment.node });
    Object.assign(frameworks.environment, environment, {
      revision: expected.revision,
      dirty: false,
    });
    return {
      react,
      frameworks,
      manifest: {
        schemaVersion: 1,
        status: "complete",
        provider: "blacksmith",
        dirty: false,
        ...expected,
        platform,
        finishedAt: "2026-10-23T12:00:00.000Z",
        runnerLabel: runner.label,
        repetition,
        environment,
        workflow: { event: "workflow_dispatch", revision: expected.revision },
        measurement: {
          runs: 7,
          warmup: 3,
          seed: react.seed,
          profiles: ["small", "medium", "realistic"],
        },
        locks: Object.fromEntries(
          ["Cargo.lock", "pnpm-lock.yaml", "benchmarks/e2e-workflow/frameworks/pnpm-lock.yaml"].map(
            (file) => [file, "b".repeat(64)],
          ),
        ),
        toolchain: { rustc: "fixture", cargo: "fixture", pnpm: "fixture" },
        build: { profile: "release", locked: true, rustflags: "", encodedRustflags: "" },
      },
    };
  });
}
