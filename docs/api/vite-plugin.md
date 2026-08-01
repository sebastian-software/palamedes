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
}
```

Defaults:

- `include`: `/\.(tsx?|jsx?|mjs|cjs)$/`
- `exclude`: `/node_modules/`
- `enablePoLoader`: `true`
- `failOnMissing`: `false`
- `failOnCompileError`: `false`
- `framework`: `"react"`
- `runtimeModule`: derived from `framework`
- `keepSourceFallbacks`: `true` during `vite serve`, `false` during `vite build`
- `mdx`: values from Palamedes config with React defaults; `false` disables MDX

`framework` states which UI framework the app compiles for. It selects the
reactive runtime for the macro transform — so inline `t` / `plural` follow a
live locale switch, see [Locale strategies](../locale-strategies.md) — and the
component contract for generated MDX modules. Solid apps must set
`framework: "solid"`; `"none"` restores the framework-agnostic runtime.

`runtimeModule` overrides only the macro transform's module path.

`keepSourceFallbacks` applies to both macro transforms and generated MDX.
Production builds strip authored messages from runtime calls by default and
therefore require compiled catalogs to be loaded before translated code
renders. They also omit translator comments and context metadata from runtime
descriptors. Set `keepSourceFallbacks` to `true` when production must retain
readable source-message fallbacks.

Generated MDX modules are independent: they already default to the framework's
reactive runtime subpath, because their frontmatter, image alt text, and
translated attributes call `getI18n()` directly. Override that with
`mdx.runtime-module` in `palamedes.yaml` or `mdx.runtimeModule` on the plugin.

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
`solid({ extensions: [".mdx"] })`. MDX compilation requires Vite 7 or newer;
set `mdx: false` on older Vite releases. See [MDX messages](../mdx.md) for
authoring and configuration.
