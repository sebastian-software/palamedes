# CLI Reference

The `@palamedes/cli` package publishes `pmds`. Its npm launcher selects the
installed platform binary; the native Rust executable owns built-in and plugin
command dispatch.

## Output Language

The native CLI loads external English, German, Spanish, and French catalogs for its help,
command summaries, progress messages, and host-owned operational errors. It
selects the first nonempty value in this order:

1. `PALAMEDES_UI_LOCALE` — an explicit UI-language override
2. `LC_ALL`
3. `LC_MESSAGES`
4. `LANG`

POSIX forms such as `de_DE.UTF-8@euro` and regional tags such as `es-MX` select
their supported base language. `C`, `POSIX`, invalid or unsupported values, and
an absent environment select English. An unsupported higher-priority value
does not fall through to another variable. Shells without POSIX locale variables,
including Windows shells, use English unless an override is provided.

```sh
LANG=de_DE.UTF-8 pmds --help
LANG=fr_FR.UTF-8 pmds --help
PALAMEDES_UI_LOCALE=es pmds report
PALAMEDES_UI_LOCALE=en pmds extract --check --json
```

In PowerShell, use `$env:PALAMEDES_UI_LOCALE = 'de'` before invoking `pmds`.
This setting controls the CLI's own output. Existing `--locale` options still
select catalog languages. Command names, flags, diagnostic codes, JSON documents,
raw values, and exit codes retain their existing contracts.

Compiler diagnostic details, third-party/OS error details, and plugin-owned
messages retain their original wording. Clap argument errors have a localized
summary followed by Clap's original technical details. These are separate from
the translated CLI presentation; their structured messages are not rewritten.

Translations live in `crates/palamedes-cli/locales/*.po`. Cargo uses
`palamedes-build`, Ferrocat's catalog compiler, and Palamedes's shared message
lowering to produce
`<locale>.pmd.json` files. Platform packages install them in `bin/pmds-locales/`
beside the executable. Only the selected locale is loaded, including English;
no translation catalog or source-text rendering fallback is embedded.
Set `PALAMEDES_UI_CATALOG_DIR` to override the directory. Discovery does not
depend on the project configuration or current working directory.

A missing, corrupt, wrong-locale, or incompatible catalog fails before command
execution with exit code 1. A fixed English bootstrap diagnostic names the UI
locale, every attempted file location, the cause, and a repair: reinstall the
executable with matching `pmds-locales/` assets, or set
`PALAMEDES_UI_CATALOG_DIR` to their directory. Decode and validation errors retain
the file path; format-version, locale, and contract-fingerprint mismatches are
reported separately. It does not load another language or substitute source text. Copying the native executable
also requires copying `pmds-locales/`. No Node runtime is required.

The CLI opts into `.fail_on_missing(true)`, so its missing or fuzzy translations
fail the build. The general Rust SDK defaults to build-time fallback resolution
and reports incomplete translations. Malformed ICU, placeholder mismatches, and
unsupported Rust constructs always fail compilation. The Rust runtime decodes prepared
instructions without a PO/ICU parser. Its current subset is literal text, display
arguments, string selects, and cardinal/ordinal plurals. Number/date/time formatting, rich text,
and translation contexts are rejected. JavaScript retains its broader feature set.

For source builds, `build.rs` writes only inside Cargo's `OUT_DIR`. The native
package builder reads the executable path and `out_dir` from Cargo's JSON messages,
then installs catalogs with the binary. This supports separate `build.build-dir`
and target directories. A bare `cargo build` does not install language assets;
run the native package build or explicitly set `PALAMEDES_UI_CATALOG_DIR` to the
reported `out_dir/catalogs` directory when launching an uninstalled executable.

The compilation summary itself uses plural messages in English, German, Spanish, and
French. Plural categories follow ICU4X/CLDR rules; `#` emits plain decimal output.
See [Rust plural messages](./rust-applications.md#plural-messages) for numeric
inputs, offsets, and the separate limits on number formatting.

## Rust Application Integration

The experimental `palamedes-build` and `palamedes-i18n` crates expose the external
catalog path used by the CLI. Follow the [Rust applications guide](./rust-applications.md)
for a complete Cargo example, deployment instructions, and the current feature
limits. The crates are not published on crates.io.

## Plugin Commands

Plugins register a namespace plus commands. They are invoked as:

```bash
pmds <plugin> <command> [...args]
pmds <plugin> <command> --json [...args]
pmds <plugin> <command> --config ./palamedes.yaml [...args]
pmds <plugin> <command> --refresh-plugin-manifests [...args]
```

`--json`, `--config`, `-c`, `--plugin-timeout-ms`, and
`--refresh-plugin-manifests` are reserved host options after the command; put
`--` before them to pass them through as plugin arguments. Unknown namespaces
produce the native plugin host's unknown-namespace diagnostic.

Plugin loading is explicit, binary-only, and applies only to non-built-in
namespaces. Validated manifests are cached under `.palamedes`; changed binaries
are described again, while cache failures fall back to the normal handshake.
`--refresh-plugin-manifests` ignores the cached entries once and replaces them
after describing every configured plugin again.
See the [configuration field](./configuration.md#cli-plugins) and the
[binary plugin protocol](./api/cli-binary-plugin.md).

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
pmds extract --fail-on-empty-catalog
pmds extract --watch
pmds extract --verbose
```

Options:

| Option                    | Description                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `-c, --config <path>`     | Use a specific config file.                                                                                                                                  |
| `-w, --watch`             | Re-run extraction on file changes (debounced). Fatal authoring errors are printed and watching continues; the config file is watched and reloaded on change. |
| `--clean`                 | Remove obsolete entries with `obsolete-since` at least 30 days old; keep undated obsolete entries.                                                           |
| `--force-clean`           | Remove all obsolete entries immediately, including undated entries.                                                                                          |
| `--check`                 | Exit unsuccessfully when extraction would create or modify a catalog, without writing catalog files. Cannot be combined with `--watch`.                      |
| `--json`                  | With `--check`, print one deterministic result document.                                                                                                     |
| `--fail-on-empty-catalog` | Fail an extraction cycle before any catalog update when a configured catalog matches no source files.                                                        |
| `--threads <COUNT>`       | Worker threads for the parallel extraction pass. Overrides `extract-threads` in the config; defaults to `4`; `1` runs serial.                                |
| `--no-cache`              | Ignore and do not write the extraction cache in `.palamedes/`. Use for a cold run; the cache is on by default.                                               |
| `-v, --verbose`           | Print verbose extraction details.                                                                                                                            |

Watch mode resolves project and include-directory symlinks to the filesystem
targets observed by the native watcher while continuing to apply include and
exclude patterns in their configured path space. A project reached through a
symlink and an included directory that is itself a symlink therefore receive
the same extraction updates as their one-shot equivalents.

`--check` runs the normal source discovery, extraction, catalog projection,
obsolete-entry policy, metadata generation, and PO/FCL serialization in memory.
It compares the exact resulting bytes with each configured catalog. Catalog
files, missing catalog directories, and catalog modification times remain
unchanged. The source-analysis cache may still be populated; add `--no-cache`
when the entire check must avoid cache writes.

Use `--fail-on-empty-catalog` in automated extraction pipelines that must treat
an empty source match as a configuration failure. Catalog projection starts
only after source discovery has succeeded, so one empty catalog exits with code
`1` before any catalog is written or marked obsolete.
Without the flag, the existing behavior remains: Palamedes warns and projects
that catalog from an empty message set. In `--check --json` mode the failure is
returned as status `error` with an empty `catalogs` array. Watch mode prints the
failure, leaves every catalog unchanged for that cycle, and keeps watching so a
later source change can recover.

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
pnpm exec pmds extract --check --json --fail-on-empty-catalog
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
other text; in block and HTML comments, that whitespace may continue onto the
directive's physical line. A `disable-next-line` directive in a multi-line
block or HTML comment applies to the first line after that comment closes. JS
and TS accept `//` and `/* ... */`; JSX and TSX
accept those forms including JSX `{/* ... */}`; MDX accepts HTML `<!-- ... -->`
and JSX `{/* ... */}`; JavaScript expressions in MDX also accept their native
`//` and `/* ... */` forms. Raw MDX template text and fenced code blocks are
always ignored so documentation examples cannot become unused suppressions.

```tsx
// palamedes-lint-disable-next-line pmds/no-placeholder-only-message
const label = t`${status}`;

const inline = t`${status}`; // palamedes-lint-disable-line pmds/no-placeholder-only-message
```

Unknown codes, directives without a code, and valid suppressions that no longer
match a finding are reported by `pmds lint`.

`palamedes-lint-disable-*` directives are consumed by `pmds lint` only. The
ESLint and Oxlint adapter in [`@palamedes/eslint-plugin`](./api/eslint-plugin.md)
leaves suppression handling to its host, so the same finding is silenced with
`eslint-disable-next-line palamedes/<rule>` or
`oxlint-disable-next-line palamedes/<rule>` there. The two forms do not
transfer: a project running both lanes needs the directive each lane
understands. The rule names differ too — the CLI reports the native diagnostic
codes (`pmds/...`), while the adapter exposes them under its host plugin
namespace (`palamedes/...`).
The default `.palamedes/extract-cache.json` stores compatible messages and
diagnostics together, so `extract` and `lint` can reuse the same native parse.
Lint follows extraction's bounded parallel read/parse model. Workers only
observe the immutable cache; results are suppressed, merged, and inserted into
the cache serially in source-file order, so cold, warm, and repeated runs keep
the same diagnostic output. A failed cache write remains non-fatal but is
always reported on stderr, including without `--verbose`.

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
`--fail-on error`. Exit code `5` means the audit completed and the configured
policy threshold failed.

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

Exit code `6` means the report completed and at least one reported locale was
below `--fail-if-below`.

## Exit codes

The CI-facing commands use stable, distinct exit codes so a policy verdict is
not confused with an operational failure:

| Code | Meaning                                                                                                          |
| ---- | ---------------------------------------------------------------------------------------------------------------- |
| `0`  | The command completed and its configured policy passed.                                                          |
| `1`  | The command could not complete because of configuration, I/O, serialization, or another operational failure.     |
| `2`  | Clap rejected invalid command-line usage.                                                                        |
| `3`  | `extract --check` completed and found catalog drift.                                                             |
| `4`  | `lint` completed and its `--fail-on` policy failed, or source analysis could not complete for one or more files. |
| `5`  | `audit` completed and its `--fail-on` policy failed.                                                             |
| `6`  | `report` completed and one or more locales were below `--fail-if-below`.                                         |

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

The driver merges even where no data config is discoverable — including
projects configured through `palamedes.config.ts` — because a registered driver
runs wherever the conflicted worktree is. Configured PO output options and
`source-locale` are then not applied, and the driver says so on stderr.

## `pmds catalog compile`

Compile PO translations into external Rust language files against an existing
application contract. This experimental command requires an exported
`schema.pmd.json` from the matching Rust application build; it does not build or
rewrite the application.

```sh
pmds catalog compile --target rust --schema dist/schema.pmd.json \
  --catalog-dir locales --locale de --output dist/translations
```

| Option                    | Meaning                                                                     |
| ------------------------- | --------------------------------------------------------------------------- |
| `--target rust`           | Required compiled catalog target; Rust is the current target.               |
| `--schema <path>`         | Existing application message contract, including its fingerprint.           |
| `--catalog-dir <path>`    | Directory with the source PO and requested `<locale>.po` inputs.            |
| `--locale <tag>`          | Output locale; repeat for multiple languages.                               |
| `--output <directory>`    | Destination for selected `<locale>.pmd.json` files.                         |
| `--fallback-locale <tag>` | Build-time fallback locale; repeat in resolution order.                     |
| `--fail-on-missing`       | Reject missing or fuzzy target translations even if a fallback exists.      |
| `--json`                  | Emit output paths and missing-translation diagnostics as one JSON document. |

By default, missing and fuzzy target translations compile through the configured
chain and source locale/message. The source PO defines the complete inventory;
unknown source entries, changed contracts, invalid ICU, unsupported constructs,
and placeholder mismatches fail before output files are touched. The schema's
version and fingerprint are validated too. Successful output replaces each
selected file atomically and preserves other installed languages. The JSON result
contains `catalogs` and `missing`; missing records contain `locale`, `message`, and
`resolvedLocale`. Failures exit 1 with a diagnostic on stderr.

See the [Rust guide](./rust-applications.md#update-translations-without-building-the-application)
for a complete update against an unchanged executable.

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
source catalogs untouched. It derives each output through the target-format
resolver, so an explicitly configured `messages.po` path becomes
`messages.po.fcl` and will resolve after changing only `format`. Update the
catalog config afterwards:

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

## Advisory update checks

The release workflow configures the native CLI's privacy-bounded update check
for the next release, following completed service readiness. The consuming
release and its production-check evidence remain pending in
[#1036](https://github.com/sebastian-software/palamedes/issues/1036) and
[version-service #12](https://github.com/sebastian-software/version-service/issues/12);
configuration alone does not mean that an enabled release has shipped.
Ordinary/local builds without `PALAMEDES_UPDATE_ENDPOINT` make no update-check
request and write no update-check cache. A configured build fails unless the value is exactly the
owned HTTPS route `https://version-service.sebastian-software.de/check`; malformed,
alternate-host, credentialed, port-qualified, query, and fragment values cannot
produce a release binary. The server half of the contract lives in the public
[version-service](https://github.com/sebastian-software/version-service)
repository and serves all Sebastian Software CLIs.

Once enabled, a regular `pmds` subcommand checks at most once per 24 hours. It
runs as part of that process — never as a daemon, background service, or
postinstall hook — and sends only this JSON shape over HTTPS:

```json
{
  "project": "palamedes",
  "version": "<installed pmds version>",
  "os": "linux",
  "arch": "x86_64",
  "ci": false,
  "installedSince": "2026-08"
}
```

`installedSince` is a coarse year-month install cohort and is deliberately
never finer than a month: combined with the other fields, a day-precision value
could form singleton combinations whose daily requests become linkable — a
de-facto identifier. A month reduces specificity but does not guarantee that
every combination is nonunique or unlinkable. There is no installation or telemetry ID and no command,
arguments, path, project data, username, or hostname. Palamedes application
code does not access or persist client IP addresses, forwarded headers, user
agents, or other identifying headers. The service reads the request URL path,
`Content-Type`, and `Content-Length` only to validate the route, media type,
and body-size limit, and forwards nothing but the documented aggregate
dimensions — with neutralized transport metadata — to its analytics sink. It
aggregates rate-limited request volume and
version/OS/architecture/CI/cohort distributions; because it has no stable
identifier, those requests are not unique weekly installations.

Set either opt-out before invoking the CLI to prevent both cache and network
access:

```bash
export DO_NOT_TRACK=1
# or
export PALAMEDES_UPDATE_CHECK=0
```

The platform cache is under `$XDG_CACHE_HOME/palamedes` (falling back to
`$HOME/.cache/palamedes`) on Linux, `$HOME/Library/Caches/palamedes` on macOS,
and `%LOCALAPPDATA%\palamedes` on Windows. A due attempt is recorded before the
request so offline use is not retried on every command, and the year-month
cohort is persisted beside it as `installed-since-v1`; deleting the cache
restarts the cohort. Cache and network failures are non-fatal and silent. The
network operation has a two-second total deadline; a valid newer semantic
version produces only this stderr notice after the command output:

```text
A new version of palamedes is available: <installed version> → <published version>
```

Stdout and exit status are unchanged, including for `--json` commands. A
silent check is not proof of successful ingestion, and a timeout can occur
after the service accepted an event. The service's 10-minute registry cache
can briefly return the previous version after publication; do not delete the
client cache to poll. Packaging smoke tests opt out without disabling checks
in the shipped artifact. Removing endpoint embedding only affects future
builds; existing binaries require an opt-out or an update to a disabled build.
See
[ADR-016](../adr/016-privacy-bounded-cli-update-check.md) for the data boundary
and the [version-service](https://github.com/sebastian-software/version-service)
repository for the service implementation and its deployment guide.

## Configuration Errors

The native CLI reads only data configs (`palamedes.yaml`, `.yml`, `.json`,
`.toml`). When the upward search finds only a JavaScript or TypeScript config,
the CLI reports that specifically instead of a generic not-found error — create
a data config next to it for CLI use. Known keys written in camelCase
(`sourceLocale`, `pseudoLocale`, `fallbackLocales`, `sourceReferenceRoot`,
`referenceScopes`, `extractThreads`, `extractCache`) are rejected with a kebab-case hint instead of being
silently ignored; other unknown top-level keys produce a warning.
Fallback-locale entries must reference configured locales, and a
`pseudo-locale` outside `locales` warns that it will be ignored.
