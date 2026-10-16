# ADR-015: Host Explicit Binary CLI Plugins In Rust

**Status:** Accepted

**Last updated:** 2026-10-16

The Rust CLI dispatches explicitly configured executable plugins without making the npm launcher a second runtime.

## Decision

Use one native command boundary:

1. The Rust `pmds` executable owns built-in and plugin command dispatch.
2. Built-in feature commands (`extract`, `lint`, `audit`, `report`, `catalog`,
   and `version`) execute before configuration or plugin resolution. The current
   reserved plugin namespace tokens are those commands plus Clap's `help`
   subcommand; visible and hidden aliases of any root command are also reserved.
3. Any other namespace is resolved only from the explicit `plugins` list in a
   Palamedes data config (`yaml`, `yml`, `json`, or `toml`). JavaScript and
   TypeScript files are not CLI configuration.
4. Every plugin is a standalone executable that speaks the versioned binary
   plugin protocol from ADR-025. ESM and CJS plugin modules are not supported.
5. Package resolution is deterministic and relative to the config file.
   Installed packages are never discovered or executed merely because they are
   present.
6. A plugin package declares `palamedes.pluginBinary` in `package.json`. A meta
   package may instead carry platform-specific optional dependencies whose
   installed package declares `pluginBinary` and matching `os`, `cpu`, and
   `libc` constraints.
7. Text output and one JSON envelope share explicit exit-code semantics.
   Built-in commands remain available to a trusted plugin through the absolute
   `pmds` path in `PALAMEDES_NATIVE`.

The npm package keeps only the platform-selection launcher required to expose a
stable `pmds` bin from a platform-neutral package. It does not parse commands,
load configuration, or host plugins.

## Context

The Rust `pmds` binary owns extraction, audits, reports, and catalog operations.
Third-party workflows need resolved project configuration and semantic catalog
discovery, but independently shipped extensions must not link into the CLI or
execute implicitly during built-in commands.

Hosting plugin semantics in the npm launcher would create a second CLI
runtime and duplicate configuration and dispatch outside Rust. Standalone
executables preserve a language-neutral extension boundary.

## Trust Model

Configured plugins are trusted local executables with the same filesystem,
environment, and network permissions as `pmds`. The protocol is an API
boundary, not a sandbox. Projects must review and pin plugin packages as they
would build tools. Built-in commands bypass plugin loading, so a missing or
broken plugin cannot affect core workflows.

## Alternatives Considered

- **JavaScript module plugins:** independently deployable, but require a second
  runtime and executable configuration for behavior already owned by Rust.
- **Rust compile-time extensions:** strongly typed but require rebuilding the
  CLI for independently released plugins.
- **Dynamic libraries:** Rust has no stable ABI and a plugin fault would take
  down the host process.
- **WASI/WASM sandbox:** a stronger isolation boundary than the trust model
  requires, with additional capability wiring for filesystem and network use.
- **External wrapper CLIs:** duplicate config discovery, catalogs, output
  envelopes, diagnostics, and version negotiation.

## Consequences

- `pmds` has one parser and one dispatch table, both in Rust.
- Plugins can be written in any language that produces an executable speaking
  the protocol; the supported SDK is Rust-first.
- CLI plugin configuration is portable data and cannot execute code while
  loading.
- JavaScript module plugins and JS/TS CLI configs are not parallel extension
  paths; plugin discovery and dispatch stay in the native CLI.
- The npm launcher remains a packaging bridge until package managers expose a
  transitive optional dependency's bin as the installed package's public bin.
  [ADR-014](./014-npm-launcher-is-a-packaging-bridge.md) records the launcher
  distribution decision and its rejected alternatives.
