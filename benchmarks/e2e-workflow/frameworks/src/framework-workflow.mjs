import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_SEED } from "../../src/corpus.mjs";
import { runCommand } from "../../src/exec.mjs";
import {
  benchmarkRoot,
  filesUnder,
  FRAMEWORKS,
  FRAMEWORK_PROFILES,
  frameworkLanes,
  inventoryForProfile,
  prepareFrameworkWorkspace,
  readFrameworkCatalogs,
  resetFrameworkWorkspace,
  seedFrameworkTranslations,
  TOOL_LABELS,
  validateFrameworkCatalogs,
  writeFrameworkSources,
} from "./framework-corpus.mjs";

const repoRoot = path.resolve(benchmarkRoot, "../../..");
const outputRoot = path.resolve(benchmarkRoot, "../results/frameworks");
const PACKAGE_NAMES = [
  "@lingui/cli",
  "@lingui/core",
  "@lingui/extractor-vue",
  "@lingui/solid",
  "lingui-for-svelte",
  "i18next-cli",
  "i18next-cli-vue",
  "i18next-cli-plugin-svelte",
  "wuchale",
  "@wuchale/jsx",
  "@wuchale/svelte",
  "vue3-gettext",
  "intlayer-cli",
  "@intlayer/babel",
  "@intlayer/vue-compiler",
  "@intlayer/svelte-compiler",
  "vue",
  "svelte",
  "solid-js",
];

export function parseFrameworkArgs(argv) {
  function value(name, fallback) {
    const index = argv.indexOf(`--${name}`);
    if (index === -1) return fallback;
    const result = argv[index + 1];
    if (!result || result.startsWith("--")) throw new Error(`--${name} requires a value`);
    return result;
  }
  function list(name, fallback, allowed) {
    const selected = value(name, fallback).split(",");
    if (selected.some((item) => !allowed.includes(item)))
      throw new Error(`Unknown --${name}: ${selected.join(",")}; expected ${allowed.join(",")}`);
    return [...new Set(selected)];
  }
  const runs = Number(value("runs", "7"));
  const warmup = Number(value("warmup", "3"));
  if (!Number.isInteger(runs) || runs < 1 || !Number.isInteger(warmup) || warmup < 0)
    throw new Error("runs must be a positive integer; warmup must be a nonnegative integer");
  return {
    profiles: list("profile", "small,medium,realistic", Object.keys(FRAMEWORK_PROFILES)),
    frameworks: list("framework", FRAMEWORKS.join(","), FRAMEWORKS),
    tools: list("tools", Object.keys(TOOL_LABELS).join(","), Object.keys(TOOL_LABELS)),
    seed: Number(value("seed", String(DEFAULT_SEED))),
    runs,
    warmup,
    pmdsBin: path.resolve(value("pmds-bin", path.join(repoRoot, "target/release/pmds"))),
    validateOnly: argv.includes("--validate-only"),
    keepTemp: argv.includes("--keep-temp"),
    strict: argv.includes("--strict"),
  };
}

export async function runFrameworkTool(root, lane, options) {
  const suffix = process.platform === "win32" ? ".cmd" : "";
  const cli = (name) => path.join(benchmarkRoot, "node_modules/.bin", `${name}${suffix}`);
  const env = {
    CI: "1",
    NO_COLOR: "1",
    ...(options.uiCatalogDir ? { PALAMEDES_UI_CATALOG_DIR: options.uiCatalogDir } : {}),
  };
  const run = (command, args) => runCommand(command, args, { cwd: root, env });
  switch (lane.tool) {
    case "palamedes":
      return run(options.pmdsBin, ["extract", "--config", "palamedes.yaml"]);
    case "lingui":
      return run(cli("lingui"), ["extract", "--config", "lingui.config.mjs"]);
    case "i18next":
      return run(cli("i18next-cli"), [
        "extract",
        "--config",
        "i18next.config.mjs",
        "--sync-all",
        "--trust-derived",
        "--quiet",
      ]);
    case "gettext":
      return run(cli("vue-gettext-extract"), ["--config", "gettext.config.js"]);
    case "wuchale":
      return run(cli("wuchale"), ["--config", "wuchale.config.mjs", "--clean"]);
    case "intlayer": {
      // The CLI requires explicit paths to avoid its interactive picker. Source
      // discovery stays inside the measured boundary, along with CLI startup.
      const files = (await filesUnder(path.join(root, "src/generated"))).map((file) =>
        path.relative(root, file),
      );
      return run(cli("intlayer"), ["extract", "--declaration-only", "--file", ...files]);
    }
    default:
      throw new Error(`Unknown framework tool ${lane.tool}`);
  }
}

async function versions(options) {
  const result = {};
  for (const name of PACKAGE_NAMES) {
    const pkg = JSON.parse(
      await readFile(path.join(benchmarkRoot, "node_modules", name, "package.json"), "utf8"),
    );
    result[name] = pkg.version;
  }
  result.palamedes = (
    await runCommand(options.pmdsBin, ["version"], {
      cwd: repoRoot,
      env: options.uiCatalogDir ? { PALAMEDES_UI_CATALOG_DIR: options.uiCatalogDir } : {},
    })
  ).stdout.trim();
  if (options.tools.includes("gettext") && options.frameworks.includes("vue"))
    result.gettext = (await runCommand("msgmerge", ["--version"], { cwd: repoRoot })).stdout.split(
      "\n",
    )[0];
  return result;
}

async function sourceHash(root) {
  const hash = createHash("sha256");
  for (const file of await filesUnder(path.join(root, "src/generated"))) {
    hash.update(path.relative(root, file));
    hash.update(await readFile(file));
  }
  return hash.digest("hex");
}

async function executeValidated(root, lane, inventory, options, expectedSourceHash) {
  await resetFrameworkWorkspace(root);
  const started = process.hrtime.bigint();
  const output = await runFrameworkTool(root, lane, options);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  const validation = validateFrameworkCatalogs(
    await readFrameworkCatalogs(root, lane),
    inventory,
    lane.id,
  );
  if ((await sourceHash(root)) !== expectedSourceHash)
    throw new Error(`${lane.id}: extraction rewrote application sources`);
  return {
    elapsedMs,
    validation,
    stdoutBytes: Buffer.byteLength(output.stdout),
    stderrBytes: Buffer.byteLength(output.stderr),
  };
}

export function summarizeSamples(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const medianMs = sorted[Math.floor(sorted.length / 2)];
  const deviations = sorted.map((value) => Math.abs(value - medianMs)).sort((a, b) => a - b);
  return {
    medianMs,
    minMs: sorted[0],
    maxMs: sorted.at(-1),
    medianAbsoluteDeviationMs: deviations[Math.floor(deviations.length / 2)],
    samplesMs: samples,
  };
}

export async function benchmarkFrameworkProfile(tempRoot, profileName, lanes, options) {
  const inventory = inventoryForProfile(profileName, options.seed);
  const workspaces = [];
  const ineligible = [];
  for (const lane of lanes) {
    console.log(`${profileName}/${lane.id}: preparing and validating catalogs`);
    const root = path.join(tempRoot, profileName, lane.id);
    try {
      await prepareFrameworkWorkspace(root, lane);
      await writeFrameworkSources(root, lane, inventory.baselineEntries, inventory.profile);
      await runFrameworkTool(root, lane, options);
      // Assert the initial extraction too: a broken baseline must never become a
      // seemingly fast update that recreates every translation from scratch.
      const initial = await readFrameworkCatalogs(root, lane);
      for (const locale of ["en", "de"]) {
        const actual = initial[locale].map((entry) => entry.source).sort();
        if (JSON.stringify(actual) !== JSON.stringify([...inventory.baselineMessages].sort()))
          throw new Error(
            `${lane.id}/${locale}: initial extraction does not match the baseline inventory`,
          );
      }
      await seedFrameworkTranslations(root, lane);
      const source = await writeFrameworkSources(
        root,
        lane,
        inventory.sourceMessages,
        inventory.profile,
      );
      const hash = await sourceHash(root);
      const checked = await executeValidated(root, lane, inventory, options, hash);
      workspaces.push({ lane, root, source, hash, validation: checked.validation, samples: [] });
    } catch (error) {
      // The pinned Intlayer extractor currently fails the catalog contract.
      // Retain the failed conformance receipt instead of publishing a timing
      // for less work. Other tool regressions remain fatal.
      if (lane.tool !== "intlayer" || !error.validation) throw error;
      ineligible.push({
        ...lane,
        status: "not-equivalent",
        reason: error.message,
        validation: error.validation,
      });
      console.log(`${lane.id}: excluded from timings: ${error.message}`);
    }
  }
  if (!options.validateOnly) {
    // Rotate the order each round so one candidate does not always run first.
    // Measurements are serial: no competing extractor or corpus generation.
    for (let round = 0; round < options.warmup + options.runs; round++) {
      for (let offset = 0; offset < workspaces.length; offset++) {
        const workspace = workspaces[(round + offset) % workspaces.length];
        console.log(
          `${profileName}/${workspace.lane.id}: ${round < options.warmup ? "warmup" : "sample"} ${round + 1}`,
        );
        const result = await executeValidated(
          workspace.root,
          workspace.lane,
          inventory,
          options,
          workspace.hash,
        );
        if (round >= options.warmup) workspace.samples.push(result.elapsedMs);
        workspace.validation = result.validation;
      }
    }
  }
  return {
    profile: profileName,
    corpus: {
      seed: options.seed,
      sourceMessages: inventory.sourceMessages.length,
      baselineMessages: inventory.baselineMessages.length,
      changed: inventory.profile.changedCount,
      added: inventory.profile.newCount,
      removed: inventory.profile.removedCount,
      interpolationMessages: inventory.sourceMessages.filter((entry) =>
        entry.current.includes("{name}"),
      ).length,
      interpolation: "one named variable; message indices 0–14 modulo 100",
      plurals: false,
    },
    results: [
      ...workspaces.map(({ lane, source, validation, samples, hash }) => ({
        ...lane,
        status: "validated",
        ...source,
        sourceSha256: hash,
        validation,
        ...(samples.length ? summarizeSamples(samples) : {}),
      })),
      ...ineligible,
    ],
  };
}

export function renderFrameworkReport(report) {
  const lines = [
    "# Framework Extraction and Catalog Update Workflows",
    "",
    `Generated: ${report.generatedAt}`,
    `Revision: ${report.environment.revision}`,
    `Working tree dirty: ${report.environment.dirty}`,
    `Node: ${report.environment.node}`,
    `Platform: ${report.environment.platform}/${report.environment.arch}`,
    `CPU: ${report.environment.cpu}`,
    `Warmup: ${report.options.warmup}`,
    `Samples: ${report.options.runs}`,
    "",
    "These are machine-local cold CLI workflow measurements. Every sample resets existing catalogs and local tool state. Fixture generation, baseline extraction, correctness checks, and report writing are outside the timer. Source discovery, process startup, parsing, catalog merge and writes are inside. Every measured result passes catalog and translation-preservation checks.",
    "",
    "Wuchale additionally transforms components in memory and compiles catalogs. Intlayer additionally generates/builds dictionaries and prepares its project artifacts. Their timings cover more work than extract/update-only lanes. No speedup ratios are generated across these different scopes. Application bundling and runtime rendering are not measured. The corpus contains plain strings and one-variable interpolation, without plurals, rich text or context disambiguation.",
    "",
    "Solid sources target the Solid 1.9 versions supported by these comparator adapters. This is an extraction workload, not evidence of Solid 2 or application/SSR compatibility.",
    "",
    "## Versions",
    "",
    ...Object.entries(report.versions).map(([name, version]) => `- ${name}: ${version}`),
  ];
  for (const profile of report.profiles) {
    lines.push(
      "",
      `## ${profile.profile}`,
      "",
      `Inventory: ${profile.corpus.sourceMessages} current, ${profile.corpus.baselineMessages} baseline; ${profile.corpus.changed} changed, ${profile.corpus.added} new, ${profile.corpus.removed} removed.`,
      "",
    );
    for (const framework of report.options.frameworks) {
      lines.push(
        `### ${framework}`,
        "",
        "| Tool | Scope | Files | Source bytes | Median | Min–max | Preserved translations |",
        "| --- | --- | ---: | ---: | ---: | --- | ---: |",
      );
      for (const row of profile.results.filter((r) => r.framework === framework)) {
        if (row.status === "not-equivalent") {
          lines.push(
            `| ${TOOL_LABELS[row.tool]} | catalog validation failed | — | — | excluded | — | ${row.validation.preservedTranslations}/${row.validation.expectedPreservedTranslations} |`,
          );
          continue;
        }
        lines.push(
          `| ${TOOL_LABELS[row.tool]} | ${row.scope} | ${row.fileCount} | ${row.sourceBytes} | ${row.medianMs == null ? "validation only" : `${row.medianMs.toFixed(2)} ms`} | ${row.minMs == null ? "—" : `${row.minMs.toFixed(2)}–${row.maxMs.toFixed(2)} ms`} | ${row.validation.preservedTranslations} |`,
        );
        if (row.validation.retainedChangedTranslations)
          lines.push(
            `\n${TOOL_LABELS[row.tool]} retained ${row.validation.retainedChangedTranslations} old translations under stable identifiers after source edits; those are reported separately from unchanged translations.\n`,
          );
      }
      lines.push("");
      for (const row of profile.results.filter(
        (r) => r.framework === framework && r.status === "not-equivalent",
      ))
        lines.push(`${TOOL_LABELS[row.tool]} is excluded from timings: ${row.reason}.`, "");
    }
  }
  lines.push(
    "## Reproduction",
    "",
    "```sh",
    report.command,
    "```",
    "",
    "The companion JSON retains every sample, dispersion, source hashes, adapter versions and semantic receipts. Run on an otherwise idle machine; laptop power/thermal state and background activity are not controlled. A small or smoke profile does not establish large-project performance.",
    "",
  );
  return lines.join("\n");
}

async function main() {
  const options = parseFrameworkArgs(process.argv.slice(2));
  const lanes = frameworkLanes(options.frameworks, options.tools);
  if (!lanes.length) throw new Error("No supported framework/tool combinations selected");
  if (!process.argv.includes("--pmds-bin")) {
    // Cargo's build script emits the CLI's own language catalogs in OUT_DIR.
    // A raw release binary alone cannot run in a fresh source checkout.
    const built = await runCommand(
      "cargo",
      ["build", "--release", "--locked", "-p", "palamedes-cli", "--message-format=json"],
      { cwd: repoRoot },
    );
    const messages = built.stdout
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line));
    const build = messages.find(
      (message) =>
        message.reason === "build-script-executed" &&
        /(?:#|\/)palamedes-cli(?:@|#|$)/u.test(message.package_id),
    );
    if (!build) throw new Error("Cargo did not report the Palamedes CLI catalog directory");
    options.uiCatalogDir = path.join(build.out_dir, "catalogs");
    const artifact = messages.find(
      (message) =>
        message.reason === "compiler-artifact" &&
        message.target?.name === "pmds" &&
        message.executable,
    );
    if (!artifact) throw new Error("Cargo did not report the Palamedes CLI executable");
    options.pmdsBin = artifact.executable;
  }
  const toolVersions = await versions(options);
  const revision = (
    await runCommand("git", ["rev-parse", "HEAD"], { cwd: repoRoot })
  ).stdout.trim();
  const dirty = Boolean(
    (await runCommand("git", ["status", "--porcelain"], { cwd: repoRoot })).stdout.trim(),
  );
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "palamedes-framework-workflow-"));
  console.log(`Framework workspaces: ${tempRoot}`);
  try {
    const report = {
      schemaVersion: 1,
      benchmark: "framework-extract-update-workflows",
      machineLocal: true,
      generatedAt: new Date().toISOString(),
      environment: {
        revision,
        dirty,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpu: os.cpus()[0]?.model,
        cpuCount: os.cpus().length,
        memoryBytes: os.totalmem(),
      },
      options,
      versions: toolVersions,
      command: `pnpm --dir benchmarks/e2e-workflow/frameworks benchmark ${process.argv
        .slice(2)
        .map((arg) => (/^[\w,./-]+$/u.test(arg) ? arg : JSON.stringify(arg)))
        .join(" ")}`.trim(),
      profiles: [],
    };
    for (const profile of options.profiles)
      report.profiles.push(await benchmarkFrameworkProfile(tempRoot, profile, lanes, options));
    const destination = options.validateOnly ? path.join(outputRoot, "validation") : outputRoot;
    await mkdir(destination, { recursive: true });
    const stamp = report.generatedAt.replaceAll(/[:.]/gu, "-");
    const names = [stamp, ...(!options.validateOnly ? ["latest"] : [])];
    for (const name of names) {
      await writeFile(
        path.join(destination, `${name}.json`),
        `${JSON.stringify(report, null, 2)}\n`,
      );
      await writeFile(path.join(destination, `${name}.md`), renderFrameworkReport(report));
    }
    console.log(`Results: ${path.join(destination, `${stamp}.md`)}`);
    if (
      options.strict &&
      report.profiles.some((profile) => profile.results.some((row) => row.status !== "validated"))
    )
      process.exitCode = 1;
  } finally {
    if (!options.keepTemp) await rm(tempRoot, { recursive: true, force: true });
    else console.log(`Retained workspaces: ${tempRoot}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
