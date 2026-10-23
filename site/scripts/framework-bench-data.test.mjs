import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  FRAMEWORK_REPORT,
  INTLAYER_REPORT,
  frameworkBenchData,
} from "../../scripts/framework-bench-data.mjs";

const root = resolve(import.meta.dirname, "../..");
const [report, diagnostic] = await Promise.all(
  [FRAMEWORK_REPORT, INTLAYER_REPORT].map(async (file) =>
    JSON.parse(await readFile(resolve(root, file), "utf8")),
  ),
);

test("publication projects every measured case and excludes failed timings and raw process data", () => {
  const data = frameworkBenchData(report, diagnostic);
  const rows = data.profiles.flatMap((profile) =>
    profile.frameworks.flatMap((framework) => framework.rows),
  );
  assert.equal(rows.length, 45);
  assert.ok(rows.every((row) => /^\d+\.\d+\.\d+/u.test(row.version)));
  assert.equal(rows.find((row) => row.tool === "Wuchale").version, report.versions.wuchale);
  assert.equal(rows.filter((row) => row.medianMs !== undefined).length, 36);
  assert.ok(
    rows
      .filter((row) => row.status === "not-equivalent")
      .every((row) => row.medianMs === undefined),
  );
  assert.ok(!/samplesMs|pmdsBin|uiCatalogDir|sourceSha256/u.test(JSON.stringify(data)));
  assert.equal(data.diagnostics.length, 6);
  assert.ok(
    data.diagnostics
      .filter((row) => row.format === ".content.ts")
      .every((row) => row.preserved === row.expectedPreserved),
  );
});

test("publication rejects stale numbers and missing or corrupted semantic receipts", () => {
  for (const mutate of [
    (row) => {
      row.medianMs = 0;
    },
    (row) => {
      row.samplesMs.pop();
    },
    (row) => {
      row.validation.preservedTranslations--;
    },
    (row) => {
      row.validation.observed.en.missingCount++;
    },
  ]) {
    const changed = structuredClone(report);
    mutate(changed.profiles[0].results[0]);
    assert.throws(() => frameworkBenchData(changed, diagnostic));
  }
});

test("publication rejects quick/dirty reports and mislabeled broader Wuchale work", () => {
  const dirty = structuredClone(report);
  dirty.environment.dirty = true;
  assert.throws(() => frameworkBenchData(dirty, diagnostic), /clean measured revision/u);
  const quick = structuredClone(report);
  quick.options.runs = 3;
  assert.throws(() => frameworkBenchData(quick, diagnostic), /seven measured samples/u);
  const scope = structuredClone(report);
  scope.profiles[0].results.find((row) => row.tool === "wuchale").scope = "extract-update";
  assert.throws(() => frameworkBenchData(scope, diagnostic));
});
