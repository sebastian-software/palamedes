# @palamedes/config

[![npm version](https://img.shields.io/npm/v/%40palamedes%2Fconfig?logo=npm)](https://www.npmjs.com/package/@palamedes/config)
[![CI](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml)
[![Sponsored by Sebastian Software](https://img.shields.io/badge/Sponsored%20by-Sebastian%20Software-0f172a.svg)](https://oss.sebastian-software.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f172a.svg)](https://github.com/sebastian-software/palamedes/blob/main/LICENSE)

Lean config loading for Palamedes projects.

Use `@palamedes/config` when framework integrations need to load Palamedes
config files. It supports canonical `palamedes.yaml` files, secondary
`palamedes.yml`, `palamedes.json`, and `palamedes.toml` data files, and the
legacy `palamedes.config.ts/js/mjs/cjs` TypeScript/JavaScript formats.

## Minimal Example

```yaml
locales: [en, de]
source-locale: en
source-reference-root: git
catalogs:
  - path: src/locales/{locale}
    include: [src]
```

## Exports

- `defineConfig(config)`
- `loadPalamedesConfig(options?)`
- `CONFIG_FILENAMES`
- `expandFallbackLocales(locales, fallbackLocales?)`
- `resolveCatalogPath(config, catalogPath, locale)`
- `resolveConfigPattern(config, pattern)`

## Configuration Notes

- `fallback-locales` defines the fallback chain for missing translations. It can
  be one shared array or a per-locale map.
- `pseudo-locale` marks a generated pseudo-locale used for layout and hardcoded
  string checks. Plugin integrations skip `failOnMissing` failures for that
  locale while keeping strict checks for real locales.
- `source-reference-root` controls the root used for PO `#:` source references.
  The default is `"git"`, which emits paths relative to the nearest Git
  repository root and falls back to the config directory when no Git root is
  available. Use `"lingui"` or `"config"` for Lingui-compatible references
  relative to the config directory, or pass a custom path.
- `catalogs[].format` defaults to `"po"`. Set it to `"fcl"` to use Ferrocat
  Catalog Lines for canonical, merge-friendly generated catalog storage.
- `loadPalamedesConfig()` returns `sourceReferenceRoot` in addition to
  `configPath` and `rootDir`; pass `skipValidation` only when inspecting a
  partially-authored config file.

See [Catalog formats](https://github.com/sebastian-software/palamedes/blob/main/docs/catalog-formats.md)
for the PO/FCL storage boundary.

See [Pseudo-localization and fallback locales](https://github.com/sebastian-software/palamedes/blob/main/docs/pseudo-localization.md)
for examples and the recommended development workflow.

## License

[![Sebastian Software](https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg)](https://oss.sebastian-software.com/)

MIT © 2026 Sebastian Software
