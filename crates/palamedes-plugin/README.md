# palamedes-plugin

Rust SDK for authoring `pmds` binary plugins. Binary plugins are standalone
executables that the Palamedes CLI spawns and drives over a versioned
newline-delimited JSON protocol on stdio (ADR 018). This crate wraps that
protocol so a plugin registers namespaced commands, receives the resolved
project context, emits diagnostics, and returns a result without implementing
the wire format itself.

The crate is consumed through a path or Git reference; it is not published to
crates.io yet.

## Documentation

- [Plugin protocol (ADR 018)](https://github.com/sebastian-software/palamedes/blob/main/adr/018-binary-plugin-protocol.md)
- [CLI plugin execution boundary (ADR 017)](https://github.com/sebastian-software/palamedes/blob/main/adr/017-cli-plugin-execution-boundary.md)

## License

Licensed under either of [MIT](../../LICENSE-MIT) or
[Apache-2.0](../../LICENSE-APACHE) at your option.
