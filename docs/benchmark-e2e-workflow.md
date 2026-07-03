# End-to-End Extract And Catalog Update Benchmark

This benchmark measures the local workflow a team would actually run to update
catalogs after source changes:

- Palamedes: `pmds extract`
- Lingui: `lingui extract`
- i18next-parser: `i18next`

It is separate from the Lingui v6 preview hot-path benchmark. This harness
includes source scanning, extraction, catalog update, and catalog writes in one
timed command.

## What This Benchmark Times

The reported medians time one CLI command per tool:

- Palamedes: `pmds extract --config palamedes.yaml`
- Lingui: `lingui extract --config lingui.config.mjs`
- i18next-parser: `i18next --config i18next-parser.config.cjs`

That means the measured time includes:

| Area                                        | Included in the timed median? | Notes                                                                                                                                              |
| ------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source file discovery                       | Yes                           | Each tool scans the generated source tree through its own normal config.                                                                           |
| Source parsing / code inspection            | Yes                           | This is the parser work needed to find messages. It is not a separate type-check or lint pass.                                                     |
| Message extraction                          | Yes                           | The command has to read the authored source syntax and produce the current message set.                                                            |
| Catalog update / merge                      | Yes                           | Existing catalogs start with unchanged, changed, and removed messages; the source tree also contains new messages.                                 |
| Catalog file writes                         | Yes                           | The command writes updated `en` and `de` catalogs.                                                                                                 |
| Semantic result validation                  | No                            | The harness checks the written catalogs after the command so bad extraction cannot publish timings, but that check is outside the measured median. |
| Runtime catalog/artifact compile            | No                            | Compiling catalogs into runtime artifacts is a separate benchmark surface.                                                                         |
| Type-checking, linting, bundling, app build | No                            | This benchmark is about catalog extraction/update workflows, not app validation.                                                                   |

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

The i18next-parser corpus uses natural-language keys so active messages can be
compared directly. Teams using key-only i18next architectures may see different
catalog shapes and timings.

## Latest Checked Run

Latest checked full run:

- timestamp: `2026-07-03T19:16:02.889Z`
- Node: `v24.18.0`
- platform: `darwin/arm64`
- warmup: `3`
- measured runs: `7`
- Palamedes CLI: `0.11.4`
- Lingui CLI: `6.4.0`
- i18next-parser CLI: `9.4.0`

### Small

Corpus:

- `80` files
- `640` current messages
- `624` baseline messages
- `48` changed, `64` new, `48` removed

Median results:

| Tool           |      Median |
| -------------- | ----------: |
| Palamedes      |  `33.53 ms` |
| Lingui         | `657.00 ms` |
| i18next-parser | `477.58 ms` |

On this run, Palamedes measured `19.59x` faster than Lingui and `14.24x`
faster than i18next-parser.

### Medium

Corpus:

- `240` files
- `1,920` current messages
- `1,872` baseline messages
- `144` changed, `192` new, `144` removed

Median results:

| Tool           |      Median |
| -------------- | ----------: |
| Palamedes      |  `42.92 ms` |
| Lingui         | `728.56 ms` |
| i18next-parser | `534.15 ms` |

On this run, Palamedes measured `16.98x` faster than Lingui and `12.45x`
faster than i18next-parser.

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
