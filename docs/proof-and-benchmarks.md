# Proof, Benchmarks, and Current Maturity

Palamedes makes a simple public claim: the same i18n model should keep working
as an app moves across modern frameworks.

This page shows the work behind that claim. The goal is confidence, not hype.

## What This Repo Can Prove

This repo can credibly prove four things:

- Palamedes is verified across Next.js, TanStack Start, SolidStart, Waku, and React Router
- the runtime model stays centered on `getI18n()`
- the message identity model stays centered on `message + context`
- transform, extract, catalog update, and catalog compile steps are measured locally and reproducibly

This page is not here to manufacture headline numbers. It is here to make the
evidence easy to inspect.

## Current Maturity

| Topic                 | Current state                                                                     |
| --------------------- | --------------------------------------------------------------------------------- |
| Recommended use cases | New projects, i18n cleanup, teams already comfortable with Lingui-style authoring |
| Supported frameworks  | Verified examples for Next.js, TanStack Start, SolidStart, Waku, and React Router |
| Runtime model         | `@palamedes/runtime` with `getI18n()`                                             |
| Catalog model         | Source-string-first, `message + context` identity; PO default, FCL opt-in         |
| Native core           | Rust + `napi-rs`                                                                  |
| Catalog semantics     | Delegated to `ferrocat`, including audit and ICU diagnostics                      |
| Node requirement      | `>=22.22`                                                                         |
| Not yet productized   | Top-level `palamedes` install, `create-palamedes` scaffold                        |

## What Counts As Proof In This Repo

- first-party multi-framework example matrix with cookie, route, subdomain, and tld locale strategies
- a native core with typed bindings
- source-string-first PO/FCL catalog semantics backed by `ferrocat`
- structured catalog audits and ICU metadata validation
- reproducible local benchmark commands
- versioned browser screenshots generated from the same CI browser flows

Together, these assets make the cross-framework story visible instead of
leaving it as a slogan.

## Benchmark Scope

The benchmark flow here focuses on the operations Palamedes claims to improve:

- transform
- extract
- catalog update
- catalog artifact compile
- end-to-end extract and catalog update workflows

It uses a checked-in fixture corpus under
[`benchmarks/proof-fixtures`](../benchmarks/proof-fixtures),
not runnable demo applications.

## Exact Commands

Build the public packages first:

```bash
pnpm build
```

Run the benchmark script:

```bash
pnpm benchmark:proof
```

For a quicker sample run:

```bash
node ./scripts/benchmark-proof.mjs --warmup 1 --runs 3
```

For a generated large-catalog run:

```bash
pnpm benchmark:proof:large
```

Equivalent direct command:

```bash
node ./scripts/benchmark-proof.mjs --warmup 1 --runs 3 --large-messages 10000
```

For a larger stress run:

```bash
node ./scripts/benchmark-proof.mjs --warmup 1 --runs 3 --large-messages 50000 --large-source-files 50
```

For the separate Lingui v6 comparison harness:

```bash
pnpm benchmark:lingui-v6
```

Quick sample:

```bash
pnpm benchmark:lingui-v6:quick
```

See the full methodology here:

- [Benchmarking against Lingui v6](https://github.com/sebastian-software/palamedes/blob/main/docs/benchmark-lingui-v6-preview.md)

For the broader architectural picture, including `next-intl` and General Translation, see:

- [Comparing modern i18n approaches](https://github.com/sebastian-software/palamedes/blob/main/docs/approach-comparison.md)

That separate harness measures Lingui macro rewrite through distinct Babel and
SWC lanes instead of folding them into one number.

For the end-to-end workflow comparison against Lingui and i18next-parser:

```bash
pnpm benchmark:e2e-workflow
```

Quick sample:

```bash
pnpm benchmark:e2e-workflow:quick
```

See the methodology and latest checked report here:

- [End-to-end extract and catalog update benchmark](https://github.com/sebastian-software/palamedes/blob/main/docs/benchmark-e2e-workflow.md)

That workflow benchmark times source discovery, source parsing needed for
message extraction, extraction, catalog update/merge, and catalog writes in one
CLI command per tool. It does not time runtime catalog/artifact compilation,
type-checking, linting, bundling, or the post-run semantic validation step.

## Methodology

- machine-local benchmark
- same checked-in fixture corpus every run
- warmup runs before measurement
- median reported for each operation
- operations measured independently, not as a blended total
- end-to-end workflow runs measured separately from isolated hot paths
- sampled peak RSS reported from Node's `process.memoryUsage().rss`

This is meant to be reproducible and honest, not a "best possible marketing
number."

That distinction matters. Native code helps, but Palamedes also keeps more of
the expensive work in one place, with less duplicated semantic work across
layers.

## Fixture Corpus

The current benchmark corpus uses a dedicated fixture set:

- `benchmarks/proof-fixtures/src/client-app.tsx`
- `benchmarks/proof-fixtures/src/client-entry.tsx`
- `benchmarks/proof-fixtures/src/server-page.tsx`
- `benchmarks/proof-fixtures/src/counter-widget.tsx`
- `benchmarks/proof-fixtures/src/locale-switcher.tsx`

That gives the benchmark:

- React macros
- JSX and tagged template paths
- client-oriented and server-oriented render shapes
- catalog artifact compilation on plain checked-in source fixtures

Large-catalog runs use a deterministic generator under
[`benchmarks/large-catalog`](../benchmarks/large-catalog)
instead of checking in a 10k or 50k message catalog. The generator creates
synthetic TSX source files and matching catalog message metadata so the same
run can measure:

- macro transform time across the generated source files
- extraction time across the generated source files
- catalog update time for the generated message set
- catalog artifact compile time for the generated PO catalog

Set `--large-messages` to enable that section. The benchmark intentionally keeps
PO as the baseline catalog storage because PO is the default app-facing format
and the Lingui comparison harness is PO-based. Use the catalog-format tests and
CLI conversion workflow to validate FCL behavior separately.

The default benchmark remains small and quick so it is still useful during
routine local checks.

## Local Baseline

Checked local sample, captured on March 18, 2026 with:

```bash
node ./scripts/benchmark-proof.mjs --warmup 1 --runs 3
```

Environment:

- Node `v24.14.0`
- macOS `darwin/arm64`
- Palamedes core `0.1.0`
- Ferrocat `0.8.0`
- fixture corpus: 5 files / 7002 source bytes / 9 catalog messages

Median results from that run:

- transform: `0.97 ms`
- extract: `0.89 ms`
- catalog update: `0.64 ms`
- catalog artifact compile: `4.04 ms`

This sample is a historical reference point. Current Palamedes builds use
Ferrocat `2.1.1`; rerun the command above when you need fresh numbers for the
current release line. The benchmark script also prints the raw sample series and
sampled peak RSS so the checked median and memory shape are easy to verify.

For the Ferrocat 2.x / Palamedes 1.0 migration PR, record a fresh
`pnpm benchmark:proof` run in the PR description so reviewers can compare it
with this historical baseline without turning machine-local numbers into a
portable performance claim.

## End-To-End Workflow Baseline

Checked local sample, captured on July 6, 2026 with:

```bash
pnpm benchmark:e2e-workflow
```

Environment:

- Node `v24.18.0`
- macOS `darwin/arm64`
- Palamedes CLI `1.2.0`
- Lingui CLI `6.4.0`
- i18next-parser CLI `9.4.0`

Median results from that run:

| Profile |  Palamedes |      Lingui | i18next-parser |
| ------- | ---------: | ----------: | -------------: |
| Small   | `33.58 ms` | `705.12 ms` |    `526.45 ms` |
| Medium  | `47.77 ms` | `812.83 ms` |    `587.52 ms` |

The harness validates that all three tools write the same active source-message
set before publishing timings. It renders the same logical message inventory
into each tool's idiomatic source shape, then measures scan, extract, catalog
update, and file writes as one workflow.

Treat these as machine-local workflow measurements, not universal claims. The
raw report lives in
[`benchmarks/e2e-workflow/results/latest.json`](../benchmarks/e2e-workflow/results/latest.json).

## What This Page Does Not Claim

- It does not claim universal results across every machine or every codebase.
- It does not claim that Palamedes already covers every possible Lingui compatibility path.
- It does not treat "written in Rust" as proof by itself.

The goal is simpler: show the work and make local verification easy.

## Related Proof Assets

- [First working translation in 5 minutes](https://github.com/sebastian-software/palamedes/blob/main/docs/first-working-translation.md)
- [Catalog formats: PO and FCL](https://github.com/sebastian-software/palamedes/blob/main/docs/catalog-formats.md)
- [Migrating to Palamedes 1.0](https://github.com/sebastian-software/palamedes/blob/main/docs/migrations/1.0.0.md)
- [Examples](https://github.com/sebastian-software/palamedes/blob/main/examples/README.md)
- [Example screenshots](https://github.com/sebastian-software/palamedes/blob/main/docs/example-screenshots/README.md)
- [Framework example notes](https://github.com/sebastian-software/palamedes/blob/main/docs/framework-example-notes.md)
- [Palamedes principles](https://github.com/sebastian-software/palamedes/blob/main/docs/principles.md)
- [Benchmarking against Lingui v6](https://github.com/sebastian-software/palamedes/blob/main/docs/benchmark-lingui-v6-preview.md)
- [End-to-end workflow benchmark](https://github.com/sebastian-software/palamedes/blob/main/docs/benchmark-e2e-workflow.md)
