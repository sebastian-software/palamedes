# ADR-012: Native CLI And YAML-First Configuration

**Status:** Accepted

**Last updated:** 2026-10-16

The native CLI owns operational workflows and reads data-only configuration, with YAML as the documented default.

## Decision

`pmds` is a native Rust CLI.

The canonical CLI implementation lives in the Cargo workspace as
`palamedes-cli` and owns:

- command-line parsing and exit codes
- data-only Palamedes config discovery and validation
- source file discovery and glob handling
- native watch mode
- extraction, lint, audit, report, catalog conversion, merge, and merge-driver
  orchestration
- human-readable output and machine-readable JSON output

`palamedes.yaml` is the canonical CLI config file. The native `pmds` CLI also
loads `palamedes.yml`, `palamedes.json`, and `palamedes.toml` via Rust's
`config` crate. It does not execute TypeScript or JavaScript config files.

The documented schema uses kebab-case field names:

- `locales`
- `source-locale`
- `fallback-locales`
- `pseudo-locale`
- `source-reference-root`
- `reference-scopes`
- `extract-threads`
- `extract-cache`
- `mdx`
- `lint`
- `catalogs`
- `plugins`

Snake-case field names remain accepted aliases at the loader boundary for
secondary TOML files and migration tolerance, but new docs and examples should
use kebab-case.

`source-reference-root` defaults to `git`, meaning PO `#:` references are
written relative to the nearest Git repository root, falling back to the config
directory when no Git root is present. `config` and `lingui` remain explicit
config-directory-relative modes for migration compatibility.

The npm package `@palamedes/cli` remains a distribution mechanism for JavaScript
projects, but it is not the runtime implementation of the CLI. Its minimal
launcher selects the installed platform-specific native package and forwards
the process invocation without parsing commands or loading config. All CLI
semantics execute in the native binary.

`@palamedes/config` remains available for JavaScript host integrations and can
load the same YAML, JSON, and TOML data files as well as legacy
`palamedes.config.*` files. That keeps Vite and Next.js integrations compatible
while making the CLI boundary native.

## Context

The operational toolchain must run without a JavaScript runtime merely to reach
semantics already owned by Rust. Command parsing, config discovery, watching,
and catalog workflows therefore share the native process and its error model.

Data-only configuration is portable across frontend projects and other hosts.
Executing JavaScript configuration would add a second runtime and a code
execution boundary to otherwise native commands. JavaScript host adapters can
retain their own configuration loader without imposing it on the CLI.

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

- Projects invoking `pmds` use data configuration; JavaScript-host config is
  not a native CLI execution path.
- New projects should create `palamedes.yaml`.
- Existing JavaScript framework integrations can continue through
  `@palamedes/config`, but the CLI no longer treats JavaScript config as a
  runtime dependency.
- JSON and TOML are supported secondary data formats for teams that prefer or
  generate those formats.
- `@palamedes/cli` package publishing includes native CLI binary packages
  in addition to the existing `@palamedes/core-node-*` native binding packages.
- CI and release validation must track the Rust CLI crate, npm CLI package, and
  platform-specific CLI binary packages as one release set.
- CLI behavior is easier to reuse outside frontend JavaScript projects because
  the operational dependency is a native binary rather than Node.js.
- Future CLI features should be implemented in Rust unless they are explicitly
  JavaScript-host integration features.
