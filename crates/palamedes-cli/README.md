# palamedes-cli

The `pmds` command-line interface for
[Palamedes](https://palamedes.dev). It carries the built-in `extract`, `lint`,
`audit`, `report`, `catalog`, and `version` commands, reads the YAML-first
project configuration, and runs binary plugins over the protocol described in
ADR 018.

The binary ships through the `@palamedes/cli` npm package and its platform
packages. It is not published to crates.io yet.

## Documentation

- [CLI reference](https://palamedes.dev/docs/cli)
- [Decision records](https://github.com/sebastian-software/palamedes/tree/main/adr)

## License

Licensed under either of [MIT](../../LICENSE-MIT) or
[Apache-2.0](../../LICENSE-APACHE) at your option.
