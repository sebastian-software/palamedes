import assert from "node:assert/strict";
import { cp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { DEFAULT_SEED } from "./corpus.mjs";
import { runCommand } from "./exec.mjs";
import {
  mergeShards,
  readShard,
  renderSummary,
  reportCases,
  RUNNERS,
  sha256,
} from "./blacksmith-report.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const workflowPath = ".github/workflows/blacksmith-benchmarks.yml";
const locks = ["Cargo.lock", "pnpm-lock.yaml", "benchmarks/e2e-workflow/frameworks/pnpm-lock.yaml"];
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

export function cliArtifacts(stdout) {
  const messages = stdout
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line));
  const artifact = messages.find(
    (m) => m.reason === "compiler-artifact" && m.target?.name === "pmds" && m.executable,
  );
  const build = messages.find(
    (m) => m.reason === "build-script-executed" && m.package_id === artifact?.package_id,
  );
  assert.ok(
    artifact?.executable && build?.out_dir,
    "Cargo must report the CLI executable and its UI catalogs",
  );
  return { binary: artifact.executable, catalogDirectory: path.join(build.out_dir, "catalogs") };
}

export async function createOutputDirectory(directory, sourceRoot = repoRoot) {
  // Resolve the parent through symlinks too: RUNNER_TEMP must stay outside the
  // checkout so one harness cannot dirty the next harness's provenance.
  const output = path.join(
    await realpath(path.dirname(path.resolve(directory))),
    path.basename(directory),
  );
  const source = await realpath(sourceRoot);
  const relative = path.relative(source, output);
  assert.ok(
    relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative),
    "evidence output must be outside the source checkout",
  );
  await mkdir(output); // Never replace an earlier repetition or partial evidence.
  return output;
}

async function runRepetition(options) {
  const output = await createOutputDirectory(options.output);
  const manifest = {
    schemaVersion: 1,
    status: "running",
    provider: options.diagnostic ? "local-diagnostic" : "blacksmith",
    platform: options.platform,
    runnerLabel: RUNNERS[options.platform].label,
    repetition: Number(options.repetition),
    runId: process.env.GITHUB_RUN_ID ?? "local",
    attempt: process.env.GITHUB_RUN_ATTEMPT ?? "1",
    startedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpu: os.cpus()[0]?.model,
      cpuCount: os.cpus().length,
      memoryBytes: os.totalmem(),
      osRelease: os.release(),
      runnerName: process.env.RUNNER_NAME ?? null,
    },
    runnerImage: { os: process.env.ImageOS ?? null, version: process.env.ImageVersion ?? null },
    workflow: {
      ref: process.env.GITHUB_WORKFLOW_REF ?? null,
      revision: process.env.GITHUB_WORKFLOW_SHA ?? null,
      event: process.env.GITHUB_EVENT_NAME ?? null,
    },
    measurement: {
      profiles: options.diagnostic ? ["small"] : ["small", "medium", "realistic"],
      seed: DEFAULT_SEED,
      runs: options.diagnostic ? 1 : 7,
      warmup: options.diagnostic ? 0 : 3,
    },
    build: {
      profile: "release",
      locked: true,
      rustflags: process.env.RUSTFLAGS ?? "",
      encodedRustflags: process.env.CARGO_ENCODED_RUSTFLAGS ?? "",
    },
    limits:
      "VM per matrix job; physical-host contention, power and thermal state unavailable. OS page caches are not flushed.",
    commands: [],
    evidenceHashes: {},
  };
  const save = () => writeFile(path.join(output, "manifest.json"), json(manifest));
  const retained = async (file, bytes) => {
    await writeFile(path.join(output, file), bytes);
    manifest.evidenceHashes[file] = sha256(bytes);
  };
  const run = async (name, command, args, env = {}) => {
    manifest.commands.push({ name, command, args });
    await save();
    console.log(`Starting ${name}`);
    try {
      const result = await runCommand(command, args, { cwd: repoRoot, env });
      await retained(`${name}.stdout.log`, result.stdout);
      await retained(`${name}.stderr.log`, result.stderr);
      return result.stdout.trim();
    } catch (error) {
      await retained(`${name}.error.log`, error.message);
      throw error;
    }
  };
  try {
    await save();
    assert.ok([1, 2, 3].includes(manifest.repetition), "repetition must be 1, 2 or 3");
    assert.equal(process.platform, RUNNERS[options.platform].platform);
    assert.equal(process.arch, RUNNERS[options.platform].arch);
    manifest.revision = await run("revision", "git", ["rev-parse", "HEAD"]);
    manifest.dirty = Boolean(await run("initial-status", "git", ["status", "--porcelain"]));
    if (!options.diagnostic) {
      assert.equal(
        process.env.GITHUB_ACTIONS,
        "true",
        "Blacksmith evidence requires GitHub Actions",
      );
      assert.equal(process.env.GITHUB_REPOSITORY, "sebastian-software/palamedes");
      assert.equal(manifest.workflow.event, "workflow_dispatch");
      assert.equal(manifest.revision, process.env.GITHUB_SHA);
      assert.equal(manifest.workflow.revision, manifest.revision);
      assert.equal(manifest.dirty, false, "benchmark requires a clean source checkout");
      assert.match(manifest.runId, /^\d+$/u);
      assert.match(manifest.attempt, /^[1-9]\d*$/u);
    }
    manifest.locks = Object.fromEntries(
      await Promise.all(
        locks.map(async (file) => [file, sha256(await readFile(path.join(repoRoot, file)))]),
      ),
    );
    manifest.toolchain = {};
    for (const [name, command, args] of [
      ["pnpm", "pnpm", ["--version"]],
      ["rustc", "rustc", ["--version", "--verbose"]],
      ["cargo", "cargo", ["--version"]],
      ["gettext", "msgmerge", ["--version"]],
    ])
      manifest.toolchain[name] = await run(name, command, args);
    await run("source", "git", [
      "archive",
      "--format=tar.gz",
      `--output=${path.join(output, "source.tar.gz")}`,
      "HEAD",
      "--",
      "benchmarks/e2e-workflow",
      "crates",
      "Cargo.toml",
      "Cargo.lock",
      "rust-toolchain.toml",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      workflowPath,
      ".github/actions/setup-workspace",
    ]);
    manifest.evidenceHashes["source.tar.gz"] = sha256(
      await readFile(path.join(output, "source.tar.gz")),
    );
    const built = cliArtifacts(
      await run("build", "cargo", [
        "build",
        "--release",
        "--locked",
        "-p",
        "palamedes-cli",
        "--message-format=json",
      ]),
    );
    const env = {
      CI: "1",
      NO_COLOR: "1",
      PALAMEDES_UPDATE_CHECK: "0",
      PALAMEDES_UI_LOCALE: "en",
      PALAMEDES_UI_CATALOG_DIR: built.catalogDirectory,
    };
    const common = [
      "--pmds-bin",
      built.binary,
      "--profile",
      manifest.measurement.profiles.join(","),
      "--seed",
      String(DEFAULT_SEED),
      "--runs",
      String(manifest.measurement.runs),
      "--warmup",
      String(manifest.measurement.warmup),
      "--order-offset",
      String((manifest.repetition - 1) * 2),
    ];
    manifest.suiteOrder =
      manifest.repetition % 2 ? ["react", "frameworks"] : ["frameworks", "react"];
    for (const suite of manifest.suiteOrder) {
      const entry =
        suite === "react"
          ? "benchmarks/e2e-workflow/src/run.mjs"
          : "benchmarks/e2e-workflow/frameworks/src/framework-workflow.mjs";
      await run(
        suite,
        process.execPath,
        [entry, ...common, "--output-dir", path.join(output, suite)],
        env,
      );
      for (const extension of ["json", "md"]) {
        const file = `${suite}/latest.${extension}`;
        manifest.evidenceHashes[file] = sha256(await readFile(path.join(output, file)));
      }
    }
    const readJson = async (suite) =>
      JSON.parse(await readFile(path.join(output, suite, "latest.json"), "utf8"));
    reportCases(manifest, await readJson("react"), await readJson("frameworks"));
    assert.equal(
      Boolean(await run("final-status", "git", ["status", "--porcelain"])),
      manifest.dirty,
      "benchmark modified source checkout",
    );
    manifest.status = "complete";
  } catch (error) {
    manifest.status = "failed";
    manifest.error = error.message;
    throw error;
  } finally {
    manifest.finishedAt = new Date().toISOString();
    await save();
  }
  console.log(`Evidence: ${output}`);
}

async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      output: { type: "string" },
      platform: { type: "string" },
      repetition: { type: "string", default: "1" },
      "run-id": { type: "string" },
      attempt: { type: "string" },
      revision: { type: "string" },
      diagnostic: { type: "boolean", default: false },
    },
  });
  assert.ok(
    values.output && RUNNERS[values.platform],
    "--output and a known --platform are required",
  );
  if (positionals[0] === "run") return runRepetition(values);
  assert.equal(positionals[0], "merge", "expected run or merge");
  const roots = positionals.slice(1);
  const shards = await Promise.all(roots.map((root) => readShard(root)));
  const report = mergeShards(shards, {
    platform: values.platform,
    runId: values["run-id"],
    attempt: values.attempt,
    revision: values.revision,
  });
  const output = await createOutputDirectory(values.output);
  // The final artifact is self-contained, including failed conformance receipts,
  // commands, source snapshots and raw samples from every VM.
  for (let index = 0; index < roots.length; index++)
    await cp(roots[index], path.join(output, `run${shards[index].manifest.repetition}`), {
      recursive: true,
    });
  await writeFile(path.join(output, "report.json"), json(report));
  await writeFile(path.join(output, "summary.md"), renderSummary(report));
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
