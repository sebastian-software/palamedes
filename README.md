# Palamedes

[![CI](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml)
[![Node >=22.22](https://img.shields.io/badge/node-%3E%3D22.22-0f172a.svg?logo=node.js)](https://github.com/sebastian-software/palamedes/blob/main/package.json)
[![Sponsored by Sebastian Software](https://img.shields.io/badge/Sponsored%20by-Sebastian%20Software-0f172a.svg)](https://oss.sebastian-software.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f172a.svg)](https://github.com/sebastian-software/palamedes/blob/main/LICENSE)

**Website: [palamedes.dev](https://palamedes.dev)**

Palamedes is open-source i18n tooling for TypeScript applications. It combines
macro-style authoring close to the code, repository-owned source-string-first
catalogs, a native toolchain for transformation, extraction, validation,
merging, and compilation, one runtime model, and first-party integrations for
supported hosts.

The same core and authoring model work across Next.js, TanStack Start,
SolidStart, Waku, React Router, Vite, and backend servers; server-first Remix v3
is smoke-verified. The framework matrix is evidence that the architecture stays
coherent across different app shapes; using Palamedes does not assume that one
product uses all of them.

We are not asking you to trust a slogan. The repo shows the work.

![The same booking rendered in English, German, and Spanish across the verified framework matrix](docs/assets/palamedes-localized-matrix.png)

The current proof:

- Six framework families, each with cookie, route, subdomain, and tld locale
  strategies: five are browser-verified through the same Playwright-based flow
  used in CI, and server-first Remix v3 is smoke-verified.
- The image above is one demo in three locales: switch language and the copy,
  plural seat counts, currency, and dates all change together. Each verified
  framework and strategy renders the same design, so per-framework captures live in
  [docs/example-screenshots](docs/example-screenshots) instead of repeating the
  same picture here. All of it is versioned browser output, not a mockup.
- A numbered [ADR series](https://palamedes.dev/decisions) explains the
  runtime model, message identity, native boundary, adapter architecture, and
  the work deliberately kept out of scope.
- Benchmark commands, fixtures, and machine-readable reports are checked in so
  the numbers can be rerun locally. The current medians, comparison numbers,
  and recorded tool versions live in one place: the
  [end-to-end workflow benchmark](https://github.com/sebastian-software/palamedes/blob/main/docs/benchmark-e2e-workflow.md)
  and its checked report
  [`benchmarks/e2e-workflow/results/latest.md`](https://github.com/sebastian-software/palamedes/blob/main/benchmarks/e2e-workflow/results/latest.md).

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
- Verified today across Next.js, TanStack Start, SolidStart, Waku, and React
  Router on Node.js `>=22.22`; server-first Remix v3 is smoke-verified and
  requires Node.js `>=24.3`
- Source-string-first catalogs are stable and powered by `ferrocat`, including structured audits and ICU authoring diagnostics
- Placeholder top-level packages exist, but there is no `palamedes` or `create-palamedes` first-run entry yet
- 1.0 stability tiers and public API expectations are documented in [Stability and versioning](https://github.com/sebastian-software/palamedes/blob/main/docs/stability.md)

## What Exists Today

- An example matrix across six framework families — five browser-verified,
  Remix v3 smoke-verified
- Versioned screenshots generated from the same Playwright-based verifier used in CI
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

## Start Here

- [First working translation in 5 minutes](https://github.com/sebastian-software/palamedes/blob/main/docs/first-working-translation.md)
- [API reference](https://github.com/sebastian-software/palamedes/blob/main/docs/api/README.md)
- [Configuration reference](https://github.com/sebastian-software/palamedes/blob/main/docs/configuration.md)
- [CLI reference](https://github.com/sebastian-software/palamedes/blob/main/docs/cli.md)
- [Backend servers with Hono, Express, and request-local i18n](https://github.com/sebastian-software/palamedes/blob/main/docs/backend-servers.md)
- [Troubleshooting common setup failures](https://github.com/sebastian-software/palamedes/blob/main/docs/troubleshooting.md)
- [`llms.txt`](https://github.com/sebastian-software/palamedes/blob/main/llms.txt) and [`llms-full.txt`](https://github.com/sebastian-software/palamedes/blob/main/llms-full.txt) for AI coding assistants
- [`@palamedes/vite-plugin`](https://www.npmjs.com/package/@palamedes/vite-plugin) for Vite projects
- [`@palamedes/next-plugin`](https://www.npmjs.com/package/@palamedes/next-plugin) for Next.js projects
- [`@palamedes/cli`](https://www.npmjs.com/package/@palamedes/cli) for extraction workflows and CI

There is no top-level `palamedes` install path yet. If you are trying
Palamedes today, start with the scoped packages above.

## Recommended Packages

| Package                                                                          | Role                                | Typical audience |
| -------------------------------------------------------------------------------- | ----------------------------------- | ---------------- |
| [`@palamedes/vite-plugin`](https://www.npmjs.com/package/@palamedes/vite-plugin) | Recommended Vite entry point        | App teams        |
| [`@palamedes/next-plugin`](https://www.npmjs.com/package/@palamedes/next-plugin) | Recommended Next.js entry point     | App teams        |
| [`@palamedes/cli`](https://www.npmjs.com/package/@palamedes/cli)                 | Extraction CLI                      | App teams, CI    |
| [`@palamedes/core`](https://www.npmjs.com/package/@palamedes/core)               | App-facing i18n instance            | App teams        |
| [`@palamedes/react`](https://www.npmjs.com/package/@palamedes/react)             | React translation components        | React app teams  |
| [`@palamedes/solid`](https://www.npmjs.com/package/@palamedes/solid)             | Solid translation components        | Solid app teams  |
| [`@palamedes/runtime`](https://www.npmjs.com/package/@palamedes/runtime)         | Runtime bridge for transformed code | App teams        |

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
  plugins: [palamedes(), solid()],
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
import { createI18n } from "@palamedes/core"
import { setClientI18n } from "@palamedes/runtime"

const i18n = createI18n()
setClientI18n(i18n)
```

```ts
// src/po.d.ts
declare module "*.po" {
  import type { CatalogMessages } from "@palamedes/core"

  export const messages: CatalogMessages
}
```

```bash
pnpm exec pmds extract
```

For semantic catalog conflict handling, Palamedes can also act as a Git merge
driver:

```bash
git config merge.palamedes-catalog.driver \
  'pmds catalog merge --format=po --conflict-strategy=use-first --output %A %A %B'
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

Internal native packages exist behind `@palamedes/core-node`, but they are
implementation detail and not part of the normal install story.

## Reserved Package Names

- [`palamedes`](https://www.npmjs.com/package/palamedes)
- [`create-palamedes`](https://www.npmjs.com/package/create-palamedes)

These names are reserved for future top-level entry points. They are not the
recommended starting point today.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm check-types
```

## License

[![Sebastian Software](https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg)](https://oss.sebastian-software.com/)

MIT © 2026 Sebastian Software
