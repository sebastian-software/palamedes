# @palamedes/site

The public Palamedes website, live at <https://palamedes.dev> — Ardo 6 with static document navigation, full prerendering, Tailwind v4,
and the Palamedes editorial design system (ADR-011). Private workspace, never
published to npm.

## Commands

From the repo root:

```bash
pnpm dev:site     # dev server on http://localhost:4100
pnpm build:site   # ARDO prebuild + static build into site/build/client
```

Inside `site/`:

```bash
pnpm preview      # serve the built output on http://localhost:4101
pnpm typecheck    # content prebuild + tsc
```

`site/scripts/prebuild-content.mjs` runs before dev, build, and typecheck. It
keeps `docs/`, `adr/`, and `site/content/blog/` as the canonical sources while
generating ARDO routes under `app/routes/docs`, `app/routes/decisions`, and
`app/routes/blog`. It also generates the `/api-reference` section with Ardo's native OXC renderer
from the checked declarations produced by the package builds. Each public entry
keeps its own reference and import path. This reuses the repository toolchain
without requiring Ardo's optional TypeScript 7.1 nightly compiler. Those generated route files and copied doc assets are
ignored; rerun the prebuild script instead of editing them.

Headless verification of the built output (three passes: default,
reduced-motion, JS disabled), from the repo root:

```bash
node scripts/verify-site-routes.mjs
```

## Theming & chrome (ARDO)

Ardo owns the header, documentation sidebar, search, and document layout. The
shared `SiteFooter` sits after `ArdoRoot`, with Ardo's own footer disabled, so
it forms one page-level footer landmark outside the main content. Marketing routes use `layout: "bare"` and keep the
explicit header and footer. Documentation uses `scrollMode="document"`.
The header uses Ardo's search dialog at every width so the primary navigation
and full wordmark fit alongside it. The keyboard search shortcut remains available.

`app/ardo-theme.ts` maps Ardo's typed theme tokens to the Palamedes editorial
palette, fonts, square corners, and flat surfaces. Ardo loads its stylesheet
once in the `ardo` cascade layer; `app/app.css` orders that layer before
Tailwind utilities. Do not target Ardo's generated classes.

The site is light-only: `ArdoRootLayout` forces `colorScheme="light"` before
first paint, and the header hides the theme toggle. Add a full dark token set
before enabling a user-selectable color scheme.

Ardo requires imports to stay inside installed packages. pnpm injects
`@palamedes/site-ui` through `file:../packages/site-ui` into the site's
dependency tree instead of linking its
workspace source directory. The prebuild checks the shared UI, and pnpm
synchronizes its installed copy after `build` scripts.

Ardo manages React, React DOM, and Vite. App code uses `ardo/react`,
`ardo/react-dom/*`, and `ArdoLink` from `ardo/runtime`. Links load prerendered
HTML documents; there is no client router or route loader. The build timestamp
comes from Ardo's configuration. JSON-LD is rendered by `StructuredData` in the
page because Ardo's metadata descriptors cover titles, links, and meta tags.

The native Ferromark pipeline supplies Markdown, syntax highlighting, search
excerpts, and heading identities. Progressive outlines use the same native
parser, including duplicate heading IDs. The build checks rendered internal
links and heading anchors with Ferrolink. Curated `llms.txt` files remain owned by the repository;
Ardo's automatic LLM exports are disabled.

## Data honesty guards

Benchmark numbers are hardcoded in `app/data/bench.ts` and checked on every
build by `scripts/verify-site-bench-data.mjs` against
`benchmarks/e2e-workflow/results/latest.md` — a new benchmark report fails
the site build until the constants (and any prose quoting them) are updated
consciously. Matrix demo links live in `app/data/matrix.ts` with explicit
per-cell hosting status (#306).

## Content sources

[`PRODUCT.md`](../PRODUCT.md) owns current messaging and evidence rules.
[ADR-001](../adr/001-project-scope-and-positioning.md) records positioning and
scope; [ADR-011](../adr/011-editorial-visual-brand-system.md) records the visual,
benchmark-presentation, and licensed-asset rules. Asset provenance lives in the
[Streamline manifest](streamline-asset-manifest.md) and
[framework brand ledger](framework-brand-usage.md).

The decision landing page is generated from `DECISIONS.md`, including its
reading groups. The numbered ADR files define sidebar order. After renumbering,
update repository references and `decision-redirects.json`; the prebuild emits
small canonical redirects under the ignored `public/decisions/` directory so
existing public links keep reaching the same topics, including without JavaScript.

Generated API reference URLs follow the same rule. `api-reference-redirects.json`
lists every `/api-reference` route the published site has listed
(`legacyRoutes`) and maps each one the generator no longer emits to its current
page (`redirects`). The prebuild fails when a published route has neither a page
nor a redirect, and writes the redirects under the ignored
`public/api-reference/` directory. Append new routes to `legacyRoutes` when a
release publishes them; do not remove entries.

Every Markdown article under `site/content/blog/` except `README.md` is published
by the site prebuild. Keep that directory for finished articles; a body label
such as "Status: draft" does not prevent publication. Remove completed plans
and discarded design explorations rather than maintaining a parallel archive.

## AI assistant context (llms.txt)

The repo-root `llms.txt` and `llms-full.txt` are copied into the build by
`scripts/copy-llms-to-site.mjs` (part of `pnpm build:site`) and serve at
`https://palamedes.dev/llms.txt` per the llms.txt convention. Edit the
root files, not the build output. The copy step rewrites hosted `docs/` and
`adr/` references to their canonical site routes.

## Deployment

Site-wide Rybbit pageview, interaction, and video tracking is described in
[Website analytics](analytics.md), including activation settings, coverage,
visitor exclusions, and the isolated browser check.

Deployed to GitHub Pages by
[`.github/workflows/deploy-site.yml`](../.github/workflows/deploy-site.yml)
on pushes to `main` that touch `site/**`, the lockfile, or the benchmark
reports, docs, ADRs, or package declarations that feed the API reference (plus manual
`workflow_dispatch`). It also rebuilds after the Publish workflow succeeds for a
release commit, so the npm versions on the framework pages, read at build time,
include the new release. The canonical domain
`palamedes.dev` is configured in the repository's Pages settings. Ardo generates
`404.html` alongside the prerendered routes; unknown paths receive that static
error document.
