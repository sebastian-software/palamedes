# Palamedes

[![CI](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml)
[![Node >=22](https://img.shields.io/badge/node-%3E%3D22-0f172a.svg?logo=node.js)](https://github.com/sebastian-software/palamedes/blob/main/package.json)
[![Sponsored by Sebastian Software](https://img.shields.io/badge/Sponsored%20by-Sebastian%20Software-0f172a.svg)](https://oss.sebastian-software.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f172a.svg)](https://github.com/sebastian-software/palamedes/blob/main/LICENSE)

Palamedes is i18n tooling for modern JavaScript and TypeScript apps with Lingui-style authoring and a cleaner, stricter architecture underneath.

It combines a native Rust core, OXC-powered transforms, and thin framework adapters into a stack built for fast hot paths, clear semantic ownership, and less historical baggage.

## Why Teams Pick Palamedes

- Faster dev and build loops without dragging Babel back into the stack
- A cleaner migration target than Lingui's older, broader API surface
- Fewer moving parts in the hot path: one runtime model, one message identity model, thin adapters

## Current Status

- Recommended for new projects and teams already doing architecture cleanup
- Supported today through verified examples for Next.js, TanStack Start, Waku, and React Router on Node.js `>=22`
- Source-string-first catalogs are stable and powered by `ferrocat`
- Placeholder top-level packages exist, but there is no `palamedes` or `create-palamedes` first-run entry yet

## Start Here

- [First working translation in 5 minutes](https://github.com/sebastian-software/palamedes/blob/main/docs/first-working-translation.md)
- [`@palamedes/vite-plugin`](https://www.npmjs.com/package/@palamedes/vite-plugin) for Vite projects
- [`@palamedes/next-plugin`](https://www.npmjs.com/package/@palamedes/next-plugin) for Next.js projects
- [`@palamedes/cli`](https://www.npmjs.com/package/@palamedes/cli) for extraction workflows and CI

There is no top-level `palamedes` install path yet. If you are trying Palamedes today, start with the scoped packages above.

## Recommended Packages

| Package | Role | Typical audience |
| --- | --- | --- |
| [`@palamedes/vite-plugin`](https://www.npmjs.com/package/@palamedes/vite-plugin) | Recommended Vite entry point | App teams |
| [`@palamedes/next-plugin`](https://www.npmjs.com/package/@palamedes/next-plugin) | Recommended Next.js entry point | App teams |
| [`@palamedes/cli`](https://www.npmjs.com/package/@palamedes/cli) | Extraction CLI | App teams, CI |
| [`@palamedes/core`](https://www.npmjs.com/package/@palamedes/core) | App-facing i18n instance | App teams |
| [`@palamedes/react`](https://www.npmjs.com/package/@palamedes/react) | React translation components | React app teams |
| [`@palamedes/runtime`](https://www.npmjs.com/package/@palamedes/runtime) | Runtime bridge for transformed code | App teams |

## Quick Start With Vite

```bash
pnpm add @palamedes/core @palamedes/react @palamedes/runtime @palamedes/vite-plugin
pnpm add -D @palamedes/cli @palamedes/config
```

```ts
// vite.config.ts
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { palamedes } from "@palamedes/vite-plugin"

export default defineConfig({
  plugins: [palamedes(), react()],
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

For the full copy-paste path, including `.po` loading and the first translated component, use the [5-minute quickstart](https://github.com/sebastian-software/palamedes/blob/main/docs/first-working-translation.md).

## Why The Architecture Matters

Palamedes is opinionated in a few places on purpose:

- `message + context` is the semantic identity
- `getI18n()` is the public runtime model
- catalog semantics live in `ferrocat`, not in duplicate PO glue
- host adapters render modules, while the core stays host-neutral

That is the real promise behind the performance claims: less duplicated logic, clearer ownership, and a toolchain that is easier to trust over time.

## Proof And Adoption Docs

- [Proof, benchmarks, and current maturity](https://github.com/sebastian-software/palamedes/blob/main/docs/proof-and-benchmarks.md)
- [Demo deployment model for the example matrix](https://github.com/sebastian-software/palamedes/blob/main/docs/demo-deployments.md)
- [Benchmarking against Lingui v6 Preview](https://github.com/sebastian-software/palamedes/blob/main/docs/benchmark-lingui-v6-preview.md)
- [Approach comparison across Lingui, next-intl, and GT](https://github.com/sebastian-software/palamedes/blob/main/docs/approach-comparison.md)
- [Palamedes principles](https://github.com/sebastian-software/palamedes/blob/main/docs/principles.md)
- [Comparison with Lingui](https://github.com/sebastian-software/palamedes/blob/main/docs/comparison-with-lingui.md)
- [Migration playbook from Lingui](https://github.com/sebastian-software/palamedes/blob/main/docs/migrate-from-lingui.md)
- [Examples](https://github.com/sebastian-software/palamedes/blob/main/examples/README.md)

## Advanced Packages

These are useful when you are building custom tooling rather than adopting Palamedes as an app team:

- [`@palamedes/transform`](https://www.npmjs.com/package/@palamedes/transform)
- [`@palamedes/extractor`](https://www.npmjs.com/package/@palamedes/extractor)
- [`@palamedes/core-node`](https://www.npmjs.com/package/@palamedes/core-node)

Internal native packages exist behind `@palamedes/core-node`, but they are implementation detail and not part of the normal install story.

## Reserved Package Names

- [`palamedes`](https://www.npmjs.com/package/palamedes)
- [`create-palamedes`](https://www.npmjs.com/package/create-palamedes)

These names are reserved for future top-level entry points. They are not the recommended starting point today.

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
