import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { receiptNames, validateRunnerClasses, waitForReceipts } from "./runner-class.mjs";

const expected = { platform: "linux-x86-64", revision: "a".repeat(40), runId: "123", attempt: "1" };
const receipts = () =>
  [1, 2, 3].map((repetition) => ({
    ...expected,
    repetition,
    hardware: {
      platform: "linux",
      arch: "x64",
      cpu: "AMD EPYC",
      cpuCount: 4,
      node: "v24.22.0",
      imageOS: "ubuntu24",
      imageVersion: "fixture",
    },
  }));

test(
  "the preflight CLI works without installed dependencies and rejects a downloaded mixed cohort",
  {
    skip: !(
      (process.platform === "linux" && process.arch === "x64") ||
      (process.platform === "darwin" && process.arch === "arm64")
    ),
  },
  async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "palamedes-runner-class-")));
    const platform = process.platform === "darwin" ? "macos-arm64" : "linux-x86-64";
    const env = {
      ...process.env,
      GITHUB_SHA: expected.revision,
      GITHUB_RUN_ID: expected.runId,
      GITHUB_RUN_ATTEMPT: expected.attempt,
    };
    const source = path.join(root, "source");
    await mkdir(source);
    for (const file of ["runner-class.mjs", "blacksmith-report.mjs", "corpus.mjs", "exec.mjs"])
      await copyFile(path.join(import.meta.dirname, file), path.join(source, file));
    const entry = path.join(source, "runner-class.mjs");
    const run = (args) =>
      spawnSync(process.execPath, [entry, ...args, "--platform", platform], {
        env,
        encoding: "utf8",
      });
    try {
      const names = receiptNames({ ...expected, platform });
      for (const [index, name] of names.entries()) {
        await mkdir(path.join(root, name));
        const result = run([
          "record",
          "--repetition",
          String(index + 1),
          "--output",
          path.join(root, name, "runner-class.json"),
        ]);
        assert.equal(result.status, 0, result.stderr);
      }
      assert.equal(run(["validate", "--directory", root]).status, 0);
      const file = path.join(root, names[1], "runner-class.json");
      const receipt = JSON.parse(await readFile(file, "utf8"));
      receipt.hardware.cpu = "another CPU class";
      await writeFile(file, JSON.stringify(receipt));
      const rejected = run(["validate", "--directory", root]);
      assert.equal(rejected.status, 1);
      assert.match(rejected.stderr, /hardware classes differ/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("runner preflight accepts a complete homogeneous platform and rejects mixed or foreign receipts", () => {
  assert.equal(validateRunnerClasses(receipts(), expected).cpu, "AMD EPYC");
  for (const mutate of [
    (r) => {
      r.pop();
    },
    (r) => {
      r[1].repetition = 1;
    },
    (r) => {
      r[1].hardware.cpu = "Intel Xeon";
    },
    (r) => {
      r[1].hardware.cpuCount = 8;
    },
    (r) => {
      r[1].hardware.imageVersion = "other";
    },
    (r) => {
      r[1].revision = "b".repeat(40);
    },
    (r) => {
      r[1].runId = "456";
    },
    (r) => {
      r[1].attempt = "2";
    },
    (r) => {
      r[1].platform = "macos-arm64";
    },
    (r) => {
      for (const receipt of r) receipt.hardware.arch = "arm64";
    },
  ]) {
    const changed = receipts();
    mutate(changed);
    assert.throws(() => validateRunnerClasses(changed, expected));
  }
});

test("runner preflight waits for all current-attempt receipts rather than accepting stale artifacts", async () => {
  let time = 0;
  let calls = 0;
  const names = receiptNames(expected);
  await waitForReceipts({
    expected,
    now: () => time,
    async sleep(ms) {
      time += ms;
    },
    async listArtifacts() {
      calls++;
      return (calls === 1 ? names.slice(0, 2) : names).map((name) => ({ name, expired: false }));
    },
  });
  assert.equal(calls, 2);
  time = 0;
  await assert.rejects(
    waitForReceipts({
      expected,
      timeoutMs: 3000,
      now: () => time,
      async sleep(ms) {
        time += ms;
      },
      listArtifacts: async () => [
        ...receiptNames({ ...expected, attempt: "2" }).map((name) => ({ name })),
        ...names.map((name) => ({ name, expired: true })),
      ],
    }),
    /Timed out/u,
  );
});
