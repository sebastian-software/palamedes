# palamedes

Rust core for [Palamedes](https://palamedes.dev): message extraction, PO and
FCL catalog parsing and serialization, ICU message handling, catalog merging,
and the macro transform that the CLI and the Node binding both build on.

This crate is the implementation the published `@palamedes/*` npm packages
call into. It is published to crates.io as a compiler dependency of
`palamedes-build`; see the repository
[README](https://github.com/sebastian-software/palamedes#readme) for the
supported entry points.

## Availability and compatibility

The Rust SDK is Preview. This core, `palamedes-build`, and `palamedes-i18n`
share the coordinated Palamedes version; no separate prerelease publication
channel is enabled. Use the builder and runtime for applications. The core is
a compiler dependency: only its `palamedes::sdk` module, the entry points that
`palamedes-build` uses, follows Cargo SemVer. Every other item is hidden from
the rustdoc output and serves the CLI and the Node binding; it can change in
any release.

## Documentation

- [palamedes.dev](https://palamedes.dev)
- [Decision records](https://github.com/sebastian-software/palamedes/tree/main/adr)

## License

Licensed under either of [MIT](../../LICENSE-MIT) or
[Apache-2.0](../../LICENSE-APACHE) at your option.
