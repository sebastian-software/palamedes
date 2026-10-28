# palamedes-i18n

The parser-free Rust runtime for [Palamedes](https://palamedes.dev). Load one
external catalog for the selected locale and render text, named arguments,
selects, and CLDR cardinal/ordinal plurals. English is external too; missing,
corrupt, or incompatible catalogs return errors instead of a language fallback.

Use `palamedes-build` in `build.rs` to generate the message contract and checked
translation macro. Compatible translation updates replace catalog data without
rebuilding the application. The runtime has no Node, PO, or ICU parser dependency.

## Availability and compatibility

The Rust SDK is Preview and published on crates.io from Palamedes 2.0.0. The
three SDK crates share the coordinated Palamedes version; use the same version
for the builder and runtime. No prerelease publishing channel is enabled. Catalog format version 2 is separate from the crate version:
upgrade incompatible schemas, catalogs, and executables together. Within an
unchanged contract, translation edits and new locales do not require a rebuild.
See the [Rust application guide](https://palamedes.dev/docs/rust-applications)
for the supported subset and installation workflow.

The documented API follows Cargo SemVer. `palamedes_i18n::Error` is
`#[non_exhaustive]`. Items hidden from the rustdoc output support generated
code or describe the catalog file format and are not covered. The MSRV policy
is described in the [Rust guide](https://palamedes.dev/docs/rust-applications#semver-and-msrv).

## License

Licensed under either [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE), at your option.
