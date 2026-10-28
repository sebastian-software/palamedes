# Configuration Reference

Palamedes uses `palamedes.yaml` as the canonical config file. The native
`pmds` CLI loads data-only config files and does not execute JavaScript or
TypeScript config. Supported file names are `palamedes.yaml`, `palamedes.yml`,
`palamedes.json`, and `palamedes.toml`.

`@palamedes/config` and framework plugins load the same data-only files. They
can still load existing `palamedes.config.ts`, `.js`, `.mjs`, and `.cjs` files
for compatibility. Local files imported by these executable legacy configs are
part of the config dependency graph: Vite, Next, and Remix watch and hash them,
so editing only an imported helper reloads the resolved configuration. Package
implementation files under `node_modules` are excluded from that project watch
graph.

## Adapter Paths

The Vite, Next.js, and Remix adapters use the same path options:

| Option              | Meaning                                                                                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projectRoot`       | Base for config discovery, a relative `configPath`, and relative `include`/`exclude` globs. Vite defaults to its resolved `root`; Next.js derives its project directory; Remix uses the working directory. |
| `configPath`        | Config file to load instead of searching. Relative paths resolve from `projectRoot`; absolute paths stay absolute.                                                                                         |
| `include`/`exclude` | Files the macro transform handles: a glob, a RegExp, or an array of both. Relative globs resolve from `projectRoot`; RegExps test the absolute file path.                                                  |

Without `configPath`, Vite and Next.js search upward from `projectRoot`. The
Remix Node hook searches upward from each imported catalog file. The adapter
`include`/`exclude` options select files for the macro transform. They are
separate from catalog `include`/`exclude`, which select source files for a
catalog and resolve from the config file directory. Palamedes v2 renamed the
adapter `cwd` option to `projectRoot`; `cwd` throws a migration error.

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

| Field                   | Required | Type                                   | Notes                                                                                       |
| ----------------------- | -------- | -------------------------------------- | ------------------------------------------------------------------------------------------- |
| `locales`               | Yes      | `string[]`                             | All locale codes known to the project. Must include `source-locale`.                        |
| `source-locale`         | Yes      | `string`                               | Locale used by source messages.                                                             |
| `catalogs`              | Yes      | catalog array                          | Catalog locations and source scan patterns.                                                 |
| `fallback-locales`      | No       | `string[] \| Record<string, string[]>` | Shared or per-locale fallback chain.                                                        |
| `pseudo-locale`         | No       | `string`                               | Locale code used for pseudo-localized UI testing.                                           |
| `source-reference-root` | No       | `git \| config \| lingui \| path`      | Root used for catalog source references. Defaults to nearest Git root, then config.         |
| `reference-scopes`      | No       | `boolean`                              | Adds stable source scopes to catalog references. Defaults to `true`.                        |
| `mdx`                   | No       | MDX options                            | Shared native MDX extraction and Vite compilation behavior.                                 |
| `lint`                  | No       | source lint options                    | Source-authoring rule levels used by `pmds lint`.                                           |
| `plugins`               | No       | `(string \| [string, options])[]`      | Explicit CLI plugin packages. Never auto-discovered.                                        |
| `extract-threads`       | No       | `number`                               | Worker threads for parallel extraction and lint analysis. Defaults to `4`; `1` runs serial. |
| `extract-cache`         | No       | `boolean`                              | Reuse the shared extraction/source-analysis cache. Defaults to `true`.                      |

The native CLI and JS config loader both accept snake_case aliases for these
hyphenated config keys: `source_locale`, `fallback_locales`, `pseudo_locale`,
`source_reference_root`, and `reference_scopes`.

`@palamedes/config` treats config objects as strict. Data configs use the
documented kebab-case keys (or their supported snake_case aliases), while
`palamedes.config.*` files use the camelCase JavaScript API names. Unless
`skipValidation` is explicitly used to inspect a partially authored config, an
unknown key at the top level or in `mdx`, `lint`, a catalog entry, or catalog
`po` options stops loading; close misspellings include a replacement hint. This
catches errors such as `fallbck-locales` before they silently change extraction
or runtime behavior. Data configs reserve `$schema` plus top-level keys prefixed
with `x-` or `.` for editor and tooling metadata; both the native CLI and the JS
loader ignore those values. For example, name a YAML anchor holder `x-defaults`
instead of adding an unprefixed `defaults` key. `skipValidation` remains the JS
tooling escape hatch for inspecting any other partially authored shape.

`extract-threads` and `extract-cache` (and their `extract_threads` /
`extract_cache` aliases) are read by the native `pmds` CLI only. They tune
extraction and lint source analysis, which the CLI owns; the JS config loader
in `@palamedes/config` ignores them, and no bundler plugin reads them.

`extract-threads` bounds the parallel read/parse pass. The default of `4` is a
measured floor rather than a core count: extraction gets slower again above it,
because a one-shot `pmds extract` pays worker setup on every invocation and
never amortizes it. Raise it only with a measurement on your own corpus and
hardware; see
[ADR-023](https://github.com/sebastian-software/palamedes/blob/main/adr/023-bounded-parallel-extraction.md)
for the numbers. `--threads` on `pmds extract` or `pmds lint` overrides this
value.

`extract-cache` controls whether extraction and source lint reuse their shared
analysis for files that have not changed. The cache lives at
`.palamedes/extract-cache.json` under the project root — add `.palamedes/` to
your `.gitignore`. Entries are validated with a `stat` (size and modification
time), so a repeat run skips parsing unchanged files; watch mode holds the cache
for the life of the process. It is discarded automatically whenever the
extractor version, source reference root, reference-scope behavior, MDX options,
or lint rule levels change. Use `--no-cache` on `pmds extract` or `pmds lint` for
a one-off cold run, or set this to `false` if a tool in your pipeline rewrites
files without changing their size or modification time. See
[ADR-022](https://github.com/sebastian-software/palamedes/blob/main/adr/022-extraction-cache.md).
If the cache cannot be persisted, the command continues with its normal result
but prints a warning to stderr even without `--verbose`; watch mode reports a
persistent write failure once per process rather than once per file event. Use
`--no-cache` or `extract-cache: false` when the cache location is intentionally
unwritable.

## Source Lint

`pmds lint` scans the same configured source files as extraction without
writing catalogs. Rule levels use `off`, `info`, `warning`, or `error`:

```yaml
lint:
  rules:
    placeholder-only: warning
    empty-component-only: off
    prefer-trans-in-jsx: info
```

Those are also the defaults. `placeholder-only` catches messages made only of
runtime values. `empty-component-only` is opt-in because component-only
authoring needs more project context. `prefer-trans-in-jsx` is an informational
readability suggestion for safe direct render positions; `t` remains fully
supported. Advanced dictionary and ambiguity policies are not part of this
open-source config surface.

## Catalogs

```yaml
catalogs:
  - path: src/locales/{locale}
    include: [src]
    exclude: [src/generated]
```

`path` should include `{locale}` and normally omits the storage extension.
Palamedes appends `.po` by default or `.fcl` when `format: fcl` is set. Dots in
the expanded path are preserved: `messages.v2` becomes `messages.v2.po`, and a
locale such as `pt.BR` becomes `pt.BR.po`. A matching configured `.po` or `.fcl`
suffix is accepted and is not duplicated; any other suffix remains part of the
catalog name before the configured format suffix.

`format` accepts `po` and `fcl`. `ndjson` is no longer supported; use `fcl`
for Ferrocat Catalog Lines.

PO catalogs also accept an output control:

```yaml
catalogs:
  - path: src/locales/{locale}
    include: [src]
    po:
      line-breaks: "off"
```

`line-breaks` accepts `auto` (the default) or `off`. `off` disables automatic
width folding for long `msgid` and `msgstr` values, so editing one word no
longer reflows the whole entry. Actual newline characters still use valid
multiline PO syntax.

Quote the value. A bare `off` is a string under YAML 1.2, which is what
Palamedes parses with, but YAML 1.1 tooling reads it as the boolean `false`.
Both spellings are accepted.

The `po` object is only valid for PO catalogs. JavaScript and TypeScript config
files use the equivalent camelCase shape:

```ts
{
  po: {
    lineBreaks: "off",
  },
}
```

## Catalog ordering

Catalog order is not configurable. Ferrocat sorts PO and FCL catalogs by source
message and then gettext context using the CLDR root collation — the same order
`Intl.Collator("en-US")` produces, because English carries no collation
tailoring of its own. That is what makes catalogs migrated from Lingui stay put
instead of re-sorting wholesale on the first extraction, and it is the only
order Palamedes writes, so there is nothing to keep in sync between formats or
projects.

Ordering is not locale-aware beyond root collation. Languages with genuinely
different collation (Swedish, Turkish, Czech and others) are not tailored for;
the catalog order follows the source message, which is the same in every locale
anyway.

Ferrocat implements the order with a generated table covering Latin text,
punctuation, symbols and digits rather than a full Unicode collation
implementation. Two consequences, both outside what source messages hold in
practice: ligatures and digraphs (`ﬁ`, `Ǆ`) sort by their own weight instead of
expanding to `fi` and `dz`, and characters outside the table sort after it by
code point. The placement of non-Latin scripts after Latin still matches root
collation; the order within them does not. Since this only decides the order
entries appear in, a miss costs a line in a diff rather than a wrong
translation. Ferrocat records the implementation and trade-offs in
[ADR 0026](https://ferrocat.dev/architecture/adr/0026-cldr-root-catalog-order).

See [Catalog formats](./catalog-formats.md) for the product boundary between
PO storage, FCL storage, and the current framework `.po` import loaders.

### Native CLI source patterns

`include` and `exclude` are resolved relative to the config file directory;
absolute patterns are also accepted. An existing directory in `include`
expands to a recursive scan for `.js`, `.jsx`, `.ts`, `.tsx`, `.mdx`, `.vue`,
and `.svelte` files. An explicit file or glob keeps its configured spelling.

The native CLI uses Ferralk's `PatternOptions::walker()` dialect with hidden
matching enabled and separator-crossing ordinary wildcards. A single `*` can
cross directory separators, so `app/*.tsx` also selects `app/nested/page.tsx`.
Hidden files and directories participate in matching. The same native
`PatternSet` contract decides which files extraction reads and which source
changes trigger watch mode.

Supported syntax includes recursive `**`, character classes and POSIX classes
such as `[[:digit:]]`, brace alternatives such as `*.{ts,tsx}`, and extglobs such
as `@(foo|bar).ts`. An empty brace alternative participates: `{,foo}.ts` selects
both `.ts` and `foo.ts`. A leading `!` remains literal path text; use `exclude`
for exclusions. `!(foo).ts` is a negated extglob.

Write `/` as the separator on every platform, including Windows. A backslash
escapes syntax on every platform: for example, the single-quoted YAML pattern
`'app/\[draft\].tsx'` selects the literal filename `[draft].tsx`. Project
root names containing glob syntax are escaped automatically. Relative `./`
and `../` prefixes resolve from the config directory; absolute globs are
accepted too. An explicitly configured existing directory is treated literally
before it expands to a recursive source pattern.

When `exclude` is empty, the CLI excludes `**/node_modules/**` under the config
root. A nonempty list replaces that default, so repeat it if it should still
apply. To exclude a subtree, use `src/generated/**`; a bare exclude directory
does not expand recursively. Invalid include or exclude syntax stops discovery
with a pattern diagnostic. Files are sorted and deduplicated across overlapping
includes.

Discovery includes symlinks to files and skips broken links. A directory
symlink explicitly named by an include is a scan root; directory symlinks
encountered below a scan root are not followed. Recoverable filesystem
traversal errors are skipped. See the
[Ferralk adoption assessment](./ferralk-adoption.md) for the migration examples,
contract fixtures, and bounded traversal measurement.

## MDX

The optional `mdx` object is shared by native catalog extraction and Vite
compilation:

```yaml
mdx:
  framework: react
  translatable-attributes: [alt, title]
  front-matter-fields: [title, description]
  ignore-directive: palamedes-ignore
  include-source-metadata: true
```

See [MDX messages](./mdx.md) for authoring semantics, framework setup, all
options, diagnostics, and the native architecture boundary.
`include-source-metadata` (default `false`) adds the authored source text to
generated MDX message lookups as diagnostic metadata. It does not provide
runtime fallbacks: a missing compiled message still throws. The Vite plugin
replaces this value with its own `includeSourceMetadata` option. The v1 key
`keep-source-fallbacks` is rejected with a migration error.

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
See [pseudo-localization](./pseudo-localization.md) for how Palamedes renders
that catalog for visual QA.

## CLI Plugins

CLI plugins are opt-in and register namespaced commands. A declaration is either
a package specifier or a `[specifier, options]` pair:

```yaml
plugins:
  - "@acme/palamedes-workflows"
  - ["./local-workflows", { policy: strict }]
```

The native CLI resolves each package or executable relative to this data config
and runs it through the binary plugin protocol. Built-in commands do not load
config or plugin code. Configuring a plugin grants it the same local permissions
as another project build tool; the plugin host is not a sandbox. JavaScript and
TypeScript files are rejected as plugin executables and are not CLI configs.

See the [binary plugin protocol](./api/cli-binary-plugin.md) for package layout,
commands, output, and the Rust author SDK.

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
