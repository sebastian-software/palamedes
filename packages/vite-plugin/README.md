# @palamedes/vite-plugin

[![npm version](https://img.shields.io/npm/v/%40palamedes%2Fvite-plugin?logo=npm)](https://www.npmjs.com/package/@palamedes/vite-plugin)
[![CI](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f172a.svg)](https://github.com/sebastian-software/palamedes/blob/main/LICENSE)

The recommended way to use Palamedes in Vite.

`@palamedes/vite-plugin` gives Vite projects fast Lingui macro transforms, `.po` loading, and a cleaner path than bolting Babel back onto a modern frontend stack.

## When To Use This Package

Use this package when you are integrating Palamedes into a Vite application.

It is the right starting point if you want:

- Lingui macro transforms before the rest of your Vite pipeline runs
- `.po` file loading during development and build
- a supported integration that stays close to normal Vite behavior

If you are on Next.js, use [`@palamedes/next-plugin`](https://www.npmjs.com/package/@palamedes/next-plugin) instead.

## Installation

```bash
pnpm add @palamedes/vite-plugin @palamedes/runtime @lingui/core @lingui/react
pnpm add -D @palamedes/cli
```

## Minimal Setup

```ts
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { palamedes } from "@palamedes/vite-plugin"

export default defineConfig({
  plugins: [palamedes(), react()],
})
```

Transformed code expects `getI18n()` from `@palamedes/runtime`, so make sure your app registers the active Lingui instance before translated code executes.

## Options

```ts
import { palamedes } from "@palamedes/vite-plugin"

palamedes({
  include: /\.(tsx?|jsx?|mjs|cjs)$/,
  exclude: /node_modules/,
  enablePoLoader: true,
  configPath: "./lingui.config.ts",
  failOnMissing: false,
  failOnCompileError: false,
  runtimeModule: "@palamedes/runtime",
})
```

## What It Handles

- transforms Lingui macros in JavaScript and TypeScript files
- compiles imported `.po` files into JavaScript modules
- reports common macro-resolution mistakes early in Vite

## Related Packages

- [`@palamedes/runtime`](https://www.npmjs.com/package/@palamedes/runtime)
- [`@palamedes/cli`](https://www.npmjs.com/package/@palamedes/cli)
- [`@palamedes/transform`](https://www.npmjs.com/package/@palamedes/transform)
- [`@palamedes/next-plugin`](https://www.npmjs.com/package/@palamedes/next-plugin)

## License

MIT © Sebastian Software GmbH
