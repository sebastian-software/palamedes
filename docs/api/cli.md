# `@palamedes/cli`

`@palamedes/cli` publishes the `pmds` command.

## Commands

- `pmds extract`
- `pmds audit`
- `pmds catalog merge`
- `pmds version`

See the [CLI reference](../cli.md) for flags and examples.

## Programmatic Exports

The package also exports:

- `extract(options)`
- `audit(options)`
- `mergeCatalog(inputPaths, options)`

These are mostly useful for tests and local automation. The CLI is the public
user-facing workflow.
