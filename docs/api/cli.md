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
- `pmds catalog compile`
- `pmds version`
- `pmds telemetry` (optional usage reporting, off until you opt in)

See the [CLI reference](../cli.md) for flags and examples.

Release builds run an advisory update check before ordinary commands, only
with an interactive stderr terminal outside CI. The request is a plain GET with
no installation ID, project hash, installed version, platform, or install
cohort; failures are silent and stdout, JSON output, and exit status never
change. `DO_NOT_TRACK=1`, `PALAMEDES_UPDATE_CHECK=0`, `--offline`, or
`PALAMEDES_OFFLINE=1` turn it off. See
[advisory update checks](../cli.md#advisory-update-checks) and
[optional CLI usage reporting](../telemetry.md).

## Plugins

CLI plugins are native executables using binary plugin protocol version 1 over
newline-delimited JSON. See the [binary plugin protocol](./cli-binary-plugin.md).
For lower-level custom JavaScript tooling, use `@palamedes/core-node` directly.
