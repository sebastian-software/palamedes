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

`runtimeModule` is the shared fallback for macro transforms and generated MDX
modules. A more specific `mdx.runtimeModule` from `palamedes.yaml` or the
plugin's `mdx` override takes precedence for MDX only.

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
