# Palamedes

[![CI](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml)
[![Node >=22](https://img.shields.io/badge/node-%3E%3D22-0f172a.svg?logo=node.js)](https://github.com/sebastian-software/palamedes/blob/main/package.json)
[![Sponsored by Sebastian Software](https://img.shields.io/badge/Sponsored%20by-Sebastian%20Software-0f172a.svg)](https://oss.sebastian-software.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f172a.svg)](https://github.com/sebastian-software/palamedes/blob/main/LICENSE)

Palamedes is a modern i18n toolchain for Lingui projects that want faster builds, faster extraction, and less Babel-shaped plumbing.

It combines a native core, OXC-powered transforms, and framework adapters for Vite and Next.js into a package family that feels small, focused, and ready for real projects.

## Why Palamedes

- Faster macro transforms without adding Babel back into the stack
- Fast message extraction for large TypeScript and React codebases
- First-party adapters for Vite and Next.js
- A small runtime layer instead of framework lock-in
- Native packaging underneath, but straightforward setup at the package level

## Start Here

If you are adopting Palamedes in an application, start with one of these:

- [`@palamedes/vite-plugin`](https://www.npmjs.com/package/@palamedes/vite-plugin) for Vite projects
- [`@palamedes/next-plugin`](https://www.npmjs.com/package/@palamedes/next-plugin) for Next.js projects
- [`@palamedes/cli`](https://www.npmjs.com/package/@palamedes/cli) for extraction workflows and CI

The lower-level packages are there when you want to build custom integrations, tooling, or runtime wiring yourself.

## Package Guide

| Package | Role | Typical audience |
| --- | --- | --- |
| [`@palamedes/vite-plugin`](https://www.npmjs.com/package/@palamedes/vite-plugin) | Recommended Vite entry point | App teams |
| [`@palamedes/next-plugin`](https://www.npmjs.com/package/@palamedes/next-plugin) | Recommended Next.js entry point | App teams |
| [`@palamedes/cli`](https://www.npmjs.com/package/@palamedes/cli) | Extraction CLI | App teams, CI |
| [`@palamedes/runtime`](https://www.npmjs.com/package/@palamedes/runtime) | Runtime bridge for transformed code | App teams, infra |
| [`@palamedes/transform`](https://www.npmjs.com/package/@palamedes/transform) | Low-level macro transform | Tool builders |
| [`@palamedes/extractor`](https://www.npmjs.com/package/@palamedes/extractor) | Low-level Lingui extractor | Tool builders |
| [`@palamedes/core-node`](https://www.npmjs.com/package/@palamedes/core-node) | Node wrapper around the native core | Tool builders |
| [`@palamedes/core-node-darwin-arm64`](https://www.npmjs.com/package/@palamedes/core-node-darwin-arm64) | Internal native package | Do not install directly |
| [`@palamedes/core-node-linux-x64-gnu`](https://www.npmjs.com/package/@palamedes/core-node-linux-x64-gnu) | Internal native package | Do not install directly |
| [`@palamedes/core-node-linux-arm64-gnu`](https://www.npmjs.com/package/@palamedes/core-node-linux-arm64-gnu) | Internal native package | Do not install directly |
| [`@palamedes/core-node-win32-x64-msvc`](https://www.npmjs.com/package/@palamedes/core-node-win32-x64-msvc) | Internal native package | Do not install directly |
| [`palamedes`](https://www.npmjs.com/package/palamedes) | Reserved top-level package | Placeholder today |
| [`create-palamedes`](https://www.npmjs.com/package/create-palamedes) | Reserved scaffold entry point | Placeholder today |

## Quick Start With Vite

```bash
pnpm add @palamedes/vite-plugin @palamedes/runtime @lingui/core @lingui/react
pnpm add -D @palamedes/cli
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
// src/i18n.ts
import { i18n } from "@lingui/core"
import { setClientI18n } from "@palamedes/runtime"

setClientI18n(i18n)
```

```bash
pnpm exec pmds extract
```

## Quick Start With Next.js

```bash
pnpm add @palamedes/next-plugin @palamedes/runtime @lingui/core @lingui/react
pnpm add -D @palamedes/cli
```

```js
// next.config.js
const { withPalamedes } = require("@palamedes/next-plugin")

module.exports = withPalamedes({})
```

Use `@palamedes/runtime` to expose the active Lingui instance on the client and server before translated code runs.

## How The Packages Fit Together

Palamedes is split deliberately:

- framework adapters handle integration and `.po` loading
- the CLI handles extraction workflows
- the transform and extractor packages are the low-level building blocks
- the runtime package provides the `getI18n()` contract that transformed code expects
- the native core packages carry the heavy lifting behind the scenes

That gives most application teams a simple starting point, while still leaving room for custom tooling and deeper integration work.

## Examples

- [Vite React example](https://github.com/sebastian-software/palamedes/tree/main/examples/vite-react)
- [Next.js App Router example](https://github.com/sebastian-software/palamedes/tree/main/examples/nextjs-app)

## Docs

- [Comparison with Lingui](https://github.com/sebastian-software/palamedes/blob/main/docs/comparison-with-lingui.md)
- [Migration guide from Lingui](https://github.com/sebastian-software/palamedes/blob/main/docs/migrate-from-lingui.md)

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm check-types
```

Palamedes currently targets Node.js `>=22`.

## License

[![Sebastian Software](https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg)](https://oss.sebastian-software.com/)

MIT © 2026 Sebastian Software
