# Benchmarking Against Lingui v6 Preview

This repo now includes a separate head-to-head benchmark harness for Palamedes vs. Lingui `6.0.0-next.1`.

It is intentionally separate from the small Palamedes-only proof benchmark:

- the Lingui comparison has its own isolated workspace package
- Lingui preview versions are pinned exactly
- the measurement scope is narrower and more explicitly normalized

## Versions

As of March 18, 2026, the benchmark workspace pins:

- `@lingui/cli@6.0.0-next.1`
- `@lingui/babel-plugin-lingui-macro@6.0.0-next.1`
- `@lingui/swc-plugin@6.0.0-next.1`
- `@lingui/format-po@6.0.0-next.1`

Those pins live in [`benchmarks/lingui-v6/package.json`](https://github.com/sebastian-software/palamedes/blob/main/benchmarks/lingui-v6/package.json).

## Commands

Build the public Palamedes packages first and run the full harness:

```bash
pnpm benchmark:lingui-v6
```

For a smaller machine-local sample:

```bash
pnpm benchmark:lingui-v6:quick
```

For validation only, without timing output:

```bash
pnpm --filter @palamedes/benchmark-lingui-v6 validate
```

Generated outputs are written to:

- `benchmarks/lingui-v6/results/latest.json`
- `benchmarks/lingui-v6/results/latest.md`

Timestamped snapshots are written alongside those files on every run.

Validate-only runs still write timestamped outputs, but they do not replace the latest full benchmark result.

## What The Harness Measures

Tracks:

- macro transform via Babel
- macro transform via SWC
- extract
- compile-from-catalog

For the two macro tracks, Palamedes intentionally reports the same single native transform baseline against both Lingui lanes. Palamedes does not have separate Babel and SWC implementations, so duplicating the comparison rows is a reporting choice, not a claim that Palamedes ran two different transform engines.

Profiles:

- `small`: 100 files / 1,000 messages
- `medium`: 400 files / 4,000 messages
- `large`: 1,200 files / 12,000 messages

Defaults:

- warmup: `5`
- measured runs: `15`
- reported metric: median milliseconds

Build-system integration, watch mode, and Palamedes-specific catalog update are intentionally out of scope.

## Corpus And Validation

The benchmark uses a deterministic synthetic corpus with fixed seed `20260318`.

The generator writes:

- synthetic source files under a temp workspace root
- canonical `en.po` and `de.po` catalogs
- stable message distributions across every run

Before any timing run, the harness validates:

- transform: Palamedes, Lingui Babel, and Lingui SWC process every file without errors
- extract: normalized `message + context` keys match the generated manifest
- compile: both toolchains compile the same `de.po` catalog without errors and with the expected message count

There are also smoke checks against checked-in repo sources:

- transform parity for Palamedes, Lingui Babel, and Lingui SWC on the checked-in benchmark proof fixtures
- extract sanity on the same example source files
- compile sanity on `packages/cli/src/commands/fixtures/ferrocat-first-test`

The compile smoke uses that clean fixture on purpose. The checked example catalogs are useful product examples, but they are not the stable compile baseline for this harness.

## Shared Syntax Boundary

The synthetic corpus currently exercises the subset that both toolchains compare cleanly in practice:

- `t`
- `msg`
- `defineMessage`
- `plural`
- `select`
- `selectOrdinal`
- `<Trans>`
- `<Plural>`
- `<SelectOrdinal>`

Excluded on purpose:

- explicit IDs
- ignore comments
- runtime calls such as `i18n._(...)`
- watch or bundler integration

One noteworthy boundary discovered during implementation:

- JSX `<Select>` with custom option props is not currently normalized the same way by Palamedes and Lingui v6 preview
- Lingui extracts `_draft` as `draft`, while Palamedes currently treats it like an exact `=draft` branch
- that shape is therefore excluded from the fair comparison corpus for now

The JS `select(...)` form remains covered.

## Reading The Outputs

The JSON output contains:

- environment and version metadata
- per-profile corpus summaries
- validation summaries
- per-tool timing samples
- cross-tool comparisons with computed speedup factors

The Markdown output is a concise machine-local summary for quick review.

Neither output should be treated as a universal cross-machine claim. This harness is meant to be reproducible and transparent, not to pretend that one laptop run is a law of nature.

The transform naming here is deliberate: this track measures compile-time source rewrite for macro-style authoring, not generic runtime translation calls.
