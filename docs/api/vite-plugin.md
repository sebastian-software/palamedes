# `@palamedes/vite-plugin`

`@palamedes/vite-plugin` transforms Palamedes macro imports, compiles `.mdx`
modules, and compiles `.po` imports inside Vite builds.

Catalog storage can be PO or FCL in `palamedes.yaml`, but this API is still a
`.po` import loader. See [Catalog formats](../catalog-formats.md) for the
storage/import boundary.

## Exports

- `palamedes(options?)`
- default export `palamedes`
- `PalamedesPluginOptions`

## Options

```ts
interface PalamedesPluginOptions {
  include?: FilterPattern;
  exclude?: FilterPattern;
  enablePoLoader?: boolean;
  configPath?: string;
  cwd?: string;
  skipValidation?: boolean;
  failOnMissing?: boolean;
  /** @deprecated Invalid and unsupported ICU is always fatal in v2. */
  failOnCompileError?: boolean;
  framework?: "react" | "solid" | "none";
  runtimeModule?: string;
  keepSourceFallbacks?: boolean;
  mdx?: PalamedesMdxConfig | false;
  experimentalGraphSplitting?: boolean | { localeBinding?: "embed" | "import-map" };
}
```

Defaults:

- `include`: `/\.([cm]?[jt]s|[jt]sx)$/`
- `exclude`: `/node_modules/`
- `enablePoLoader`: `true`
- `failOnMissing`: `false`
- `failOnCompileError`: deprecated compatibility option; it no longer
  downgrades invalid or unsupported ICU to a warning.
- `framework`: `"react"`
- `runtimeModule`: `"@palamedes/runtime"`
- `keepSourceFallbacks`: `false`
- `mdx`: values from Palamedes config with React defaults; `false` disables MDX
- `experimentalGraphSplitting`: deprecated; delivery is automatic and `false` is rejected

`framework` states which UI framework the app compiles for and selects the
component contract for generated MDX modules. Solid apps must set
`framework: "solid"`.

Macro and generated MDX runtime lookups always use the plain, hook-free getter.
Locale changes require document navigation. `runtimeModule` is an advanced
override for only the macro transform's module path.

`keepSourceFallbacks` defaults to `false` in every environment. Set
`keepSourceFallbacks: true` to retain authored text for diagnostics. Missing
compiled messages throw; source metadata never supplies replacement output.
Valid translation fallbacks are compiled by the native compiler.

Generated MDX modules can set `mdx.runtime-module` in `palamedes.yaml` or
`mdx.runtimeModule` on the plugin when integrating a custom runtime.

Compiled delivery follows the evaluated module graph automatically. Development
awaits the active locale's generated fragment before running its source module.
Production emits locale-bound import maps and separate executable fragments.
Set the document's `lang` before its module entry runs; the adapter initializes
the client instance. Locale changes require document navigation.

Vite's resolved `base` must be root-relative, such as `/app/`, or an absolute
URL. Relative bases are rejected because nested document URLs would resolve
catalog URLs differently.

With `failOnMissing: true`, compiled MDX IDs are checked against every target
locale in each catalog whose `include` patterns cover that MDX file. This
reports missing MDX translations even when the catalog module has not been
imported yet.

## Usage

```ts
import { defineConfig } from "vite";
import { palamedes } from "@palamedes/vite-plugin";

export default defineConfig({
  plugins: [palamedes()],
});
```

Keep `palamedes()` before the React or Solid Vite plugin so the native MDX
compiler emits JSX before the framework transform runs. React MDX parsing is
configured automatically. Solid must use
`solid({ extensions: [".mdx"] })`. React MDX requires Vite 8 or `rolldown-vite`
because the generated JSX module type needs Rolldown; plain Rollup-based Vite 7
and older projects can set `mdx: false` while keeping macros and catalog loading.
See [MDX
messages](../mdx.md) for authoring and configuration.

## Server and document delivery

`@palamedes/vite-plugin/server` exports
`createViteServerI18n({ locale, timeZone?, ...options })`. It awaits the shared,
immutable complete catalog for the active locale and returns fresh request
state. Host request middleware keeps that state in its request scope across
SSR, loaders and actions. Applications do not construct catalog import maps.

`@palamedes/vite-plugin/delivery` exports `createViteCatalogDelivery({
clientDirectory, development?, manifestName? })`. Framework adapters call
`getLocaleBinding(locale)` and pipe HTML through
`createDocumentTransform(binding, { nonce?, errorHtml? })`. `errorHtml` is trusted,
catalog-independent host markup; the default view provides Reload and Home.
Import maps precede all modulepreloads. Catalog-only manifest changes refresh
without restarting the host. Missing production assets fail closed.

React Router's initial route imports run before its client entry. The document
transport observes their catalog dependencies independently. Lazy route facades
forward failures into the host's normal ErrorBoundary instead of React Router's
automatic reload. Error UI must be independent of message catalogs.

Static HTML applications receive a generated module entry that installs the
active locale's import map and awaits application dependencies. An optional
`<template data-palamedes-error>` supplies the host's error view. Existing module
script nonces propagate to the generated entry and import map.
