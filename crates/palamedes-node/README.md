# palamedes-node

N-API bindings that expose the Palamedes Rust core to Node.js. The crate builds
the native addon shipped inside the `@palamedes/core-node` platform packages
and is not published to crates.io.

The exported surface is workflow-first (ADR 009): each binding performs a
complete operation rather than exposing the core object graph.

## Documentation

- [palamedes.dev](https://palamedes.dev)
- [Decision records](https://github.com/sebastian-software/palamedes/tree/main/adr)

## License

Licensed under either of [MIT](../../LICENSE-MIT) or
[Apache-2.0](../../LICENSE-APACHE) at your option.
