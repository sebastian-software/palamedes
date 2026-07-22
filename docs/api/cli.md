# `@palamedes/cli`

`@palamedes/cli` publishes the `pmds` command. A small Node.js wrapper delegates
built-in commands to the native Rust sidecar and hosts explicitly configured
third-party command plugins.

## Commands

- `pmds extract`
- `pmds audit`
- `pmds report`
- `pmds catalog merge`
- `pmds catalog convert`
- `pmds version`

See the [CLI reference](../cli.md) for flags and examples.

## Programmatic Exports

- `@palamedes/cli/plugin`: `definePlugin()` and
  `PALAMEDES_PLUGIN_API_VERSION`, plus TypeScript types for the versioned command
  host.

See [CLI plugin API](./cli-plugin.md). For lower-level custom JavaScript tooling,
use `@palamedes/core-node` directly.
