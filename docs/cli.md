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
pmds extract --watch
pmds extract --verbose
```

Options:

| Option                | Description                                                       |
| --------------------- | ----------------------------------------------------------------- |
| `-c, --config <path>` | Use a specific config file.                                       |
| `-w, --watch`         | Re-run extraction on file changes.                                |
| `--clean`             | Remove obsolete catalog entries instead of marking them obsolete. |
| `-v, --verbose`       | Print verbose extraction details.                                 |

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

Merges two catalog files with Palamedes catalog semantics. This is suitable for
Git merge-driver workflows.

```bash
pmds catalog merge ours.po theirs.po --output merged.po
pmds catalog merge %A %B --output %A --format po --conflict-strategy use-first
```

Options:

| Option                           | Description                                                      |
| -------------------------------- | ---------------------------------------------------------------- |
| `--output <path>`                | Required output path.                                            |
| `-c, --config <path>`            | Use a specific config file when inferring `sourceLocale`.        |
| `--format <format>`              | `po` or `ndjson`. Inferred from paths when omitted.              |
| `--conflict-strategy <strategy>` | `use-first`, `use-last`, or `error`.                             |
| `--source-locale <locale>`       | Source locale for catalog semantics. Defaults to config or `en`. |
| `--locale <locale>`              | Locale of the merged catalog.                                    |

## `pmds version`

Prints the installed CLI version.

```bash
pmds version
```
