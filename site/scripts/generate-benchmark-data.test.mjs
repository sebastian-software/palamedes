import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import {
  BLACKSMITH_REPORT,
  loadBlacksmithBenchData,
} from "../../scripts/blacksmith-bench-data.mjs";
import { reactBenchmarkVersions } from "../../scripts/benchmark-tool-versions.mjs";
import {
  FRAMEWORK_REPORT,
  INTLAYER_REPORT,
  loadFrameworkBenchData,
} from "../../scripts/framework-bench-data.mjs";
import { writeBenchmarkData } from "./generate-benchmark-data.mjs";

const repository = resolve(import.meta.dirname, "../..");
const reactReport = "benchmarks/e2e-workflow/results/latest.json";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "palamedes-benchmark-data-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const file of [reactReport, FRAMEWORK_REPORT, INTLAYER_REPORT, BLACKSMITH_REPORT]) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await copyFile(join(repository, file), join(root, file));
  }
  return root;
}

test("a fresh checkout generates the exact benchmark imports without a site build", async (t) => {
  const root = await fixture(t);
  const output = join(root, "site/app/data/generated");
  await assert.rejects(readdir(output), { code: "ENOENT" });
  const original = await readFile(join(root, reactReport), "utf8");
  await writeBenchmarkData(root);
  assert.deepEqual((await readdir(output)).sort(), [
    "benchmark-versions.json",
    "blacksmith-bench.json",
    "framework-bench.json",
  ]);
  for (const [file, expected] of [
    [
      "benchmark-versions.json",
      `${JSON.stringify(reactBenchmarkVersions(JSON.parse(original)))}\n`,
    ],
    ["framework-bench.json", `${JSON.stringify(await loadFrameworkBenchData(root), null, 2)}\n`],
    ["blacksmith-bench.json", `${JSON.stringify(await loadBlacksmithBenchData(root))}\n`],
  ]) {
    assert.equal(await readFile(join(output, file), "utf8"), expected);
    await writeFile(join(output, file), "stale data\n");
  }
  await writeBenchmarkData(root);
  const versions = JSON.parse(await readFile(join(output, "benchmark-versions.json"), "utf8"));
  assert.equal(versions.Lingui, JSON.parse(original).versions.lingui.cli);
  assert.equal(await readFile(join(root, reactReport), "utf8"), original);
  assert.deepEqual(await readdir(join(root, "site")), ["app"]);
});

test("invalid measured versions fail before creating generated data", async (t) => {
  const root = await fixture(t);
  const path = join(root, reactReport);
  const report = JSON.parse(await readFile(path, "utf8"));
  delete report.versions.lingui;
  await writeFile(path, JSON.stringify(report));
  await assert.rejects(
    writeBenchmarkData(root),
    /Missing measured tool version for react\/lingui/u,
  );
  await assert.rejects(readdir(join(root, "site")), { code: "ENOENT" });
});
