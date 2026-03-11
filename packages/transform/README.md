# @palamedes/transform

[![npm version](https://img.shields.io/npm/v/%40palamedes%2Ftransform?logo=npm)](https://www.npmjs.com/package/@palamedes/transform)
[![CI](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f172a.svg)](https://github.com/sebastian-software/palamedes/blob/main/LICENSE)

Low-level Lingui macro transformation powered by Palamedes' native core.

This package turns Lingui macro imports into runtime calls without requiring Babel. It is the building block behind the framework adapters and the right entry point when you want to embed Palamedes in your own bundler, compiler, or tooling flow.

## When To Use This Package

Use `@palamedes/transform` when you are:

- building a custom integration outside the official plugins
- experimenting with your own compile pipeline
- working on Palamedes internals

If you are integrating Palamedes into an app, start with [`@palamedes/vite-plugin`](https://www.npmjs.com/package/@palamedes/vite-plugin) or [`@palamedes/next-plugin`](https://www.npmjs.com/package/@palamedes/next-plugin) instead.

## Installation

```bash
pnpm add -D @palamedes/transform
```

## Minimal Example

```ts
import { transformLinguiMacros } from "@palamedes/transform"

const result = transformLinguiMacros(
  'import { t } from "@lingui/macro"; const message = t`Hello ${name}`',
  "example.ts",
  {
    runtimeModule: "@palamedes/runtime",
  }
)

console.log(result.code)
```

## Key Exports

- `transformLinguiMacros(code, filename, options?)`
- `mightContainLinguiMacros(code)`
- `findMacroImports(program)`
- `LINGUI_MACRO_PACKAGES`
- `JS_MACROS`
- `JSX_MACROS`

## Supported Macro Shapes

- tagged templates such as `t\`...\`` and `msg\`...\``
- descriptor calls such as `t({ message: "..." })`
- `defineMessage(...)`
- `plural(...)`, `select(...)`, `selectOrdinal(...)`
- `<Trans>`, `<Plural>`, `<Select>`, `<SelectOrdinal>`

## Related Packages

- [`@palamedes/core-node`](https://www.npmjs.com/package/@palamedes/core-node)
- [`@palamedes/extractor`](https://www.npmjs.com/package/@palamedes/extractor)
- [`@palamedes/vite-plugin`](https://www.npmjs.com/package/@palamedes/vite-plugin)
- [`@palamedes/next-plugin`](https://www.npmjs.com/package/@palamedes/next-plugin)

## License

MIT © 2026 [Sebastian Software](https://oss.sebastian-software.com/)
