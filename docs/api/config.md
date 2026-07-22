# `@palamedes/config`

`@palamedes/config` loads and validates Palamedes data config files and legacy
`palamedes.config.*` files.

## Exports

- `defineConfig(config)`
- `loadPalamedesConfig(options?)`
- `CONFIG_FILENAMES`
- `expandFallbackLocales(locales, fallbackLocales?)`
- `resolveCatalogPath(config, catalogPath, locale)`
- `resolveConfigPattern(config, pattern)`
- `LoadPalamedesConfigOptions`
- `PalamedesConfig`
- `LoadedPalamedesConfig`
- `PalamedesCatalogConfig`
- `PalamedesFallbackLocales`
- `PalamedesSourceReferenceRoot`
- `PalamedesPluginDeclaration`

## Config Files

Supported file names:

- `palamedes.yaml`
- `palamedes.yml`
- `palamedes.json`
- `palamedes.toml`
- `palamedes.config.ts`
- `palamedes.config.js`
- `palamedes.config.mjs`
- `palamedes.config.cjs`

See the [configuration reference](../configuration.md) for every field.

## `defineConfig(config)`

Returns the config unchanged while giving TypeScript users a typed authoring
surface.

```ts
import { defineConfig } from "@palamedes/config"

export default defineConfig({
  locales: ["en", "de"],
  sourceLocale: "en",
  catalogs: [{ path: "src/locales/{locale}", include: ["src"] }],
  plugins: [["@acme/palamedes-workflows", { policy: "strict" }]],
})
```

PO is the default catalog storage. Opt into FCL by adding `format: "fcl"`:

```ts
export default defineConfig({
  locales: ["en", "de"],
  sourceLocale: "en",
  catalogs: [{ path: "src/locales/{locale}", format: "fcl", include: ["src"] }],
})
```

## `loadPalamedesConfig(options?)`

Searches from `cwd` for a supported config file unless `configPath` is passed.
The returned object includes `configPath`, `rootDir`, and
`sourceReferenceRoot`.

```ts
const config = await loadPalamedesConfig({ cwd: process.cwd() })
```

Options include `cwd`, `configPath`, and `skipValidation`. Use
`skipValidation` only for tooling that needs to inspect partially-authored
config files.

`plugins` is returned in declaration order. Each entry is a package specifier
or `[specifier, options]`; the CLI plugin host resolves it relative to
`configPath`.
