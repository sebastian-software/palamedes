# CLI Reference

The `@palamedes/cli` package publishes `pmds`.
It is a native Rust binary; npm is only a distribution mechanism.

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

| Option                | Description                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| `-c, --config <path>` | Use a specific config file.                                                                        |
| `-w, --watch`         | Re-run extraction on file changes.                                                                 |
| `--clean`             | Remove obsolete entries with `obsolete-since` at least 30 days old; keep undated obsolete entries. |
| `--force-clean`       | Remove all obsolete entries immediately, including undated entries.                                |
| `-v, --verbose`       | Print verbose extraction details.                                                                  |

## `pmds audit`

Audits catalogs for missing translations and ICU authoring issues.

```bash
pmds audit
pmds audit --locale de fr
pmds audit --json
pmds audit --fail-on warning
```

Options:

| Option                 | Description                                     |
| ---------------------- | ----------------------------------------------- |
| `-c, --config <path>`  | Use a specific config file.                     |
| `--locale <locale...>` | Audit only selected target locales.             |
| `--json`               | Print the machine-readable audit result.        |
| `--fail-on <level>`    | Fail on `error` or `warning`. Default: `error`. |

## `pmds catalog merge`

Merges catalog files with Palamedes catalog semantics. This is suitable for
Git merge-driver workflows.

```bash
pmds catalog merge ours.po theirs.po --output merged.po
pmds catalog merge %A %B --base %O --output %A --format po --conflict-strategy use-first
pmds catalog merge ours.fcl theirs.fcl --output merged.fcl --format fcl
```

Options:

| Option                           | Description                                                      |
| -------------------------------- | ---------------------------------------------------------------- |
| `--output <path>`                | Required output path.                                            |
| `-c, --config <path>`            | Use a specific config file when inferring `sourceLocale`.        |
| `--format <format>`              | `po` or `fcl`. Inferred from paths when omitted.                 |
| `--base <path>`                  | Optional ancestor catalog path supplied by Git merge drivers.    |
| `--conflict-strategy <strategy>` | `use-first`, `use-last`, or `error`.                             |
| `--source-locale <locale>`       | Source locale for catalog semantics. Defaults to config or `en`. |
| `--locale <locale>`              | Locale of the merged catalog.                                    |

## `pmds catalog convert`

Converts supported PO catalogs to Ferrocat Catalog Lines (FCL). Conversion
fails before writing output when a PO source contains raw `fuzzy` flags.

```bash
pmds catalog convert src/locales/de.po --to fcl --output src/locales/de.fcl
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

## `pmds version`

Prints the installed CLI version.

```bash
pmds version
```
