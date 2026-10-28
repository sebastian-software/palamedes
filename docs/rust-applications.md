# Rust Applications (Experimental)

Use Palamedes to prepare PO catalogs during a Cargo build, then load the selected
language from a file when your Rust CLI or service runs. Every language, including
English, stays outside the executable. Compatible translation edits and additional
languages can ship without rebuilding it.

The Rust SDK is published on crates.io from Palamedes 2.0.0 as `palamedes-i18n`,
`palamedes`, and `palamedes-build`. It is in the **Preview** tier: the public APIs
follow [Cargo SemVer](#semver-and-msrv), and Preview describes the feature scope.
The current subset is text, display arguments, string selects, and cardinal and
ordinal plurals. Localized number/date/time formatting, rich text, and translation
contexts are rejected. This path does not yet offer the full TypeScript workflow.
See the [stability guide](./stability.md).

## Preview and Publication

The Rust SDK is Preview. The runtime, builder, and core compiler ship in the
coordinated Palamedes release set at the shared version; they do not use
separate SDK versions or an independent prerelease publishing channel. The
shared release policy allows only stable v2-or-later versions. Use the same
registry version for `palamedes-i18n` and `palamedes-build`.

`pnpm verify:rust-sdk` packages the three crates in dependency order and inspects
all archive file lists, license texts, READMEs, packaged builds, and rustdoc. A
loopback sparse staging registry serves those exact archives. An independent
project outside the repository uses exact version-only dependencies, a normal
`build.rs`, and no workspace paths or patches. It runs a copied executable with
external English and German catalogs and an empty `PATH`, checks plurals and
missing/incompatible errors, then compiles a real PO change with native `pmds`
against the exported version 2 schema. The application checksum must remain
unchanged. The receipt is `target/rust-sdk-proof/receipt.json`; temporary consumer
and installation paths are recorded there for inspection.

`pnpm release:rust:dry-run` runs the same verification without uploading. The
Publish workflow uses it before any publication and CI runs the proof on the
pinned Rust toolchain. Staging matters because the builder depends on SDK
versions that reach crates.io only when the same release uploads them, so a
crates.io publish dry run cannot verify that graph. No archive/build verification
is bypassed.

The prepared Cargo lane publishes `palamedes-i18n`, then `palamedes`, then
`palamedes-build`. It checks exact archive checksums before skipping an existing
version, rejects yanked or different content, and waits a bounded interval for
index visibility before packaging the next crate. Registry authentication or
server errors stop the lane. The lane requires a `CRATES_IO_OWNER` repository
variable naming a direct owner; it checks existing names against that owner and
repository, and checks ownership after a first upload before continuing to
dependent crates. After every publish job, the workflow reads the crates.io
index again and fails unless all three crates are there, unyanked, at the
release version.

Before any npm or crates.io upload starts, the `preflight-cargo` job checks the
release policy, the `publish = ["crates-io"]` allowlists, the configured owner,
that all three crates already exist on crates.io with this repository and
owner, and that the release version is not yanked. It also exchanges the
workflow's OIDC identity for a crates.io token without uploading anything. All
upload jobs depend on it, so a Cargo lane that is not ready stops the release
before npm receives a package. The Cargo upload also waits for every native npm
package, so a failed native build stops crates.io as well as the JavaScript
packages. A Publish dry run runs the same registry checks
without the token exchange. When publication is not enabled, it reports the
policy and allowlists instead of enforcing them.

Cargo publication uses [crates.io trusted publishing](https://crates.io/docs/trusted-publishing).
Each crate must trust GitHub Actions for owner `sebastian-software`, repository
`palamedes`, workflow `publish.yml`, with no environment constraint. The
`preflight-cargo` and `publish-cargo` jobs grant `id-token: write` and exchange
their GitHub identity through the commit-pinned `rust-lang/crates-io-auth-action`.
The preflight passes only whether a token was issued to its readiness check. The
publish job passes its temporary token as `CARGO_REGISTRY_TOKEN` only to the SDK
upload step. The action revokes each token when its job completes. No long-lived
Cargo secret or token fallback is used. Authentication failure stops
publication; a dry run does not request an OIDC token. A successful exchange
shows that crates.io trusts this workflow for at least one crate. It does not
prove the trusted-publisher configuration of each crate; only the upload does.

Publication needs both `publicationEnabled: true` in the release policy and
explicit `publish = ["crates-io"]` allowlists in the three SDK crate manifests.
The CLI, Node binding, and plugin crates keep `publish = false`. The `0.0.0`
bootstrap publications established the crate names and ownership. A passing
dry run does not prove trusted-publisher permissions; only an upload does.

## SemVer and MSRV

The crates use the coordinated Palamedes version, and Cargo treats `2.0` to
`2.1` as a compatible upgrade. These Rust APIs therefore follow Cargo SemVer:

- the public API of `palamedes-i18n`
- the public API of `palamedes-build`
- the `palamedes::sdk` module, which `palamedes-build` compiles catalogs with

Everything else in the `palamedes` crate is hidden from its rustdoc. It serves
the `pmds` CLI and the Node binding and can change in any release, so depend on
`palamedes-build` and `palamedes-i18n` rather than on `palamedes` directly.
Items hidden from the `palamedes-i18n` docs support the generated macro or
describe the catalog file format, which `FORMAT_VERSION` versions separately.
Because the code `palamedes-build` generates constructs those hidden items,
`palamedes-build` requires the exact `palamedes-i18n` release it ships with
(`=2.0.0` for 2.0.0), so Cargo upgrades the two crates together.

`palamedes_i18n::Error` and `palamedes_build::Error` are `#[non_exhaustive]`.
New failure kinds can arrive in a minor release, so a `match` on either error
needs a wildcard arm. Both errors are `Send + Sync + 'static` and chain I/O,
decoding, and catalog compiler causes through `std::error::Error::source`.
Data types, such as `CompiledCatalogs`, stay exhaustive.

The minimum supported Rust version (MSRV) is the `rust-version` in the
workspace [`Cargo.toml`](../Cargo.toml). A minor release can raise it, with a
changelog entry. The MSRV stays at least two stable Rust releases behind the
latest stable release.

The crates depend on Ferrocat with caret requirements, so your Cargo graph can
resolve a newer compatible Ferrocat release. Palamedes's own builds and tests
use the exact versions in its `Cargo.lock`.

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
[`Cargo.toml`](../Cargo.toml). Use the same version for both crates:

### `Cargo.toml`

```toml
[package]
name = "greeting-cli"
version = "0.1.0"
edition = "2024"

[dependencies]
palamedes-i18n = "2.0.0"

[build-dependencies]
palamedes-build = "2.0.0"
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

The source-language PO defines the complete message inventory and is always an
input. `.locales()` chooses which language files to emit; it does not require
shipping an English file. Target catalogs may omit entries or contain empty or
fuzzy translations. By default, those entries compile through `.fallback_locales()`
and ultimately the source locale/message. Cargo reports fallback use; other build
hosts can inspect `CompiledCatalogs::missing`. Set `.fail_on_missing(true)` to reject
incomplete target translations. Invalid or unsupported ICU and argument mismatches
still fail compilation. A fallback is compiled into the selected language file;
no source text or fallback language is embedded in the executable.

### `build.rs`

```rust
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let catalogs = palamedes_build::CatalogBuilder::new("locales", "en")
        .locales(&["en", "de"])
        .build()?;
    catalogs.install_to(std::path::Path::new("dist/translations"))?;
    std::fs::copy(&catalogs.schema_file, "dist/schema.pmd.json")?;
    Ok(())
}
```

`build()` writes generated definitions to `OUT_DIR/messages.rs`, an exported
message contract to `OUT_DIR/schema.pmd.json`, and language data to
`OUT_DIR/catalogs/<locale>.pmd.json`. Keep the schema with your translation-build
inputs; it contains IDs and argument signatures, not translations. The running
application only needs its selected language file. Cargo tracks the input catalogs
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
   Ferrocat's catalog compiler and Palamedes's shared message lowering to prepare language
   data and generate a schema plus a real `macro_rules! translate` definition.
2. `include!` makes those definitions available to your Rust program. Rust's own
   compiler expands `translate!` calls. It resolves source literals to internal
   message IDs during constant evaluation and checks named arguments.
3. The executable loads one prepared catalog and renders its instructions.
   The runtime decodes JSON data; it contains no PO or ICU parser. No language
   catalog or source-text rendering fallback is embedded in the executable.

The generator emits one sorted source/signature table and a shared const function
that searches it by binary search. Each macro invocation expands a small lookup,
not a copy of the whole catalog. Both table lookup and argument validation happen
during constant evaluation; the table is not runtime translation storage. If the
generated definitions live inside a module, set `.module_path("crate::messages")`
to that module's crate-relative path so calls from other modules resolve correctly.

There is no source-rewriting command to run before Cargo. The generator produces
definitions; the normal Rust compiler processes macro invocations. Arguments
can appear in any order. Unknown source messages and missing, extra, or duplicate
argument names fail compilation. A plural or ordinal argument also requires a
built-in integer/float type or a validated `PluralNumber`; bare strings and other
`Display` values fail compilation in those positions. Constant messages return `Result<&str, Error>`;
messages with arguments return `Result<String, Error>`. Nonplural argument values
implement `Display` and are inserted literally. Numeric expressions are borrowed
and evaluated once, just like other arguments.

The [checked Rust CLI example](../crates/palamedes-i18n/examples/cli/) also shows
string selects, plurals, and three languages. Its deployment test copies the executable
and selected catalogs into an isolated directory, compiles real PO updates against
the exported contract, and adds a compatible language. It checks that the copied
executable stays byte-for-byte unchanged.

## Plural Messages

Add a complete ICU plural message to the source PO, rather than joining a count
and a translated noun in Rust. For example, append to `locales/en.po`:

```po
msgid "{count, plural, one {# file} other {# files}}"
msgstr "{count, plural, one {# file} other {# files}}"
```

Append its translation to `locales/de.po`:

```po
msgid "{count, plural, one {# file} other {# files}}"
msgstr "{count, plural, one {# Datei} other {# Dateien}}"
```

Then add a call in `main()`. Adding a message changes the contract, so rebuild
and redeploy the executable together with its catalogs:

```rust
let count = 2_usize;
println!(
    "{}",
    translate!(&catalog, "{count, plural, one {# file} other {# files}}", count = count)?
);
// With the German catalog: 2 Dateien
```

`plural` uses the selected catalog locale's CLDR cardinal rules; `selectordinal`
uses its ordinal rules. ICU4X caches the required rule sets when the catalog
loads. Its compiled CLDR rule data is part of the runtime dependency; translated
messages remain external. Regional locales such as `pt-PT` and `pt-BR` retain
their own rules. Supply the categories your translation needs: `zero`, `one`,
`two`, `few`, `many`, and the required `other`. A missing category selects `other`.

Exact branches such as `=0` match the original count before category selection.
With `offset:1`, category selection and `#` use the count minus one. A `#` inside
a nested select keeps the enclosing plural's value; a nested plural supplies
its own value. An apostrophe-quoted `'#'` remains literal text.

The generated signature distinguishes display arguments from numeric plural and
ordinal arguments. Built-in integers and floating-point values, including borrowed
values, work directly. A call such as `count = "drei"` fails Rust compilation,
as do bare decimal strings. Ordinary text and select arguments still accept
`Display` values.

For decimal input that must preserve visible fractional zeros, parse it into
`PluralNumber` before calling the macro:

```rust
let count: palamedes_i18n::PluralNumber = "1.0".parse()?;
println!(
    "{}",
    translate!(&catalog, "{count, plural, one {# file} other {# files}}", count = count)?
);
```

`PluralNumber` validates the signed plain decimal and preserves its visible
digits. English `"1"` selects `one`, while `"1.0"` selects `other`. A floating-point
value whose Rust display is `1` consequently selects `one`. The numeric range
remains at most 18 fractional digits and an `i128` coefficient, including after
offset subtraction. Invalid decimal input fails parsing. Non-finite floats,
exponent notation, out-of-range numeric values, and arithmetic overflow can still
return `Error::PluralArgument` at rendering time; type checking cannot prove those
value constraints. Counts are never rounded through `f64`.

Translations and independent catalog updates cannot introduce a plural for an
argument that the source message only uses as display/select text. Such a change
would impose a new numeric requirement on existing callers, so compilation and
catalog loading reject it. Translations may simplify a numeric argument to plain
display without weakening the source contract.

`#` emits the adjusted value as plain decimal text, preserving fractional zeros.
It does not add localized grouping, separators, or digits. `{count, number}` and
number/date/time styles remain unsupported; format those values in the host
application when needed.

## Update Translations Without Building the Application

Use the native `pmds` CLI from the same Palamedes release as your crates, for
example `@palamedes/cli` 2.0.0; the 1.x CLI does not have this command. Its own
[external UI catalogs](./cli.md#output-language) must be installed alongside it.
The update command itself does not invoke Cargo or rustc for your application.

After the initial application build, change the greeting entry in `locales/de.po`
to the following, keeping any other entries:

```po
msgid "Hello {name}!"
msgstr "Guten Tag {name}!"
```

Compile that PO file against the already exported contract:

```sh
pmds catalog compile --target rust \
  --schema dist/schema.pmd.json \
  --catalog-dir locales --locale de \
  --output dist/translations
```

This writes only `de.pmd.json`, checks the schema fingerprint and full message
contract, and leaves other installed locales in the output directory alone.
Keep `en.po` as the source-inventory input. Repeat `--locale` for multiple output
languages; a new language uses the same workflow with its own `<locale>.po` file.
Use `--fallback-locale` to configure the build-time chain, `--fail-on-missing` for
strict completeness, or `--json` for the output paths and missing-translation
report. Invalid or changed contracts fail before any output catalog is replaced.
Each accepted language file is replaced atomically.

With the `install_dir` created in the deployment example, install the new data
and run the same copied executable:

```sh
cp dist/translations/de.pmd.json "$install_dir/translations/"
(cd "$install_dir" && ./greeting-cli de translations)
# Guten Tag Ada!
```

No application build belongs between those two runs. The equivalent Rust tooling
API loads `CatalogContract::load(schema_path)` and calls
`CatalogBuilder::compile_updates(&contract, output_directory)`.

## Catalog Compatibility and Failures

Plural and pound instructions use compiled format version 2. Version 1 artifacts
and exported schemas must be regenerated with the matching builder, runtime,
and `pmds` implementation. Upgrade the executable and its catalogs together once;
compatible PO updates can then continue using the exported version 2 schema.

Each catalog carries a format version, locale, and fingerprint of message IDs and
argument signatures. Loading checks those fields, the complete message inventory,
and the prepared instruction signatures. The Rust data format is separate from
the JavaScript catalog ABI.

You can replace translated text or add a locale without rebuilding the executable
as long as the message contract stays compatible. Generate new language files
from the same message inventory and signatures using the exported schema. The
source PO remains an input even when no source-language file is emitted. Adding
or removing messages or changing their argument contract requires matching catalogs and an application build.

A missing, corrupt, wrong-locale, or incompatible file returns an error.
`Catalog::load()` attaches the file path to all failures and distinguishes format
version, locale, and contract-fingerprint mismatches. There is no automatic retry in English and no source-text substitution. The small example
above exits through Rust's normal `Result` error reporting. A production host
should choose its own bootstrap diagnostic and exit or request-error policy.

## Extraction and Current Limits

`palamedes_build::extract_messages(source, macro_name)` extracts source literals
and line numbers from Rust token trees, including calls inside attributes. It
ignores comments and ordinary string contents and rejects dynamic source
expressions. It is an API for Rust tooling. **`pmds extract` does not yet extract
Rust sources**; its existing inputs remain JavaScript, TypeScript, and MDX.
The small example above maintains its PO entries directly.

| Message feature                     | Experimental Rust support                                       |
| ----------------------------------- | --------------------------------------------------------------- |
| Literal text                        | Supported                                                       |
| Named display arguments             | Supported; names checked, numeric plural types enforced by Rust |
| String selects                      | Supported                                                       |
| Plurals and ordinal plurals         | Supported; CLDR categories, exact branches, offsets, and `#`    |
| Localized numbers, dates, and times | Rejected at build time                                          |
| Rich text and translation contexts  | Rejected at build time                                          |

Palamedes's own `pmds` CLI uses this integration for external English, German, Spanish, and
French catalogs. Its environment precedence, installation layout, and diagnostic
boundaries are documented in [CLI output language](./cli.md#output-language).
Those are policies of `pmds`, not defaults imposed on your application.
