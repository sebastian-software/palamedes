# Proof, Benchmarks, and Current Maturity

Palamedes makes a simple public claim:

it keeps a coherent i18n model across multiple modern frameworks without
changing the core mental model underneath.

This page exists to show the work behind that claim.

## What This Repo Can Prove

This repo can credibly prove four things:

- Palamedes is verified across Next.js, TanStack Start, SolidStart, Waku, and React Router
- the runtime model stays centered on `getI18n()`
- the message identity model stays centered on `message + context`
- transform, extract, catalog update, and catalog compile hot paths are measured locally and reproducibly

This page is not here to manufacture marketing numbers. It is here to make the
architecture and the evidence easy to inspect.

## Current Maturity

| Topic | Current state |
| --- | --- |
| Recommended use cases | New projects, architecture cleanup, teams already comfortable with Lingui-style authoring |
| Supported frameworks | Verified examples for Next.js, TanStack Start, SolidStart, Waku, and React Router |
| Runtime model | `@palamedes/runtime` with `getI18n()` |
| Catalog model | Source-string-first, `.po`, `message + context` identity |
| Native core | Rust + `napi-rs` |
| Catalog semantics | Delegated to `ferrocat` |
| Node requirement | `>=22` |
| Not yet productized | Top-level `palamedes` install, `create-palamedes` scaffold |

## What Counts As Proof In This Repo

- first-party multi-framework example matrix with cookie and route locale strategies
- a native core with typed bindings and a documented architecture
- source-string-first catalog semantics backed by `ferrocat`
- reproducible local benchmark commands
- versioned browser screenshots generated from the same CI browser flows

Together, these assets make the cross-framework story visible instead of
leaving it as a slogan.

## Benchmark Scope

The benchmark flow here focuses on the hot paths Palamedes claims to improve:

- transform
- extract
- catalog update
- catalog artifact compile

It uses a checked-in fixture corpus under
[`benchmarks/proof-fixtures`](/Users/sebastian/Workspace/business/palamedes/benchmarks/proof-fixtures),
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

For the separate Lingui v6 preview comparison harness:

```bash
pnpm benchmark:lingui-v6
```

Quick sample:

```bash
pnpm benchmark:lingui-v6:quick
```

See the full methodology here:

- [Benchmarking against Lingui v6 Preview](https://github.com/sebastian-software/palamedes/blob/main/docs/benchmark-lingui-v6-preview.md)

For the broader architectural picture, including `next-intl` and General Translation, see:

- [Comparing modern i18n approaches](https://github.com/sebastian-software/palamedes/blob/main/docs/approach-comparison.md)

That separate harness measures Lingui macro rewrite through distinct Babel and
SWC lanes instead of folding them into one number.

## Methodology

- machine-local benchmark
- same checked-in fixture corpus every run
- warmup runs before measurement
- median reported for each operation
- operations measured independently, not as a blended total

This is meant to be reproducible and honest, not a “best possible marketing
number.”

That distinction matters. The performance story in Palamedes is not just
"native is faster." It is that a cleaner architecture can keep more of the hot
path in one place, with less duplicated semantic work across layers.

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

## Local Baseline

Current checked local sample, captured on March 18, 2026 with:

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

The benchmark script also prints the raw sample series so the checked median is
easy to verify.

## What This Page Does Not Claim

- It does not claim universal results across every machine or every codebase.
- It does not claim that Palamedes already covers every possible Lingui compatibility path.
- It does not treat “written in Rust” as proof by itself.

The goal is simpler:

show the work, show the architecture, and make local verification easy.

## Related Proof Assets

- [First working translation in 5 minutes](https://github.com/sebastian-software/palamedes/blob/main/docs/first-working-translation.md)
- [Examples](https://github.com/sebastian-software/palamedes/blob/main/examples/README.md)
- [Example screenshots](https://github.com/sebastian-software/palamedes/blob/main/docs/example-screenshots/README.md)
- [Framework example notes](https://github.com/sebastian-software/palamedes/blob/main/docs/framework-example-notes.md)
- [Palamedes principles](https://github.com/sebastian-software/palamedes/blob/main/docs/principles.md)
- [Benchmarking against Lingui v6 Preview](https://github.com/sebastian-software/palamedes/blob/main/docs/benchmark-lingui-v6-preview.md)
