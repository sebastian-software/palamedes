# @palamedes/site

The public Palamedes website, live at <https://palamedes.dev> — React Router 8
(framework mode) with ARDO route generation, full prerendering, Tailwind v4,
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
pnpm typecheck    # react-router typegen + tsc
```

`site/scripts/prebuild-content.mjs` runs before dev, build, and typecheck. It
keeps `docs/`, `adr/`, and `site/content/blog/` as the canonical sources while
generating ARDO routes under `app/routes/docs`, `app/routes/decisions`, and
`app/routes/blog`. It also generates the `/api-reference` section with TypeDoc
from the package sources. Those generated route files and copied doc assets are
ignored; rerun the prebuild script instead of editing them.

Headless verification of the built output (three passes: default,
reduced-motion, JS disabled), from the repo root:

```bash
node scripts/verify-site-routes.mjs
```

## Theming & chrome (ARDO)

ARDO owns the site chrome: `ArdoRoot` in `app/root.tsx` renders the header and
footer on **every** route (marketing pages included — `layout: "bare"` only
drops the sidebar). Marketing pages therefore must not render their own nav or
footer; the shared `SiteFooter` is passed into ARDO's `footer` slot instead.

The Palamedes look is applied through two sanctioned mechanisms only:

1. **Token bridge** — `app/app.css` maps ARDO's public `--ardo-*` custom
   properties (its complete theming contract) onto the Swiss-spec-grid tokens
   (paper/ink/hairline/accent, radius 0, no shadows). Never target ARDO's
   hashed class names; they change between releases.
2. **Cascade layers** — ARDO's stylesheet ships an unlayered
   `* { margin: 0; padding: 0 }` reset that would override Tailwind's layered
   utilities. `app.css` therefore imports `ardo/ui/styles.css` into the `ardo`
   layer between `base` and `components` (do not re-import it in `root.tsx`).

The site is deliberately light-only (`themeToggle: false`): the design system
has no dark token set yet. To add dark mode later, define a `.dark` mapping for
both the Palamedes tokens and the `--ardo-*` bridge, then re-enable the toggle.

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
reports, docs, ADRs, or package sources that feed TypeDoc (plus manual
`workflow_dispatch`). The canonical domain
`palamedes.dev` is configured in the repository's Pages settings; the
workflow ships `__spa-fallback.html` as `404.html` so unknown paths render
client-side while sitemap routes serve prerendered HTML.
