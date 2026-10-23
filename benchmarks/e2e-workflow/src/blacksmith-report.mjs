import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { DEFAULT_SEED, PROFILE_DEFINITIONS } from "./corpus.mjs";

export const RUNNERS = {
  "linux-x86-64": { label: "blacksmith-4vcpu-ubuntu-2404", platform: "linux", arch: "x64" },
  "macos-arm64": { label: "blacksmith-6vcpu-macos-26", platform: "darwin", arch: "arm64" },
};
const REACT_TOOLS = ["palamedes", "lingui", "formatjs", "fbtee", "i18nextCli", "gt"];
const FRAMEWORK_TOOLS = {
  vue: ["palamedes", "lingui", "i18next", "intlayer"],
  svelte: ["palamedes", "lingui", "i18next", "wuchale", "intlayer"],
  solid: ["palamedes", "lingui", "i18next", "wuchale", "intlayer"],
};

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

function samples(values, reported, count) {
  assert.equal(values?.length, count, "incomplete sample set");
  assert.ok(
    values.every((n) => Number.isFinite(n) && n > 0),
    "invalid sample",
  );
  assert.equal(median(values), reported, "median does not match raw samples");
}

function sameMembers(actual, expected) {
  assert.deepEqual(
    [...actual].sort(),
    [...expected].sort(),
    "missing or duplicate benchmark cases",
  );
}

// The two harnesses deliberately retain different semantic gates. React checks
// active inventories (and fbtee/GT translations); the SFC/TSX extension checks
// every unchanged translation and application-source hashes as well.
export function reportCases(manifest, react, frameworks) {
  const { profiles, runs, warmup, seed } = manifest.measurement;
  assert.equal(react.schemaVersion, 2);
  assert.equal(frameworks.schemaVersion, 1);
  assert.equal(react.benchmark, "palamedes-e2e-extract-update-workflow");
  assert.equal(frameworks.benchmark, "framework-extract-update-workflows");
  assert.equal(react.validateOnly, false);
  assert.equal(frameworks.options.validateOnly, false);
  for (const options of [react, frameworks.options]) {
    assert.equal(options.runs, runs);
    assert.equal(options.warmup, warmup);
    assert.equal(options.seed, seed);
  }
  assert.equal(frameworks.environment.revision, manifest.revision);
  assert.equal(frameworks.environment.dirty, manifest.dirty);
  for (const environment of [react.environment, frameworks.environment]) {
    assert.equal(environment.platform, manifest.environment.platform);
    assert.equal(environment.arch, manifest.environment.arch);
    assert.equal(environment.node ?? environment.nodeVersion, manifest.environment.node);
  }
  sameMembers(
    react.profiles.map((p) => p.profile),
    profiles,
  );
  sameMembers(
    frameworks.profiles.map((p) => p.profile),
    profiles,
  );
  // Archived campaigns still contain the retired Vue comparator. Require its
  // declared tool and pinned version before accepting that historical lane;
  // current campaigns must contain the complete remaining matrix.
  const legacyGettext = frameworks.options.tools.includes("gettext");
  assert.equal(legacyGettext, typeof frameworks.versions["vue3-gettext"] === "string");
  sameMembers(frameworks.options.tools, [
    "palamedes",
    "lingui",
    "i18next",
    "wuchale",
    "intlayer",
    ...(legacyGettext ? ["gettext"] : []),
  ]);
  const cases = [];
  for (const profile of react.profiles) {
    const definition = PROFILE_DEFINITIONS[profile.profile];
    assert.ok(definition, "unknown corpus profile");
    assert.equal(
      profile.corpus.fileCount,
      definition.fileCount ?? definition.markedFiles + definition.unmarkedFiles,
    );
    assert.equal(
      profile.corpus.sourceMessageCount,
      definition.messages ?? definition.fileCount * definition.messagesPerFile,
    );
    assert.equal(profile.corpus.changedCount, definition.changedCount);
    assert.equal(profile.corpus.newCount, definition.newCount);
    assert.equal(profile.corpus.removedCount, definition.removedCount);
    sameMembers(
      profile.results.map((r) => r.tool),
      REACT_TOOLS,
    );
    assert.equal(profile.validation.expectedActiveMessages, profile.corpus.sourceMessageCount);
    for (const row of profile.results) {
      const validation = profile.validation.tools[row.tool];
      const targets = row.tool === "formatjs" ? ["source"] : ["en", "de"];
      sameMembers(Object.keys(validation.activeMessagesByTarget), targets);
      for (const target of targets)
        assert.equal(validation.activeMessagesByTarget[target], profile.corpus.sourceMessageCount);
      if (["fbtee", "gt"].includes(row.tool))
        assert.equal(
          validation.preservedTranslations,
          profile.corpus.sourceMessageCount - profile.corpus.changedCount - profile.corpus.newCount,
        );
      for (const lane of ["cold", "warm"]) {
        if (lane === "warm") assert.equal(row.warm?.touchedFiles, 5);
        const measured =
          lane === "cold" ? { samplesMs: row.rawSamplesMs, medianMs: row.medianMs } : row.warm;
        samples(measured?.samplesMs, measured?.medianMs, runs);
        cases.push({
          id: `react/${profile.profile}/${lane}/${row.tool}`,
          framework: "react",
          profile: profile.profile,
          lane,
          tool: row.tool,
          scope: row.tool === "formatjs" ? "extract-write" : "extract-update",
          status: "validated",
          corpus: profile.corpus,
          validation,
          medianMs: measured.medianMs,
          samplesMs: measured.samplesMs,
        });
      }
    }
  }
  for (const profile of frameworks.profiles) {
    const original = react.profiles.find((p) => p.profile === profile.profile).corpus;
    for (const [field, other] of [
      ["sourceMessages", "sourceMessageCount"],
      ["baselineMessages", "baselineMessageCount"],
      ["changed", "changedCount"],
      ["added", "newCount"],
      ["removed", "removedCount"],
    ])
      assert.equal(
        profile.corpus[field],
        original[other],
        "framework corpus differs from React inventory",
      );
    sameMembers(
      profile.results.map((r) => r.id),
      Object.entries(FRAMEWORK_TOOLS).flatMap(([framework, tools]) =>
        [...tools, ...(framework === "vue" && legacyGettext ? ["gettext"] : [])].map(
          (tool) => `${framework}-${tool}`,
        ),
      ),
    );
    for (const row of profile.results) {
      assert.equal(row.id, `${row.framework}-${row.tool}`);
      assert.equal(
        row.scope,
        ["wuchale", "intlayer"].includes(row.tool) ? "extract-update-compile" : "extract-update",
      );
      if (row.status === "not-equivalent") {
        assert.equal(row.tool, "intlayer", "unexpected excluded candidate");
        assert.ok(row.reason && row.validation, "missing conformance receipt");
        assert.equal(row.validation.activeMessagesPerLocale, profile.corpus.sourceMessages);
        assert.ok(
          Object.values(row.validation.observed).some(
            (observed) =>
              observed.missingCount || observed.unexpectedCount || observed.duplicateCount,
          ) ||
            row.validation.preservedTranslations !== row.validation.expectedPreservedTranslations,
          "excluded candidate has no failed semantic check",
        );
        assert.equal(row.samplesMs, undefined, "failed conformance cannot carry timings");
        assert.equal(row.medianMs, undefined);
      } else {
        assert.equal(row.status, "validated");
        samples(row.samplesMs, row.medianMs, runs);
        assert.match(row.sourceSha256, /^[a-f0-9]{64}$/u);
        assert.equal(row.validation.activeMessagesPerLocale, profile.corpus.sourceMessages);
        for (const locale of ["en", "de"]) {
          const observed = row.validation.observed[locale];
          assert.equal(observed.total, profile.corpus.sourceMessages);
          for (const field of ["missingCount", "unexpectedCount", "duplicateCount"])
            assert.equal(observed[field], 0);
        }
        assert.equal(
          row.validation.preservedTranslations,
          row.validation.expectedPreservedTranslations,
        );
        assert.equal(
          row.validation.expectedPreservedTranslations,
          profile.corpus.sourceMessages - profile.corpus.changed - profile.corpus.added,
        );
        assert.deepEqual(row.validation.lostTranslations, []);
      }
      cases.push({
        id: `${row.framework}/${profile.profile}/cold/${row.tool}`,
        framework: row.framework,
        profile: profile.profile,
        lane: "cold",
        tool: row.tool,
        scope: row.scope,
        status: row.status,
        corpus: profile.corpus,
        sourceSha256: row.sourceSha256,
        sourceBytes: row.sourceBytes,
        fileCount: row.fileCount,
        validation: row.validation,
        reason: row.reason,
        ...(row.status === "validated" ? { medianMs: row.medianMs, samplesMs: row.samplesMs } : {}),
      });
    }
  }
  return cases.sort((a, b) => a.id.localeCompare(b.id));
}

export async function readShard(root) {
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
  for (const [file, hash] of Object.entries(manifest.evidenceHashes)) {
    assert.ok(
      !path.isAbsolute(file) && !file.split(/[\\/]/u).includes(".."),
      "invalid evidence path",
    );
    assert.equal(
      sha256(await readFile(path.join(root, file))),
      hash,
      `evidence hash mismatch: ${file}`,
    );
  }
  for (const file of ["react/latest.json", "frameworks/latest.json", "source.tar.gz"])
    assert.ok(manifest.evidenceHashes[file], `missing retained evidence: ${file}`);
  const json = async (file) => JSON.parse(await readFile(path.join(root, file), "utf8"));
  return {
    manifest,
    react: await json("react/latest.json"),
    frameworks: await json("frameworks/latest.json"),
  };
}

export function mergeShards(shards, expected) {
  assert.equal(shards.length, 3, "three VM repetitions are required");
  const sorted = [...shards].sort((a, b) => a.manifest.repetition - b.manifest.repetition);
  sameMembers(
    sorted.map((s) => s.manifest.repetition),
    [1, 2, 3],
  );
  const cases = [];
  let signature;
  for (const { manifest: m, react, frameworks } of sorted) {
    assert.equal(m.schemaVersion, 1);
    assert.equal(m.status, "complete", "incomplete or failed repetition");
    assert.equal(m.provider, "blacksmith", "local diagnostics are not publication evidence");
    assert.equal(m.dirty, false, "dirty source checkout");
    for (const key of ["platform", "runId", "attempt", "revision"])
      assert.equal(m[key], expected[key], `mismatched ${key}`);
    const runner = RUNNERS[m.platform];
    assert.ok(runner, "unknown runner profile");
    assert.equal(m.runnerLabel, runner.label);
    assert.equal(m.environment.platform, runner.platform);
    assert.equal(m.environment.arch, runner.arch);
    assert.match(m.revision, /^[a-f0-9]{40}$/u);
    assert.match(m.runId, /^\d+$/u);
    assert.match(m.attempt, /^[1-9]\d*$/u);
    assert.equal(m.workflow.event, "workflow_dispatch");
    assert.equal(m.workflow.revision, m.revision);
    for (const file of [
      "Cargo.lock",
      "pnpm-lock.yaml",
      "benchmarks/e2e-workflow/frameworks/pnpm-lock.yaml",
    ])
      assert.match(m.locks[file], /^[a-f0-9]{64}$/u);
    for (const tool of [
      "pnpm",
      "rustc",
      "cargo",
      ...(frameworks.options.tools.includes("gettext") ? ["gettext"] : []),
    ])
      assert.ok(m.toolchain[tool], `missing ${tool} version`);
    assert.equal(m.measurement.seed, DEFAULT_SEED);
    assert.equal(m.build.profile, "release");
    assert.equal(m.build.locked, true);
    assert.equal(m.measurement.runs, 7);
    assert.equal(m.measurement.warmup, 3);
    sameMembers(m.measurement.profiles, ["small", "medium", "realistic"]);
    const rows = reportCases(m, react, frameworks);
    const current = JSON.stringify({
      measurement: m.measurement,
      locks: m.locks,
      toolchain: m.toolchain,
      build: m.build,
      runnerImage: m.runnerImage,
      cpu: m.environment.cpu,
      cpuCount: m.environment.cpuCount,
      versions: { react: react.versions, frameworks: frameworks.versions },
      cases: rows.map(({ medianMs: _median, samplesMs: _samples, reason: _reason, ...row }) => row),
    });
    if (signature !== undefined)
      assert.equal(
        current,
        signature,
        "repetitions differ in corpus, scope, versions, hardware class or semantic receipts",
      );
    signature = current;
    cases.push(rows);
  }
  const first = sorted[0].manifest;
  return {
    schemaVersion: 1,
    benchmark: "blacksmith-extraction-workflows",
    ...expected,
    generatedAt: new Date().toISOString(),
    methodology:
      "Median of three per-VM medians; seven samples after three warmups per VM. Platforms, scopes and cold/warm lanes remain separate. Raw samples are retained in each repetition.",
    repetitions: sorted.map(({ manifest }) => manifest),
    results: cases[0].map(({ samplesMs: _samples, medianMs: _median, ...row }, index) => ({
      ...row,
      ...(row.status === "validated"
        ? {
            medianMs: median(cases.map((rows) => rows[index].medianMs)),
            vmMediansMs: cases.map((rows) => rows[index].medianMs),
          }
        : {}),
    })),
    sourceRevision: first.revision,
  };
}

export function renderSummary(report) {
  const lines = [
    "# Blacksmith extraction workflows",
    "",
    `Platform: ${report.platform}`,
    `Revision: ${report.revision}`,
    "",
    report.methodology,
    "",
    "React Intl only extracts and writes an artifact. Wuchale also transforms and compiles. Intlayer's JSON configuration is excluded when catalog validation fails. React warm runs model a five-file edit and are not equivalent-work speed comparisons. OS page caches are not flushed; physical-host contention and power/thermal state are unavailable. These are reproducible project-run measurements, not an independent third-party audit.",
    "",
  ];
  for (const framework of ["react", "vue", "svelte", "solid"]) {
    for (const profile of ["small", "medium", "realistic"]) {
      for (const lane of framework === "react" ? ["cold", "warm"] : ["cold"]) {
        lines.push(
          `## ${framework} / ${profile} / ${lane}`,
          "",
          "| Workflow | Scope | Median |",
          "| --- | --- | ---: |",
        );
        for (const row of report.results.filter(
          (r) => r.framework === framework && r.profile === profile && r.lane === lane,
        ))
          lines.push(
            `| ${row.tool} | ${row.scope} | ${row.status === "validated" ? `${row.medianMs.toFixed(2)} ms` : "excluded: catalog validation failed"} |`,
          );
        lines.push("");
      }
    }
  }
  return lines.join("\n");
}
