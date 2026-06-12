# `@palamedes/config`

`@palamedes/config` loads and validates `palamedes.config.*` files.

## Exports

- `defineConfig(config)`
- `loadPalamedesConfig(options?)`
- `CONFIG_FILENAMES`
- `expandFallbackLocales(locales, fallbackLocales?)`
- `resolveCatalogPath(config, catalogPath, locale)`
- `resolveConfigPattern(config, pattern)`
- `PalamedesConfig`
- `LoadedPalamedesConfig`
- `PalamedesCatalogConfig`
- `PalamedesFallbackLocales`

## Config Files

Supported file names:

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
})
```

## `loadPalamedesConfig(options?)`

Searches from `cwd` for a supported config file unless `configPath` is passed.
The returned object includes `configPath` and `rootDir`.

```ts
const config = await loadPalamedesConfig({ cwd: process.cwd() })
```
