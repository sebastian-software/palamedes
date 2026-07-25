# `pmds` Binary Plugin Protocol

Binary plugins are standalone executables that extend `pmds` with namespaced
commands, following [ADR 002](../adr/002-binary-plugin-protocol.md). They speak
a versioned newline-delimited JSON protocol over stdio, so Rust-first
extensions can link the `palamedes` crates directly without maintaining Node
bindings. The [ESM plugin API](./cli-plugin.md) remains fully supported; both
kinds share one configuration, one registry, and the same output contract.

## Declare A Binary Plugin

Configuration keeps the familiar tuple form. The plugin kind is a property of
the resolved package: a binary plugin package declares `palamedes.pluginBinary`
in its `package.json`, pointing at the executable relative to the package root.

```yaml
plugins:
  - ["@acme/palamedes-plus", { license: "…" }]
```

```json
{
  "name": "@acme/palamedes-plus",
  "palamedes": { "pluginBinary": "./bin/palamedes-plus" }
}
```

Per-platform binaries follow the same `optionalDependencies` pattern the CLI
itself uses for `pmds-native`. For local development, a config-relative path to
a directory containing such a `package.json` — or directly to a non-JavaScript
executable file — is accepted. A `pluginBinary` ending in `.js`, `.mjs`, or
`.cjs` is spawned through the current Node executable, which keeps fixtures and
prototypes cross-platform. Packages without `palamedes.pluginBinary` are
loaded as ESM plugins as before. Nothing is ever discovered via `PATH` or
executed merely because it is installed.

## Protocol

Protocol version `1` must match exactly. It is versioned independently of both
the package version and the ESM plugin API major.

The host spawns the executable once per request and writes a single JSON
object to stdin, then closes it:

```json
{
  "palamedesBinaryPluginProtocol": 1,
  "hostVersion": "1.5.1",
  "kind": "describe"
}
```

`describe` must answer with exactly one manifest event on stdout:

```json
{ "event": "manifest", "name": "acme", "protocolVersion": 1, "commands": { "inspect": { "description": "Inspect configured catalogs." } } }
```

Manifests are validated like ESM plugin definitions: lowercase kebab-case
names, no built-in namespaces (`extract`, `audit`, `report`, `catalog`,
`version`), no duplicates across configured plugins.

A `run` request carries the invocation and resolved project context:

```json
{
  "palamedesBinaryPluginProtocol": 1,
  "hostVersion": "1.5.1",
  "kind": "run",
  "command": "inspect",
  "args": ["one", "two"],
  "options": { "license": "…" },
  "json": false,
  "interactive": false,
  "config": { "…": "resolved LoadedPalamedesConfig" },
  "catalogs": [{ "path": "…", "format": "po", "include": ["src"], "exclude": [], "locales": [{ "locale": "en", "path": "/abs/path" }] }]
}
```

The plugin answers with newline-delimited events on stdout — zero or more
`diagnostic` and `output` events, then at most one `result` event:

```json
{ "event": "diagnostic", "severity": "info", "code": "ACME_INSPECTED", "message": "Inspected 2 catalogs." }
{ "event": "output", "text": "inspecting" }
{ "event": "result", "text": "done", "data": { "count": 2 }, "exitCode": 0 }
```

- stdout is reserved for protocol events; free-form progress belongs on
  stderr, which passes through to the terminal.
- Diagnostics use the same `severity`/`code`/`message`/`details` shape and
  rendering as the ESM API. With `--json`, everything is folded into the same
  single host envelope.
- Without an explicit `exitCode`, error diagnostics produce `1` and other
  results produce `0`. Exit codes must be integers from 0 through 255.
- If no valid `result` event arrives, the process exit code is the
  authoritative fallback and the host reports a `PLUGIN_BINARY_PROTOCOL`
  diagnostic.
- `SIGINT` and `SIGTERM` are forwarded to the child; cooperative cancellation
  maps to exit codes 130 and 143.

## Built-In Commands And Trust

Instead of a bidirectional channel, the host exports the resolved
`pmds-native` executable path as the `PALAMEDES_NATIVE` environment variable.
Binary plugins are trusted local code — the trust model from
[ADR 001](../adr/001-cli-plugin-execution-boundary.md) applies unchanged — so
they may invoke documented built-in commands directly as subprocesses. In JSON
mode a plugin should capture that output rather than let it corrupt the single
envelope on its own stdout.

Built-in commands bypass configuration and plugin loading entirely, so a
missing, incompatible, or crashing binary plugin never affects `pmds extract`,
`audit`, `report`, `catalog`, or `version`.
