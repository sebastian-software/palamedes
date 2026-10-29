import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { RUNNERS } from "./blacksmith-report.mjs";

export function receiptNames({ platform, runId, attempt }) {
  return [1, 2, 3].map((run) => `runner-class-${platform}-run${run}-${runId}-${attempt}`);
}

export function validateRunnerClasses(receipts, expected) {
  assert.equal(receipts.length, 3, "three runner-class receipts are required");
  assert.deepEqual(receipts.map((r) => r.repetition).sort(), [1, 2, 3]);
  const runner = RUNNERS[expected.platform];
  assert.ok(runner, "unknown runner profile");
  for (const receipt of receipts) {
    for (const key of ["platform", "revision", "runId", "attempt"])
      assert.equal(receipt[key], expected[key], `runner-class receipt has a different ${key}`);
    assert.equal(receipt.hardware.platform, runner.platform);
    assert.equal(receipt.hardware.arch, runner.arch);
    assert.ok(receipt.hardware.cpu);
    assert.ok(Number.isInteger(receipt.hardware.cpuCount) && receipt.hardware.cpuCount > 0);
    assert.deepEqual(
      receipt.hardware,
      receipts[0].hardware,
      "runner hardware classes differ; stop before building or measuring",
    );
  }
  return receipts[0].hardware;
}

export async function waitForReceipts({
  expected,
  listArtifacts,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  timeoutMs = 180_000,
}) {
  const required = receiptNames(expected);
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const names = new Set(
      (await listArtifacts())
        .filter((artifact) => !artifact.expired)
        .map((artifact) => artifact.name),
    );
    if (required.every((name) => names.has(name))) return;
    await sleep(2000);
  }
  throw new Error("Timed out waiting for three runner-class receipts; no measurements started");
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      platform: { type: "string" },
      repetition: { type: "string" },
      output: { type: "string" },
      directory: { type: "string" },
    },
  });
  const expected = {
    platform: values.platform,
    revision: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
  };
  assert.ok(RUNNERS[expected.platform], "unknown runner profile");
  assert.match(expected.revision ?? "", /^[a-f0-9]{40}$/u);
  assert.match(expected.runId ?? "", /^\d+$/u);
  assert.match(expected.attempt ?? "", /^[1-9]\d*$/u);
  if (positionals[0] === "record") {
    const repetition = Number(values.repetition);
    assert.ok([1, 2, 3].includes(repetition));
    const receipt = {
      ...expected,
      repetition,
      hardware: {
        platform: process.platform,
        arch: process.arch,
        cpu: os.cpus()[0]?.model,
        cpuCount: os.cpus().length,
        node: process.version,
        imageOS: process.env.ImageOS ?? null,
        imageVersion: process.env.ImageVersion ?? null,
      },
    };
    await writeFile(values.output, `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(`Runner class: ${JSON.stringify(receipt.hardware)}`);
    return;
  }
  if (positionals[0] === "wait") {
    assert.ok(process.env.GH_TOKEN, "artifact lookup requires a read-only GitHub token");
    await waitForReceipts({
      expected,
      async listArtifacts() {
        const response = await fetch(
          `${process.env.GITHUB_API_URL}/repos/${process.env.GITHUB_REPOSITORY}/actions/runs/${expected.runId}/artifacts?per_page=100`,
          {
            headers: { Authorization: `Bearer ${process.env.GH_TOKEN}` },
            signal: AbortSignal.timeout(10_000),
          },
        );
        assert.ok(response.ok, `runner-class artifact lookup failed (${response.status})`);
        return (await response.json()).artifacts;
      },
    });
    return;
  }
  assert.equal(positionals[0], "validate", "expected record, wait or validate");
  const receipts = await Promise.all(
    receiptNames(expected).map(async (name) =>
      JSON.parse(await readFile(path.join(values.directory, name, "runner-class.json"), "utf8")),
    ),
  );
  console.log(
    `Validated runner class: ${JSON.stringify(validateRunnerClasses(receipts, expected))}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
