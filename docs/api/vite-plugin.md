# `@palamedes/vite-plugin`

`@palamedes/vite-plugin` transforms Palamedes macro imports and compiles `.po`
imports inside Vite builds.

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
}
```

Defaults:

- `include`: `/\.(tsx?|jsx?|mjs|cjs)$/`
- `exclude`: `/node_modules/`
- `enablePoLoader`: `true`
- `failOnMissing`: `false`
- `failOnCompileError`: `false`
- `runtimeModule`: `"@palamedes/runtime"`

## Usage

```ts
import { defineConfig } from "vite"
import { palamedes } from "@palamedes/vite-plugin"

export default defineConfig({
  plugins: [palamedes()],
})
```
