# @palamedes/vite-plugin

[![npm version](https://img.shields.io/npm/v/%40palamedes%2Fvite-plugin?logo=npm)](https://www.npmjs.com/package/@palamedes/vite-plugin)
[![CI](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml)
[![Sponsored by Sebastian Software](https://img.shields.io/badge/Sponsored%20by-Sebastian%20Software-0f172a.svg)](https://oss.sebastian-software.com/)
[![License: MIT OR Apache-2.0](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-0f172a.svg)](https://github.com/sebastian-software/palamedes#license)

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
pnpm add @palamedes/solid @solidjs/web@2.0.0-rc.16 solid-js@2.0.0-rc.16
pnpm add -D @solidjs/vite-plugin@3.0.0-next.50
```

Solid 2 is still published only as prerelease versions, and an unpinned
`solid-js` resolves to Solid 1. The commands pin the versions that the
maintained `examples/solid-*` apps use.

## Minimal Setup

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { palamedes } from "@palamedes/vite-plugin";

export default defineConfig({
  plugins: [palamedes(), react()],
});
```

Invalid or unsupported ICU always fails catalog compilation. The plugin
throws a migration error for the removed v1 options `failOnCompileError`,
`keepSourceFallbacks` (now `includeSourceMetadata`), `cwd` (now
`projectRoot`), and `experimentalGraphSplitting`.

```ts
import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";
import { palamedes } from "@palamedes/vite-plugin";

export default defineConfig({
  plugins: [palamedes({ framework: "solid" }), solid({ extensions: [".mdx"] })],
});
```

```yaml
locales: [en, de]
source-locale: en
catalogs:
  - path: src/locales/{locale}
    include: [src]
```

Set the document’s `lang` before its module entry runs. Generated dependencies initialize the client instance and await only the active locale’s compiled fragments before translated code executes. Locale changes use document navigation.

Catalog storage can be PO or FCL in `palamedes.yaml`. Standard framework
delivery derives the compiled active-locale dependencies automatically, so app
code does not need direct catalog imports or locale maps. For explicit custom
integrations, the current low-level import hook accepts `.po` modules; FCL
storage is compiled and delivered through the adapter rather than imported by
application code.

## Options

```ts
import { palamedes } from "@palamedes/vite-plugin";

palamedes({
  include: /\.([cm]?[jt]s|[jt]sx)$/,
  exclude: /node_modules/,
  enablePoLoader: true,
  configPath: "./palamedes.yaml",
  projectRoot: undefined,
  skipValidation: false,
  failOnMissing: false,
  framework: "react",
  includeSourceMetadata: undefined,
  mdx: {
    translatableAttributes: ["alt", "title"],
    frontMatterFields: ["title", "description"],
  },
});
```

`includeSourceMetadata` defaults to `false` in every environment. Set
`includeSourceMetadata: true` to retain authored text for diagnostics. Missing
compiled messages throw; source metadata never supplies replacement output.
Valid translation fallbacks are compiled by the native compiler.

`projectRoot` is the base for config discovery, a relative `configPath`, and
relative `include`/`exclude` globs. It defaults to Vite's resolved `root`; a
relative value resolves from the current working directory. `skipValidation`
is passed through to `loadPalamedesConfig` and loads partially-authored config
files without validation (tooling only).

`framework` says which UI framework the app compiles for and selects the
component contract for compiled `.mdx`. It defaults to `"react"`, so **Solid
apps must set `framework: "solid"`**; use `"none"` for a project that is
neither. Macro and generated MDX runtime access is always hook-free. Locale
changes require a document navigation.

`environment` defaults to `"auto"`, which reads the Vite environment to tell
server builds from browser builds. Bundlers without Vite environments, such as
tsdown or standalone Rolldown building a Node backend, need
`environment: "server"`. Otherwise the plugin treats the build as a browser
build: `@palamedes/runtime/node` keeps its runtime-macro path, and
`virtual:palamedes/server-catalogs` fails as a browser import. See [Backend servers](https://github.com/sebastian-software/palamedes/blob/main/docs/backend-servers.md).

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
native semantic analyzer. Vite 8's Rolldown pipeline recognizes the generated
React module type, so React parsing is configured automatically. Solid requires
`solid({ extensions: [".mdx"] })`.

Compiled graph delivery is automatic in development and production. No
experimental flag, application PO map, or manual client initialization is
needed. Vite's resolved `base` must be root-relative (for example `/app/`) or
an absolute URL.

SSR hosts use `createBundledServerI18n` from
`@palamedes/runtime/server/bundled` to create request state from the shared
lazy active-locale catalog, and `@palamedes/vite-plugin/delivery` to bind
import maps before modulepreloads and modules execute.
Static Vite HTML entries receive the same locale binding automatically.

The package requires Vite 8. The macro transform declares `id` and `code` hook
filters so files without a Palamedes macro import are skipped before the
JavaScript hook runs. The handler keeps the same `includes()` check for hosts
that ignore filter metadata. The MDX hook also declares an `.mdx` ID filter and
retains its handler checks.
Hook filters allow query suffixes such as `page.ts?view=preview` and
`page.mdx?view=preview`. Configured `include` and `exclude` patterns are still
checked against the file path without its query inside the handler.
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

<!-- ferramenta-family:start -->

**palamedes** is part of the [Ferramenta](https://ferramenta.dev) family — A family of Rust tools.

Siblings: [ferroni](https://sebastian-software.github.io/ferroni/) — Oniguruma-compatible regex engine · [ferriki](https://github.com/sebastian-software/ferriki) — Shiki-compatible syntax highlighting · [ferromark](https://sebastian-software.github.io/ferromark/) — Markdown to HTML with a secure default and every GFM extension included. · [ferrolex](https://github.com/sebastian-software/ferrolex) — Spell checking for text and code · [ferrocat](https://ferrocat.dev) — Translation catalog engine · [ferrovia](https://github.com/sebastian-software/ferrovia) — SVGO-compatible SVG optimizer · [ferralk](https://github.com/sebastian-software/ferralk) — Glob matching and parallel filesystem walking · [ferrugo](https://github.com/sebastian-software/ferrugo) — PDF previews for untrusted files.
<!-- ferramenta-family:end -->

## License

[![Sebastian Software](https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg)](https://oss.sebastian-software.com/)

MIT OR Apache-2.0 © 2026 Sebastian Software
