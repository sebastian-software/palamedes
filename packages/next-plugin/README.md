# @palamedes/next-plugin

[![npm version](https://img.shields.io/npm/v/%40palamedes%2Fnext-plugin?logo=npm)](https://www.npmjs.com/package/@palamedes/next-plugin)
[![CI](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml)
[![Sponsored by Sebastian Software](https://img.shields.io/badge/Sponsored%20by-Sebastian%20Software-0f172a.svg)](https://oss.sebastian-software.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f172a.svg)](https://github.com/sebastian-software/palamedes/blob/main/LICENSE)

The recommended way to use Palamedes in Next.js.

`@palamedes/next-plugin` wires Palamedes into webpack and Turbopack so Lingui macros are transformed before they leak into runtime, and `.po` files can be loaded as part of the application build.

## When To Use This Package

Use this package when you are integrating Palamedes into a Next.js application.

It is the right starting point if you want:

- Lingui macro transforms without adding Babel back to the project
- `.po` file loading as part of the app build
- one supported integration point for both webpack and Turbopack

If you are on Vite, use [`@palamedes/vite-plugin`](https://www.npmjs.com/package/@palamedes/vite-plugin) instead.

## Installation

```bash
pnpm add @palamedes/next-plugin @palamedes/runtime @lingui/core @lingui/react
pnpm add -D @palamedes/cli
```

## Minimal Setup

```js
const { withPalamedes } = require("@palamedes/next-plugin")

module.exports = withPalamedes({})
```

Transformed code expects a runtime getter from `@palamedes/runtime`, so make sure you register your active Lingui instance on the client and server before translated code runs.

## Options

```js
const { withPalamedes } = require("@palamedes/next-plugin")

module.exports = withPalamedes({}, {
  include: /\.(tsx?|jsx?)$/,
  exclude: /node_modules/,
  enablePoLoader: true,
  configPath: "./lingui.config.js",
  failOnMissing: false,
  failOnCompileError: false,
  runtimeModule: "@palamedes/runtime",
})
```

## What It Handles

- transforms Lingui macros in JavaScript and TypeScript sources
- compiles imported `.po` files into JavaScript modules
- integrates with both webpack and Turbopack

## Related Packages

- [`@palamedes/runtime`](https://www.npmjs.com/package/@palamedes/runtime)
- [`@palamedes/cli`](https://www.npmjs.com/package/@palamedes/cli)
- [`@palamedes/transform`](https://www.npmjs.com/package/@palamedes/transform)
- [`@palamedes/vite-plugin`](https://www.npmjs.com/package/@palamedes/vite-plugin)

## License

[![Sebastian Software](https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg)](https://oss.sebastian-software.com/)

MIT © 2026 Sebastian Software
