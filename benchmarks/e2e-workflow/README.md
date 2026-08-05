# End-to-End Workflow Benchmark

This workspace package benchmarks the full local extraction workflow a team
would run to update catalogs:

- Palamedes: `pmds extract`
- Lingui: `lingui extract`
- React Intl: `formatjs extract`
- i18next-cli: `i18next-cli extract`
- General Translation: `gtx-cli generate`

The harness generates the same logical source inventory for each tool, renders
it into each tool's idiomatic source shape, resets catalogs before every timed
run, then measures scan, extract, and output writes together. Palamedes, Lingui,
i18next-cli, and General Translation update `en` and `de` catalogs. The React
Intl lane uses `@formatjs/cli` to write one aggregated extracted-message JSON
artifact instead; the generated report records that narrower scope explicitly.

The General Translation lane runs `gtx-cli generate`, GT's path for teams
handling their own translations: it extracts and merges catalogs entirely
locally, with no API key and no network access. GT's default workflow
(`gtx-cli translate`) sends content to the GT API and is out of scope here.
Because GT keys catalogs by a content hash it computes itself, the baseline
catalogs for that lane are derived from a real `gtx-cli generate` run rather
than from a reimplementation of its hashing.

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
