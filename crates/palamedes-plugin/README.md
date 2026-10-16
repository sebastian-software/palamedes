# palamedes-plugin

Rust SDK for authoring `pmds` binary plugins. Binary plugins are standalone
executables that the Palamedes CLI spawns and drives over a versioned
newline-delimited JSON protocol on stdio (ADR-025). This crate wraps that
protocol so a plugin registers namespaced commands, receives the resolved
project context, emits diagnostics, and returns a result without implementing
the wire format itself.

The crate is consumed through a path or Git reference; it is not published to
crates.io yet.

## Documentation

- [Plugin protocol (ADR-025)](https://github.com/sebastian-software/palamedes/blob/main/adr/025-binary-plugin-protocol.md)
- [CLI plugin execution boundary (ADR-015)](https://github.com/sebastian-software/palamedes/blob/main/adr/015-cli-plugin-execution-boundary.md)

## License

Licensed under either of [MIT](../../LICENSE-MIT) or
[Apache-2.0](../../LICENSE-APACHE) at your option.
