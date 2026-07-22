# 001 — Host Explicit CLI Plugins In The npm Wrapper

- Status: Accepted
- Date: 2026-07-22
- Issue: [#365](https://github.com/sebastian-software/palamedes/issues/365)

## Context

The Rust `pmds` binary owns extraction, audits, reports, and catalog operations.
Third-party workflows need resolved project configuration and semantic catalog
discovery, but linking independently shipped extensions into the Rust binary or
exposing N-API internals would couple the extension contract to implementation
details. An unrestricted lifecycle-hook system would also make ordinary built-in
commands execute third-party code implicitly.

## Decision

Use a hybrid boundary:

1. The npm package keeps a small Node.js `pmds` wrapper as the public executable
   and installs the Rust program as a private `pmds-native` sidecar.
2. Built-in namespaces (`extract`, `audit`, `report`, `catalog`, and `version`)
   are delegated directly to the sidecar before configuration or plugin modules
   are loaded.
3. Plugins are loaded only for a non-built-in namespace and only when explicitly
   listed in `plugins` in the resolved Palamedes configuration.
4. A plugin declares a lowercase kebab-case namespace, plugin API major version,
   and a record of namespaced commands. API version `1` must match exactly.
5. Package resolution is deterministic and relative to the config file. Installed
   packages are never discovered or executed merely because they are present.
6. Commands receive a versioned capability host: resolved configuration, semantic
   catalog enumeration, structured diagnostics, cancellation, and a guarded way
   to invoke documented built-in commands. Rust and N-API internals are not part
   of the contract.
7. Text output and a single JSON envelope share explicit exit-code semantics.
   `SIGINT` and `SIGTERM` are exposed through `AbortSignal`; cooperative
   cancellation maps to exit codes 130 and 143.
8. The host never prompts. Commands receive an `interactive` capability that is
   false for JSON, CI, and non-TTY execution.

The plugin API major is independent of the package version. Additive API-1
capabilities may ship in compatible Palamedes minor releases. Removing or
changing API-1 behavior requires a Palamedes major release or a parallel newer
plugin API major with a migration window.

## Trust Model

Configured plugins are trusted local code with the same filesystem, environment,
and network permissions as `pmds`. The host is an API boundary, not a sandbox.
Projects must review and pin plugin packages as they would build scripts. CI
must not inject untrusted plugin configuration. A missing, incompatible, or
failing plugin prevents only plugin-command dispatch; built-in commands bypass
plugin loading entirely.

## Alternatives Considered

- **Rust compile-time extensions:** strongly typed but unsuitable for independent
  npm delivery and would require rebuilding the CLI.
- **Language-neutral subprocess protocol:** useful for a future multi-language
  ecosystem, but adds process lifecycle, discovery, and protocol complexity before
  the first command API has stabilized.
- **WASI/WASM sandbox:** a potentially stronger isolation boundary, but current
  workflows need ordinary package resolution and controlled access to project files.
- **Unrestricted Node lifecycle hooks:** easy to add but would execute third-party
  code during built-ins and make ordering/failure behavior part of every core command.
- **External wrapper CLIs:** avoid changes here but duplicate config discovery,
  catalogs, output envelopes, diagnostics, and version negotiation.

## Consequences

- Existing built-in behavior remains owned and parsed by Rust.
- The npm wrapper becomes a small runtime component rather than only a binary
  installer.
- Plugin authors can ship ordinary ESM/CJS npm packages without depending on
  internal native bindings.
- Hooks such as `beforeExtract` and `afterAudit` remain intentionally out of
  scope. They can be evaluated later without weakening the explicit-command
  execution rule.
