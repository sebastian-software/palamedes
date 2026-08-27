# `@palamedes/cli`

`@palamedes/cli` publishes the `pmds` command. A minimal npm launcher selects
the packaged native executable; Rust owns built-ins and explicit binary plugin
commands.

## Commands

- `pmds extract` (`--check` verifies catalog drift without rewriting files)
- `pmds lint`
- `pmds audit`
- `pmds report`
- `pmds catalog merge`
- `pmds catalog merge-driver`
- `pmds catalog convert`
- `pmds version`

See the [CLI reference](../cli.md) for flags and examples.

The CLI reference also documents the deployment-gated advisory update check,
its 24-hour cache, exact six-field request with the year-month install
cohort, two opt-outs, stderr-only notice,
non-fatal two-second network bound, build-time endpoint allowlist, and the
distinction between protocol-only path/media/length validation and aggregate
storage.

## Plugins

CLI plugins are native executables using binary plugin protocol version 1 over
newline-delimited JSON. See the [binary plugin protocol](./cli-binary-plugin.md).
For lower-level custom JavaScript tooling, use `@palamedes/core-node` directly.
