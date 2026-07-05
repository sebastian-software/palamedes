# @palamedes/site

The public Palamedes website — React Router 8 (framework mode) with full
prerendering, Tailwind v4, and the Swiss-spec-grid design system from
[`docs/site/structure/`](../docs/site/structure/README.md). Private
workspace, never published to npm.

## Commands

From the repo root:

```bash
pnpm dev:site     # dev server on http://localhost:4100
pnpm build:site   # static build into site/build/client (all 6 routes prerendered)
```

Inside `site/`:

```bash
pnpm preview      # serve the built output on http://localhost:4101
pnpm typecheck    # react-router typegen + tsc
```

Headless verification of the built output (three passes: default,
reduced-motion, JS disabled):

```bash
node scripts/verify-site-routes.mjs
```

## Data honesty guards

Benchmark numbers are hardcoded in `app/data/bench.ts` and checked on every
build by `scripts/verify-site-bench-data.mjs` against
`benchmarks/e2e-workflow/results/latest.md` — a new benchmark report fails
the site build until the constants (and any prose quoting them) are updated
consciously. Matrix demo links live in `app/data/matrix.ts` with explicit
per-cell hosting status (#306).

## Deployment

Deployed to GitHub Pages by
[`.github/workflows/deploy-site.yml`](../.github/workflows/deploy-site.yml)
on pushes to `main` that touch `site/**`, the lockfile, or the benchmark
reports (plus manual `workflow_dispatch`). The canonical domain
`palamedes.dev` is configured in the repository's Pages settings; the
workflow ships `__spa-fallback.html` as `404.html` so unknown paths render
client-side while the six real routes serve their prerendered HTML.
