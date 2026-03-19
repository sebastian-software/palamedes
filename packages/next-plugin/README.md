# @palamedes/next-plugin

[![npm version](https://img.shields.io/npm/v/%40palamedes%2Fnext-plugin?logo=npm)](https://www.npmjs.com/package/@palamedes/next-plugin)
[![CI](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml)
[![Sponsored by Sebastian Software](https://img.shields.io/badge/Sponsored%20by-Sebastian%20Software-0f172a.svg)](https://oss.sebastian-software.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f172a.svg)](https://github.com/sebastian-software/palamedes/blob/main/LICENSE)

The recommended Palamedes entry point for Next.js applications.

`@palamedes/next-plugin` wires Palamedes into Next.js so message macros are transformed before they leak into runtime, and `.po` files can be loaded as part of the application build.

## Status

- Recommended for Next.js applications using App Router and Palamedes macros
- Supports `.po` imports and source-string-first catalog semantics
- Uses webpack as the currently verified production path on Next.js 16
- Includes Turbopack wiring, but the stable documented path remains webpack for now
- Not a full Next.js starter or scaffolding tool

## Start Here

Use the full copy-paste setup guide:

- [First working translation in 5 minutes](https://github.com/sebastian-software/palamedes/blob/main/docs/first-working-translation.md)

## Installation

```bash
pnpm add @palamedes/core @palamedes/react @palamedes/runtime @palamedes/next-plugin
pnpm add -D @palamedes/cli @palamedes/config
```

## Minimal Setup

```js
const { withPalamedes } = require("@palamedes/next-plugin")

module.exports = withPalamedes({})
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

Transformed code expects `getI18n()` from `@palamedes/runtime`, so make sure the active i18n instance is available on both the client and the server before translated code executes.

## Options

```js
const { withPalamedes } = require("@palamedes/next-plugin")

module.exports = withPalamedes({}, {
  include: /\.(tsx?|jsx?)$/,
  exclude: /node_modules/,
  enablePoLoader: true,
  configPath: "./palamedes.config.ts",
  failOnMissing: false,
  failOnCompileError: false,
  runtimeModule: "@palamedes/runtime",
})
```

## What This Package Handles

- transforms supported message macros in JavaScript and TypeScript sources
- compiles imported `.po` files into JavaScript modules
- keeps source-string-first catalog semantics aligned with the native core
- integrates with webpack and includes Turbopack wiring for future parity

## Related Docs

- [Proof, benchmarks, and current maturity](https://github.com/sebastian-software/palamedes/blob/main/docs/proof-and-benchmarks.md)
- [Migration from Lingui](https://github.com/sebastian-software/palamedes/blob/main/docs/migrate-from-lingui.md)
- [Examples](https://github.com/sebastian-software/palamedes/blob/main/examples/README.md)

## License

[![Sebastian Software](https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg)](https://oss.sebastian-software.com/)

MIT © 2026 Sebastian Software
