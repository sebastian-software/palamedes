# @palamedes/cli

[![npm version](https://img.shields.io/npm/v/%40palamedes%2Fcli?logo=npm)](https://www.npmjs.com/package/@palamedes/cli)
[![CI](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml)
[![Sponsored by Sebastian Software](https://img.shields.io/badge/Sponsored%20by-Sebastian%20Software-0f172a.svg)](https://oss.sebastian-software.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f172a.svg)](https://github.com/sebastian-software/palamedes/blob/main/LICENSE)

The Palamedes command-line interface for keeping local catalogs healthy and
hosting explicitly configured workflow commands.

The npm package keeps a small Node.js dispatcher in front of the Rust `pmds`
sidecar. Built-in commands go directly to Rust; namespaced plugin commands use a
versioned JavaScript host API.

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

## Usage

```bash
pnpm exec pmds extract
pnpm exec pmds extract --watch
pnpm exec pmds extract --clean
pnpm exec pmds extract --force-clean
pnpm exec pmds extract --config ./palamedes.yaml
pnpm exec pmds extract --verbose
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
messages, and ICU compatibility issues through the same `ferrocat`
catalog engine that powers Palamedes builds.

For local performance checks, set `PALAMEDES_TIMING_JSON=1` on `pmds extract`.
The command prints a machine-readable timing line with total, glob, extract,
and catalog-write timings.

See [Catalog formats](https://github.com/sebastian-software/palamedes/blob/main/docs/catalog-formats.md)
for when to keep PO storage and when to opt into FCL.

### CLI Plugins

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

A minimal plugin exports `@palamedes/cli/plugin` API version 1:

```js
import { definePlugin } from "@palamedes/cli/plugin"

export default definePlugin({
  name: "acme",
  apiVersion: 1,
  commands: {
    inspect: {
      run({ host, options }) {
        return {
          text: `Found ${host.catalogs().length} catalog definitions`,
          data: { catalogs: host.catalogs(), options },
        }
      },
    },
  },
})
```

The host exposes resolved config, catalog discovery, structured diagnostics,
cooperative cancellation, and guarded built-in command execution. It does not
expose native internals or sandbox plugin code. A configured plugin has the same
local permissions as a build script, so review and pin plugin dependencies.

See the [CLI plugin API](https://github.com/sebastian-software/palamedes/blob/main/docs/api/cli-plugin.md)
for output envelopes, exit codes, collision rules, and author types.

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

```yaml
locales: [en, de]
source-locale: en
source-reference-root: git
catalogs:
  - path: src/locales/{locale}
    include: [src]
```

`source-reference-root` controls PO `#:` references written by `pmds extract`.
The default is `"git"`, so monorepo references are emitted relative to the
nearest Git repository root. Use `"lingui"` or `"config"` to keep references
relative to the config directory, matching Lingui's default behavior.

## Related Packages

- [`@palamedes/extractor`](https://www.npmjs.com/package/@palamedes/extractor) for low-level extraction
- [`@palamedes/vite-plugin`](https://www.npmjs.com/package/@palamedes/vite-plugin) for Vite integration
- [`@palamedes/next-plugin`](https://www.npmjs.com/package/@palamedes/next-plugin) for Next.js integration
- [`@palamedes/runtime`](https://www.npmjs.com/package/@palamedes/runtime) for runtime wiring

## License

[![Sebastian Software](https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg)](https://oss.sebastian-software.com/)

MIT © 2026 Sebastian Software
