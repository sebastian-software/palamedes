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
  runtimeModule?: string
  mdx?: PalamedesMdxConfig | false
}
```

Defaults:

- `include`: `/\.(tsx?|jsx?|mjs|cjs)$/`
- `exclude`: `/node_modules/`
- `enablePoLoader`: `true`
- `failOnMissing`: `false`
- `failOnCompileError`: `false`
- `runtimeModule`: `"@palamedes/runtime"`
- `mdx`: values from Palamedes config with React defaults; `false` disables MDX

## Usage

```ts
import { defineConfig } from "vite"
import { palamedes } from "@palamedes/vite-plugin"

export default defineConfig({
  plugins: [palamedes()],
})
```

Keep `palamedes()` before the React or Solid Vite plugin so the native MDX
compiler emits JSX before the framework transform runs. See
[MDX messages](../mdx.md) for authoring and configuration.
