# End-to-End Extraction Workflow Benchmark

This benchmark measures the local extraction workflow a team would actually
run after source changes:

- Palamedes: `pmds extract`
- Lingui: `lingui extract`
- React Intl: `formatjs extract`
- i18next-cli: `i18next-cli extract`

It is separate from the Lingui v6 hot-path benchmark. This harness
includes source scanning, extraction, and output writes in one timed command.
Palamedes, Lingui, and i18next-cli also update existing `en`
and `de` catalogs. The React Intl lane instead uses `@formatjs/cli` to write one
aggregated extracted-message JSON artifact; it does not provide a locale-catalog
merge in this command, so its narrower scope is called out throughout the report.

## What This Benchmark Times

The reported medians time one CLI command per tool:

- Palamedes: `pmds extract --config palamedes.yaml`
- Lingui: `lingui extract --config lingui.config.mjs`
- React Intl: `formatjs extract "src/generated/**/*.{ts,tsx}" --out-file src/locales/extracted.json --id-interpolation-pattern "[sha512:contenthash:base64:6]"`
- i18next-cli: `i18next-cli extract --config i18next.config.mjs --sync-all --trust-derived --quiet`

That means the measured time includes:

| Area                                        | Included in the timed median? | Notes                                                                                                                                                                                                                             |
| ------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source file discovery                       | Yes                           | Each tool scans the generated source tree through its own normal config.                                                                                                                                                          |
| Source parsing / code inspection            | Yes                           | This is the parser work needed to find messages. It is not a separate type-check or lint pass.                                                                                                                                    |
| Message extraction                          | Yes                           | The command has to read the authored source syntax and produce the current message set.                                                                                                                                           |
| Catalog update / merge                      | Except React Intl             | Existing catalogs start with unchanged, changed, and removed messages; the source tree also contains new messages. React Intl's extraction workflow overwrites one extracted-message artifact instead of merging locale catalogs. |
| Catalog file writes                         | Yes                           | Three tools write updated `en` and `de` catalogs. React Intl's extraction workflow writes one aggregated JSON artifact with content-hash IDs.                                                                                     |
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
- **General Translation** performs network/AI translation in its CLI workflow,
  which is not comparable to these deterministic local extraction commands.

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

- timestamp: `2026-07-31T08:33:20.786Z`
- Node: `v24.18.0`
- platform: `darwin/arm64`
- warmup: `3`
- measured runs: `7`
- Palamedes CLI: `1.9.0`
- Lingui CLI: `6.6.0`
- React Intl extraction CLI (`@formatjs/cli`): `6.16.14`
- i18next-cli: `1.67.3`

### Small

Corpus:

- `80` files
- `640` current messages
- `624` baseline messages
- `48` changed, `64` new, `48` removed

Median results:

| Tool        |      Median |
| ----------- | ----------: |
| Palamedes   |  `12.82 ms` |
| Lingui      | `690.97 ms` |
| React Intl  | `282.84 ms` |
| i18next-cli | `404.93 ms` |

On this run, Palamedes measured `53.91x` faster than Lingui, `22.07x` faster
than React Intl, and `31.59x` faster than i18next-cli.

Warm lane: after touching `5` source files, Palamedes re-ran in `10.27 ms`
against its own cold `12.82 ms`. The compared tools re-extract in full, so
their warm medians repeat their cold ones.

### Medium

Corpus:

- `240` files
- `1,920` current messages
- `1,872` baseline messages
- `144` changed, `192` new, `144` removed

Median results:

| Tool        |      Median |
| ----------- | ----------: |
| Palamedes   |  `22.22 ms` |
| Lingui      | `761.69 ms` |
| React Intl  | `305.90 ms` |
| i18next-cli | `618.69 ms` |

On this run, Palamedes measured `34.27x` faster than Lingui, `13.76x` faster
than React Intl, and `27.84x` faster than i18next-cli.

Warm lane: after touching `5` source files, Palamedes re-ran in `14.05 ms`
against its own cold `22.22 ms`. The compared tools re-extract in full, so
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

| Tool        |       Median |
| ----------- | -----------: |
| Palamedes   |   `82.14 ms` |
| Lingui      | `2405.52 ms` |
| React Intl  |  `470.81 ms` |
| i18next-cli | `6256.98 ms` |

On this run, Palamedes measured `29.29x` faster than Lingui, `5.73x` faster
than React Intl, and `76.18x` faster than i18next-cli.

Warm lane: after touching `5` source files, Palamedes re-ran in `33.11 ms`
against its own cold `82.14 ms` — the corpus where the cache has the most to
skip, and the shape of a real repository. The compared tools re-extract in
full, so their warm medians repeat their cold ones (`2339.33 ms`, `470.60 ms`,
and `6196.06 ms`), which is why this lane never enters a speedup ratio.

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
