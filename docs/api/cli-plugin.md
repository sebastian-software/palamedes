# `@palamedes/cli/plugin`

The versioned CLI plugin API defines explicit, namespaced workflow commands. It
does not provide lifecycle hooks and does not expose Rust or N-API internals.

## Define A Plugin

```js
import { definePlugin } from "@palamedes/cli/plugin"

export default definePlugin({
  name: "acme",
  apiVersion: 1,
  commands: {
    inspect: {
      description: "Inspect configured catalogs.",
      run({ args, options, host, signal }) {
        signal.throwIfAborted()
        host.reportDiagnostic({
          severity: "info",
          code: "ACME_INSPECTED",
          message: `Inspected ${host.catalogs().length} catalog definitions.`,
        })
        return {
          text: `Inspected ${args.length} arguments`,
          data: { catalogs: host.catalogs(), options },
        }
      },
    },
  },
})
```

Configure and invoke it:

```yaml
plugins:
  - ["@acme/palamedes-workflows", { policy: strict }]
```

```bash
pmds acme inspect one two
pmds acme inspect --json one two
pmds acme inspect --config ./palamedes.yaml --json
```

Use `--` when a plugin needs the reserved `--json`, `--config`, or `-c` token as
an ordinary command argument.

## Contract

- `name` and command names use lowercase kebab-case.
- `apiVersion` is currently `1` and must match the host exactly.
- `options` is the value from the config tuple.
- `interactive` is false for JSON output, CI, or non-TTY execution. The host
  never prompts; plugins should only prompt when this value is true.
- `host.config` is the resolved `LoadedPalamedesConfig`.
- `host.catalogs()` returns format, source patterns, and absolute per-locale
  catalog paths without exposing native implementation details.
- `host.runBuiltIn(args)` accepts only documented built-in namespaces and
  returns `{exitCode}`. During a JSON plugin invocation, native stdout and stderr
  are captured as optional `stdout` and `stderr` fields so the CLI still emits
  exactly one JSON envelope.
- `host.reportDiagnostic()` records `info`, `warning`, or `error` diagnostics.
- `signal` is aborted on `SIGINT`/`SIGTERM`; commands should stop cooperatively.

A command may return text or `{text, data, diagnostics, exitCode}`. Without an
explicit exit code, error diagnostics produce `1` and other results produce `0`.
Exit codes must be integers from 0 through 255.

With `--json`, stdout contains exactly one host envelope:

```json
{
  "ok": true,
  "plugin": "acme",
  "command": "inspect",
  "exitCode": 0,
  "result": { "catalogs": [] },
  "diagnostics": []
}
```

Plugins should not write directly to stdout when `json` is true, because doing
so would corrupt the machine-readable stream.

## Resolution And Trust

Plugins are resolved in config order relative to the config file. Duplicate or
built-in namespaces, missing packages, incompatible API versions, invalid
commands, and thrown errors fail with structured diagnostics. Installed packages
that are absent from `plugins` are never loaded.

ESM plugins normally use a default export as shown above. CommonJS packages may
assign the plugin object to `module.exports`; both shapes use Node's package
resolution from the config location.

Configured plugins are trusted code with the same filesystem, environment, and
network permissions as the CLI. The API is a compatibility boundary, not a
sandbox. Built-in commands bypass config and plugin loading, so a broken plugin
does not change `pmds extract`, `audit`, `report`, `catalog`, or `version`.

See [ADR 001](../adr/001-cli-plugin-execution-boundary.md) for the execution-boundary decision.
