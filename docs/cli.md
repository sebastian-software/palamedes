# CLI Reference

The `@palamedes/cli` package publishes `pmds`.
Built-in commands execute in the native Rust sidecar. The npm wrapper also hosts
explicitly configured third-party command plugins.

## Plugin Commands

Plugins register a namespace plus commands. They are invoked as:

```bash
pmds <plugin> <command> [...args]
pmds <plugin> <command> --json [...args]
pmds <plugin> <command> --config ./palamedes.yaml [...args]
```

`--json`, `--config`, and `-c` are reserved host options after the command; put
`--` before them to pass them through as plugin arguments. Unknown namespaces
fall back to the native CLI's normal unknown-command diagnostic.

Plugin loading is explicit and applies only to non-built-in namespaces. See the
[configuration field](./configuration.md#cli-plugins), the
[`@palamedes/cli/plugin` API](./api/cli-plugin.md), and the
[binary plugin protocol](./api/cli-binary-plugin.md) for executable plugins.

## `pmds extract`

Extracts messages from configured source files and writes source-string-first
catalogs.

```bash
pmds extract
pmds extract --config ./palamedes.yaml
pmds extract --clean
pmds extract --force-clean
pmds extract --watch
pmds extract --verbose
```

Options:

| Option                | Description                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `-c, --config <path>` | Use a specific config file.                                                                                                                                  |
| `-w, --watch`         | Re-run extraction on file changes (debounced). Fatal authoring errors are printed and watching continues; the config file is watched and reloaded on change. |
| `--clean`             | Remove obsolete entries with `obsolete-since` at least 30 days old; keep undated obsolete entries.                                                           |
| `--force-clean`       | Remove all obsolete entries immediately, including undated entries.                                                                                          |
| `--threads <COUNT>`   | Worker threads for the parallel extraction pass. Overrides `extract-threads` in the config; defaults to `4`; `1` runs serial.                                |
| `--no-cache`          | Ignore and do not write the extraction cache in `.palamedes/`. Use for a cold run; the cache is on by default.                                               |
| `-v, --verbose`       | Print verbose extraction details.                                                                                                                            |

## `pmds audit`

Audits catalogs for missing translations, fuzzy review markers, and ICU
authoring issues across PO and FCL.

```bash
pmds audit
pmds audit --locale de fr
pmds audit --locale de,fr
pmds audit --json
pmds audit --fail-on warning
```

Options:

| Option                 | Description                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `-c, --config <path>`  | Use a specific config file.                                                                  |
| `--locale <locale...>` | Audit only selected target locales. Space-separated and comma-separated values are accepted. |
| `--json`               | Print the machine-readable audit result.                                                     |
| `--fail-on <level>`    | Fail on `error` or `warning`. Default: `error`.                                              |

## `pmds report`

Reports per-locale translation completeness from configured catalogs. Source
locale entries count as translated; target locales are compared against the
source catalog messages that are not obsolete. PO and FCL entries marked
`fuzzy` need review and count as untranslated (reported in a separate `fuzzy`
column).

```bash
pmds report
pmds report --locale de fr
pmds report --locale de,fr --json
pmds report --fail-if-below 95
```

Options:

| Option                      | Description                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------- |
| `-c, --config <path>`       | Use a specific config file.                                                           |
| `--locale <locale...>`      | Report only selected target locales. Space-separated and comma-separated values work. |
| `--json`                    | Print the machine-readable completeness report.                                       |
| `--fail-if-below <percent>` | Fail when any reported locale is below this translated percentage.                    |

## `pmds catalog merge`

Merges catalog files with Palamedes catalog semantics. This is suitable for
Git merge-driver workflows.

```bash
pmds catalog merge ours.po theirs.po --output merged.po
pmds catalog merge %A %B --base %O --output %A --path %P --format po --conflict-strategy use-first
pmds catalog merge ours.fcl theirs.fcl --output merged.fcl --format fcl
```

`pmds catalog merge` requires exactly two input catalogs in precedence order.

Merged PO catalogs are written in the same order and shape as an extraction
produces, so a resolved conflict does not land as a fully re-sorted file that
the next `pmds extract` sorts back. Applying the catalog's own `po` options
needs to know which configured catalog is being merged, and a Git merge driver
only ever sees temporary files — pass `%P` through `--path` for that. Without
it the output path is used, which is enough outside a merge driver.

Options:

| Option                           | Description                                                      |
| -------------------------------- | ---------------------------------------------------------------- |
| `--output <path>`                | Required output path.                                            |
| `-c, --config <path>`            | Use a specific config file when inferring `source-locale`.       |
| `--format <format>`              | `po` or `fcl`. Inferred from paths when omitted.                 |
| `--base <path>`                  | Optional ancestor catalog path supplied by Git merge drivers.    |
| `--conflict-strategy <strategy>` | `use-first`, `use-last`, or `error`. Default: `use-first`.       |
| `--source-locale <locale>`       | Source locale for catalog semantics. Defaults to config or `en`. |
| `--locale <locale>`              | Locale of the merged catalog.                                    |
| `--path <path>`                  | Real catalog pathname; pass `%P` in a Git merge driver.          |

## `pmds catalog convert`

Converts supported PO catalogs to Ferrocat Catalog Lines (FCL). Translator
comments, obsolete state, and review markers such as `fuzzy` are preserved.
The output file is replaced only after conversion succeeds.

```bash
pmds catalog convert src/locales/de.po --to fcl --output src/locales/de.fcl
pmds catalog convert src/locales/de.po --to fcl --locale de
pmds catalog convert --config palamedes.yaml --to fcl
```

Config mode writes `.fcl` files beside existing `.po` files and leaves the
source catalogs untouched. Update the catalog config afterwards:

```yaml
catalogs:
  - path: src/locales/{locale}
    format: fcl
    include: [src]
```

See [Catalog formats](./catalog-formats.md) for when to keep PO storage and
when to opt into FCL.

Options:

| Option                     | Description                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `<input>`                  | Optional input catalog for single-file conversion.                                          |
| `-c, --config <path>`      | Convert configured PO catalogs. Cannot be combined with `--output`.                         |
| `--to <format>`            | Target format. Currently `fcl`.                                                             |
| `--output <path>`          | Output path for single-file conversion. Defaults to the input path with a `.fcl` extension. |
| `--source-locale <locale>` | Source locale for single-file conversion. Default: `en`.                                    |
| `--locale <locale>`        | Locale for single-file conversion.                                                          |

## `pmds version`

Prints the installed CLI version. `pmds --version` / `pmds -V` print the same
information.

```bash
pmds version
pmds --version
```

## Configuration Errors

The native CLI reads only data configs (`palamedes.yaml`, `.yml`, `.json`,
`.toml`). When the upward search finds only a `palamedes.config.ts`/`.js`, the
CLI reports that specifically instead of a generic not-found error — create a
data config next to it for CLI use. Known keys written in camelCase
(`sourceLocale`, `pseudoLocale`, `fallbackLocales`, `sourceReferenceRoot`,
`referenceScopes`) are rejected with a kebab-case hint instead of being
silently ignored; other unknown top-level keys produce a warning.
Fallback-locale entries must reference configured locales, and a
`pseudo-locale` outside `locales` warns that it will be ignored.
