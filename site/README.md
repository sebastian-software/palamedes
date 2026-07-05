# @palamedes/site

The public Palamedes website, live at <https://palamedes.dev> — React Router 8 (framework mode) with ARDO route generation, full
prerendering, Tailwind v4, and the Swiss-spec-grid design system from
[`docs/site/structure/`](../docs/site/structure/README.md). Private
workspace, never published to npm.

## Commands

From the repo root:

```bash
pnpm dev:site     # dev server on http://localhost:4100
pnpm build:site   # ARDO prebuild + static build into site/build/client
```

Inside `site/`:

```bash
pnpm preview      # serve the built output on http://localhost:4101
pnpm typecheck    # react-router typegen + tsc
```

`site/scripts/prebuild-content.mjs` runs before dev, build, and typecheck. It
keeps `docs/`, `adr/`, and `docs/site/posts/` as the canonical sources while
generating ARDO routes under `app/routes/docs`, `app/routes/decisions`, and
`app/routes/blog`. It also generates the `/api-reference` section with TypeDoc
from the package sources. Those generated route files and copied doc assets are
ignored; rerun the prebuild script instead of editing them.

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

## AI assistant context (llms.txt)

The repo-root `llms.txt` and `llms-full.txt` are copied into the build by
`scripts/copy-llms-to-site.mjs` (part of `pnpm build:site`) and serve at
`https://palamedes.dev/llms.txt` per the llms.txt convention. Edit the
root files, not the build output. The copy step rewrites hosted `docs/` and
`adr/` references to their canonical site routes.

## Deployment

Deployed to GitHub Pages by
[`.github/workflows/deploy-site.yml`](../.github/workflows/deploy-site.yml)
on pushes to `main` that touch `site/**`, the lockfile, or the benchmark
reports, docs, ADRs, or package sources that feed TypeDoc (plus manual
`workflow_dispatch`). The canonical domain
`palamedes.dev` is configured in the repository's Pages settings; the
workflow ships `__spa-fallback.html` as `404.html` so unknown paths render
client-side while sitemap routes serve prerendered HTML.
