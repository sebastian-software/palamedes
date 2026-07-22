# End-to-End Extraction Workflow Benchmark

This benchmark measures the local extraction workflow a team would actually
run after source changes:

- Palamedes: `pmds extract`
- Lingui: `lingui extract`
- FormatJS: `formatjs extract`
- i18next-parser: `i18next`
- i18next-cli: `i18next-cli extract`

It is separate from the Lingui v6 hot-path benchmark. This harness
includes source scanning, extraction, and output writes in one timed command.
Palamedes, Lingui, i18next-parser, and i18next-cli also update existing `en`
and `de` catalogs. FormatJS instead writes its standard aggregated extracted-
message JSON artifact; it does not provide a locale-catalog merge in this
command, so its narrower scope is called out throughout the report.

## What This Benchmark Times

The reported medians time one CLI command per tool:

- Palamedes: `pmds extract --config palamedes.yaml`
- Lingui: `lingui extract --config lingui.config.mjs`
- FormatJS: `formatjs extract "src/generated/**/*.{ts,tsx}" --out-file src/locales/extracted.json --id-interpolation-pattern "[sha512:contenthash:base64:6]"`
- i18next-parser: `i18next --config i18next-parser.config.cjs`
- i18next-cli: `i18next-cli extract --config i18next.config.mjs --sync-all --trust-derived --quiet`

That means the measured time includes:

| Area                                        | Included in the timed median? | Notes                                                                                                                                                                                                     |
| ------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source file discovery                       | Yes                           | Each tool scans the generated source tree through its own normal config.                                                                                                                                  |
| Source parsing / code inspection            | Yes                           | This is the parser work needed to find messages. It is not a separate type-check or lint pass.                                                                                                            |
| Message extraction                          | Yes                           | The command has to read the authored source syntax and produce the current message set.                                                                                                                   |
| Catalog update / merge                      | Except FormatJS               | Existing catalogs start with unchanged, changed, and removed messages; the source tree also contains new messages. FormatJS overwrites one extracted-message artifact instead of merging locale catalogs. |
| Catalog file writes                         | Yes                           | Four tools write updated `en` and `de` catalogs. FormatJS writes one aggregated JSON extraction artifact with content-hash IDs.                                                                           |
| Semantic result validation                  | No                            | The harness checks the written catalogs after the command so bad extraction cannot publish timings, but that check is outside the measured median.                                                        |
| Runtime catalog/artifact compile            | No                            | Compiling catalogs into runtime artifacts is a separate benchmark surface.                                                                                                                                |
| Type-checking, linting, bundling, app build | No                            | This benchmark is about catalog extraction/update workflows, not app validation.                                                                                                                          |

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

The i18next-parser and i18next-cli corpora use natural-language keys so active
messages can be compared directly. Teams using key-only i18next architectures
may see different catalog shapes and timings. FormatJS source uses
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

## Latest Checked Run

Latest checked full run:

- timestamp: `2026-07-22T14:44:41.328Z`
- Node: `v24.18.0`
- platform: `darwin/arm64`
- warmup: `3`
- measured runs: `7`
- Palamedes CLI: `1.3.0`
- Lingui CLI: `6.4.0`
- FormatJS CLI: `6.16.14`
- i18next-parser CLI: `9.4.0`
- i18next-cli: `1.66.2`

### Small

Corpus:

- `80` files
- `640` current messages
- `624` baseline messages
- `48` changed, `64` new, `48` removed

Median results:

| Tool           |       Median |
| -------------- | -----------: |
| Palamedes      |   `43.88 ms` |
| Lingui         | `1143.37 ms` |
| FormatJS       |  `291.08 ms` |
| i18next-parser |  `512.98 ms` |
| i18next-cli    |  `378.21 ms` |

On this run, Palamedes measured `26.06x` faster than Lingui, `6.63x` faster
than FormatJS, `11.69x` faster than i18next-parser, and `8.62x` faster than
i18next-cli.

### Medium

Corpus:

- `240` files
- `1,920` current messages
- `1,872` baseline messages
- `144` changed, `192` new, `144` removed

Median results:

| Tool           |      Median |
| -------------- | ----------: |
| Palamedes      |  `46.93 ms` |
| Lingui         | `760.77 ms` |
| FormatJS       | `299.82 ms` |
| i18next-parser | `569.17 ms` |
| i18next-cli    | `584.74 ms` |

On this run, Palamedes measured `16.21x` faster than Lingui, `6.39x` faster
than FormatJS, `12.13x` faster than i18next-parser, and `12.46x` faster than
i18next-cli.

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

| Tool           |       Median |
| -------------- | -----------: |
| Palamedes      |  `179.87 ms` |
| Lingui         | `2238.75 ms` |
| FormatJS       |  `474.62 ms` |
| i18next-parser | `1641.15 ms` |
| i18next-cli    | `6612.71 ms` |

On this run, Palamedes measured `12.45x` faster than Lingui, `2.64x` faster
than FormatJS, `9.12x` faster than i18next-parser, and `36.76x` faster than
i18next-cli.

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
