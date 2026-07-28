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
| `reference-scopes`      | No       | `boolean`                              | Adds stable source scopes to catalog references. Defaults to `true`.                |
| `mdx`                   | No       | MDX options                            | Shared native MDX extraction and Vite compilation behavior.                         |
| `plugins`               | No       | `(string \| [string, options])[]`      | Explicit CLI plugin packages. Never auto-discovered.                                |
| `extract-threads`       | No       | `number`                               | Worker threads for the parallel extraction pass. Defaults to `4`; `1` runs serial.  |
| `extract-cache`         | No       | `boolean`                              | Reuse the on-disk extraction cache. Defaults to `true`.                             |

The native CLI and JS config loader both accept snake_case aliases for these
hyphenated config keys: `source_locale`, `fallback_locales`, `pseudo_locale`,
`source_reference_root`, and `reference_scopes`.

`extract-threads` and `extract-cache` (and their `extract_threads` /
`extract_cache` aliases) are read by the native `pmds` CLI only. They tune
extraction, which the CLI owns; the JS config loader in `@palamedes/config`
ignores them, and no bundler plugin reads them.

`extract-threads` bounds the parallel read/parse pass. The default of `4` is a
measured floor rather than a core count: extraction gets slower again above it,
because a one-shot `pmds extract` pays worker setup on every invocation and
never amortizes it. Raise it only with a measurement on your own corpus and
hardware; see
[ADR-013](https://github.com/sebastian-software/palamedes/blob/main/adr/013-bounded-parallel-extraction.md)
for the numbers. `--threads` on the command line overrides this value.

`extract-cache` controls whether extraction reuses its own results for files
that have not changed. The cache lives at `.palamedes/extract-cache.json` under
the project root — add `.palamedes/` to your `.gitignore`. Entries are validated
with a `stat` (size and modification time), so a repeat run skips both reading
and parsing unchanged files; watch mode holds the cache for the life of the
process. It is discarded automatically whenever the extractor version, source
reference root, or extraction-relevant MDX options change. Use `--no-cache` for a one-off cold run, or set
this to `false` if a tool in your pipeline rewrites files without changing their
size or modification time. See
[ADR-019](https://github.com/sebastian-software/palamedes/blob/main/adr/019-extraction-cache.md).

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
When an include entry is a directory-like path, extraction scans JavaScript,
TypeScript, and MDX files below it.

When `exclude` is empty, the native CLI implicitly excludes
`**/node_modules/**`.

## MDX

The optional `mdx` object is shared by native catalog extraction and Vite
compilation:

```yaml
mdx:
  framework: react
  translatable-attributes: [alt, title]
  front-matter-fields: [title, description]
  ignore-directive: palamedes-ignore
```

See [MDX messages](./mdx.md) for authoring semantics, framework setup, all
options, diagnostics, and the native architecture boundary.

## Source References

`source-reference-root` controls the root used for catalog references written by
`pmds extract`. `reference-scopes` controls whether those references include a
stable component or function suffix.

```yaml
source-reference-root: git
reference-scopes: true
```

Values:

- `git`: nearest Git repository root, falling back to the config directory.
- `config` or `lingui`: config-directory relative references.
- Any other string: path resolved relative to the config directory.

`reference-scopes` defaults to `true`, producing references such as
`src/App.tsx#CheckoutButton`. Set it to `false` for file-only references such as
`src/App.tsx`. When disabled, Palamedes skips source-scope extraction while
retaining file references. The setting applies to both PO `#:` references and
FCL `r=` tags.

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
