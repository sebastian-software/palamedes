# Proof, Benchmarks, and Current Maturity

Palamedes makes a simple public claim: authoring, message identity, catalogs,
and runtime access should form one coherent model.

This page shows the work behind that claim. The framework matrix verifies the
same model across different app shapes; it does not assume that one product
uses all of them. The goal is confidence, not hype.

## What This Repo Can Prove

This repo can credibly prove five things:

- Palamedes is browser-verified across Next.js, TanStack Start, SolidStart, Waku, and React Router, with server-first Remix v3 smoke-verified
- the runtime model stays centered on `getI18n()`
- the message identity model stays centered on `message + context`
- transform, extract, source analysis, catalog update, and catalog compile steps are measured locally and reproducibly
- nested ICU semantics survive source, extraction, macro transformation, PO catalog update, catalog compile, and runtime rendering

This page is not here to manufacture headline numbers. It is here to make the
evidence easy to inspect.

## Current Maturity

| Topic                 | Current state                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Recommended use cases | New projects, i18n cleanup, teams already comfortable with Lingui-style authoring                                  |
| Supported frameworks  | Browser-verified examples for Next.js, TanStack Start, SolidStart, Waku, and React Router; Remix v3 smoke-verified |
| Runtime model         | `@palamedes/runtime` with `getI18n()`                                                                              |
| Catalog model         | Source-string-first, `message + context` identity; PO default, FCL opt-in                                          |
| Native core           | Rust + `napi-rs`                                                                                                   |
| Catalog semantics     | Delegated to `ferrocat`, including audit and ICU diagnostics                                                       |
| Node requirement      | `>=22.22`                                                                                                          |
| Not yet productized   | Top-level `palamedes` install, `create-palamedes` scaffold                                                         |

## What Counts As Proof In This Repo

- first-party multi-framework example matrix with cookie, route, subdomain, and tld locale strategies
- a native core with typed bindings
- source-string-first PO/FCL catalog semantics backed by `ferrocat`
- structured catalog audits and ICU metadata validation
- reproducible local benchmark commands
- versioned browser screenshots generated from the same CI browser flows

Together, these assets make the shared-model claim visible instead of leaving
it as a slogan.

## Benchmark Scope

The benchmark flow here focuses on the operations Palamedes claims to improve:

- transform
- extract
- source analysis, including the incremental cost of semantic authoring facts and diagnostics
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

For the end-to-end workflow comparison against Lingui, React Intl, and i18next-cli:

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

For the checked ICU semantics proof:

```bash
pnpm proof:icu
```

This runs one nested `select` + `plural` message through extraction, macro
transformation, PO catalog update, catalog compilation, and execution of the
transformed runtime function. The exact scope and the dated public market
snapshot are documented in
[ICU Semantics Proof: Source to Runtime](./icu-semantics-proof.md).

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

Checked local sample, captured on July 31, 2026 with:

```bash
node ./scripts/benchmark-proof.mjs --warmup 3 --runs 7 --large-messages 10000
```

Environment:

- Node `v24.18.0`
- macOS `darwin/arm64`
- Palamedes core `1.9.0`
- Ferrocat `3.3.0`
- fixture corpus: 5 files / 1628 source bytes / 7 catalog messages

Median results from that run:

- transform: `0.48 ms`
- extract: `0.30 ms`
- catalog update: `0.46 ms`
- catalog artifact compile: `5.65 ms`

Sampled peak RSS stayed between `54 MiB` and `58 MiB` across the four steps.

The same run generated `10,000` messages across `20` source files
(`1,213,545` source bytes). Its median results were:

- large transform: `5,327.49 ms`
- large extract: `106.81 ms`
- large catalog update: `161.20 ms`
- large catalog artifact compile: `431.40 ms`

Sampled peak RSS for the large fixture ranged from `118 MiB` to `178 MiB`.

These numbers are not comparable with the previously checked March 2026 sample:
that one ran against a different fixture corpus (5 files / 7002 source bytes /
9 catalog messages) on Palamedes core `0.1.0`. Treat each sample as a snapshot
of its own corpus and release line, not as a trend line. The benchmark script
prints the raw sample series and sampled peak RSS so the checked median and
memory shape are easy to verify.

## End-To-End Workflow Baseline

The end-to-end extract/update comparison numbers are deliberately **not**
repeated on this page. They live in exactly one place — the checked report
[`benchmarks/e2e-workflow/results/latest.md`](../benchmarks/e2e-workflow/results/latest.md)
(with machine-readable data in
[`latest.json`](../benchmarks/e2e-workflow/results/latest.json)) — and the
methodology is documented in
[End-to-end workflow benchmark](./benchmark-e2e-workflow.md). The website
charts quote the same report and a build-time guard
(`scripts/verify-site-bench-data.mjs`) fails the site build if they drift.

The harness validates that all tools write the same active source-message set
before publishing timings. Treat the results as machine-local workflow
measurements, not universal claims.

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
