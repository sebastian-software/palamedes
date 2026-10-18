# Rust Applications (Experimental)

Use Palamedes to prepare PO catalogs during a Cargo build, then load the selected
language from a file when your Rust CLI or service runs. Every language, including
English, stays outside the executable. Compatible translation edits and additional
languages can ship without rebuilding it.

This is an experimental repository integration. `palamedes-build` and
`palamedes-i18n` are **not published on crates.io**; the publication hold in
[#1153](https://github.com/sebastian-software/palamedes/issues/1153) still applies.
The current subset is text, display arguments, and string selects. Plurals,
localized number/date/time formatting, rich text, and translation contexts are
rejected. This path does not yet offer the full TypeScript workflow or a stable
Rust SDK contract. See the [stability guide](./stability.md).

## Build a Small CLI

Create a project with this layout:

```text
greeting-cli/
  Cargo.toml
  build.rs
  locales/
    en.po
    de.po
  src/
    main.rs
```

Use a Rust toolchain compatible with the workspace's `rust-version` in
[`Cargo.toml`](../Cargo.toml). Pin both Git dependencies to the same reviewed
revision. This example pins the implementation used by this guide:

### `Cargo.toml`

```toml
[package]
name = "greeting-cli"
version = "0.1.0"
edition = "2024"

[dependencies]
palamedes-i18n = { git = "https://github.com/sebastian-software/palamedes", rev = "fd9d8f67477a14101a572b8adfa5f453efc72ea1" }

[build-dependencies]
palamedes-build = { git = "https://github.com/sebastian-software/palamedes", rev = "fd9d8f67477a14101a572b8adfa5f453efc72ea1" }
```

Inside the Palamedes workspace, path dependencies are also possible. There is no
Node dependency in this Cargo workflow.

### `locales/en.po`

```po
msgid "Hello {name}!"
msgstr "Hello {name}!"
```

### `locales/de.po`

```po
msgid "Hello {name}!"
msgstr "Hallo {name}!"
```

The source-language catalog is required too. Every selected locale must have the
same nonempty message inventory and reviewed, nonempty translations. Missing or
fuzzy entries, malformed ICU, and argument mismatches fail the build.

### `build.rs`

```rust
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let catalogs = palamedes_build::CatalogBuilder::new("locales", "en")
        .locales(&["en", "de"])
        .build()?;
    catalogs.install_to(std::path::Path::new("dist/translations"))?;
    Ok(())
}
```

`build()` writes generated definitions to `OUT_DIR/messages.rs` and prepared
catalogs to `OUT_DIR/catalogs/<locale>.pmd.json`. Cargo tracks the input catalogs
and runs this build script when they change. `install_to()` copies the language
files to a distribution directory chosen by your application. Here that is
`dist/translations/` relative to the package root; the build script owns this
output directory, so use a location appropriate to your packaging workflow.

### `src/main.rs`

```rust
use std::path::PathBuf;

include!(concat!(env!("OUT_DIR"), "/messages.rs"));

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut arguments = std::env::args().skip(1);
    let locale = arguments.next().unwrap_or_else(|| "en".into());
    let directory = PathBuf::from(
        arguments.next().unwrap_or_else(|| "dist/translations".into()),
    );
    let catalog = palamedes_i18n::Catalog::load(
        directory.join(format!("{locale}.pmd.json")),
        &locale,
        CATALOG_SCHEMA,
    )?;
    println!("{}", translate!(&catalog, "Hello {name}!", name = "Ada")?);
    Ok(())
}
```

Run it from the project directory:

```sh
cargo run -- de
# Hallo Ada!
cargo run -- en
# Hello Ada!
```

English is the application's default locale in this example. It still loads
`en.pmd.json` from disk. A missing English catalog is an error, just like a
missing German one.

## Deploy the Executable and Its Language Files

Build the release executable and copy the languages you want to distribute.
This POSIX shell example installs only German into a temporary directory:

```sh
cargo build --release
install_dir="$(mktemp -d)"
mkdir -p "$install_dir/translations"
cp target/release/greeting-cli "$install_dir/"
cp dist/translations/de.pmd.json "$install_dir/translations/"
(cd "$install_dir" && ./greeting-cli de translations)
# Hallo Ada!
```

Windows builds produce `greeting-cli.exe`; copy it and the catalog files with
your platform's packaging tools. Neither installation needs Node, PO files, a
Palamedes checkout, or an English language file to render German.

The application owns locale selection and path discovery. A CLI might inspect
`LC_ALL`, `LC_MESSAGES`, and `LANG`; a service might resolve a locale per request.
The runtime does not read headers or environment variables or search directories.
Pass the selected locale and file path explicitly. Catalogs are immutable, so a
service can keep independent instances per locale and share them across threads.
`Catalog::from_bytes(bytes, locale, CATALOG_SCHEMA)` supports other storage paths.

## What the Generator and Rust Compiler Each Do

1. Cargo invokes `build.rs` as part of `cargo build`. `palamedes-build` uses
   Palamedes's catalog compiler and Ferrocat's ICU semantics to prepare language
   data and generate a schema plus a real `macro_rules! translate` definition.
2. `include!` makes those definitions available to your Rust program. Rust's own
   compiler expands `translate!` calls. It resolves source literals to internal
   message IDs during constant evaluation and checks named arguments.
3. The executable loads one prepared catalog and renders its instructions.
   The runtime decodes JSON data; it contains no PO or ICU parser. No language
   catalog or source-text rendering fallback is embedded in the executable.

There is no source-rewriting command to run before Cargo. The generator produces
definitions; the normal Rust compiler processes macro invocations. Arguments
can appear in any order. Unknown source messages and missing, extra, or duplicate
argument names fail compilation. Constant messages return `Result<&str, Error>`;
messages with arguments return `Result<String, Error>`. Argument values implement
`Display` and are inserted literally.

The [checked Rust CLI example](../crates/palamedes-i18n/examples/cli/) also shows
string selects and three languages. Its deployment test copies the executable
and selected catalogs into an isolated directory, changes compatible translations,
and adds a compatible language without rebuilding the executable.

## Catalog Compatibility and Failures

Each catalog carries a format version, locale, and fingerprint of message IDs and
argument signatures. Loading checks those fields, the complete message inventory,
and the prepared instruction signatures. The Rust data format is separate from
the JavaScript catalog ABI.

You can replace translated text or add a locale without rebuilding the executable
as long as the message contract stays compatible. Generate new language files
from the same message inventory and signatures, and include the source locale in
the builder's selected locales. Adding or removing messages or changing their
argument contract requires matching catalogs and an application build.

A missing, corrupt, wrong-locale, or incompatible file returns an error. There is
no automatic retry in English and no source-text substitution. The small example
above exits through Rust's normal `Result` error reporting. A production host
should choose its own bootstrap diagnostic and exit or request-error policy.

## Extraction and Current Limits

`palamedes_build::extract_messages(source, macro_name)` extracts source literals
and line numbers from Rust token trees, including calls inside attributes. It
ignores comments and ordinary string contents and rejects dynamic source
expressions. It is an API for Rust tooling. **`pmds extract` does not yet extract
Rust sources**; its existing inputs remain JavaScript, TypeScript, and MDX.
The small example above maintains its PO entries directly.

| Message feature                     | Experimental Rust support                 |
| ----------------------------------- | ----------------------------------------- |
| Literal text                        | Supported                                 |
| Named display arguments             | Supported; argument names checked by Rust |
| String selects                      | Supported                                 |
| Plurals and ordinal plurals         | Rejected at build time                    |
| Localized numbers, dates, and times | Rejected at build time                    |
| Rich text and translation contexts  | Rejected at build time                    |

Palamedes's own `pmds` CLI uses this integration for external English, German, and
Spanish catalogs. Its environment precedence, installation layout, and diagnostic
boundaries are documented in [CLI output language](./cli.md#output-language).
Those are policies of `pmds`, not defaults imposed on your application.
