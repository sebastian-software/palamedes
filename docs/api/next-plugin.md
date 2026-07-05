# `@palamedes/next-plugin`

`@palamedes/next-plugin` wires Palamedes macro transformation and `.po` loading
into Next.js.

Catalog storage can be PO or FCL in `palamedes.yaml`, but this API is still a
`.po` import loader. See [Catalog formats](../catalog-formats.md) for the
storage/import boundary.

## Exports

- `withPalamedes(baseConfig?, options?)`
- default export `withPalamedes`
- `WithPalamedesOptions`
- internal loader subpaths used by plugin wiring:
  `@palamedes/next-plugin/palamedes-loader` and
  `@palamedes/next-plugin/palamedes-po-loader`

## Options

```ts
interface WithPalamedesOptions {
  include?: RegExp
  exclude?: RegExp
  enablePoLoader?: boolean
  configPath?: string
  failOnMissing?: boolean
  failOnCompileError?: boolean
  runtimeModule?: string
  workspaceRoot?: string
}
```

Defaults:

- `include`: `/\.[jt]sx?$/`
- `exclude`: `/node_modules/`
- `enablePoLoader`: `true`
- `failOnMissing`: `false`
- `failOnCompileError`: `false`
- `runtimeModule`: `"@palamedes/runtime"`

## Usage

```js
const { withPalamedes } = require("@palamedes/next-plugin")

module.exports = withPalamedes({})
```

The plugin configures both Turbopack and webpack paths. `workspaceRoot` can be
set explicitly in monorepos when automatic root detection is not correct.
