import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { DEFAULT_SEED } from "../../src/corpus.mjs";

import {
  filesUnder,
  frameworkLanes,
  inventoryForProfile,
  prepareFrameworkWorkspace,
  readFrameworkCatalogs,
  resetFrameworkWorkspace,
  seedFrameworkTranslations,
  validateFrameworkCatalogs,
  writeFrameworkSources,
} from "./framework-corpus.mjs";
import { runFrameworkTool, summarizeSamples } from "./framework-workflow.mjs";

// A bounded implementation comparison, separate from the published campaigns.
// Both inputs must be release CLIs packaged with their own pmds-locales sibling.
const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index === -1 && fallback !== undefined) return fallback;
  if (index === -1 || !args[index + 1] || args[index + 1].startsWith("--"))
    throw new Error(`--${name} requires a value`);
  return args[index + 1];
}
const baseline = path.resolve(option("baseline"));
const candidate = path.resolve(option("candidate", baseline));
const baselineRevision = option("baseline-revision");
const candidateRevision = option("candidate-revision", "working-tree");
const output = path.resolve(option("output"));
const warmup = Number(option("warmup", "3"));
const runs = Number(option("runs", "7"));
if (!Number.isInteger(warmup) || warmup < 0 || !Number.isInteger(runs) || runs < 1)
  throw new Error("warmup must be nonnegative and runs must be positive integers");
const fixture = await mkdtemp(path.join(os.tmpdir(), "palamedes-component-parsing-"));
const inventory = inventoryForProfile("realistic");
const repo = path.resolve(import.meta.dirname, "../../../..");
const command = (name, values) =>
  execFileSync(name, values, { cwd: repo, encoding: "utf8" }).trim();
async function hashFile(file) {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}
async function sourceHash(root) {
  const hash = createHash("sha256");
  for (const file of await filesUnder(path.join(root, "src/generated"))) {
    hash.update(path.relative(root, file));
    hash.update(await readFile(file));
  }
  return hash.digest("hex");
}
const report = {
  question:
    "Does reusing component analysis reduce release extraction time without changing catalogs?",
  scope: "Local implementation comparison; not a reference campaign or cross-platform claim.",
  measuredBoundary:
    "CLI startup, discovery, extraction, catalog merge and output writes; setup and validation excluded",
  cachePolicy:
    "cold: catalogs and tool caches reset; cached: catalogs reset, compatible unchanged-source cache retained",
  limits:
    "OS page cache, physical host contention, power and thermal state are not controlled. Cached is an unchanged-source hit, not an edit simulation.",
  createdAt: new Date().toISOString(),
  harnessSha256: await hashFile(fileURLToPath(import.meta.url)),
  baseline: { revision: baselineRevision, sha256: await hashFile(baseline) },
  candidate: { revision: candidateRevision, sha256: await hashFile(candidate) },
  environment: {
    platform: process.platform,
    architecture: process.arch,
    os: os.release(),
    cpu: os.cpus()[0]?.model,
    cpuCount: os.cpus().length,
    node: process.version,
    rustc: command("rustc", ["--version"]),
    build: "cargo build --release --locked -p palamedes-cli; default features and release profile",
    rustflags: process.env.RUSTFLAGS ?? null,
    background: option("background", "Not recorded"),
    sourceRevision: command("git", ["rev-parse", "HEAD"]),
    sourceDirty: command("git", ["status", "--short"]),
    sourceDiffSha256: createHash("sha256")
      .update(command("git", ["diff", "HEAD", "--", "crates"]))
      .digest("hex"),
  },
  corpus: {
    profile: "realistic",
    seed: DEFAULT_SEED,
    ...inventory.profile,
    messages: inventory.sourceMessages.length,
  },
  warmup,
  runs,
  order: ["baseline", "candidate", "candidate", "baseline"],
  results: [],
};
try {
  for (const lane of frameworkLanes(["vue", "svelte"], ["palamedes"])) {
    const root = path.join(fixture, lane.id);
    await prepareFrameworkWorkspace(root, lane);
    await writeFrameworkSources(root, lane, inventory.baselineEntries, inventory.profile);
    await runFrameworkTool(root, lane, { pmdsBin: baseline });
    const initial = await readFrameworkCatalogs(root, lane);
    for (const locale of ["en", "de"]) {
      if (
        JSON.stringify(initial[locale].map((entry) => entry.source).sort()) !==
        JSON.stringify([...inventory.baselineMessages].sort())
      )
        throw new Error(`${lane.id}/${locale}: invalid baseline inventory`);
    }
    await seedFrameworkTranslations(root, lane);
    const source = await writeFrameworkSources(
      root,
      lane,
      inventory.sourceMessages,
      inventory.profile,
    );
    const hash = await sourceHash(root);
    // ADR-022 deliberately refuses to persist files modified within one second.
    await setTimeout(1100);
    if (args.includes("--prepare-only")) {
      console.log(`Prepared ${lane.id}: ${root}`);
      continue;
    }
    for (const cache of ["cold", "cached"]) {
      for (const [block, implementation] of report.order.entries()) {
        const pmdsBin = implementation === "baseline" ? baseline : candidate;
        await resetFrameworkWorkspace(root);
        if (cache === "cached") await runFrameworkTool(root, lane, { pmdsBin });
        const samples = [];
        let validation;
        for (let round = 0; round < warmup + runs; round++) {
          if (cache === "cold") await resetFrameworkWorkspace(root);
          else {
            await rm(path.join(root, "src/locales"), { recursive: true, force: true });
            await cp(path.join(root, ".baseline-locales"), path.join(root, "src/locales"), {
              recursive: true,
            });
          }
          const started = process.hrtime.bigint();
          await runFrameworkTool(root, lane, { pmdsBin });
          const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
          validation = validateFrameworkCatalogs(
            await readFrameworkCatalogs(root, lane),
            inventory,
            lane.id,
          );
          if ((await sourceHash(root)) !== hash)
            throw new Error(`${lane.id}: application sources changed`);
          if (cache === "cached") {
            const entries = JSON.parse(
              await readFile(path.join(root, ".palamedes/extract-cache.json"), "utf8"),
            );
            if (Object.keys(entries.entries).length !== source.fileCount)
              throw new Error(`${lane.id}: incomplete persisted extraction cache`);
          }
          if (round >= warmup) samples.push(elapsedMs);
        }
        const result = {
          framework: lane.framework,
          cache,
          block,
          implementation,
          ...source,
          sourceSha256: hash,
          validation,
          loadAverage: os.loadavg(),
          ...summarizeSamples(samples),
        };
        report.results.push(result);
        console.log(
          `${lane.framework}/${cache}/${block}/${implementation}: ${result.medianMs.toFixed(3)} ms`,
        );
      }
    }
  }
  if (!args.includes("--prepare-only")) {
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Retained raw comparison: ${output}`);
  }
} finally {
  if (args.includes("--keep-temp") || args.includes("--prepare-only"))
    console.log(`Retained fixtures: ${fixture}`);
  else await rm(fixture, { recursive: true, force: true });
}
