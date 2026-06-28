# ADR-016: Native CLI And YAML-First Configuration

**Status:** Accepted
**Date:** 2026-06-28

## Context

Palamedes already keeps most careful i18n work in Rust: extraction, catalog
updates, audits, PO parsing, catalog merging, transform logic, ICU diagnostics,
and runtime artifact compilation. Before this decision, the public `pmds` CLI
was still a TypeScript/Node.js program that mostly orchestrated those native
operations through `@palamedes/core-node`.

That shape was convenient for early JavaScript project adoption, but it made the
CLI boundary heavier than the work required:

- every scripted CLI call started Node.js before reaching the Rust core
- config loading depended on `jiti` and JavaScript/TypeScript config execution
- extraction watch mode depended on Node packages such as `chokidar`
- command parsing, glob expansion, printing, and exit-code handling lived in a
  second runtime
- non-JavaScript adoption paths, such as CMS integrations or mobile app
  workflows, would inherit a Node.js dependency even when they only need the CLI

This conflicted with the Rust-first boundary documented in ADR-002, ADR-007,
and ADR-009. If `pmds` is the stable operational tool for extracting, auditing,
reporting, and merging catalogs, it should not require a JavaScript runtime
merely to reach logic that is already native.

The config format had the same boundary problem. `palamedes.config.ts` and
other JavaScript config files work well inside frontend projects, but they make
Node.js part of the CLI contract. For a native CLI meant to work across
frameworks and future non-JavaScript hosts, executable JavaScript config is the
wrong default boundary.

## Decision

`pmds` is a native Rust CLI.

The canonical CLI implementation lives in the Cargo workspace as
`palamedes-cli` and owns:

- command-line parsing and exit codes
- data-only Palamedes config discovery and validation
- source file discovery and glob handling
- native watch mode
- extraction, audit, report, and catalog merge orchestration
- human-readable output and machine-readable JSON output

`palamedes.yaml` is the canonical CLI config file. The native `pmds` CLI also
loads `palamedes.yml`, `palamedes.json`, and `palamedes.toml` via Rust's
`config` crate. It does not execute TypeScript or JavaScript config files.

The documented schema uses kebab-case field names:

- `source-locale`
- `fallback-locales`
- `pseudo-locale`
- `source-reference-root`
- `catalogs`

Snake-case field names remain accepted aliases at the loader boundary for
secondary TOML files and migration tolerance, but new docs and examples should
use kebab-case.

`source-reference-root` defaults to `git`, meaning PO `#:` references are
written relative to the nearest Git repository root, falling back to the config
directory when no Git root is present. `config` and `lingui` remain explicit
config-directory-relative modes for migration compatibility.

The npm package `@palamedes/cli` remains a distribution mechanism for JavaScript
projects, but it is not the runtime implementation of the CLI. It installs or
points to platform-specific native binary packages and exposes the `pmds` bin.
Running `pmds` should execute the native binary, not a Node.js wrapper.

`@palamedes/config` remains available for JavaScript host integrations and can
load the same YAML, JSON, and TOML data files as well as legacy
`palamedes.config.*` files. That keeps Vite and Next.js integrations compatible
while making the CLI boundary native.

## Alternatives Considered

### 1. Keep the TypeScript CLI and rely on native bindings

Rejected as the long-term architecture. It preserves Node startup, JavaScript
config execution, and a second orchestration runtime for operations whose core
logic is already Rust.

### 2. Add a separate `pmds-native` command first

Rejected because the tool is still early enough to make the correct boundary the
default. A parallel command would extend the period where users and docs must
choose between two CLIs.

### 3. Keep TypeScript config support inside the native CLI by shelling out to Node.js

Rejected because it keeps Node.js in the CLI runtime path and makes native
behavior depend on a host runtime that is otherwise unnecessary. Migration from
JavaScript config should happen through data-only Palamedes config, not through
a hidden compatibility subprocess.

### 4. Use TOML as the canonical user-authored format

Rejected as the default documentation shape. TOML is supported, but YAML reads
better for nested project config and avoids making arrays of catalog objects
look more complex than they are.

### 5. Use JSON as the canonical user-authored format

Rejected as the canonical user-authored format. JSON is easy for tools but poor
for hand-authored project config. It remains supported as a data-only format.

## Consequences

- This is a breaking CLI/config change for projects using
  `palamedes.config.ts`, `.js`, `.mjs`, or `.cjs` with `pmds`.
- New projects should create `palamedes.yaml`.
- Existing JavaScript framework integrations can continue through
  `@palamedes/config`, but the CLI no longer treats JavaScript config as a
  runtime dependency.
- JSON and TOML are supported secondary data formats for teams that prefer or
  generate those formats.
- `@palamedes/cli` package publishing now includes native CLI binary packages
  in addition to the existing `@palamedes/core-node-*` native binding packages.
- CI and release validation must track the Rust CLI crate, npm CLI package, and
  platform-specific CLI binary packages as one release set.
- CLI behavior is easier to reuse outside frontend JavaScript projects because
  the operational dependency is a native binary rather than Node.js.
- Future CLI features should be implemented in Rust unless they are explicitly
  JavaScript-host integration features.
