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
  include?: FilterPattern
  exclude?: FilterPattern
  enablePoLoader?: boolean
  configPath?: string
  cwd?: string
  skipValidation?: boolean
  failOnMissing?: boolean
  failOnCompileError?: boolean
  framework?: "react" | "solid" | "none"
  runtimeModule?: string
  keepSourceFallbacks?: boolean
  mdx?: PalamedesMdxConfig | false
  experimentalGraphSplitting?: boolean | { localeBinding?: "embed" | "import-map" }
}
```

Defaults:

- `include`: `/\.(tsx?|jsx?|mjs|cjs)$/`
- `exclude`: `/node_modules/`
- `enablePoLoader`: `true`
- `failOnMissing`: `false`
- `failOnCompileError`: `false`
- `framework`: `"react"`
- `runtimeModule`: `"@palamedes/runtime"`
- `keepSourceFallbacks`: `true` during `vite serve`, `false` during `vite build`
- `mdx`: values from Palamedes config with React defaults; `false` disables MDX
- `experimentalGraphSplitting`: `false`

`framework` states which UI framework the app compiles for and selects the
component contract for generated MDX modules. Solid apps must set
`framework: "solid"`.

Macro and generated MDX runtime lookups always use the plain, hook-free getter.
Locale changes require document navigation. `runtimeModule` is an advanced
override for only the macro transform's module path.

`keepSourceFallbacks` applies to both macro transforms and generated MDX.
Production builds strip authored messages from runtime calls by default and
therefore require compiled catalogs to be loaded before translated code
renders. They also omit translator comments and context metadata from runtime
descriptors. Set `keepSourceFallbacks` to `true` when production must retain
readable source-message fallbacks.

Generated MDX modules can set `mdx.runtime-module` in `palamedes.yaml` or
`mdx.runtimeModule` on the plugin when integrating a custom runtime.

`experimentalGraphSplitting` emits generated message sidecars per transformed
source module. The default `"embed"` form carries every locale in each sidecar;
the experimental `"import-map"` form emits locale-specific assets and requires
the server to inject the active locale's import map before browser modules
load. Both modes require `setClientI18n()` rather than eager application-owned
PO imports, and locale changes require document navigation.

With `failOnMissing: true`, compiled MDX IDs are checked against every target
locale in each catalog whose `include` patterns cover that MDX file. This
reports missing MDX translations even when the catalog module has not been
imported yet.

## Usage

```ts
import { defineConfig } from "vite"
import { palamedes } from "@palamedes/vite-plugin"

export default defineConfig({
  plugins: [palamedes()],
})
```

Keep `palamedes()` before the React or Solid Vite plugin so the native MDX
compiler emits JSX before the framework transform runs. React MDX parsing is
configured automatically. Solid must use
`solid({ extensions: [".mdx"] })`. React MDX requires Vite 8 or newer because
the generated JSX module type needs Rolldown; Vite 7 and older projects can
set `mdx: false` while keeping macros and catalog loading. See [MDX
messages](../mdx.md) for authoring and configuration.
