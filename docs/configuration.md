# Configuration Reference

Palamedes uses `palamedes.yaml` as the canonical config file. The native
`pmds` CLI loads data-only config files and does not execute JavaScript or
TypeScript config. Supported file names are `palamedes.yaml`, `palamedes.yml`,
`palamedes.json`, and `palamedes.toml`.

`@palamedes/config` and framework plugins load the same data-only files. They
can still load existing `palamedes.config.ts`, `.js`, `.mjs`, and `.cjs` files
for compatibility.

## Minimal Config

```yaml
locales: [en, de]
source-locale: en
catalogs:
  - path: src/locales/{locale}
    include: [src]
```

PO remains the default storage format. Use FCL when you want Ferrocat Catalog
Lines as the generated, canonical, merge-friendly catalog storage:

```yaml
catalogs:
  - path: src/locales/{locale}
    format: fcl
    include: [src]
```

## Fields

| Field                   | Required | Type                                   | Notes                                                                               |
| ----------------------- | -------- | -------------------------------------- | ----------------------------------------------------------------------------------- |
| `locales`               | Yes      | `string[]`                             | All locale codes known to the project. Must include `source-locale`.                |
| `source-locale`         | Yes      | `string`                               | Locale used by source messages.                                                     |
| `catalogs`              | Yes      | catalog array                          | Catalog locations and source scan patterns.                                         |
| `fallback-locales`      | No       | `string[] \| Record<string, string[]>` | Shared or per-locale fallback chain.                                                |
| `pseudo-locale`         | No       | `string`                               | Locale code used for pseudo-localized UI testing.                                   |
| `source-reference-root` | No       | `git \| config \| lingui \| path`      | Root used for catalog source references. Defaults to nearest Git root, then config. |
| `plugins`               | No       | `(string \| [string, options])[]`      | Explicit CLI plugin packages. Never auto-discovered.                                |

The native CLI and JS config loader also accept snake_case aliases for
hyphenated config keys: `source_locale`, `fallback_locales`, `pseudo_locale`,
and `source_reference_root`.

## Catalogs

```yaml
catalogs:
  - path: src/locales/{locale}
    include: [src]
    exclude: [src/generated]
```

`path` should include `{locale}` and points to the catalog path without the
storage extension. Palamedes appends `.po` by default or `.fcl` when
`format: fcl` is set.

`format` accepts `po` and `fcl`. `ndjson` is no longer supported; use `fcl`
for Ferrocat Catalog Lines.

See [Catalog formats](./catalog-formats.md) for the product boundary between
PO storage, FCL storage, and the current framework `.po` import loaders.

`include` and `exclude` are resolved relative to the config file directory.
When an include entry is a directory-like path, extraction scans JavaScript and
TypeScript files below it.

When `exclude` is empty, the native CLI implicitly excludes
`**/node_modules/**`.

## Source References

`source-reference-root` controls the root used for PO `#:` references written by
`pmds extract`.

```yaml
source-reference-root: git
```

Values:

- `git`: nearest Git repository root, falling back to the config directory.
- `config` or `lingui`: config-directory relative references.
- Any other string: path resolved relative to the config directory.

## Fallback Locales

One shared fallback chain:

```yaml
fallback-locales: [en]
```

Per-locale fallback chain:

```yaml
fallback-locales:
  de-CH: [de, en]
  de: [en]
```

The config helper removes self-fallbacks from a locale chain.

## Pseudo Locale

```yaml
locales: [en, de, pseudo]
source-locale: en
pseudo-locale: pseudo
catalogs:
  - path: src/locales/{locale}
    include: [src]
```

Plugin integrations pass `pseudo-locale` through to catalog compilation and skip
`failOnMissing` failures for that locale.

## CLI Plugins

CLI plugins are opt-in and register namespaced commands. A declaration is either
a package specifier or a `[specifier, options]` pair:

```yaml
plugins:
  - "@acme/palamedes-workflows"
  - ["./local-workflows.mjs", { policy: strict }]
```

The npm CLI resolves each specifier relative to this config file. Built-in
commands do not load plugin code. Configuring a plugin grants it the same local
permissions as another project build script; the plugin host is not a sandbox.
Plugin-command dispatch uses `@palamedes/config`, so legacy
`palamedes.config.ts/js/mjs/cjs` files remain available there even though native
built-in commands intentionally accept only data config files.

See [CLI plugins](./api/cli-plugin.md) for the command and author API.

## Other Data Formats

YAML is the documented default because it is concise for hand-authored project
config. The same schema can also be written as JSON or TOML.

```json
{
  "locales": ["en", "de"],
  "source-locale": "en",
  "catalogs": [
    {
      "path": "src/locales/{locale}",
      "include": ["src"]
    }
  ]
}
```

```toml
locales = ["en", "de"]
source-locale = "en"

[[catalogs]]
path = "src/locales/{locale}"
include = ["src"]
```
