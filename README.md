# Palamedes

[![CI](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml)
[![Node >=22](https://img.shields.io/badge/node-%3E%3D22-0f172a.svg?logo=node.js)](https://github.com/sebastian-software/palamedes/blob/main/package.json)
[![Sponsored by Sebastian Software](https://img.shields.io/badge/Sponsored%20by-Sebastian%20Software-0f172a.svg)](https://oss.sebastian-software.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f172a.svg)](https://github.com/sebastian-software/palamedes/blob/main/LICENSE)

Palamedes is a modern i18n stack for JavaScript and TypeScript apps that stays
consistent across frameworks.

It keeps one runtime model, one message identity model, and thin framework
adapters across verified integrations for Next.js, TanStack Start, SolidStart,
Waku, and React Router.

That is the real differentiator: Palamedes does not just try to feel cleaner in
one framework. It tries to keep the i18n model architecturally coherent as the
host framework changes.

Underneath that public model is a native Rust core, OXC-powered transforms, and
deliberately thin adapters built for fast hot paths, clear semantic ownership,
and less historical baggage.

It is also the intended local substrate for higher-order translation workflows.
Palamedes+ can add authenticated remote translation and managed quality controls
on top, while Palamedes keeps the local catalog, context, and QA semantics
reusable and open.

## Why Palamedes Is Unusual

Most i18n tools force one of three tradeoffs:

- framework-native convenience with a narrow portability story
- broader compatibility with more historical surface area
- runtime-first dictionary workflows that change the authoring model

Palamedes takes a different position:

- one authoring feel close to Lingui-style macros
- one public runtime model through `getI18n()`
- one message identity model through `message + context`
- one architecture with a native core and thin adapters
- one verified proof surface across five framework families

## Why Teams Pick Palamedes

- Cross-framework consistency without relearning i18n every time the framework changes
- Faster transform, extraction, and catalog hot paths without dragging Babel back into the stack
- A cleaner migration target than Lingui's broader historical API surface
- A host-neutral local substrate for future translation workflows

## Current Status

- Recommended for new projects and teams already doing architecture cleanup
- Verified today across Next.js, TanStack Start, SolidStart, Waku, and React Router on Node.js `>=22`
- Source-string-first catalogs are stable and powered by `ferrocat`
- Placeholder top-level packages exist, but there is no `palamedes` or `create-palamedes` first-run entry yet

## What Exists Today As Proof

- A browser-verified example matrix across five framework families
- Versioned screenshots generated from the same Playwright-based verifier used in CI
- Reproducible benchmark commands for transform, extract, catalog update, and compile hot paths
- ADRs and architecture docs that make the ownership model explicit

## Start Here

- [First working translation in 5 minutes](https://github.com/sebastian-software/palamedes/blob/main/docs/first-working-translation.md)
- [Backend servers with Hono, Express, and request-local i18n](https://github.com/sebastian-software/palamedes/blob/main/docs/backend-servers.md)
- [`@palamedes/vite-plugin`](https://www.npmjs.com/package/@palamedes/vite-plugin) for Vite projects
- [`@palamedes/next-plugin`](https://www.npmjs.com/package/@palamedes/next-plugin) for Next.js projects
- [`@palamedes/cli`](https://www.npmjs.com/package/@palamedes/cli) for extraction workflows and CI

There is no top-level `palamedes` install path yet. If you are trying
Palamedes today, start with the scoped packages above.

## Recommended Packages

| Package | Role | Typical audience |
| --- | --- | --- |
| [`@palamedes/vite-plugin`](https://www.npmjs.com/package/@palamedes/vite-plugin) | Recommended Vite entry point | App teams |
| [`@palamedes/next-plugin`](https://www.npmjs.com/package/@palamedes/next-plugin) | Recommended Next.js entry point | App teams |
| [`@palamedes/cli`](https://www.npmjs.com/package/@palamedes/cli) | Extraction CLI | App teams, CI |
| [`@palamedes/core`](https://www.npmjs.com/package/@palamedes/core) | App-facing i18n instance | App teams |
| [`@palamedes/react`](https://www.npmjs.com/package/@palamedes/react) | React translation components | React app teams |
| [`@palamedes/solid`](https://www.npmjs.com/package/@palamedes/solid) | Solid translation components | Solid app teams |
| [`@palamedes/runtime`](https://www.npmjs.com/package/@palamedes/runtime) | Runtime bridge for transformed code | App teams |

## Quick Start With Vite

Palamedes keeps the Vite-side integration stable across React and Solid.

Base install:

```bash
pnpm add @palamedes/core @palamedes/runtime @palamedes/vite-plugin
pnpm add -D @palamedes/cli @palamedes/config
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

```ts
// palamedes.config.ts
import { defineConfig } from "@palamedes/config"

export default defineConfig({
  locales: ["en", "de"],
  sourceLocale: "en",
  catalogs: [
    {
      path: "src/locales/{locale}",
      include: ["src"],
    },
  ],
})
```

```ts
// src/i18n.ts
import { createI18n } from "@palamedes/core"
import { setClientI18n } from "@palamedes/runtime"

const i18n = createI18n()
setClientI18n(i18n)
```

```bash
pnpm exec pmds extract
```

For the full copy-paste path, including `.po` loading and the first translated
component, use the [5-minute quickstart](https://github.com/sebastian-software/palamedes/blob/main/docs/first-working-translation.md).
That walkthrough uses React for the shortest path, but the same Vite plugin,
runtime model, and catalog flow now also back Solid.

## The Core Architecture Claim

The point is not only that Palamedes is fast. The point is that the i18n hot
path is owned more coherently.

Palamedes is opinionated in a few places on purpose:

- `message + context` is the semantic identity
- `getI18n()` is the public runtime model
- catalog semantics live in `ferrocat`, not in duplicate PO glue
- host adapters render modules, while the core stays host-neutral

That gives teams something stronger than a benchmark number:

- less duplicated logic
- clearer adapter boundaries
- less runtime API sprawl
- a toolchain that is easier to trust over time

The same ownership model also matters for future translation workflows:

- Palamedes owns local, host-neutral translation workflow primitives
- higher-order products can own remote execution, account controls, and premium policies
- the repo keeps its catalogs either way

## Proof And Adoption Docs

- [MDX-ready messaging source for homepage/docs](https://github.com/sebastian-software/palamedes/blob/main/docs/site/index.mdx)
- [Proof, benchmarks, and current maturity](https://github.com/sebastian-software/palamedes/blob/main/docs/proof-and-benchmarks.md)
- [Example matrix and local/CI verification story](https://github.com/sebastian-software/palamedes/blob/main/examples/README.md)
- [Versioned example screenshots](https://github.com/sebastian-software/palamedes/blob/main/docs/example-screenshots/README.md)
- [Optional demo deployment note](https://github.com/sebastian-software/palamedes/blob/main/docs/demo-deployments.md)
- [Benchmarking against Lingui v6 Preview](https://github.com/sebastian-software/palamedes/blob/main/docs/benchmark-lingui-v6-preview.md)
- [Approach comparison across Lingui, next-intl, and GT](https://github.com/sebastian-software/palamedes/blob/main/docs/approach-comparison.md)
- [Palamedes principles](https://github.com/sebastian-software/palamedes/blob/main/docs/principles.md)
- [Translation workflow surface](https://github.com/sebastian-software/palamedes/blob/main/docs/translation-workflow-surface.md)
- [Translation module boundaries](https://github.com/sebastian-software/palamedes/blob/main/docs/translation-module-boundaries.md)
- [Backend servers with request-local runtime wiring](https://github.com/sebastian-software/palamedes/blob/main/docs/backend-servers.md)
- [ADR-012: Translation augmentation boundary](https://github.com/sebastian-software/palamedes/blob/main/adr/012-translation-augmentation-boundary.md)
- [Comparison with Lingui](https://github.com/sebastian-software/palamedes/blob/main/docs/comparison-with-lingui.md)
- [Migration playbook from Lingui](https://github.com/sebastian-software/palamedes/blob/main/docs/migrate-from-lingui.md)
- [Examples](https://github.com/sebastian-software/palamedes/blob/main/examples/README.md)
- [Internal storyline for a later deck](https://github.com/sebastian-software/palamedes/blob/main/docs/site/internal-storyline.md)

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
