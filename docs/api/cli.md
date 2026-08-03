# `@palamedes/cli`

`@palamedes/cli` publishes the `pmds` command. A minimal npm launcher selects
the packaged native executable; Rust owns built-ins and explicit binary plugin
commands.

## Commands

- `pmds extract`
- `pmds audit`
- `pmds report`
- `pmds catalog merge`
- `pmds catalog convert`
- `pmds version`

See the [CLI reference](../cli.md) for flags and examples.

## Plugins

CLI plugins are native executables using binary plugin protocol version 1 over
newline-delimited JSON. See the [binary plugin protocol](./cli-binary-plugin.md).
For lower-level custom JavaScript tooling, use `@palamedes/core-node` directly.
