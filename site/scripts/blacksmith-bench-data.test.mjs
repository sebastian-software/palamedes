import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  blacksmithBenchData,
  BLACKSMITH_REPORT,
  importBlacksmithBenchmarks,
  loadBlacksmithBenchData,
} from "../../scripts/blacksmith-bench-data.mjs";
import { campaign, expected } from "../../benchmarks/e2e-workflow/test-fixtures/blacksmith.mjs";
import { mergeShards, sha256 } from "../../benchmarks/e2e-workflow/src/blacksmith-report.mjs";

function publication() {
  return {
    schemaVersion: 1,
    runId: expected.runId,
    attempt: expected.attempt,
    revision: expected.revision,
    platforms: { "linux-x86-64": campaign("linux-x86-64"), "macos-arm64": campaign() },
  };
}

test("keeps both columns pending without borrowing local timings", () => {
  const data = blacksmithBenchData(null);
  assert.equal(data.status, "pending");
  assert.deepEqual(
    data.platforms.map((p) => p.label),
    ["Linux", "macOS"],
  );
  assert.deepEqual(data.profiles, []);
  assert.ok(!JSON.stringify(data).includes("medianMs"));
});

test("publishes active cold cases as paired platform medians with honest exclusions", () => {
  const data = blacksmithBenchData(publication());
  const rows = data.profiles.flatMap((p) => p.frameworks.flatMap((f) => f.rows));
  assert.equal(data.status, "measured");
  assert.equal(rows.length, 60);
  assert.equal(rows.filter((row) => row.tool === "Intlayer").length, 9);
  assert.ok(
    rows
      .filter((row) => row.tool === "Intlayer")
      .every((row) =>
        Object.values(row.values).every(
          (value) => value.status === "not-equivalent" && value.medianMs === undefined,
        ),
      ),
  );
  assert.equal(rows.find((row) => row.tool === "Wuchale").scope, "extract + update + compile");
  assert.equal(rows.find((row) => row.tool === "React Intl").scope, "extract + write");
  assert.ok(
    !/samplesMs|rawSamplesMs|pmdsBin|catalogDirectory|sourceSha256|vmMediansMs/u.test(
      JSON.stringify(data),
    ),
  );
  assert.ok(data.runUrl.endsWith(`/runs/${expected.runId}/attempts/${expected.attempt}`));
});

test("rejects partial, mixed, corrupt, local or failed campaigns instead of filling a column", () => {
  for (const change of [
    (p) => {
      delete p.platforms["linux-x86-64"];
    },
    (p) => {
      p.platforms["linux-x86-64"].pop();
    },
    (p) => {
      p.platforms["linux-x86-64"][0].manifest.runId = "999";
    },
    (p) => {
      p.platforms["linux-x86-64"][0].manifest.provider = "local-diagnostic";
    },
    (p) => {
      p.platforms["macos-arm64"][0].frameworks.profiles[0].results[0].medianMs = 0;
    },
    (p) => {
      for (const s of p.platforms["linux-x86-64"]) s.manifest.locks["Cargo.lock"] = "c".repeat(64);
    },
    (p) => {
      for (const s of p.platforms["linux-x86-64"]) {
        s.manifest.environment.node = "v24.99.0";
        s.react.environment.nodeVersion = "v24.99.0";
        s.react.environment.node = "v24.99.0";
        s.frameworks.environment.node = "v24.99.0";
      }
    },
  ]) {
    const changed = publication();
    change(changed);
    assert.throws(() => blacksmithBenchData(changed));
  }
});

test("only an absent campaign is pending; a malformed existing file fails the build", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "palamedes-pending-bench-test-"));
  try {
    assert.equal((await loadBlacksmithBenchData(root)).status, "pending");
    const file = path.join(root, BLACKSMITH_REPORT);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "{}");
    await assert.rejects(loadBlacksmithBenchData(root));
    // An inaccessible root must not be silently presented as an absent report.
    await writeFile(path.join(root, "not-a-directory"), "file");
    await assert.rejects(loadBlacksmithBenchData(path.join(root, "not-a-directory")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("imports complete platform artifacts and refuses a summary that disagrees with raw reports", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "palamedes-bench-import-test-"));
  try {
    const pub = publication();
    const roots = {};
    for (const [id, shards] of Object.entries(pub.platforms)) {
      const platformRoot = path.join(root, id);
      roots[id] = platformRoot;
      await mkdir(platformRoot);
      for (const shard of shards) {
        const runRoot = path.join(platformRoot, `run${shard.manifest.repetition}`);
        await mkdir(path.join(runRoot, "react"), { recursive: true });
        await mkdir(path.join(runRoot, "frameworks"));
        const files = {
          "react/latest.json": JSON.stringify(shard.react),
          "frameworks/latest.json": JSON.stringify(shard.frameworks),
          "source.tar.gz": "synthetic test archive",
        };
        shard.manifest.evidenceHashes = {};
        for (const [file, bytes] of Object.entries(files)) {
          await writeFile(path.join(runRoot, file), bytes);
          shard.manifest.evidenceHashes[file] = sha256(bytes);
        }
        await writeFile(path.join(runRoot, "manifest.json"), JSON.stringify(shard.manifest));
      }
      const report = mergeShards(shards, { ...expected, platform: id });
      await writeFile(path.join(platformRoot, "report.json"), JSON.stringify(report));
    }
    const options = { linux: roots["linux-x86-64"], macos: roots["macos-arm64"], repoRoot: root };
    const file = await importBlacksmithBenchmarks(options);
    assert.equal(file, path.join(root, BLACKSMITH_REPORT));
    assert.equal((await loadBlacksmithBenchData(root)).status, "measured");
    const reportFile = path.join(options.linux, "report.json");
    const tampered = JSON.parse(await readFile(reportFile, "utf8"));
    tampered.results[0].medianMs = 0;
    await writeFile(reportFile, JSON.stringify(tampered));
    await assert.rejects(importBlacksmithBenchmarks(options), /aggregate differs/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("validates the retained historical campaign without publishing its retired comparator", async () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const retained = JSON.parse(await readFile(path.join(root, BLACKSMITH_REPORT), "utf8"));
  const original = structuredClone(retained);
  const data = blacksmithBenchData(retained);
  const rows = data.profiles.flatMap((p) => p.frameworks.flatMap((f) => f.rows));
  assert.equal(rows.length, 60);
  assert.ok(!rows.some((row) => row.tool === "vue3-gettext"));
  assert.ok(!rows.some((row) => row.tool === undefined));
  assert.deepEqual(retained, original);
});
