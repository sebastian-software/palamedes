import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { mergeShards, readShard } from "../benchmarks/e2e-workflow/src/blacksmith-report.mjs";
import { benchmarkToolVersion } from "./benchmark-tool-versions.mjs";

export const BLACKSMITH_REPORT = "benchmarks/e2e-workflow/results/blacksmith/latest.json";
const PLATFORMS = [
  { id: "linux-x86-64", label: "Linux", arch: "x86-64" },
  { id: "macos-arm64", label: "macOS", arch: "ARM64" },
];
const LABELS = {
  palamedes: "Palamedes",
  lingui: "Lingui",
  formatjs: "React Intl",
  fbtee: "fbtee",
  i18nextCli: "i18next-cli",
  gt: "General Translation",
  i18next: "i18next-cli",
  wuchale: "Wuchale",
  intlayer: "Intlayer",
};
const SCOPES = {
  "extract-write": "extract + write",
  "extract-update": "extract + catalog update",
  "extract-update-compile": "extract + update + compile",
};

export function blacksmithBenchData(publication) {
  if (publication === null) return { status: "pending", platforms: PLATFORMS, profiles: [] };
  assert.ok([1, 2].includes(publication.schemaVersion), "unknown campaign schema");
  assert.deepEqual(Object.keys(publication.platforms).sort(), PLATFORMS.map((p) => p.id).sort());
  if (publication.schemaVersion === 2)
    assert.deepEqual(Object.keys(publication.campaigns).sort(), PLATFORMS.map((p) => p.id).sort());
  // Platforms are independent experiments and may be retried separately. Each
  // still needs one complete, homogeneous three-VM campaign; source, locks,
  // measurement options and comparator versions must agree across platforms.
  const campaigns = PLATFORMS.map(({ id }) =>
    publication.schemaVersion === 1 ? publication : publication.campaigns[id],
  );
  const reports = PLATFORMS.map(({ id }, index) =>
    mergeShards(publication.platforms[id], {
      runId: campaigns[index].runId,
      attempt: campaigns[index].attempt,
      revision: publication.revision,
      platform: id,
    }),
  );
  const first = reports[0].repetitions[0];
  for (const report of reports) {
    assert.deepEqual(
      report.repetitions[0].locks,
      first.locks,
      "platforms must measure the same dependency locks",
    );
    assert.deepEqual(report.repetitions[0].measurement, first.measurement);
    assert.equal(report.repetitions[0].environment.node, first.environment.node);
  }
  const baseline = publication.platforms[PLATFORMS[0].id][0];
  for (const { id } of PLATFORMS) {
    const shard = publication.platforms[id][0];
    assert.deepEqual(shard.react.versions, baseline.react.versions);
    const { gettext: _gettext, ...versions } = shard.frameworks.versions;
    const { gettext: _baselineGettext, ...baselineVersions } = baseline.frameworks.versions;
    assert.deepEqual(versions, baselineVersions, "platform comparator versions differ");
  }
  const runUrls = campaigns.map(
    ({ runId, attempt }) =>
      `https://github.com/sebastian-software/palamedes/actions/runs/${runId}/attempts/${attempt}`,
  );
  return {
    status: "measured",
    runUrl: runUrls[0] === runUrls[1] ? runUrls[0] : undefined,
    revision: publication.revision,
    reportPath: BLACKSMITH_REPORT,
    platforms: PLATFORMS.map((platform, index) => {
      const manifest = reports[index].repetitions[0];
      return {
        ...platform,
        runUrl: runUrls[index],
        cpu: manifest.environment.cpu,
        node: manifest.environment.node,
        measured: manifest.finishedAt.slice(0, 10),
        repetitions: 3,
        runs: 7,
        warmup: 3,
      };
    }),
    profiles: ["small", "medium", "realistic"].map((profile) => ({
      id: profile,
      frameworks: ["react", "vue", "svelte", "solid"].map((framework) => ({
        id: framework,
        rows: reports[0].results
          .filter(
            // Retain and validate the complete historical campaign above, but
            // keep retired comparators out of the active public comparison.
            (row) =>
              row.framework === framework &&
              row.profile === profile &&
              row.lane === "cold" &&
              row.tool !== "gettext",
          )
          .map((row) => {
            const peers = reports.map((report) =>
              report.results.find((candidate) => candidate.id === row.id),
            );
            for (const peer of peers) {
              assert.ok(peer);
              assert.equal(peer.scope, row.scope);
              assert.deepEqual(peer.corpus, row.corpus, "platform corpora differ");
            }
            return {
              tool: LABELS[row.tool],
              version: benchmarkToolVersion(
                framework === "react" ? baseline.react.versions : baseline.frameworks.versions,
                row.tool,
                framework,
              ),
              scope: SCOPES[row.scope],
              values: Object.fromEntries(
                PLATFORMS.map(({ id }, index) => [
                  id,
                  peers[index].status === "validated"
                    ? { status: "validated", medianMs: peers[index].medianMs }
                    : { status: "not-equivalent" },
                ]),
              ),
            };
          })
          .sort((a, b) =>
            a.tool === "Palamedes" ? -1 : b.tool === "Palamedes" ? 1 : a.tool.localeCompare(b.tool),
          ),
      })),
    })),
  };
}

export async function loadBlacksmithBenchData(repoRoot) {
  let contents;
  try {
    contents = await readFile(join(repoRoot, BLACKSMITH_REPORT), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return blacksmithBenchData(null);
    throw error;
  }
  return blacksmithBenchData(JSON.parse(contents));
}

// Import the complete downloaded platform artifacts, not a summary pasted from
// CI. Verify every retained hash and rebuild the aggregate from raw VM reports.
// The checked bundle keeps raw samples/receipts after CI artifacts expire; only
// the small projection above enters the browser graph.
export async function importBlacksmithBenchmarks({ linux, macos, repoRoot }) {
  const roots = [linux, macos];
  const platformReports = await Promise.all(
    roots.map(async (root) => JSON.parse(await readFile(join(root, "report.json"), "utf8"))),
  );
  const { revision } = platformReports[0];
  const publication = { schemaVersion: 2, revision, campaigns: {}, platforms: {} };
  for (const [index, { id }] of PLATFORMS.entries()) {
    const declared = platformReports[index];
    assert.equal(declared.revision, revision, "platforms must measure the same source revision");
    const { runId, attempt } = declared;
    const shards = await Promise.all(
      [1, 2, 3].map((run) => readShard(join(roots[index], `run${run}`))),
    );
    const checked = mergeShards(shards, { platform: id, runId, attempt, revision });
    // Optional undefined metadata is absent in the downloaded JSON.
    assert.equal(
      JSON.stringify(declared.results),
      JSON.stringify(checked.results),
      "downloaded aggregate differs from raw evidence",
    );
    for (const key of ["platform", "runId", "attempt", "revision"])
      assert.equal(declared[key], checked[key]);
    publication.campaigns[id] = { runId, attempt };
    publication.platforms[id] = shards;
  }
  blacksmithBenchData(publication);
  const output = join(repoRoot, BLACKSMITH_REPORT);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(publication, null, 2)}\n`);
  return output;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { linux: { type: "string" }, macos: { type: "string" } },
  });
  assert.ok(values.linux && values.macos, "Provide --linux and --macos artifact directories");
  console.log(
    await importBlacksmithBenchmarks({ ...values, repoRoot: resolve(import.meta.dirname, "..") }),
  );
}
