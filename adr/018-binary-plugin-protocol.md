# ADR-018: Binary Plugin Protocol For Rust-Hosted Extensions

- Status: Accepted
- Date: 2026-07-25
- Revised: 2026-09-01

## Context

Palamedes extensions are independently shipped executables. Rust-first
extensions such as commercial workflow commands should link the `palamedes`
crates directly without maintaining N-API bindings, while users keep the single
`pmds` entry point.

ADR 017 places explicit plugin dispatch in the native CLI. A language-neutral
subprocess protocol keeps independently versioned plugins outside the CLI's
Rust ABI and prevents one plugin crash from corrupting the host process.

## Decision

1. A plugin is a standalone executable spawned once per request. The host and
   plugin exchange newline-delimited JSON on stdio.
2. Configuration entries remain a package/path specifier or
   `[specifier, options]`. Packages declare `palamedes.pluginBinary`; native
   meta packages may resolve the matching installed optional platform package.
   Direct executable paths are accepted for local development. JavaScript and
   TypeScript files are rejected.
3. Protocol version `1` uses two request kinds:
   - `describe` returns one manifest with the plugin namespace, protocol
     version, and commands;
   - `run` receives the command, arguments, plugin options, resolved data
     config, semantic catalogs, output mode, and interactive capability.
4. A run emits zero or more `diagnostic` and `output` events followed by at
   most one `result` event (`text`, `data`, `exitCode`). stdout is reserved for
   protocol events; stderr passes through for progress logging.
5. The manifest uses lowercase kebab-case names, may not collide with built-in
   namespaces, and must match the host protocol major exactly.
6. The `result` exit code is authoritative. Without a result, the child process
   exit code is the fallback and the host emits a protocol diagnostic.
7. The host sets `PALAMEDES_NATIVE` to the absolute path of its own executable.
   Trusted plugins may invoke documented built-ins directly as subprocesses.
8. On Unix the host starts each plugin in an isolated process group and forwards
   `SIGINT` and `SIGTERM` to that group. Direct and terminal signals therefore
   reach the plugin tree exactly once; shell-compatible cancellation codes
   remain 130 and 143.
9. A configured plugin that fails to resolve or describe blocks only its own
   namespace. Commands of other configured plugins run and surface the skipped
   plugin as a warning diagnostic; the failure is fatal only when it may own
   the requested namespace.
10. The host bounds protocol line, byte, and event consumption. `describe` has
    a mandatory deadline; `run` remains unbounded unless the caller opts into a
    command deadline. A limit violation terminates the plugin process tree.

## Packaging And Resolution

Resolution starts at the data config and walks parent `node_modules`
directories. Scoped and unscoped package names are supported without evaluating
Node exports. pnpm's package symlinks are canonicalized before resolving a meta
package's optional dependencies.

For a direct binary package:

```json
{
  "name": "@acme/palamedes-plus-darwin-arm64",
  "os": ["darwin"],
  "cpu": ["arm64"],
  "palamedes": { "pluginBinary": "./bin/palamedes-plus" }
}
```

A platform-neutral package can list such packages as `optionalDependencies`.
The host selects the one installed for its compiled `os`, `cpu`, and `libc`.

## Trust Model

Configured plugins are trusted local code with the same permissions as `pmds`.
The protocol is a compatibility and failure-isolation boundary, not a sandbox.
Only external namespaces load configuration or resolve plugins, so built-ins
remain independent of plugin health.

## Consequences

- The request, event, and manifest schemas are a versioned public contract.
- The native CLI owns package resolution, process lifecycle, diagnostics,
  rendering, and exit codes.
- The `palamedes-plugin` crate wraps the plugin side of the protocol.
- Plugin packages may ship independently on the normal npm integrity and
  optional-platform-package path without any JavaScript runtime integration.
