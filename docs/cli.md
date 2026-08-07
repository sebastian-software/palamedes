# CLI Reference

The `@palamedes/cli` package publishes `pmds`. Its npm launcher selects the
installed platform binary; the native Rust executable owns built-in and plugin
command dispatch.

## Plugin Commands

Plugins register a namespace plus commands. They are invoked as:

```bash
pmds <plugin> <command> [...args]
pmds <plugin> <command> --json [...args]
pmds <plugin> <command> --config ./palamedes.yaml [...args]
```

`--json`, `--config`, and `-c` are reserved host options after the command; put
`--` before them to pass them through as plugin arguments. Unknown namespaces
produce the native plugin host's unknown-namespace diagnostic.

Plugin loading is explicit, binary-only, and applies only to non-built-in
namespaces. See the [configuration field](./configuration.md#cli-plugins) and
the [binary plugin protocol](./api/cli-binary-plugin.md).

## `pmds extract`

Extracts messages from configured source files and writes source-string-first
catalogs.

```bash
pmds extract
pmds extract --config ./palamedes.yaml
pmds extract --clean
pmds extract --force-clean
pmds extract --check
pmds extract --check --json
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
| `--check`             | Exit unsuccessfully when extraction would create or modify a catalog, without writing catalog files. Cannot be combined with `--watch`.                      |
| `--json`              | With `--check`, print one deterministic result document.                                                                                                     |
| `--threads <COUNT>`   | Worker threads for the parallel extraction pass. Overrides `extract-threads` in the config; defaults to `4`; `1` runs serial.                                |
| `--no-cache`          | Ignore and do not write the extraction cache in `.palamedes/`. Use for a cold run; the cache is on by default.                                               |
| `-v, --verbose`       | Print verbose extraction details.                                                                                                                            |

`--check` runs the normal source discovery, extraction, catalog projection,
obsolete-entry policy, metadata generation, and PO/FCL serialization in memory.
It compares the exact resulting bytes with each configured catalog. Catalog
files, missing catalog directories, and catalog modification times remain
unchanged. The source-analysis cache may still be populated; add `--no-cache`
when the entire check must avoid cache writes.

`--clean` and `--force-clean` keep their normal meaning in check mode. If both
are present, `--force-clean` wins. Because regular extraction does not delete
catalog files, the current catalog change kinds are `created` and `modified`;
cleanup flags remove obsolete entries inside the projected file.

JSON paths are relative to the configuration root when possible, use `/` as
the separator, and are sorted deterministically:

```json
{
  "status": "drift",
  "catalogs": [
    { "path": "catalogs/de/messages.fcl", "change": "modified" },
    { "path": "locales/de/messages.po", "change": "created" }
  ]
}
```

A clean result uses `{ "status": "clean", "catalogs": [] }`. An extraction
or configuration failure uses status `error`, an empty `catalogs` array, and
`error.message`. Exit code `0` means clean, `1` means the check could not run,
`2` is reserved by Clap for invalid command-line usage, and `3` means catalog
drift. A minimal CI check is:

```bash
pnpm exec pmds extract --check --json
```

## `pmds lint`

Checks Palamedes source authoring without creating or updating catalogs. It
uses the union of the configured `catalogs[].include` and `exclude` file sets,
deduplicates overlapping catalogs, and supports JS, TS, JSX, TSX, and MDX.

```bash
pmds lint
pmds lint --json
pmds lint --fail-on warning
```

Options:

| Option                | Description                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `-c, --config <path>` | Use a specific config file.                                                                                         |
| `--json`              | Print one deterministic result document.                                                                            |
| `--fail-on <level>`   | Fail on `error` or `warning`. Default: `error`.                                                                     |
| `--threads <COUNT>`   | Worker threads for bounded parallel source analysis. Overrides `extract-threads`; defaults to `4`; `1` runs serial. |
| `--no-cache`          | Ignore and do not write the shared source-analysis cache.                                                           |

Human diagnostics contain file, line, column, severity, stable code, message,
and actionable help. JSON contains `diagnostics`, `failedFiles`, and a
`summary` with file and severity counts plus the number of suppressed findings.
Diagnostics are ordered by file, byte range, and code; failed files are ordered
by file. The document shape is stable:

```json
{
  "diagnostics": [
    {
      "code": "pmds/no-placeholder-only-message",
      "severity": "warning",
      "file": "src/view.tsx",
      "primary": { "start": 91, "end": 103, "line": 3, "column": 14 },
      "message": "This message contains placeholders but no translatable text.",
      "help": "Move translation to the surrounding authored sentence, or remove the translation macro if this value should be rendered as-is."
    }
  ],
  "failedFiles": [],
  "summary": {
    "files": 1,
    "errors": 0,
    "warnings": 1,
    "infos": 0,
    "suppressed": 0,
    "failedFiles": 0
  }
}
```

Exit code `0` means the configured threshold passed. Exit code `4` means lint
completed and either diagnostics met the configured `--fail-on` threshold
(whether errors alone or errors and warnings) or one or more source files could
not be analyzed. Exit code `1` means configuration, I/O, or output execution
failed before lint could produce its result. Exit code `2` remains reserved by
Clap for invalid command-line usage. This mirrors `extract --check`: a completed
verdict has a dedicated code that CI can distinguish from a command that could
not run.

Suppressions are deliberately code-specific and line-scoped. A directive must
start immediately after a supported comment opener, allowing whitespace but no
other text. JS and TS accept `//` and `/* ... */`; JSX and TSX accept those
forms including JSX `{/* ... */}`; MDX accepts HTML `<!-- ... -->` and JSX
`{/* ... */}`. MDX fenced code blocks are always ignored so documentation
examples cannot become unused suppressions.

```tsx
// palamedes-lint-disable-next-line pmds/no-placeholder-only-message
const label = t`${status}`

const inline = t`${status}` // palamedes-lint-disable-line pmds/no-placeholder-only-message
```

Unknown codes, directives without a code, and valid suppressions that no longer
match a finding are reported by `pmds lint`.
The default `.palamedes/extract-cache.json` stores compatible messages and
diagnostics together, so `extract` and `lint` can reuse the same native parse.
Lint follows extraction's bounded parallel read/parse model. Workers only
observe the immutable cache; results are suppressed, merged, and inserted into
the cache serially in source-file order, so cold, warm, and repeated runs keep
the same diagnostic output.

## `pmds audit`

Audits catalogs for missing translations, fuzzy review markers, and ICU
authoring issues across PO and FCL.

```bash
pmds audit
pmds audit --locale de fr
pmds audit --locale de,fr
pmds audit --json
pmds audit --fail-on warning
pmds audit --fail-on info
```

Options:

| Option                 | Description                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `-c, --config <path>`  | Use a specific config file.                                                                  |
| `--locale <locale...>` | Audit only selected target locales. Space-separated and comma-separated values are accepted. |
| `--json`               | Print the machine-readable audit result.                                                     |
| `--fail-on <level>`    | Fail on `error`, `warning`, or `info`. Default: `error`.                                     |

`--fail-on info` makes informational diagnostics such as
`catalog.fuzzy_flag` fail the command, which is useful when CI must reject every
catalog entry that still carries a review marker. The default remains
`--fail-on error`.

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
pmds catalog merge ours.po theirs.po --base base.po --output merged.po
pmds catalog merge-driver %O %A %B %A --path %P --conflict-strategy use-first
pmds catalog merge ours.fcl theirs.fcl --output merged.fcl
```

`pmds catalog merge` requires exactly two current input catalogs. Without
`--base`, they are combined in precedence order. With `--base`, the command
performs a deletion-aware three-way merge with explicit ancestor, ours (first
input), and theirs (second input) roles:

- an entry absent from both current sides stays deleted;
- a deletion wins when the other side is unchanged from the ancestor;
- an entry modified on one side and deleted on the other follows
  `--conflict-strategy` and emits `combine.modify_delete_resolved` when resolved;
- entries newly added on either side are retained; and
- an entry changed on only one side is accepted without a translation conflict.

`use-first` selects ours and `use-last` selects theirs for translation and
modify/delete conflicts. `error` rejects the merge. Parse errors and rejected
conflicts leave the output file unchanged. PO and FCL use the same identity and
deletion rules; identity is the source message plus optional gettext context.

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
| `--format <format>`              | `po` or `fcl`. Overrides path inference when supplied.           |
| `--base <path>`                  | Optional common ancestor for a three-way merge.                  |
| `--conflict-strategy <strategy>` | `use-first`, `use-last`, or `error`. Default: `use-first`.       |
| `--source-locale <locale>`       | Source locale for catalog semantics. Defaults to config or `en`. |
| `--locale <locale>`              | Locale of the merged catalog.                                    |
| `--path <path>`                  | Real catalog pathname; pass `%P` in a Git merge driver.          |

### Git merge driver

Use `catalog merge-driver` for Git instead of reconstructing role handling in
a wrapper script:

```bash
git config merge.palamedes-catalog.driver \
  'pmds catalog merge-driver %O %A %B %A --path %P --conflict-strategy use-first'
```

During a normal merge, Git's `%A` is logical ours and `%B` is theirs. During a
rebase, Git internally assigns the upstream side to `%A` and the commit being
replayed to `%B`. `merge-driver` detects the active rebase and swaps those
inputs before calling the Core API, so `use-first` consistently means “the
branch being merged or rebased wins.” Use `--operation merge` or
`--operation rebase` to override auto-detection in unusual Git orchestration.

The positional arguments are ancestor (`%O`), Git current file (`%A`), Git
other file (`%B`), and output (`%A`). `--path %P` selects the real configured
catalog so its PO formatting options are applied to the output and, when
`--format` is omitted, determines whether the extensionless Git temp files are
PO or FCL. This one driver supports mixed PO/FCL repositories. Outside a merge
driver, omit `--path` and format inference continues to use the input/output
catalog paths.

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
`.toml`). When the upward search finds only a JavaScript or TypeScript config,
the CLI reports that specifically instead of a generic not-found error — create
a data config next to it for CLI use. Known keys written in camelCase
(`sourceLocale`, `pseudoLocale`, `fallbackLocales`, `sourceReferenceRoot`,
`referenceScopes`) are rejected with a kebab-case hint instead of being
silently ignored; other unknown top-level keys produce a warning.
Fallback-locale entries must reference configured locales, and a
`pseudo-locale` outside `locales` warns that it will be ignored.
