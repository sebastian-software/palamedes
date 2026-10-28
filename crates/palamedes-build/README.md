# palamedes-build

Cargo build integration for [Palamedes](https://palamedes.dev). Compile PO
catalogs in `build.rs`, generate a source-first translation macro with checked
arguments, and export a message schema for later data-only translation updates.
The application loads external data with `palamedes-i18n`.

```rust,no_run
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let catalogs = palamedes_build::CatalogBuilder::new("locales", "en")
        .locales(&["en", "de"])
        .build()?;
    catalogs.install_to(std::path::Path::new("dist/translations"))?;
    std::fs::copy(catalogs.schema_file, "dist/schema.pmd.json")?;
    Ok(())
}
```

## Availability and compatibility

The Rust SDK is Preview and published on crates.io from Palamedes 2.0.0. The
builder, runtime, and core compiler share the coordinated Palamedes version; use
the same version for the builder and runtime. No prerelease publishing channel
is enabled. Catalog format version 2 is independent
of the crate version; changing message IDs or argument contracts requires an
application rebuild. Compatible translation updates use the exported schema and
a matching `pmds catalog compile --target rust`, without Node or an application
build. See the [Rust application guide](https://palamedes.dev/docs/rust-applications)
for the supported subset and failure modes.

The public API follows Cargo SemVer. Fallible calls return
`palamedes_build::Error`, which is `#[non_exhaustive]` and `Send + Sync`, and
chains I/O and catalog compiler causes through `source()`. The MSRV policy is
described in the [Rust guide](https://palamedes.dev/docs/rust-applications#semver-and-msrv).

## License

Licensed under either [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE), at your option.
