# Configuration Reference

Palamedes config files are loaded by `@palamedes/config`, the CLI, and the
framework plugins.

Supported file names:

- `palamedes.config.ts`
- `palamedes.config.js`
- `palamedes.config.mjs`
- `palamedes.config.cjs`

## Minimal Config

```ts
import { defineConfig } from "@palamedes/config"

export default defineConfig({
  locales: ["en", "de"],
  sourceLocale: "en",
  catalogs: [
    {
      path: "src/locales/{locale}",
      include: ["src"],
    },
  ],
})
```

## Fields

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `locales` | Yes | `string[]` | All locale codes known to the project. Must include `sourceLocale`. |
| `sourceLocale` | Yes | `string` | Locale used by source messages. |
| `catalogs` | Yes | `PalamedesCatalogConfig[]` | Catalog locations and source scan patterns. |
| `fallbackLocales` | No | `string[] \| Record<string, string[]>` | Shared or per-locale fallback chain. |
| `pseudoLocale` | No | `string` | Locale code used for pseudo-localized UI testing. |

## Catalogs

```ts
interface PalamedesCatalogConfig {
  path: string
  include: string[]
  exclude?: string[]
}
```

`path` should include `{locale}` and points to the catalog path without the
`.po` extension.

`include` and `exclude` are resolved relative to the config file directory.
When an include entry is a directory-like path, extraction scans JavaScript and
TypeScript files below it.

## Fallback Locales

One shared fallback chain:

```ts
fallbackLocales: ["en"]
```

Per-locale fallback chain:

```ts
fallbackLocales: {
  "de-CH": ["de", "en"],
  de: ["en"],
}
```

The config helper removes self-fallbacks from a locale chain.

## Pseudo Locale

```ts
export default defineConfig({
  locales: ["en", "de", "pseudo"],
  sourceLocale: "en",
  pseudoLocale: "pseudo",
  catalogs: [{ path: "src/locales/{locale}", include: ["src"] }],
})
```

Plugin integrations pass `pseudoLocale` through to catalog compilation and skip
`failOnMissing` failures for that locale.
