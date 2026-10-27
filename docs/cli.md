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
`cargo run -p palamedes-cli` does not refresh a `target/<profile>/pmds-locales/`
directory left by an earlier package build. After changing message sources, those
files may have a stale fingerprint. Rebuild the native platform package, or use
the current `palamedes-cli` `build-script-executed.out_dir` from
`cargo build -p palamedes-cli --message-format=json` and point
`PALAMEDES_UI_CATALOG_DIR` to its `catalogs/` child. Bootstrap errors include this
source-checkout guidance as well as the installed-package repair.

Counted summaries and host-owned verdicts use plural messages in English, German, Spanish, and
French. Each count in a multi-count summary selects its own plural branch. Plural categories follow ICU4X/CLDR rules; `#` emits plain decimal output.
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

Bare source directories include `.vue` files. Inline `<script setup>` and
`<script>` macros use the same native extraction as JavaScript and TypeScript,
with references pointing to the original SFC. Template text is not extracted.

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
pmds extract --runtime-manifest .palamedes/macros.json
```

Options:

| Option                      | Description                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `-c, --config <path>`       | Use a specific config file.                                                                                                                                  |
| `-w, --watch`               | Re-run extraction on file changes (debounced). Fatal authoring errors are printed and watching continues; the config file is watched and reloaded on change. |
| `--clean`                   | Remove obsolete entries with `obsolete-since` at least 30 days old; keep undated obsolete entries.                                                           |
| `--force-clean`             | Remove all obsolete entries immediately, including undated entries.                                                                                          |
| `--check`                   | Exit unsuccessfully when extraction would create or modify a catalog, without writing catalog files. Cannot be combined with `--watch`.                      |
| `--json`                    | With `--check`, print one deterministic result document.                                                                                                     |
| `--fail-on-empty-catalog`   | Fail an extraction cycle before any catalog update when a configured catalog matches no source files.                                                        |
| `--threads <COUNT>`         | Worker threads for the parallel extraction pass. Overrides `extract-threads` in the config; defaults to `4`; `1` runs serial.                                |
| `--no-cache`                | Ignore and do not write the extraction cache in `.palamedes/`. Use for a cold run; the cache is on by default.                                               |
| `--runtime-manifest <path>` | Also write the runtime macro manifest, relative to the config file. With `--check`, fail when it is stale.                                                   |
| `-v, --verbose`             | Print verbose extraction details.                                                                                                                            |

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

`--runtime-manifest` serves Node code that runs macros without a bundler; see
[Macros Without A Bundler](./backend-servers.md#macros-without-a-bundler). For
each `t`, `plural`, `select`, and `selectOrdinal` call imported from
`@palamedes/core/macro`, the manifest records the static text the runtime
receives, the compiled key, and the placeholder names. Two calls with the same
static text but different messages or placeholder names fail extraction, as do
choice branches that interpolate values or descriptor messages built from
template expressions.

## `pmds lint`

Checks Palamedes source authoring without creating or updating catalogs. It
uses the union of the configured `catalogs[].include` and `exclude` file sets,
deduplicates overlapping catalogs, and supports JS, TS, JSX, TSX, MDX, Vue scripts,
and Svelte scripts.

```bash
pmds lint
pmds lint --json
pmds lint --fail-on warning
pmds lint src/view.tsx src/actions.ts --json --fail-on warning
```

Explicit file arguments replace catalog source discovery. They are literal file
paths relative to the invocation directory, including when `--config` points
elsewhere. They bypass catalog `include` and `exclude` patterns; configuration
still supplies lint policy, MDX options, and the shared cache. Duplicate paths
are checked once. Use files rather than directories or quoted globs. Missing,
unreadable, or unsupported inputs appear in `failedFiles` and produce exit code
`4`, so a mistyped path cannot silently pass. Omit files for the full configured
source check. Targeted runs preserve cache entries for other project files.

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

`palamedes-lint-disable-*` directives and native `pmds/...` diagnostic codes
are the source-authoring suppression interface. When migrating from the removed
ESLint/Oxlint adapter, replace host directives and `palamedes/...` rule names as
shown in the [v2 migration guide](./migration-v2.md#replace-the-lint-adapter).

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

With `--target js`, compile the catalogs from `palamedes.yaml` into
parser-free JavaScript modules, one `<locale>.mjs` per locale, for Node code
that runs without a bundler:

```sh
pmds catalog compile --target js --output .palamedes/catalogs
```

Each module exports `messages` for `i18n.load()`. Configured catalogs of the
same locale are merged, and `--locale` limits the output. Fallbacks follow the
configuration; `--fallback-locale` replaces the configured `fallback-locales`
with one shared chain, and each locale it names must be listed in `locales`.
`--config`, `--fail-on-missing`, and `--json` work as below; `--schema` and
`--catalog-dir` apply to the Rust target only.

A source message that appears in several catalogs compiles to one runtime ID.
Identical output is kept once, and a translation takes precedence over another
catalog's fallback for the same message. Two different compilations of the same
message fail with `compile.conflicting_message`, naming both catalogs.

No module is written while any catalog fails. Each failure names the catalog
file that holds the message, that file's locale (a fallback locale when the
message was reached through one), and the source message. Invalid or
unsupported ICU fails with the compiler's code, such as
`compile.invalid_icu_message`; `--fail-on-missing` reports each missing
translation as `compile.missing_translation`. With `--json`, the document also
contains a `diagnostics` array whose entries have `severity`, `code`,
`message`, `catalogPath`, `locale`, `requestedLocale`, `sourceKey` when the
source message is known, and `conflictingCatalogPath` for conflicts. The command
then exits 1 and repeats the failure on stderr.

With `--target rust`, compile PO translations into external Rust language files against an existing
application contract. This experimental command requires an exported
`schema.pmd.json` from the matching Rust application build; it does not build or
rewrite the application.

```sh
pmds catalog compile --target rust --schema dist/schema.pmd.json \
  --catalog-dir locales --locale de --output dist/translations
```

| Option                    | Meaning                                                                     |
| ------------------------- | --------------------------------------------------------------------------- |
| `--target rust`           | Required compiled catalog target: `rust` or `js`.                           |
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

Palamedes v2 uses the shared `app-tracking` Rust client. Release builds embed
exactly `https://sebastian-app-tracking.b-cdn.net/v1/versions/palamedes/github/stable`;
invalid build-time `PALAMEDES_UPDATE_ENDPOINT` values fail the build. Ordinary
builds without that setting remain offline. Published v1 clients keep their
existing version-service behavior.

A regular native CLI invocation checks when due, with an hourly success cache,
bounded failure suppression, and notice throttling. The service reads the
existing CDN-cached oss-metrics GitHub release snapshot and requires a release
to be at least one hour old. This does not guarantee that every downstream
package manager is already updated. There is no separate client GitHub/npm
lookup. The version GET contains no usage body, installation ID, project hash,
installed version, platform, or install cohort. Network infrastructure still
processes metadata such as the requesting IP.

A newer release produces an advisory stderr notice after command output.
Stdout/JSON and exit status stay unchanged. Each due update request has a
200 ms network deadline; filesystem and process overhead are additional.
Failures are silent. `DO_NOT_TRACK=1`, `PALAMEDES_UPDATE_CHECK=0`, `--offline`,
or `PALAMEDES_OFFLINE=1` suppress update checks before cache/network access.
Help/version, telemetry controls, and automatic Git merge-driver execution do
not trigger a check.

The cache is `palamedes/app-tracking-updates` beneath `$XDG_CACHE_HOME`
(or `$HOME/.cache`) on Linux, `$HOME/Library/Caches` on macOS, and
`%LOCALAPPDATA%` on Windows. New clients do not reuse or transmit the old
`update-check-v1` timestamp or `installed-since-v1` cohort.

## `pmds telemetry`

Optional command usage reporting is off until explicit consent. Run:

```sh
pmds telemetry enable                         # Display the full notice only
pmds telemetry enable --accept telemetry-v1   # Give informed consent
pmds telemetry status                         # Local policy and queue status
pmds telemetry preview                        # Inspect data without sending
pmds telemetry disable                        # Stop and discard unsent usage
pmds telemetry delete                         # Request remote deletion
pmds telemetry flush                          # Try one pending operation
```

`decline` records a refusal. `reset` requests deletion of the previous identity;
new reporting needs a separate `enable` decision. If local state is corrupt or
its credential is lost, `forget --acknowledge-unverified-deletion` explicitly
abandons local authority without claiming remote deletion.

Status and preview are JSON documents with no credentials. An offline deletion
can remain pending; rerun `delete` or an ordinary command online to retry.
Controls never count as usage. A busy or invalid state produces an explicit
control error; ordinary command failures to count/report remain advisory.

See [optional CLI usage reporting](./telemetry.md) for collected fields, fixed
command categories, project identity, environment settings, CI, retention, and
measurement limits. The complete disclosure is also available through
`pmds telemetry enable` in English. Update checks do not require telemetry
consent. Existing v1 request analytics do not opt anyone into v2 telemetry.

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
