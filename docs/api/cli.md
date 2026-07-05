# `@palamedes/cli`

`@palamedes/cli` publishes the `pmds` command.

It is a native Rust binary distributed through npm. The package has no
programmatic JavaScript API, `main`, or `exports` surface.

## Commands

- `pmds extract`
- `pmds audit`
- `pmds report`
- `pmds catalog merge`
- `pmds catalog convert`
- `pmds version`

See the [CLI reference](../cli.md) for flags and examples.

## Programmatic Exports

None. Use `pmds` for extraction, audits, completeness reports, catalog merge
workflows, and catalog conversion. For custom JavaScript tooling, use
`@palamedes/core-node` directly.
