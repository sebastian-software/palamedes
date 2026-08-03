# @palamedes/cli

[![npm version](https://img.shields.io/npm/v/%40palamedes%2Fcli?logo=npm)](https://www.npmjs.com/package/@palamedes/cli)
[![CI](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml)
[![Sponsored by Sebastian Software](https://img.shields.io/badge/Sponsored%20by-Sebastian%20Software-0f172a.svg)](https://oss.sebastian-software.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f172a.svg)](https://github.com/sebastian-software/palamedes/blob/main/LICENSE)

The native Palamedes command-line interface for keeping local catalogs healthy
and hosting explicitly configured binary workflow commands. The npm launcher
only selects the installed platform package; Rust owns all command parsing,
configuration, plugin dispatch, output, and exit codes.

## When To Use This Package

Use `@palamedes/cli` when you want:

- a supported extraction command for Palamedes projects
- structured catalog audits in CI
- watch mode during development
- a clean way to update `.po` catalogs in CI, with opt-in `.fcl` storage
- a semantic catalog merge command for Git merge drivers
- explicit third-party workflow commands without wrapping or forking `pmds`

If you are building your own extraction workflow inside your i18n config or custom tooling, look at [`@palamedes/extractor`](https://www.npmjs.com/package/@palamedes/extractor) instead.

## Installation

```bash
pnpm add -D @palamedes/cli
```

Or run it without adding it to your project first:

```bash
pnpm dlx @palamedes/cli extract
```

The npm package currently publishes native binaries for:

- macOS arm64
- Linux x64 glibc
- Linux x64 musl
- Linux arm64 glibc
- Windows x64 MSVC

The `pmds` launcher selects the matching optional native package when the
command runs. Installation does not require npm lifecycle scripts, so package
managers may safely disable them for `@palamedes/cli`:

```bash
pnpm install --ignore-scripts
pnpm exec pmds --version
```

Keep optional dependencies enabled. If the matching package or its binary is
missing, `pmds` reports the expected platform package and how to add it
explicitly.

When the platform is known ahead of time — CI images, deployment targets — the
platform package can be installed directly instead. Each platform package
declares its own `pmds` bin, so the native binary runs without any Node
launcher process:

```bash
pnpm add -D @palamedes/cli-linux-x64-musl
pnpm exec pmds --version
```

## Usage

```bash
pnpm exec pmds extract
pnpm exec pmds extract --watch
pnpm exec pmds extract --clean
pnpm exec pmds extract --force-clean
pnpm exec pmds extract --config ./palamedes.yaml
pnpm exec pmds extract --threads 1
pnpm exec pmds extract --no-cache
pnpm exec pmds extract --verbose
pnpm exec pmds lint
pnpm exec pmds lint --json
pnpm exec pmds lint --fail-on warning
pnpm exec pmds lint --no-cache
pnpm exec pmds audit
pnpm exec pmds audit --json
pnpm exec pmds audit --fail-on warning
pnpm exec pmds report
pnpm exec pmds report --locale de,fr --fail-if-below 95
pnpm exec pmds report --json
pnpm exec pmds catalog merge --output src/locales/de.po src/locales/de.po other.po
pnpm exec pmds catalog convert src/locales/de.po --to fcl --output src/locales/de.fcl
```

`pmds audit` reports missing translations, extra catalog entries, obsolete
messages, fuzzy review markers, and ICU compatibility issues through the same `ferrocat`
catalog engine that powers Palamedes builds.

`pmds lint` is non-mutating and checks Palamedes authoring across the same
configured sources as extraction. It supports stable human and JSON output,
configured rule levels, code-specific line suppressions, and CI thresholds.

`pmds catalog convert` preserves translator comments, obsolete state, and
review markers such as `fuzzy` when converting PO catalogs to FCL.

`--threads <COUNT>` sets the worker threads for the parallel extraction pass,
overriding `extract-threads` in the config; it defaults to `4` and `1` runs
serial. `--no-cache` on `extract` or `lint` ignores and does not write their
shared source-analysis cache in `.palamedes/` — use it for a cold run; the cache
is on by default.

For local performance checks, set `PALAMEDES_TIMING_JSON=1` on `pmds extract`.
The command prints a machine-readable timing line with total, glob, extract,
and catalog-write timings.

See [Catalog formats](https://github.com/sebastian-software/palamedes/blob/main/docs/catalog-formats.md)
for when to keep PO storage and when to opt into FCL.

### Binary CLI Plugins

Plugins are loaded only when they are explicitly declared and a non-built-in
namespace is invoked:

```yaml
plugins:
  - ["@acme/palamedes-workflows", { policy: strict }]
```

```bash
pnpm exec pmds acme sync
pnpm exec pmds acme sync --json
pnpm exec pmds acme sync --config ./palamedes.yaml
```

A plugin package points at a native executable:

```json
{
  "name": "@acme/palamedes-workflows-darwin-arm64",
  "os": ["darwin"],
  "cpu": ["arm64"],
  "palamedes": { "pluginBinary": "./bin/palamedes-workflows" }
}
```

The executable answers the versioned JSON-lines protocol on stdin/stdout. The
Rust [`palamedes-plugin`](https://github.com/sebastian-software/palamedes/tree/main/crates/palamedes-plugin)
crate provides the supported SDK for command registration, resolved config,
catalog discovery, structured diagnostics, results, and built-in command
execution. A configured plugin has the same local permissions as a build tool,
so review and pin plugin dependencies.

See the [binary plugin protocol](https://github.com/sebastian-software/palamedes/blob/main/docs/api/cli-binary-plugin.md)
for packaging, output envelopes, exit codes, and collision rules.

### Completeness Report

`pmds report` prints a per-locale translation-management view:

```text
Locale  Translated  Missing  Complete
de      483/520     37       92.9%
fr      510/520     10       98.1%
```

By default, it reports configured target locales and skips the source locale
and pseudo-locale. Use `--locale de,fr` to select locales, `--json` for bots
and dashboards, and `--fail-if-below 95` to make CI fail when any reported
locale is below the threshold.

### Catalog Merge

`pmds catalog merge` combines catalog files. When inputs
contain the same semantic identity, `--conflict-strategy` controls how
translator-facing conflicts are handled; messages that only exist in the second
input are added.

```bash
pnpm exec pmds catalog merge --format=po --conflict-strategy=use-first --base %O --output %A %A %B
pnpm exec pmds catalog merge --format=fcl --conflict-strategy=use-first --base %O --output %A %A %B
```

`--format` can be omitted when all input and output extensions are supported
and match. `.po` maps to `po`; `.fcl` maps to `fcl`.

For Git merge-driver usage:

```gitattributes
*.po merge=palamedes-catalog
*.fcl merge=palamedes-catalog-fcl
```

```bash
git config merge.palamedes-catalog.driver \
  'pmds catalog merge --format=po --conflict-strategy=use-first --base %O --output %A %A %B'
git config merge.palamedes-catalog-fcl.driver \
  'pmds catalog merge --format=fcl --conflict-strategy=use-first --base %O --output %A %A %B'
```

`--source-locale` is optional. The command uses an explicit value first, then
the configured Palamedes config when available, then `en`.

## Configuration

`@palamedes/cli` uses `palamedes.yaml` by default. It also supports
`palamedes.yml`, `palamedes.json`, and `palamedes.toml`.
JavaScript and TypeScript files are not CLI configuration.

```yaml
locales: [en, de]
source-locale: en
source-reference-root: git
reference-scopes: false
catalogs:
  - path: src/locales/{locale}
    include: [src]
```

`source-reference-root` controls catalog references written by `pmds extract`.
The default is `"git"`, so monorepo references are emitted relative to the
nearest Git repository root. Use `"lingui"` or `"config"` to keep references
relative to the config directory, matching Lingui's default behavior.
`reference-scopes` defaults to `true`; set it to `false` to skip scope
extraction and emit file-only PO `#:` and FCL `r=` references.

## Related Packages

- [`@palamedes/extractor`](https://www.npmjs.com/package/@palamedes/extractor) for low-level extraction
- [`@palamedes/vite-plugin`](https://www.npmjs.com/package/@palamedes/vite-plugin) for Vite integration
- [`@palamedes/next-plugin`](https://www.npmjs.com/package/@palamedes/next-plugin) for Next.js integration
- [`@palamedes/runtime`](https://www.npmjs.com/package/@palamedes/runtime) for runtime wiring

## License

[![Sebastian Software](https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg)](https://oss.sebastian-software.com/)

MIT © 2026 Sebastian Software
