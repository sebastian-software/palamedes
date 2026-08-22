# @palamedes/vite-plugin

[![npm version](https://img.shields.io/npm/v/%40palamedes%2Fvite-plugin?logo=npm)](https://www.npmjs.com/package/@palamedes/vite-plugin)
[![CI](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml)
[![Sponsored by Sebastian Software](https://img.shields.io/badge/Sponsored%20by-Sebastian%20Software-0f172a.svg)](https://oss.sebastian-software.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f172a.svg)](https://github.com/sebastian-software/palamedes/blob/main/LICENSE)

The recommended Palamedes entry point for Vite applications.

`@palamedes/vite-plugin` gives Vite projects fast macro transforms, first-class
`.mdx` compilation, `.po` loading, and a translation workflow that feels native to modern frontend
tooling instead of bolted on from an older Babel path.

## Status

- Recommended for Vite projects using React or Solid and Palamedes macros
- Supports `.po` imports and source-string-first catalog semantics
- Extracts and compiles semantic MDX messages through the same native analysis
- Reports missing translations and ICU compatibility diagnostics during builds
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
  plugins: [palamedes({ framework: "solid" }), solid({ extensions: [".mdx"] })],
})
```

```yaml
locales: [en, de]
source-locale: en
catalogs:
  - path: src/locales/{locale}
    include: [src]
```

Transformed code expects `getI18n()` from `@palamedes/runtime`, so register the active client i18n instance before translated code executes.

Catalog storage can be PO or FCL in `palamedes.yaml`, but the current Vite
loader is still a `.po` import loader. Keep direct app imports on `.po` unless a
future adapter release explicitly documents `.fcl` imports.

## Options

```ts
import { palamedes } from "@palamedes/vite-plugin"

palamedes({
  include: /\.(tsx?|jsx?|mjs|cjs)$/,
  exclude: /node_modules/,
  enablePoLoader: true,
  configPath: "./palamedes.yaml",
  cwd: process.cwd(),
  skipValidation: false,
  failOnMissing: false,
  failOnCompileError: false,
  framework: "react",
  keepSourceFallbacks: undefined,
  mdx: {
    translatableAttributes: ["alt", "title"],
    frontMatterFields: ["title", "description"],
  },
})
```

`keepSourceFallbacks` defaults to `true`, including `vite build`, so a missing
catalog chunk renders readable source text instead of a compiled hash. Set it
to `false` to opt into smaller output when source text must not ship. The
parser-free runtime returns an ICU source fallback literally; use
`@palamedes/core` if a fallback itself must interpolate values.

`cwd` and `skipValidation` are passed through to `loadPalamedesConfig`: `cwd`
sets the directory the config search starts from, and `skipValidation` loads
partially-authored config files without validation (tooling only).

`framework` says which UI framework the app compiles for and selects the
component contract for compiled `.mdx`. It defaults to `"react"`, so **Solid
apps must set `framework: "solid"`**; use `"none"` for a project that is
neither. Macro and generated MDX runtime access is always hook-free. Locale
changes require a document navigation.

The separate `runtimeModule` option overrides only the macro transform's module
path. Override generated MDX independently through `mdx.runtimeModule`.

When `failOnMissing` is enabled, MDX compiled IDs are validated against every
target locale in the catalogs that include the source file, even before a
catalog module is imported.

Imports ending in `?palamedes` are treated like `.po` catalog imports — the
analog of Lingui's `?lingui` query suffix — so bundler-agnostic code can force
a module through the Palamedes catalog loader.

`.mdx` modules are compiled before the React or Solid JSX plugin. Catalog
extraction discovers the same files automatically, and both paths share the
native semantic analyzer. React MDX requires Vite 8 or newer: its Rolldown
pipeline recognizes the generated module type. Vite 7 projects can continue to
use macros and catalog loading with `mdx: false`, or compile MDX for Solid with
`solid({ extensions: [".mdx"] })`. React parsing is configured automatically,
while Solid requires that explicit extension setting.

The package peer range remains broad because macros and catalog loading work on
supported Vite releases independently of the React MDX compiler.
See the [MDX guide](https://github.com/sebastian-software/palamedes/blob/main/docs/mdx.md).

## What This Package Handles

- transforms supported message macros before the rest of the Vite pipeline runs
- compiles imported `.po` files into JavaScript modules
- keeps source-string-first catalog semantics aligned with the native core
- reports common macro, catalog, placeholder, and ICU compatibility issues during dev and build

## Related Docs

- [Proof, benchmarks, and current maturity](https://github.com/sebastian-software/palamedes/blob/main/docs/proof-and-benchmarks.md)
- [Troubleshooting common setup failures](https://github.com/sebastian-software/palamedes/blob/main/docs/troubleshooting.md)
- [Migration from Lingui](https://github.com/sebastian-software/palamedes/blob/main/docs/migrate-from-lingui.md)
- [Examples](https://github.com/sebastian-software/palamedes/blob/main/examples/README.md)

## License

[![Sebastian Software](https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg)](https://oss.sebastian-software.com/)

MIT © 2026 Sebastian Software
