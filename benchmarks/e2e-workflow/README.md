# End-to-End Workflow Benchmark

This workspace package benchmarks the full local extraction workflow a team
would run to update catalogs:

- Palamedes: `pmds extract`
- Lingui: `lingui extract`
- FormatJS: `formatjs extract`
- i18next-parser: `i18next`
- i18next-cli: `i18next-cli extract`

The harness generates the same logical source inventory for each tool, renders
it into each tool's idiomatic source shape, resets catalogs before every timed
run, then measures scan, extract, and output writes together. Palamedes,
Lingui, i18next-parser, and i18next-cli update `en` and `de` catalogs. FormatJS
writes its standard aggregated extracted-message JSON artifact instead; the
generated report records that narrower scope explicitly.

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
