# @palamedes/vite-plugin

[![npm version](https://img.shields.io/npm/v/%40palamedes%2Fvite-plugin?logo=npm)](https://www.npmjs.com/package/@palamedes/vite-plugin)
[![CI](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml)
[![Sponsored by Sebastian Software](https://img.shields.io/badge/Sponsored%20by-Sebastian%20Software-0f172a.svg)](https://oss.sebastian-software.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f172a.svg)](https://github.com/sebastian-software/palamedes/blob/main/LICENSE)

The recommended Palamedes entry point for Vite applications.

`@palamedes/vite-plugin` gives Vite projects fast macro transforms, `.po` loading, and a cleaner path than bolting Babel-oriented i18n tooling back onto a modern frontend stack.

## Status

- Recommended for Vite projects using React or Solid and Palamedes macros
- Supports `.po` imports and source-string-first catalog semantics
- Best paired with `@palamedes/runtime` and `@palamedes/cli`
- Not a framework generator or top-level app scaffold

## Start Here

Use the full copy-paste setup guide:

- [First working translation in 5 minutes](https://github.com/sebastian-software/palamedes/blob/main/docs/first-working-translation.md)

## Installation

```bash
pnpm add @palamedes/core @palamedes/runtime @palamedes/vite-plugin
pnpm add -D @palamedes/cli @palamedes/config
```

Then add the host package pair you want:

```bash
pnpm add @palamedes/react react react-dom
pnpm add -D @vitejs/plugin-react
```

or

```bash
pnpm add @palamedes/solid solid-js
pnpm add -D vite-plugin-solid
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

```ts
import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
import { palamedes } from "@palamedes/vite-plugin"

export default defineConfig({
  plugins: [palamedes(), solid()],
})
```

```ts
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

Transformed code expects `getI18n()` from `@palamedes/runtime`, so register the active client i18n instance before translated code executes.

## Options

```ts
import { palamedes } from "@palamedes/vite-plugin"

palamedes({
  include: /\.(tsx?|jsx?|mjs|cjs)$/,
  exclude: /node_modules/,
  enablePoLoader: true,
  configPath: "./palamedes.config.ts",
  failOnMissing: false,
  failOnCompileError: false,
  runtimeModule: "@palamedes/runtime",
})
```

## What This Package Handles

- transforms supported message macros before the rest of the Vite pipeline runs
- compiles imported `.po` files into JavaScript modules
- keeps source-string-first catalog semantics aligned with the native core
- reports common macro and catalog issues during dev and build

## Related Docs

- [Proof, benchmarks, and current maturity](https://github.com/sebastian-software/palamedes/blob/main/docs/proof-and-benchmarks.md)
- [Migration from Lingui](https://github.com/sebastian-software/palamedes/blob/main/docs/migrate-from-lingui.md)
- [Examples](https://github.com/sebastian-software/palamedes/blob/main/examples/README.md)

## License

[![Sebastian Software](https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg)](https://oss.sebastian-software.com/)

MIT © 2026 Sebastian Software
