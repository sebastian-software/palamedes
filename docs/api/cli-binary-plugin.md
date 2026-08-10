# `pmds` Binary Plugin Protocol

Binary plugins are standalone executables that extend `pmds` with namespaced
commands. The native Rust CLI spawns them and exchanges newline-delimited JSON
over stdio. The protocol is the only CLI plugin boundary; JavaScript modules
and executable JavaScript/TypeScript configs are not supported.

## Configure A Plugin

Configuration uses a package or config-relative executable, optionally paired
with JSON-compatible options:

```yaml
plugins:
  - ["@acme/palamedes-plus", { license: "…" }]
```

A direct plugin package declares its executable relative to `package.json`:

```json
{
  "name": "@acme/palamedes-plus-darwin-arm64",
  "os": ["darwin"],
  "cpu": ["arm64"],
  "palamedes": { "pluginBinary": "./bin/palamedes-plus" }
}
```

A platform-neutral meta package may list native packages in
`optionalDependencies`. The Rust host follows the installed dependency whose
`os`, `cpu`, and `libc` fields match the running native CLI and whose manifest
declares `palamedes.pluginBinary`.

Resolution starts next to the Palamedes data config and walks parent
`node_modules` directories. pnpm symlinks are supported. A local package
directory or a direct native executable path can be used for development.
Nothing is discovered via `PATH`, and merely installing a package never causes
it to run.

A configured plugin that fails to resolve or describe blocks only its own
namespace. Commands of other configured plugins still run and report the
skipped plugin as a `PLUGIN_UNAVAILABLE` warning; the failure is fatal only
when the requested namespace cannot be served.

## Protocol

Protocol version `1` must match exactly. It is versioned independently of the
CLI and plugin package versions.

The host spawns the executable once per request and writes one JSON object to
stdin before closing it. `describe` asks for the plugin manifest:

```json
{
  "palamedesBinaryPluginProtocol": 1,
  "hostVersion": "1.10.0",
  "kind": "describe"
}
```

The plugin answers with exactly one manifest event:

```json
{
  "event": "manifest",
  "name": "acme",
  "protocolVersion": 1,
  "commands": {
    "inspect": { "description": "Inspect configured catalogs." }
  }
}
```

Namespaces and commands must be lowercase kebab-case. The six built-in feature
commands are `extract`, `lint`, `audit`, `report`, `catalog`, and `version`.
Plugin namespaces cannot use those tokens, Clap's `help` subcommand, or any
visible or hidden alias of a root command; they also cannot collide with another
configured plugin.

A `run` request carries the invocation and resolved project context:

```json
{
  "palamedesBinaryPluginProtocol": 1,
  "hostVersion": "1.10.0",
  "kind": "run",
  "command": "inspect",
  "args": ["one", "two"],
  "options": { "license": "…" },
  "json": false,
  "interactive": false,
  "config": { "rootDir": "/project" },
  "catalogs": [
    {
      "path": "locales/{locale}/messages",
      "format": "po",
      "include": ["src"],
      "exclude": [],
      "locales": [{ "locale": "en", "path": "/project/locales/en/messages.po" }]
    }
  ]
}
```

`catalogs[].path` is the configured `{locale}` pattern; each
`catalogs[].locales[].path` is the absolute file the extraction pass writes,
storage extension included.

The plugin emits zero or more diagnostic and output events followed by at most
one result event:

```json
{ "event": "diagnostic", "severity": "info", "code": "ACME_INSPECTED", "message": "Inspected 2 catalogs." }
{ "event": "output", "text": "inspecting" }
{ "event": "result", "text": "done", "data": { "count": 2 }, "exitCode": 0 }
```

- stdout is reserved for protocol events; free-form progress belongs on
  stderr, which passes through to the terminal.
- In text mode the host renders `output` events as they arrive; result text,
  data, and diagnostics follow after the plugin exits.
- Diagnostics use `info`, `warning`, or `error` severity and may include
  `code` and structured `details`.
- `--json` folds the result and diagnostics into one host envelope.
- A result exit code is authoritative. Without a result, the process exit code
  is the fallback and the host emits `PLUGIN_BINARY_PROTOCOL`.
- Exit codes range from 0 through 255. Terminal cancellation keeps the usual
  130 (`SIGINT`) and 143 (`SIGTERM`) meanings. On Unix the host isolates the
  plugin process group and forwards `SIGINT` and `SIGTERM` to that group, so
  direct and terminal signals reach the plugin tree exactly once.

## Built-In Commands And Trust

The host sets `PALAMEDES_NATIVE` to the absolute path of the running `pmds`
executable. Trusted plugins may invoke documented built-in commands through
that path. In JSON mode they should capture built-in output so it does not
corrupt the plugin protocol on stdout.

Configured plugins are trusted local code with the same filesystem,
environment, and network permissions as `pmds`. The protocol is a compatibility
boundary, not a sandbox. Built-ins bypass config and plugin resolution, so a
missing or broken plugin cannot affect core commands.

## Rust SDK

The `palamedes-plugin` crate wraps the plugin side: command registration, typed
request context, catalogs, diagnostics, results, and protocol I/O.
`Plugin::run()` handles stdin/stdout; `Plugin::dispatch()` exposes the same path
for tests. `CommandContext::built_in_command()` prepares a `pmds` subprocess
from `PALAMEDES_NATIVE`. See
`crates/palamedes-plugin/examples/inspect.rs` for a complete plugin.
