import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { benchmarkToolVersion } from "./benchmark-tool-versions.mjs";

export const FRAMEWORK_REPORT = "benchmarks/e2e-workflow/results/frameworks/latest.json";
export const INTLAYER_REPORT =
  "benchmarks/e2e-workflow/results/frameworks/2026-10-23T10-54-16-646Z-intlayer-roundtrip.json";

const LABELS = {
  palamedes: "Palamedes",
  lingui: "Lingui",
  i18next: "i18next-cli",
  wuchale: "Wuchale",
  intlayer: "Intlayer",
};
const FRAMEWORKS = { vue: "Vue", svelte: "Svelte", solid: "Solid" };

// The public payload contains display values and conformance receipts. Raw
// samples, source hashes, and local executable paths stay in the checked report.
export function frameworkBenchData(report, diagnostic) {
  assert.equal(report.benchmark, "framework-extract-update-workflows");
  assert.equal(report.machineLocal, true);
  assert.equal(report.environment.dirty, false, "Publication requires a clean measured revision");
  assert.equal(report.options.validateOnly, false);
  assert.ok(report.options.runs >= 7, "Publication requires at least seven measured samples");
  assert.deepEqual(report.profiles.map((profile) => profile.profile).sort(), [
    "medium",
    "realistic",
    "small",
  ]);
  const profiles = report.profiles.map((profile) => ({
    id: profile.profile,
    messages: profile.corpus.sourceMessages,
    frameworks: Object.entries(FRAMEWORKS).map(([id, label]) => {
      const results = profile.results.filter((row) => row.framework === id);
      const tools = [
        "palamedes",
        "lingui",
        "i18next",
        ...(id === "vue" ? [] : ["wuchale"]),
        "intlayer",
      ];
      assert.deepEqual(results.map((row) => row.tool).sort(), [...tools].sort());
      return {
        id,
        label,
        rows: results.map((row) => {
          const broader = ["wuchale", "intlayer"].includes(row.tool);
          assert.equal(row.scope, broader ? "extract-update-compile" : "extract-update");
          const base = {
            tool: LABELS[row.tool],
            version: benchmarkToolVersion(report.versions, row.tool, id),
            scope: broader ? "extract + update + compile" : "extract + catalog update",
            status: row.status,
            preserved: row.validation.preservedTranslations,
            expectedPreserved: row.validation.expectedPreservedTranslations,
            written: row.validation.observed.de.total,
            expected: profile.corpus.sourceMessages,
          };
          if (row.status === "not-equivalent") {
            assert.equal(
              row.tool,
              "intlayer",
              "Unexpected conformance failure must stop publication",
            );
            assert.equal(row.medianMs, undefined, "Failed conformance must not carry a timing");
            assert.ok(row.validation.observed.de.unexpectedCount > 0);
            assert.ok(base.preserved < base.expectedPreserved);
            return base;
          }
          assert.notEqual(
            row.tool,
            "intlayer",
            "Update the Intlayer publication note when its conformance changes",
          );
          assert.equal(row.status, "validated");
          assert.equal(
            base.preserved,
            base.expectedPreserved,
            "Existing translations must survive",
          );
          for (const locale of ["en", "de"]) {
            const observed = row.validation.observed[locale];
            assert.equal(observed.total, base.expected);
            for (const key of ["missingCount", "unexpectedCount", "duplicateCount"])
              assert.equal(observed[key], 0, `${row.id}/${locale}: ${key}`);
          }
          assert.equal(row.samplesMs.length, report.options.runs);
          assert.ok(row.samplesMs.every((sample) => Number.isFinite(sample) && sample > 0));
          const sorted = [...row.samplesMs].sort((a, b) => a - b);
          assert.equal(row.medianMs, sorted[Math.floor(sorted.length / 2)]);
          assert.equal(row.minMs, sorted[0]);
          assert.equal(row.maxMs, sorted.at(-1));
          return {
            ...base,
            medianMs: row.medianMs,
            files: row.fileCount,
          };
        }),
      };
    }),
  }));
  assert.equal(diagnostic.benchmark, "intlayer-catalog-roundtrip-conformance");
  assert.equal(diagnostic.timings, false);
  assert.equal(diagnostic.version, report.versions["intlayer-cli"]);
  const diagnostics = Object.keys(FRAMEWORKS).flatMap((framework) =>
    ["json", "ts"].map((format) => {
      const cases = diagnostic.cases.filter((row) => row.id === `${framework}-intlayer-${format}`);
      assert.equal(cases.length, 1);
      const receipt = cases[0].validation;
      assert.ok(receipt.observed.de.unexpectedCount > 0);
      if (format === "ts")
        assert.equal(receipt.preservedTranslations, receipt.expectedPreservedTranslations);
      else assert.ok(receipt.preservedTranslations < receipt.expectedPreservedTranslations);
      return {
        framework: FRAMEWORKS[framework],
        format: `.content.${format}`,
        preserved: receipt.preservedTranslations,
        expectedPreserved: receipt.expectedPreservedTranslations,
        extra: receipt.observed.de.unexpectedCount,
      };
    }),
  );
  return {
    meta: {
      generated: report.generatedAt.slice(0, 10),
      node: report.environment.node,
      platform: `${report.environment.platform}/${report.environment.arch}`,
      cpu: report.environment.cpu,
      runs: report.options.runs,
      warmup: report.options.warmup,
      reportPath: FRAMEWORK_REPORT.replace(/\.json$/u, ".md"),
      diagnosticPath: INTLAYER_REPORT.replace(/\.json$/u, ".md"),
      intlayerVersion: diagnostic.version,
    },
    profiles,
    diagnostics,
  };
}

export async function loadFrameworkBenchData(repoRoot) {
  const [report, diagnostic] = await Promise.all(
    [FRAMEWORK_REPORT, INTLAYER_REPORT].map(async (file) =>
      JSON.parse(await readFile(join(repoRoot, file), "utf8")),
    ),
  );
  return frameworkBenchData(report, diagnostic);
}
