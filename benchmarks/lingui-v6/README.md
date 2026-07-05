# Lingui v6 Benchmark

This workspace package contains the synthetic head-to-head benchmark harness for Palamedes vs. Lingui v6.

It measures Lingui's macro rewrite through separate Babel and SWC lanes, plus extract and compile-from-catalog.

Run it from the repo root:

```bash
pnpm benchmark:lingui-v6
pnpm benchmark:lingui-v6:quick
pnpm --filter @palamedes/benchmark-lingui-v6 validate
```

Outputs are written to `benchmarks/lingui-v6/results/`.

Methodology and scope live in [`docs/benchmark-lingui-v6-preview.md`](https://github.com/sebastian-software/palamedes/blob/main/docs/benchmark-lingui-v6-preview.md).
