# End-to-End Extraction Workflow Benchmark

This benchmark measures the local extraction workflow a team would actually
run after source changes:

- Palamedes: `pmds extract`
- Lingui: `lingui extract`
- React Intl: `formatjs extract`
- i18next-cli: `i18next-cli extract`
- General Translation: `gtx-cli generate`

It is separate from the Lingui v6 hot-path benchmark. This harness
includes source scanning, extraction, and output writes in one timed command.
Palamedes, Lingui, i18next-cli, and General Translation also update existing
`en` and `de` catalogs. The React Intl lane instead uses `@formatjs/cli` to
write one aggregated extracted-message JSON artifact; it does not provide a
locale-catalog merge in this command, so its narrower scope is called out
throughout the report.

## What This Benchmark Times

The reported medians time one CLI command per tool:

- Palamedes: `pmds extract --config palamedes.yaml`
- Lingui: `lingui extract --config lingui.config.mjs`
- React Intl: `formatjs extract "src/generated/**/*.{ts,tsx}" --out-file src/locales/extracted.json --id-interpolation-pattern "[sha512:contenthash:base64:6]"`
- i18next-cli: `i18next-cli extract --config i18next.config.mjs --sync-all --trust-derived --quiet`
- General Translation: `gtx-cli generate --quiet`

That means the measured time includes:

| Area                                        | Included in the timed median? | Notes                                                                                                                                                                                                                             |
| ------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source file discovery                       | Yes                           | Each tool scans the generated source tree through its own normal config.                                                                                                                                                          |
| Source parsing / code inspection            | Yes                           | This is the parser work needed to find messages. It is not a separate type-check or lint pass.                                                                                                                                    |
| Message extraction                          | Yes                           | The command has to read the authored source syntax and produce the current message set.                                                                                                                                           |
| Catalog update / merge                      | Except React Intl             | Existing catalogs start with unchanged, changed, and removed messages; the source tree also contains new messages. React Intl's extraction workflow overwrites one extracted-message artifact instead of merging locale catalogs. |
| Catalog file writes                         | Yes                           | Four tools write updated `en` and `de` catalogs. React Intl's extraction workflow writes one aggregated JSON artifact with content-hash IDs.                                                                                      |
| Semantic result validation                  | No                            | The harness checks the written catalogs after the command so bad extraction cannot publish timings, but that check is outside the measured median.                                                                                |
| Runtime catalog/artifact compile            | No                            | Compiling catalogs into runtime artifacts is a separate benchmark surface.                                                                                                                                                        |
| Type-checking, linting, bundling, app build | No                            | This benchmark is about catalog extraction/update workflows, not app validation.                                                                                                                                                  |

For Palamedes, the JSON report also includes the `PALAMEDES_TIMING_JSON=1`
breakdown from inside `pmds extract` (`glob`, `extract`, and `write`). The
headline median still uses the outer process timing so CLI startup and normal
command overhead remain part of the workflow measurement.

## Commands

Build the release `pmds` binary and run the full default benchmark:

```bash
pnpm benchmark:e2e-workflow
```

For a smaller sample:

```bash
pnpm benchmark:e2e-workflow:quick
```

For semantic validation only:

```bash
pnpm --filter @palamedes/benchmark-e2e-workflow validate
```

Generated outputs are written to:

- `benchmarks/e2e-workflow/results/latest.json`
- `benchmarks/e2e-workflow/results/latest.md`

Timestamped snapshots are written alongside those files.

## Methodology

The harness generates a deterministic logical source inventory and renders it
into each tool's idiomatic source shape. Before every warmup and measured run,
catalogs are reset to a baseline containing unchanged, changed, and removed
messages. The source tree also contains new messages.

After each tool runs, the harness normalizes active catalog messages and checks
them against the generated current inventory. The benchmark does not assume
that every parser extracted the same result just because the command exited
successfully.

The i18next-cli corpus uses natural-language keys so active
messages can be compared directly. Teams using key-only i18next architectures
may see different catalog shapes and timings. React Intl source uses
`defineMessages` and `FormattedMessage`; validation compares the extracted
`defaultMessage` values rather than treating its generated content-hash IDs as
message semantics.

General Translation source uses `useGT()` strings and `<T>` components. Its
catalogs are keyed by a content hash the CLI computes itself, so validation maps
the target catalog's keys back through the source catalog instead of reading the
keys as message text. Two GT specifics are worth knowing when reading its
median: new entries are seeded with the source text rather than left empty, and
removed entries are dropped immediately instead of being marked obsolete, so GT
does slightly less bookkeeping than the PO lanes. The harness additionally
asserts that the run preserved every existing translation — if GT's hashing ever
changed shape, the merge would silently reseed each entry and the lane would
stop doing the catalog work it is timed for.

## Reading The React Intl Row

The React Intl lane does less work than every other lane in the table.
`formatjs extract` scans sources and writes one aggregated extracted-message
artifact; it never reads an existing catalog, never merges, and never writes a
per-locale file. Its median therefore answers a narrower question than the four
catalog-update medians next to it and must not be read as a catalog-update
number.

It stays in the matrix because React Intl is one of the most widely used React
i18n libraries, and dropping the second-largest tool in the field while keeping
smaller ones would say more about lane selection than about performance. The
honest handling is to keep the row and label its scope, which is what the
generated report does on every run.

## Tools Not In The Matrix

- **next-intl `useExtracted`** remains a stretch comparison. Extraction is
  integrated into a Next.js Turbopack/Webpack build rather than exposed as an
  equivalent standalone CLI workflow, and the API is still experimental.
  Including it would mix bundler overhead into only one row.
- **Paraglide JS** has no source-extraction command. Messages live in the
  inlang project and its comparable local step is compile-time code generation,
  which belongs to a compile benchmark.
- **Vue I18n** has no first-party extraction CLI to time; discovery is commonly
  handled by editor tooling such as i18n Ally.
- **Tolgee** has no local command that produces catalogs. Its CLI extracts
  locally only through `tolgee extract print` and `tolgee extract check`, which
  report to the console and write no files; catalogs reach the repository via
  `tolgee pull`, which downloads an export from the Tolgee platform and needs an
  API key. Timing a console dump against catalog-update commands would compare
  even less than the React Intl row does.

## Cold And Warm

The report has two lanes per profile, and they answer different questions.

**Cold** clears every tool cache along with the catalogs before each run. It is
the like-for-like comparison — the same work for every tool — and it is the only
lane that feeds the speedup table, `site/app/data/bench.ts`, and the figures
quoted on the website.

**Warm** keeps tool caches, resets the catalogs, and touches a few source files
to model an edit before each run. It answers "what does the next run cost?",
which is what a developer actually experiences. It is not a like-for-like
comparison: Palamedes reuses its extraction cache
([ADR-019](../adr/019-extraction-cache.md)), while the other tools have no
comparable local cache and re-extract in full, so their warm and cold numbers
are the same by design. Those numbers are deliberately kept out of every
speedup ratio.

The cold reset is a correctness requirement, not a detail. The corpus is
generated once per profile and never changes, so a cache surviving between runs
would be hit by every run after the first and the cold medians would silently
become warm ones.

## Latest Checked Run

> **Recorded from the current checkout.** The version line below is the version
> embedded in the locally built release binary. Re-record after releases or
> material benchmark changes so the provenance and binary stay aligned.

Latest checked full run:

- timestamp: `2026-08-05T09:07:39.077Z`
- Node: `v24.18.0`
- platform: `darwin/arm64`
- warmup: `3`
- measured runs: `7`
- Palamedes CLI: `1.12.0`
- Lingui CLI: `6.6.0`
- React Intl extraction CLI (`@formatjs/cli`): `6.16.16`
- i18next-cli: `1.67.3`
- General Translation CLI (`gtx-cli`): `2.16.0`, corpus authored against
  `gt-react` `11.1.4`

### Small

Corpus:

- `80` files
- `640` current messages
- `624` baseline messages
- `48` changed, `64` new, `48` removed

Median results:

| Tool                |      Median |
| ------------------- | ----------: |
| Palamedes           |  `14.11 ms` |
| Lingui              | `747.18 ms` |
| React Intl          | `288.59 ms` |
| i18next-cli         | `625.87 ms` |
| General Translation | `577.89 ms` |

On this run, Palamedes measured `52.94x` faster than Lingui, `20.45x` faster
than React Intl, `44.35x` faster than i18next-cli, and `40.95x` faster than
General Translation.

Warm lane: after touching `5` source files, Palamedes re-ran in `10.76 ms`
against its own cold `14.11 ms`. The compared tools re-extract in full, so
their warm medians repeat their cold ones.

### Medium

Corpus:

- `240` files
- `1,920` current messages
- `1,872` baseline messages
- `144` changed, `192` new, `144` removed

Median results:

| Tool                |      Median |
| ------------------- | ----------: |
| Palamedes           |  `23.80 ms` |
| Lingui              | `836.69 ms` |
| React Intl          | `344.09 ms` |
| i18next-cli         | `658.40 ms` |
| General Translation | `669.27 ms` |

On this run, Palamedes measured `35.15x` faster than Lingui, `14.46x` faster
than React Intl, `27.66x` faster than i18next-cli, and `28.12x` faster than
General Translation.

Warm lane: after touching `5` source files, Palamedes re-ran in `15.16 ms`
against its own cold `23.80 ms`. The compared tools re-extract in full, so
their warm medians repeat their cold ones.

### Realistic

Corpus (modeled on a production web app's Lingui include roots — most source is
not i18n, but the extractor still has to scan all of it; figures rounded so they
read as a shape, not false precision):

- `1,500` files (`750` with i18n markers, `750` without)
- `~400,000` source lines (~3% carry i18n syntax)
- `6,000` current messages (~15% with a `{name}` variable)
- `5,850` baseline messages
- `450` changed, `600` new, `450` removed

Median results:

| Tool                |       Median |
| ------------------- | -----------: |
| Palamedes           |   `83.89 ms` |
| Lingui              | `2480.24 ms` |
| React Intl          |  `475.85 ms` |
| i18next-cli         | `6644.63 ms` |
| General Translation | `6116.43 ms` |

On this run, Palamedes measured `29.57x` faster than Lingui, `5.67x` faster
than React Intl, `79.21x` faster than i18next-cli, and `72.91x` faster than
General Translation.

Warm lane: after touching `5` source files, Palamedes re-ran in `33.08 ms`
against its own cold `83.89 ms` — the corpus where the cache has the most to
skip, and the shape of a real repository. The compared tools re-extract in
full, so their warm medians repeat their cold ones (`2459.89 ms`, `481.17 ms`,
`6708.17 ms`, and `5877.81 ms`), which is why this lane never enters a speedup
ratio.

## Reading The Numbers

These are machine-local CLI workflow timings, not universal cross-machine
claims. They are useful because the corpus, semantic validation, raw samples,
and generated reports are checked in and reproducible.

Use the JSON report when quoting numbers:

- [`benchmarks/e2e-workflow/results/latest.json`](../benchmarks/e2e-workflow/results/latest.json)
- [`benchmarks/e2e-workflow/results/latest.md`](../benchmarks/e2e-workflow/results/latest.md)

The Palamedes timing breakdown in the JSON comes from `PALAMEDES_TIMING_JSON=1`
on `pmds extract`; the end-to-end median still uses the outer process timing so
CLI startup and catalog writes stay inside the measured workflow.
