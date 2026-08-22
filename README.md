# Palamedes

[![CI](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml)
[![Node >=22.22](https://img.shields.io/badge/node-%3E%3D22.22-0f172a.svg?logo=node.js)](https://github.com/sebastian-software/palamedes/blob/main/package.json)
[![Sponsored by Sebastian Software](https://img.shields.io/badge/Sponsored%20by-Sebastian%20Software-0f172a.svg)](https://oss.sebastian-software.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f172a.svg)](https://github.com/sebastian-software/palamedes/blob/main/LICENSE)
[![palamedes version](https://img.shields.io/npm/v/palamedes?label=palamedes)](https://www.npmjs.com/package/palamedes)
[![palamedes downloads](https://img.shields.io/npm/dm/palamedes?label=downloads)](https://www.npmjs.com/package/palamedes)
[![@palamedes/cli version](https://img.shields.io/npm/v/%40palamedes%2Fcli?label=pmds)](https://www.npmjs.com/package/@palamedes/cli)
[![create-palamedes version](https://img.shields.io/npm/v/create-palamedes?label=create-palamedes)](https://www.npmjs.com/package/create-palamedes)

**Website: [palamedes.dev](https://palamedes.dev)**

| Integration      | Version                                                                                                                                   | Monthly downloads                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js          | [![npm version](https://img.shields.io/npm/v/%40palamedes%2Fnext-plugin)](https://www.npmjs.com/package/@palamedes/next-plugin)           | [![npm downloads](https://img.shields.io/npm/dm/%40palamedes%2Fnext-plugin)](https://www.npmjs.com/package/@palamedes/next-plugin)           |
| Vite             | [![npm version](https://img.shields.io/npm/v/%40palamedes%2Fvite-plugin)](https://www.npmjs.com/package/@palamedes/vite-plugin)           | [![npm downloads](https://img.shields.io/npm/dm/%40palamedes%2Fvite-plugin)](https://www.npmjs.com/package/@palamedes/vite-plugin)           |
| Remix v3         | [![npm version](https://img.shields.io/npm/v/%40palamedes%2Fremix)](https://www.npmjs.com/package/@palamedes/remix)                       | [![npm downloads](https://img.shields.io/npm/dm/%40palamedes%2Fremix)](https://www.npmjs.com/package/@palamedes/remix)                       |
| React Router RSC | [![npm version](https://img.shields.io/npm/v/%40palamedes%2Freact-router-rsc)](https://www.npmjs.com/package/@palamedes/react-router-rsc) | [![npm downloads](https://img.shields.io/npm/dm/%40palamedes%2Freact-router-rsc)](https://www.npmjs.com/package/@palamedes/react-router-rsc) |
| TanStack Start   | [![npm version](https://img.shields.io/npm/v/%40palamedes%2Ftanstack)](https://www.npmjs.com/package/@palamedes/tanstack)                 | [![npm downloads](https://img.shields.io/npm/dm/%40palamedes%2Ftanstack)](https://www.npmjs.com/package/@palamedes/tanstack)                 |
| SolidStart       | [![npm version](https://img.shields.io/npm/v/%40palamedes%2Fsolid)](https://www.npmjs.com/package/@palamedes/solid)                       | [![npm downloads](https://img.shields.io/npm/dm/%40palamedes%2Fsolid)](https://www.npmjs.com/package/@palamedes/solid)                       |
| Waku             | [![npm version](https://img.shields.io/npm/v/%40palamedes%2Fwaku)](https://www.npmjs.com/package/@palamedes/waku)                         | [![npm downloads](https://img.shields.io/npm/dm/%40palamedes%2Fwaku)](https://www.npmjs.com/package/@palamedes/waku)                         |
| React runtime    | [![npm version](https://img.shields.io/npm/v/%40palamedes%2Freact)](https://www.npmjs.com/package/@palamedes/react)                       | [![npm downloads](https://img.shields.io/npm/dm/%40palamedes%2Freact)](https://www.npmjs.com/package/@palamedes/react)                       |

Palamedes is open-source i18n tooling for TypeScript applications. It combines
macro-style authoring close to the code, repository-owned source-string-first
catalogs, a native toolchain for transformation, extraction, validation,
merging, and compilation, one runtime model, and first-party integrations for
supported hosts.

## Start Here

For the shortest supported path, install the shared Vite packages:

```bash
pnpm add @palamedes/core @palamedes/runtime @palamedes/vite-plugin
pnpm add -D @palamedes/cli
```

Then follow the [5-minute quickstart](docs/first-working-translation.md) to add
React, configure a catalog, and render the first translation. There is no
top-level `palamedes` install path yet; use the scoped packages above.

Already evaluating Palamedes? [Skip to the proof](#proof-you-can-inspect), or
browse the [framework](https://palamedes.dev/frameworks),
[architecture](https://palamedes.dev/architecture), and
[documentation](https://palamedes.dev/docs) paths.

## Proof You Can Inspect

The same core and authoring model work across Next.js, TanStack Start,
SolidStart, Waku, React Router, Vite, and backend servers; server-first Remix v3
is smoke-verified. The framework matrix is evidence that the architecture stays
coherent across different app shapes; using Palamedes does not assume that one
product uses all of them.

We are not asking you to trust a slogan. The repo shows the work.

![The same booking rendered in English, German, and Spanish across the verified framework matrix](docs/assets/palamedes-localized-matrix.png)

The current proof:

- Six framework families, each with cookie, route, subdomain, and tld locale
  strategies, plus Vite MDX: all 25 are smoke-verified on relevant PRs and
  `main`; five UI-adapter families and Vite make 21 browser-capable examples
  for the scheduled Playwright flow, while server-first Remix v3 remains
  smoke-verified.
- The image above is one demo in three locales: switch language and the copy,
  plural seat counts, currency, and dates all change together. The 20
  UI-adapter examples have versioned captures in
  [docs/example-screenshots](docs/example-screenshots) instead of repeating the
  same picture here. Those captures are browser output, not mockups.
- A numbered [ADR series](https://palamedes.dev/decisions) explains the
  runtime model, message identity, native boundary, adapter architecture, and
  the work deliberately kept out of scope.
- Benchmark commands, fixtures, and machine-readable reports are checked in so
  the numbers can be rerun locally. The
  [end-to-end workflow benchmark](https://github.com/sebastian-software/palamedes/blob/main/docs/benchmark-e2e-workflow.md)
  documents the methodology; the dated medians, comparison numbers, and tool
  versions live in the checked
  [`benchmarks/e2e-workflow/results/latest.md`](https://github.com/sebastian-software/palamedes/blob/main/benchmarks/e2e-workflow/results/latest.md)
  snapshot.

**The run you trigger all day.** Cross-tool comparisons have to run cold —
every cache cleared, every tool doing the same work — and that is the lane the
comparison numbers come from. But it is not the run you actually make. You edit
a few files and extract again. On the realistic corpus (1,500 files, 6,000
messages) a cold extract and catalog update takes `73 ms`; touching `5` source
files and re-running takes `47 ms`, because extraction is cached per
file and validated by a `stat` — unchanged files are neither read nor parsed
([ADR-019](https://palamedes.dev/decisions/019-extraction-cache)). In watch
mode that cache is held in memory for the life of the process.

The compared tools have no equivalent local cache: they re-extract in full, so
their warm runs cost what their cold runs cost. That makes this a capability
difference rather than a race, which is exactly why it is kept out of every
speedup number we publish.

**Try it live.** The live reference covers cookie, route, and subdomain demos across the framework matrix (tld domains are still being provisioned). Open [Next.js (cookie)](https://nextjs-cookie.examples.palamedes.dev) and [SolidStart (route)](https://solidstart-route.examples.palamedes.dev), switch language, and watch copy, plural seat counts, currency, and dates change together. The full URL list and hosting notes live in [examples/README](examples/README.md).

Under the hood, a Rust core, OXC-powered transforms, and `ferrocat` catalog
semantics handle the careful work: parsing, extraction, updates, audits,
diagnostics, and runtime artifact compilation. PO remains the default catalog
storage, and teams can opt into FCL when they want canonical, merge-friendly
generated catalogs with cleaner machine-owned metadata.

## Why Teams Pick Palamedes

- One coherent model from authoring through runtime
- Familiar macro-style authoring without carrying older compatibility paths forward
- First-party integrations that keep host-specific wiring out of catalog semantics
- Fast transforms, extraction, catalog updates, audits, and compile steps
- Source-string-first catalogs that translators can inspect and teams can trust
- Semantic PO/FCL catalog merging for Git merge-driver workflows
- A full local toolchain that remains useful on its own, with Palamedes+ planned as an optional managed layer

## What Makes It Feel Better

Most i18n stacks eventually ask teams to choose between convenience, speed, and
clarity.

Palamedes is built around a calmer default:

- write the message where the UI happens
- identify messages by `message + context`
- access the active runtime through `getI18n()`
- keep catalog and ICU semantics in one dedicated engine
- keep framework adapters thin

In daily work, that means a translation workflow that is easier to explain,
easier to review, and easier to carry from one framework to the next.

## Current Status

- Recommended for new projects and teams that want cleaner i18n foundations
- All 25 examples are smoke-verified on relevant PRs and `main`; 21
  browser-capable examples across Next.js, TanStack Start, SolidStart, Waku,
  React Router, and Vite run Playwright weekly or manually. Server-first Remix
  v3 is smoke-only and requires Node.js `>=24.3`
- Source-string-first catalogs are stable and powered by `ferrocat`, including structured audits and ICU authoring diagnostics
- Placeholder top-level packages exist, but there is no `palamedes` or `create-palamedes` first-run entry yet; their bins link to the quickstart and exit non-zero rather than silently succeeding
- 1.0 stability tiers and public API expectations are documented in [Stability and versioning](https://github.com/sebastian-software/palamedes/blob/main/docs/stability.md)

## What Exists Today

- An example matrix across six framework families — five browser-verified,
  Remix v3 smoke-verified
- Versioned screenshots for the 20 UI-adapter examples, generated from the same
  Playwright-based verifier used in CI
- Reproducible benchmark commands for transform, extract, catalog update, compile steps, and end-to-end extract/update workflows
- Structured catalog audit and metadata validation APIs backed by `ferrocat`
- Decision records and architecture docs that explain the choices behind the product
- Public headless frontend primitives in `@palamedes/react` and `@palamedes/solid` that the matrix uses directly

## Who Builds This

Palamedes is maintained by Sebastian Software GmbH. Sebastian Werner's public
profile lists recent frontend internationalization work for Regrello, including
a full Lingui-based application internationalization effort from October 2024
to September 2025. Salesforce later announced the Regrello acquisition and
noted that it completed on October 1, 2025.

That matters because Palamedes is not coming from a generic "i18n is hard"
take. It comes from repeated work on source-string-first i18n: older
gettext-style macro systems, recent enterprise Lingui migrations, and the same
hard questions this repo documents in ADRs.

Evidence:

- [Sebastian Werner profile at Sebastian Software](https://sebastian-software.de/werner)
- [Sebastian Consulting profile](https://sebastian-consulting.de/de/werner)
- [qooxdoo](https://qooxdoo.org/)
- [Salesforce announcement for Regrello](https://www.salesforce.com/news/stories/salesforce-signs-definitive-agreement-to-acquire-regrello/)

## Explore the Docs and Packages

- [First working translation in 5 minutes](https://github.com/sebastian-software/palamedes/blob/main/docs/first-working-translation.md)
- [First working translation with Next.js](https://github.com/sebastian-software/palamedes/blob/main/docs/nextjs-first-run.md)
- [API reference](https://github.com/sebastian-software/palamedes/blob/main/docs/api/README.md)
- [Configuration reference](https://github.com/sebastian-software/palamedes/blob/main/docs/configuration.md)
- [CLI reference](https://github.com/sebastian-software/palamedes/blob/main/docs/cli.md)
- [Platform support](https://github.com/sebastian-software/palamedes/blob/main/docs/platform-support.md)
- **Migrating from Lingui or comparing approaches:** [migration guide](https://github.com/sebastian-software/palamedes/blob/main/docs/migrate-from-lingui.md), [comparison with Lingui](https://github.com/sebastian-software/palamedes/blob/main/docs/comparison-with-lingui.md), [approach comparison](https://github.com/sebastian-software/palamedes/blob/main/docs/approach-comparison.md), [locale strategies](https://github.com/sebastian-software/palamedes/blob/main/docs/locale-strategies.md), and [catalog formats](https://github.com/sebastian-software/palamedes/blob/main/docs/catalog-formats.md)
- [Backend servers with Hono, Express, and request-local i18n](https://github.com/sebastian-software/palamedes/blob/main/docs/backend-servers.md)
- [Troubleshooting common setup failures](https://github.com/sebastian-software/palamedes/blob/main/docs/troubleshooting.md)
- [`llms.txt`](https://github.com/sebastian-software/palamedes/blob/main/llms.txt) and [`llms-full.txt`](https://github.com/sebastian-software/palamedes/blob/main/llms-full.txt) for AI coding assistants
- [`@palamedes/vite-plugin`](https://www.npmjs.com/package/@palamedes/vite-plugin) for Vite projects
- [`@palamedes/next-plugin`](https://www.npmjs.com/package/@palamedes/next-plugin) for Next.js projects
- [`@palamedes/tanstack`](https://www.npmjs.com/package/@palamedes/tanstack) for TanStack Start projects
- [`@palamedes/waku`](https://www.npmjs.com/package/@palamedes/waku) for Preview ESM-only Waku server actions
- [`@palamedes/remix`](https://www.npmjs.com/package/@palamedes/remix) for Preview server-first Remix v3 projects
- [`@palamedes/react-router-rsc`](https://www.npmjs.com/package/@palamedes/react-router-rsc) for Preview React Router RSC request scopes
- [`@palamedes/config`](https://www.npmjs.com/package/@palamedes/config) for JavaScript host configuration
- [`@palamedes/cli`](https://www.npmjs.com/package/@palamedes/cli) for extraction workflows and CI
- [`@palamedes/eslint-plugin`](https://www.npmjs.com/package/@palamedes/eslint-plugin) for preview ESLint/Oxlint editor diagnostics

## Recommended Packages

| Package                                                                                    | Role                                   | Typical audience |
| ------------------------------------------------------------------------------------------ | -------------------------------------- | ---------------- |
| [`@palamedes/vite-plugin`](https://www.npmjs.com/package/@palamedes/vite-plugin)           | Recommended Vite entry point           | App teams        |
| [`@palamedes/next-plugin`](https://www.npmjs.com/package/@palamedes/next-plugin)           | Recommended Next.js entry point        | App teams        |
| [`@palamedes/tanstack`](https://www.npmjs.com/package/@palamedes/tanstack)                 | TanStack Start middleware              | App teams        |
| [`@palamedes/waku`](https://www.npmjs.com/package/@palamedes/waku)                         | Preview ESM-only Waku interceptor      | App teams        |
| [`@palamedes/remix`](https://www.npmjs.com/package/@palamedes/remix)                       | Preview server-first Remix v3 adapter  | App teams        |
| [`@palamedes/react-router-rsc`](https://www.npmjs.com/package/@palamedes/react-router-rsc) | Preview React Router RSC request scope | App teams        |
| [`@palamedes/config`](https://www.npmjs.com/package/@palamedes/config)                     | JavaScript host configuration          | App teams        |
| [`@palamedes/cli`](https://www.npmjs.com/package/@palamedes/cli)                           | Extraction CLI                         | App teams, CI    |
| [`@palamedes/eslint-plugin`](https://www.npmjs.com/package/@palamedes/eslint-plugin)       | Preview lint/editor adapter            | App teams        |
| [`@palamedes/core`](https://www.npmjs.com/package/@palamedes/core)                         | App-facing i18n instance               | App teams        |
| [`@palamedes/react`](https://www.npmjs.com/package/@palamedes/react)                       | React translation components           | React app teams  |
| [`@palamedes/solid`](https://www.npmjs.com/package/@palamedes/solid)                       | Solid translation components           | Solid app teams  |
| [`@palamedes/runtime`](https://www.npmjs.com/package/@palamedes/runtime)                   | Runtime bridge for transformed code    | App teams        |

Both UI packages also expose headless frontend helpers for locale sync and
locale-switch modelling. The example matrix uses those public helpers directly
instead of hiding everything in example-local code.

## Quick Start With Vite

Palamedes keeps the Vite-side integration stable across React and Solid.

Base install:

```bash
pnpm add @palamedes/core @palamedes/runtime @palamedes/vite-plugin
pnpm add -D @palamedes/cli
```

Then add the host-specific package pair:

```bash
pnpm add @palamedes/react react react-dom
pnpm add -D @vitejs/plugin-react
```

or

```bash
pnpm add @palamedes/solid solid-js
pnpm add -D vite-plugin-solid
```

```ts
// vite.config.ts (React)
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { palamedes } from "@palamedes/vite-plugin"

export default defineConfig({
  plugins: [palamedes(), react()],
})
```

```ts
// vite.config.ts (Solid)
import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
import { palamedes } from "@palamedes/vite-plugin"

export default defineConfig({
  plugins: [palamedes(), solid({ extensions: [".mdx"] })],
})
```

```yaml
# palamedes.yaml
locales: [en, de]
source-locale: en
catalogs:
  - path: src/locales/{locale}
    include: [src]
```

```ts
// src/i18n.ts
import { createI18n } from "@palamedes/core/compiled"
import { setClientI18n } from "@palamedes/runtime"

const i18n = createI18n()
setClientI18n(i18n)
```

```ts
// src/po.d.ts
declare module "*.po" {
  import type { CompiledCatalogMessages } from "@palamedes/core/compiled"

  export const messages: CompiledCatalogMessages
}
```

```bash
pnpm exec pmds extract
```

Keep generated PO and FCL catalogs synchronized in CI without rewriting the
workspace:

```bash
pnpm exec pmds extract --check --json
```

`pmds` uses stable exit codes for CI, so a completed policy verdict is distinct
from a command that could not run:

| Code | Meaning                                                            |
| ---- | ------------------------------------------------------------------ |
| `0`  | The command and its configured policy passed.                      |
| `1`  | Configuration, I/O, serialization, or another operational failure. |
| `2`  | Invalid command-line usage.                                        |
| `3`  | `extract --check` found catalog drift.                             |
| `4`  | `lint` completed but its policy or source analysis failed.         |
| `5`  | `audit` completed but its `--fail-on` policy failed.               |
| `6`  | `report` completed but a locale was below `--fail-if-below`.       |

See the [CLI reference](https://github.com/sebastian-software/palamedes/blob/main/docs/cli.md#exit-codes)
for the complete contract.

For semantic catalog conflict handling, Palamedes can also act as a Git merge
driver:

```bash
git config merge.palamedes-catalog.driver \
  'pmds catalog merge-driver %O %A %B %A --path %P --conflict-strategy=use-first'
```

For the full copy-paste path, including `.po` loading and the first translated
component, use the [5-minute quickstart](https://github.com/sebastian-software/palamedes/blob/main/docs/first-working-translation.md).
That walkthrough uses React for the shortest path, but the same Vite plugin,
runtime model, and catalog flow now also back Solid.

## The Technical Foundation

The technical story is there to support the product story: teams should get a
translation stack that feels predictable in daily work.

Palamedes is opinionated in a few places:

- `message + context` is the semantic identity
- `getI18n()` is the public runtime model
- catalog parsing, updates, audits, PO/FCL storage, and ICU QA live in `ferrocat`
- host adapters render modules while the core stays portable

That gives teams more than a benchmark number:

- less duplicated logic
- clearer adapter boundaries
- less runtime API sprawl
- a toolchain that is easier to trust during migrations and reviews

## Palamedes And Palamedes+

Palamedes covers the open-source local workflow for authoring, transformation,
extraction, catalogs, validation, semantic merging, compilation, and runtime
integration. Palamedes+ is planned as an optional managed layer for translation
automation and collaboration.

Palamedes does not require Palamedes+. The local toolchain needs no account,
catalogs remain in the repository, and higher-level products can build on the
same catalog and QA semantics without replacing them.

## Proof And Adoption Docs

Every guide, API reference, and ADR in this repository is published on the
website — that is the recommended way to browse them:

- [palamedes.dev/docs](https://palamedes.dev/docs) — all guides, comparisons, and references
- [palamedes.dev/decisions](https://palamedes.dev/decisions) — the full ADR series
- [palamedes.dev/proof](https://palamedes.dev/proof) — benchmarks and the verification story
- [palamedes.dev/frameworks](https://palamedes.dev/frameworks) — the example matrix with live demos

In the repository itself, start with:

- [Proof, benchmarks, and current maturity](docs/proof-and-benchmarks.md)
- [Example matrix and local/CI verification story](examples/README.md)
- [Decision records index](DECISIONS.md)
- [`llms.txt`](llms.txt) and [`llms-full.txt`](llms-full.txt) for AI coding assistants

## Advanced Packages

These are useful when you are building custom tooling rather than adopting
Palamedes as an app team:

- [`@palamedes/transform`](https://www.npmjs.com/package/@palamedes/transform)
- [`@palamedes/extractor`](https://www.npmjs.com/package/@palamedes/extractor)
- [`@palamedes/core-node`](https://www.npmjs.com/package/@palamedes/core-node)

Internal native packages exist behind `@palamedes/core-node` and
`@palamedes/cli`, but they are implementation detail and not part of the normal
install story.

## Reserved Package Names

- [`palamedes`](https://www.npmjs.com/package/palamedes)
- [`create-palamedes`](https://www.npmjs.com/package/create-palamedes)

These names are reserved for future top-level entry points. They are not the
recommended starting point today: their placeholder bins print the supported
quickstart to stderr and exit non-zero without creating a project or running a
command.

## Development

Want to contribute? Read [CONTRIBUTING.md](./CONTRIBUTING.md) for the repository
layout, local checks, and pull request expectations.

```bash
pnpm install
pnpm build
pnpm test
pnpm check-types
```

## License

[![Sebastian Software](https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg)](https://oss.sebastian-software.com/)

MIT © 2026 Sebastian Software

The MIT license does not cover third-party marks or Streamline visual assets.
See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for their separate terms
and required attribution.
