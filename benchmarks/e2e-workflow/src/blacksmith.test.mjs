import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { cliArtifacts, createOutputDirectory } from "./blacksmith.mjs";
import { mergeShards, readShard, renderSummary, sha256 } from "./blacksmith-report.mjs";
import { parseArgs, toolOrder, writeOutputs } from "./run.mjs";
import { campaign, expected, original } from "../test-fixtures/blacksmith.mjs";

const root = path.resolve(import.meta.dirname, "../../..");

test("aggregates retained evidence in a Node-only checkout without comparator dependencies", async () => {
  const parent = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "palamedes-node-only-merge-")),
  );
  try {
    const source = path.join(parent, "source/benchmarks/e2e-workflow/src");
    await mkdir(source, { recursive: true });
    for (const name of ["blacksmith.mjs", "blacksmith-report.mjs", "corpus.mjs", "exec.mjs"])
      await cp(path.join(import.meta.dirname, name), path.join(source, name));
    const roots = [];
    for (const shard of campaign()) {
      const directory = path.join(parent, `shard${shard.manifest.repetition}`);
      roots.push(directory);
      const files = {
        "react/latest.json": JSON.stringify(shard.react),
        "frameworks/latest.json": JSON.stringify(shard.frameworks),
        "source.tar.gz": "fixture source snapshot",
      };
      shard.manifest.evidenceHashes = {};
      for (const [name, bytes] of Object.entries(files)) {
        await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
        await writeFile(path.join(directory, name), bytes);
        shard.manifest.evidenceHashes[name] = sha256(bytes);
      }
      await writeFile(path.join(directory, "manifest.json"), JSON.stringify(shard.manifest));
    }
    const output = path.join(parent, "aggregate");
    const result = spawnSync(
      process.execPath,
      [
        path.join(source, "blacksmith.mjs"),
        "merge",
        "--platform",
        expected.platform,
        "--run-id",
        expected.runId,
        "--attempt",
        expected.attempt,
        "--revision",
        expected.revision,
        "--output",
        output,
        ...roots,
      ],
      { cwd: parent, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(await readFile(path.join(output, "report.json"), "utf8"));
    assert.equal(report.results.length, 81);
    assert.equal(report.revision, expected.revision);
    assert.match(await readFile(path.join(output, "summary.md"), "utf8"), /macos-arm64/u);
    for (const repetition of [1, 2, 3])
      assert.equal(
        (await readShard(path.join(output, `run${repetition}`))).manifest.repetition,
        repetition,
      );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("aggregates three VM medians without pooling samples or mixing workflow scopes", () => {
  const shards = campaign();
  const first = shards[0].react.profiles[0].results[0];
  for (const [index, shard] of shards.entries()) {
    const row = shard.react.profiles[0].results[0];
    row.rawSamplesMs = row.rawSamplesMs.map((n) => n + index * 10);
    row.medianMs += index * 10;
  }
  const report = mergeShards(shards, expected);
  const row = report.results.find((r) => r.id === "react/small/cold/palamedes");
  assert.equal(row.medianMs, first.medianMs + 10);
  assert.equal(report.results.length, 81);
  assert.equal(
    report.results.find((r) => r.id === "react/small/cold/formatjs").scope,
    "extract-write",
  );
  assert.equal(
    report.results.find((r) => r.id === "svelte/small/cold/wuchale").scope,
    "extract-update-compile",
  );
  assert.equal(report.results.find((r) => r.id === "vue/small/cold/intlayer").medianMs, undefined);
  assert.ok(report.results.some((r) => r.lane === "warm"));
  assert.doesNotMatch(renderSummary(report), /min.?max|range/iu);
});

test("rejects missing, duplicate, failed, dirty, local or unrelated VM evidence", () => {
  assert.throws(() => mergeShards(campaign().slice(0, 2), expected), /three VM/u);
  for (const mutate of [
    (s) => {
      s.manifest.repetition = 1;
    },
    (s) => {
      s.manifest.status = "failed";
    },
    (s) => {
      s.manifest.dirty = true;
    },
    (s) => {
      s.manifest.provider = "local-diagnostic";
    },
    (s) => {
      s.manifest.platform = "linux-x86-64";
    },
    (s) => {
      s.manifest.runId = "other";
    },
    (s) => {
      s.manifest.attempt = "2";
    },
    (s) => {
      s.manifest.revision = "b".repeat(40);
    },
    (s) => {
      s.manifest.locks["Cargo.lock"] = "c".repeat(64);
    },
    (s) => {
      s.manifest.environment.cpu = "different CPU";
    },
    (s) => {
      s.frameworks.versions.wuchale = "different";
    },
  ]) {
    const shards = campaign();
    mutate(shards[1]);
    assert.throws(() => mergeShards(shards, expected));
  }
});

test("rejects incomplete timings, semantic failures and changed corpora instead of summarizing them", () => {
  for (const mutate of [
    (s) => {
      s.react.profiles[0].results.pop();
    },
    (s) => {
      s.react.profiles[0].results[0].rawSamplesMs.pop();
    },
    (s) => {
      s.react.profiles[0].results[0].medianMs = 1;
    },
    (s) => {
      s.react.profiles[0].validation.tools.palamedes.activeMessagesByTarget.de = 0;
    },
    (s) => {
      s.frameworks.profiles[0].results[0].scope = "less-work";
    },
    (s) => {
      s.frameworks.profiles[0].corpus.sourceMessages = 1;
    },
    (s) => {
      s.frameworks.profiles[0].results[0].validation.preservedTranslations = 0;
    },
    (s) => {
      s.frameworks.profiles[0].results[0].validation.observed.de.unexpectedCount = 1;
    },
    (s) => {
      s.frameworks.profiles[0].results.find((r) => r.tool === "intlayer").medianMs = 1;
    },
  ]) {
    const shards = campaign();
    mutate(shards[1]);
    assert.throws(() => mergeShards(shards, expected));
  }
});

test("checks retained evidence bytes before loading a shard", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "palamedes-evidence-test-"));
  try {
    await writeFile(
      path.join(directory, "manifest.json"),
      JSON.stringify({ evidenceHashes: { "source.tar.gz": sha256("original") } }),
    );
    await writeFile(path.join(directory, "source.tar.gz"), "corrupted");
    await assert.rejects(readShard(directory), /evidence hash mismatch/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("keeps report output outside the source checkout and refuses existing evidence", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "palamedes-output-test-"));
  try {
    await assert.rejects(createOutputDirectory(path.join(root, "incidental-evidence")), /outside/u);
    const output = await createOutputDirectory(path.join(parent, "reports"));
    await assert.rejects(createOutputDirectory(output), /EEXIST/u);
    const report = structuredClone(original.react);
    const paths = await writeOutputs(report, output);
    assert.equal(paths.primaryJson, path.join(output, "latest.json"));
    assert.deepEqual(JSON.parse(await readFile(paths.primaryJson, "utf8")), report);
    assert.equal(parseArgs(["--output-dir", output]).outputDir, output);
    assert.equal(toolOrder(2)[0], "formatjs");
    assert.equal(new Set(toolOrder(2)).size, 6);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("locates CLI catalogs by Cargo package identity rather than executable directory", () => {
  const messages = [
    { reason: "build-script-executed", package_id: "other", out_dir: "/wrong" },
    { reason: "build-script-executed", package_id: "cli", out_dir: "/build/cli/out" },
    {
      reason: "compiler-artifact",
      package_id: "cli",
      target: { name: "pmds" },
      executable: "/target/release/pmds",
    },
  ]
    .map((m) => JSON.stringify(m))
    .join("\n");
  assert.deepEqual(cliArtifacts(messages), {
    binary: "/target/release/pmds",
    catalogDirectory: path.join("/build/cli/out", "catalogs"),
  });
  assert.throws(() => cliArtifacts(""), /Cargo must report/u);
});

test("retains a failed manifest and command logs when a non-CI call is rejected", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "palamedes-failed-run-test-"));
  try {
    const output = path.join(parent, "evidence");
    const platform = process.platform === "darwin" ? "macos-arm64" : "linux-x86-64";
    const result = spawnSync(
      process.execPath,
      [
        path.join(import.meta.dirname, "blacksmith.mjs"),
        "run",
        "--platform",
        platform,
        "--output",
        output,
      ],
      {
        cwd: root,
        env: { ...process.env, GITHUB_ACTIONS: "false" },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 1);
    const manifest = JSON.parse(await readFile(path.join(output, "manifest.json"), "utf8"));
    assert.equal(manifest.status, "failed");
    // The platform guard may reject Windows/x64 macOS before probing Git.
    assert.ok(manifest.error);
    assert.ok(manifest.finishedAt);
    assert.ok(!manifest.commands.some((command) => command.name === "build"));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
