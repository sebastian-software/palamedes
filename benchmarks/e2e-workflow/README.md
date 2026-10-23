# End-to-End Workflow Benchmark

This workspace package benchmarks the full local extraction workflow a team
would run to update catalogs:

- Palamedes: `pmds extract`
- Lingui: `lingui extract`
- React Intl: `formatjs extract`
- fbtee: `fbtee collect` + `fbtee prepare-translations`
- i18next-cli: `i18next-cli extract`
- General Translation: `gtx-cli generate`

The harness generates the same logical source inventory for each tool, renders
it into each tool's idiomatic source shape, resets catalogs before every timed
run, then measures scan, extract, and output writes together. Palamedes, Lingui,
fbtee, i18next-cli, and General Translation update `en` and `de` catalogs. The
React Intl lane uses `@formatjs/cli` to write one aggregated extracted-message
JSON artifact instead; the generated report records that narrower scope
explicitly.

The fbtee lane measures its official two-command local workflow. `fbtee collect`
scans the sources and writes `source_strings.json`; `fbtee
prepare-translations` then merges the `en` and `de` JSON catalogs. Both Node
process startups remain inside the timed boundary.

The General Translation lane runs `gtx-cli generate`, General Translation's
path for teams handling their own translations: it extracts and merges catalogs
entirely locally, with no API key and no network access. General Translation's
default workflow (`gtx-cli translate`) sends content to the General Translation
API and is out of scope here. Because General Translation keys catalogs by a
content hash it computes itself, the baseline catalogs for that lane are derived
from a real `gtx-cli generate` run rather than from a reimplementation of its
hashing.

The timed median does not include runtime catalog/artifact compilation, linting,
type-checking, bundling, or the post-run semantic validation. The validation is
there to reject bad results before publishing timings; it is not part of the
measured number.

Run from the repo root:

```bash
pnpm benchmark:e2e-workflow
pnpm benchmark:e2e-workflow:quick
pnpm --filter @palamedes/benchmark-e2e-workflow validate
```

Outputs are written to `benchmarks/e2e-workflow/results/`.

The latest checked report is summarized in
[`docs/benchmark-e2e-workflow.md`](../../docs/benchmark-e2e-workflow.md).

The [framework workflow extension](frameworks/README.md) adds Vue, Svelte, and
Solid component sources, Wuchale, and an Intlayer conformance lane.
Run it with `pnpm benchmark:framework-workflow`. It reuses this suite's message
inventory and stores its reports separately from the existing website evidence.

## Blacksmith reference runs

The manual [Blacksmith extraction benchmarks workflow](../../.github/workflows/blacksmith-benchmarks.yml)
runs this React suite and the Vue/Svelte/Solid extension on Linux x86-64 and
macOS ARM64. Choose `both` to run three fresh VMs per platform. Each VM builds
the same release CLI and runs all comparators serially against the same seeded
logical inventories: small, medium, and realistic. Dependency installation,
native compilation, fixture preparation, environment probes, and correctness
checks stay outside the timed commands. The OS page cache is not flushed.

After the workflow is merged into the default branch, start a campaign with:

```sh
gh workflow run blacksmith-benchmarks.yml --ref main -f platform=both
```

The runner labels follow Ferroni's established setup:
`blacksmith-4vcpu-ubuntu-2404` and `blacksmith-6vcpu-macos-26`. Jobs have a
90-minute limit. A platform selector permits a Linux-only or macOS-only retry;
paid runners are never triggered by pushes, pull requests, or a schedule.

Every VM takes seven samples after three warmups. React tool order rotates
between VMs, the framework extension also rotates it between rounds, and the
order of the two suites alternates. Cold runs reset catalogs and tool caches.
React's separate warm lane keeps caches and touches five files. It describes
incremental behavior, not equivalent-work speed. React Intl only extracts and
writes a source artifact; Wuchale also transforms and compiles. Those scopes
stay separate. Intlayer's JSON configuration produces an untimed conformance
receipt if it fails the catalog contract.

Both suites now check active inventories after every invocation, outside the
timer. The React suite additionally checks fbtee and General Translation's
seeded translations; the framework extension checks every unchanged German
translation and asserts that application sources did not change. These gates
are recorded separately rather than treated as identical coverage.

Each platform's summary reports the median of its three VM medians. It does
not pool the 21 samples or combine Linux with macOS. Aggregation requires all
three complete repetitions from the same workflow run, attempt, and revision.
It rejects changed versions, locks, CPU classes, corpora, scopes, failed
semantic checks, incomplete samples, and dirty checkouts. Expected Intlayer
conformance failures remain exclusions, with their receipts retained.

The `benchmarks-<platform>-<run-id>-<attempt>` artifact contains the summary,
JSON report, every repetition's raw reports and logs, source snapshots, lockfile
hashes, toolchain versions, build flags, runner image, and CPU information.
Per-VM artifacts, including failed calls, are kept for seven days; complete
platform artifacts are kept for 30 days. Download evidence before it expires
if it will support a published claim. VM isolation does not establish control
over physical-host contention, power, or thermal state. These are reproducible
project-run measurements, not an independent third-party audit.

Results are written outside the source checkout and never update the checked
`latest` reports or website figures automatically. The homepage uses a Linux
and macOS selector to compare tools on one platform at a time. Until a complete
reference campaign is checked in, both platforms are explicitly pending; the
earlier local recording stays available in its own disclosure. No local
measurement fills a reference-runner result.

To publish a campaign, verify the successful run's exact source revision and
download both complete platform artifacts. Import their extracted directories:

```sh
node scripts/blacksmith-bench-data.mjs \
  --linux /path/to/benchmarks-linux-x86-64-RUN-ATTEMPT \
  --macos /path/to/benchmarks-macos-arm64-RUN-ATTEMPT
```

The importer verifies the retained file hashes and rebuilds both aggregates
from all six raw VM reports. It rejects mixed runs, revisions, dependencies,
corpora, scopes, incomplete samples and failed semantic gates. The output is
`benchmarks/e2e-workflow/results/blacksmith/latest.json`, retaining raw samples
and catalog receipts in Git after CI artifacts expire. Review that file before
committing it. The site build validates it again and emits only display data,
provenance, and evidence links into the browser bundle. The four framework
views then use the new values without a UI change. Source archives and full
logs remain separate artifacts; retain them durably if they will be linked as
publication evidence. Never promote a partial run, a local diagnostic, or an
excluded candidate's timing.

### Published campaign

The [October 23, 2026 campaign](https://github.com/sebastian-software/palamedes/actions/runs/39977069712/attempts/1)
measured revision `88bd86d3229778969dd70d21ff84c1911c6b15b1` on three
Linux x86-64 VMs (four AMD EPYC vCPUs each) and three macOS ARM64 VMs (six
Apple M4 Pro virtual CPUs each), with Node.js 24.22.0. The
[checked evidence bundle](results/blacksmith/latest.json) retains all six
manifests, raw samples, and catalog receipts. Each platform has 72 validated
case rows and nine untimed Intlayer exclusions, across all three inventories
and the separately retained React cold/warm lanes.

The campaign predates the removal of vue3-gettext from the active comparison.
Its raw evidence stays intact and fully validated; the website omits that
retired comparator. Future campaigns use the reduced framework matrix and no
longer require GNU gettext tools.

All six measurement jobs succeeded. Both CI reporting jobs failed because
importing the corpus metadata eagerly resolved `@lingui/format-po`, which the
Node-only reporting jobs do not install. The complete retained shards were
downloaded, hash-checked, and combined locally with the same `blacksmith.mjs
merge` command. Every one of the 81 aggregate rows per platform was checked
against the original aggregator before import. The fix defers Lingui resolution
until corpus generation; a regression test now runs the full merge command in
a checkout without comparator dependencies. No measurement or aggregation
formula changed during recovery. The workflow link retains the failed
reporting jobs as part of this campaign's provenance.

For a local orchestration smoke check after installing both workspaces:

```sh
node benchmarks/e2e-workflow/src/blacksmith.mjs run --diagnostic \
  --platform macos-arm64 --output /private/tmp/palamedes-benchmark-diagnostic
```

Use `linux-x86-64` on Linux. The output directory must not exist and its parent
must exist outside the source checkout. Diagnostics use the small corpus, no
warmups, and one sample; they are explicitly rejected by the campaign merger.
Both underlying harnesses also accept `--output-dir` for custom local report
destinations. Their existing output paths remain the default.
