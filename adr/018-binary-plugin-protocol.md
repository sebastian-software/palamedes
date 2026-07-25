# 018 — Binary Plugin Protocol For Rust-First Extensions

- Status: Accepted
- Date: 2026-07-25

## Context

ADR [017](./017-cli-plugin-execution-boundary.md) established explicit,
config-listed CLI plugins hosted in the npm wrapper with a Node ESM/CJS plugin
API. That API serves JavaScript-first workflow extensions well, but the next
wave of planned extensions is Rust-first: commercial Palamedes Plus commands
will link the `palamedes` crates directly. Forcing each Rust extension through
N-API bindings would tax every plugin with binding maintenance that exists only
to satisfy the host language, not the plugin's own needs.

There is also a product constraint. `pmds` must remain the single CLI entry
point: teams install a plugin package, keep every existing command and script
unchanged, and gain new namespaced commands. Shipping a separate commercial CLI
would fragment the user experience, force script migrations, and hide from
open-source users that a commercial tier exists at all.

ADR 017 already anticipated this direction and listed a language-neutral
subprocess protocol as "useful for a future multi-language ecosystem", deferred
only until the first command API had stabilized.

## Decision

Introduce a second plugin kind: **binary plugins** — standalone executables the
host spawns per invocation and talks to over a versioned stdio protocol.

1. Configuration is unchanged in shape. `plugins` entries keep the
   `[specifier, options]` tuple form and deterministic, config-relative
   resolution. The plugin kind is a property of the resolved package: an ESM
   package exports a plugin object as today, while a binary package declares a
   `palamedes.pluginBinary` path in its `package.json` pointing at the
   executable (per-platform packages follow the same `optionalDependencies`
   pattern the CLI itself uses for `pmds-native`). An absolute or
   config-relative file path is accepted for local development. Nothing is ever
   discovered via `PATH` or executed merely because it is installed.
2. The protocol is newline-delimited JSON with a strict request/response shape:
   - The host spawns the executable with a reserved argv marker and writes a
     single request object on stdin: protocol version, host version, request
     kind (`describe` or `run`), and for `run` the command name, arguments,
     plugin options, resolved configuration, semantic catalog enumeration,
     output mode, and the `interactive` flag.
   - `describe` returns the manifest: plugin name, protocol version, and the
     namespaced commands with descriptions. The manifest is validated exactly
     like an ESM plugin definition (kebab-case names, no built-in or duplicate
     namespaces).
   - `run` emits zero or more `diagnostic` and `output` events followed by one
     `result` event (`text`, `data`, `exitCode`) on stdout. The host renders
     text output or folds everything into the existing single JSON envelope, so
     `--json` semantics stay identical across both plugin kinds. stderr passes
     through for free-form progress logging.
   - Protocol version `1` must match exactly, mirroring the ESM `apiVersion`
     rule, and is versioned independently of both the package version and the
     ESM plugin API.
3. Cancellation and exit semantics match ADR 017: the host forwards `SIGINT`
   and `SIGTERM` to the child, cooperative shutdown maps to exit codes 130 and
   143, and a `result` without an explicit exit code derives it from error
   diagnostics. The process exit code is the authoritative fallback when no
   valid `result` event arrives.
4. Instead of a bidirectional `runBuiltIn` channel, the host hands the plugin
   the resolved `pmds-native` executable path via an environment variable.
   Binary plugins are trusted local code (see ADR 017's trust model), so they
   may invoke documented built-in commands directly as subprocesses; the
   protocol stays unidirectional and simple.
5. A `palamedes-plugin` SDK crate wraps the protocol — command registration,
   typed configuration and catalog access, diagnostics, result envelopes — so a
   Rust plugin `main` reads like `definePlugin` does in JavaScript. Plugins
   link the `palamedes` crates directly for engine functionality; the protocol
   is only the CLI integration boundary, never an engine API.
6. The ESM plugin API 1 remains fully supported and unchanged. Re-basing the
   Node API onto the same protocol via a generic shim is possible later but is
   not part of this decision.
7. Dispatch stays in the npm wrapper for now. Moving binary-plugin dispatch
   into `pmds-native` would enable a Node-free distribution and remains an
   explicit future option this protocol does not foreclose.

## Trust Model

Unchanged from ADR 017. Configured binary plugins are trusted local code with
the same filesystem, environment, and network permissions as `pmds`. The
protocol is a compatibility boundary, not a sandbox. Built-in commands still
bypass configuration and plugin loading entirely, so a missing or broken binary
plugin can never affect `extract`, `audit`, `report`, `catalog`, or `version`.

## Alternatives Considered

- **Dynamic libraries (`dlopen`/`libloading`):** Rust has no stable ABI, so
  host and plugin would need identical compiler and dependency versions;
  `abi_stable`-style workarounds flatten the type surface and a plugin fault
  takes down the host process.
- **WASM component model:** a strong sandbox and single cross-platform
  artifact, but the trust model does not need a sandbox, and capability-wiring
  ordinary filesystem and network access would cost more than it returns for
  first-party workflow commands.
- **Per-plugin N-API bindings:** keeps a single plugin API but imposes exactly
  the binding tax this decision removes, on every Rust plugin, forever.
- **A separate Plus CLI:** rejected on product grounds — it would split the
  entry point, require teams to migrate scripts, and decouple commercial
  features from the familiar `pmds` workflow.

## Consequences

- The request, event, and manifest schemas become a versioned public contract
  that must evolve under the same compatibility rules as the ESM plugin API.
- The npm wrapper gains spawn-and-dispatch logic for binary plugins alongside
  the existing module loader; both share manifest validation, envelope
  rendering, and exit-code semantics.
- CI needs a fixture binary plugin exercised across the supported platform
  matrix, like the existing plugin-host tests do for ESM plugins.
- Rust-first extensions such as Palamedes Plus can version and ship
  independently of the CLI without maintaining any Node bindings, while users
  keep one CLI and their existing workflows.
