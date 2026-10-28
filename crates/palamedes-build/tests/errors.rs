//! Typed builder errors: variants, Display text, and source chains.

use std::error::Error as _;
use std::fs;
use std::path::Path;

use palamedes_build::{CatalogBuilder, CatalogContract, Error, extract_messages};

fn catalogs(entries: &[(&str, &str)]) -> tempfile::TempDir {
    let directory = tempfile::tempdir().unwrap();
    for (locale, content) in entries {
        fs::write(directory.path().join(format!("{locale}.po")), content).unwrap();
    }
    directory
}

fn compile(directory: &Path, strict: bool) -> Error {
    let output = tempfile::tempdir().unwrap();
    CatalogBuilder::new(directory, "en")
        .locales(&["en", "de"])
        .fail_on_missing(strict)
        .compile_to(output.path())
        .err()
        .expect("compilation should fail")
}

#[test]
fn errors_cross_threads_and_box_into_dyn_error() {
    fn assert_bounds<T: std::error::Error + Send + Sync + 'static>() {}
    assert_bounds::<Error>();
    let boxed: Box<dyn std::error::Error + Send + Sync> = Error::ContractMismatch.into();
    assert!(boxed.to_string().contains("message contract"));
}

#[test]
fn missing_catalog_files_keep_the_path_and_the_io_source() {
    let directory = catalogs(&[("en", "msgid \"Hello\"\nmsgstr \"Hello\"\n")]);
    let error = compile(directory.path(), false);
    let Error::Io { path, source } = &error else {
        panic!("expected an I/O error, found {error:?}");
    };
    assert!(path.ends_with("de.po"), "{path:?}");
    assert_eq!(source.kind(), std::io::ErrorKind::NotFound);
    assert!(error.to_string().starts_with("could not access "));
    assert!(error.to_string().contains("de.po"), "{error}");
    assert!(
        error
            .source()
            .is_some_and(|source| source.is::<std::io::Error>())
    );
}

#[test]
fn malformed_po_reports_the_locale_and_chains_the_parser_error() {
    let directory = catalogs(&[
        ("en", "msgid \"Hello\"\nmsgstr \"Hello\"\n"),
        ("de", "msgid \"Hello\"\nmsgstr \"Hallo\"\nnot a PO line\n"),
    ]);
    let error = compile(directory.path(), false);
    assert!(
        matches!(&error, Error::ParsePo { locale, .. } if locale == "de"),
        "{error:?}"
    );
    assert!(error.to_string().starts_with("de: invalid PO catalog: "));
    let source = error.source().expect("parser error is chained");
    assert!(error.to_string().ends_with(&source.to_string()));
}

#[test]
fn invalid_icu_reports_the_compiler_error_as_source() {
    let directory = catalogs(&[
        ("en", "msgid \"Hello {name}\"\nmsgstr \"Hello {name}\"\n"),
        ("de", "msgid \"Hello {name}\"\nmsgstr \"Hallo {\"\n"),
    ]);
    let error = compile(directory.path(), false);
    assert!(
        matches!(&error, Error::CompileCatalog { locale, .. } if locale == "de"),
        "{error:?}"
    );
    assert!(error.source().is_some());
}

#[test]
fn translation_contract_errors_name_the_locale_and_source_message() {
    let directory = catalogs(&[
        ("en", "msgid \"Hello {name}\"\nmsgstr \"Hello {name}\"\n"),
        ("de", "msgid \"Hello {name}\"\nmsgstr \"Hallo {other}\"\n"),
    ]);
    let error = compile(directory.path(), false);
    assert!(
        matches!(&error, Error::PlaceholderMismatch { locale, message } if locale == "de" && message == "Hello {name}"),
        "{error:?}"
    );
    assert_eq!(
        error.to_string(),
        "de: placeholder mismatch for \"Hello {name}\""
    );
    assert!(error.source().is_none());
}

#[test]
fn unsupported_formatting_is_a_typed_message_error() {
    let directory = catalogs(&[
        (
            "en",
            "msgid \"{count, number}\"\nmsgstr \"{count, number}\"\n",
        ),
        (
            "de",
            "msgid \"{count, number}\"\nmsgstr \"{count, number}\"\n",
        ),
    ]);
    let error = compile(directory.path(), false);
    assert!(
        matches!(&error, Error::UnsupportedMessage { locale, message, .. } if locale == "en" && message == "{count, number}"),
        "{error:?}"
    );
    assert!(error.to_string().contains("number/date/time formatting"));
}

#[test]
fn strict_builds_report_the_first_missing_translation() {
    let directory = catalogs(&[
        ("en", "msgid \"Hello\"\nmsgstr \"Hello\"\n"),
        ("de", "msgid \"Hello\"\nmsgstr \"\"\n"),
    ]);
    let error = compile(directory.path(), true);
    assert!(
        matches!(&error, Error::MissingTranslation { locale, message } if locale == "de" && message == "Hello"),
        "{error:?}"
    );
    assert_eq!(
        error.to_string(),
        "de: missing or fuzzy translation for \"Hello\" (fail_on_missing)"
    );
}

#[test]
fn builder_options_are_validated_before_reading_catalogs() {
    let output = tempfile::tempdir().unwrap();
    let error = CatalogBuilder::new("does-not-exist", "en")
        .locales(&["en"])
        .macro_name("not an ident")
        .compile_to(output.path())
        .err()
        .unwrap();
    assert!(matches!(error, Error::InvalidMacroName { .. }), "{error:?}");

    let error = CatalogBuilder::new("does-not-exist", "en")
        .locales(&["en"])
        .module_path("other::messages")
        .compile_to(output.path())
        .err()
        .unwrap();
    assert!(
        matches!(error, Error::InvalidModulePath { .. }),
        "{error:?}"
    );

    let error = CatalogBuilder::new("does-not-exist", "en")
        .locales(&["en", "en"])
        .compile_to(output.path())
        .err()
        .unwrap();
    assert!(matches!(error, Error::InvalidLocales), "{error:?}");
}

#[test]
fn contract_files_report_decode_errors_with_their_path() {
    let directory = tempfile::tempdir().unwrap();
    let schema = directory.path().join("schema.pmd.json");
    fs::write(&schema, b"{").unwrap();
    let error = CatalogContract::load(&schema).unwrap_err();
    assert!(
        matches!(&error, Error::DecodeContract { path, .. } if path == &schema),
        "{error:?}"
    );
    assert!(
        error
            .to_string()
            .starts_with("invalid Rust catalog schema ")
    );
    assert!(
        error
            .source()
            .is_some_and(|source| source.is::<serde_json::Error>())
    );
}

#[test]
fn dynamic_extraction_reports_the_macro_and_line() {
    let error = extract_messages("fn f() {\n    tr!(dynamic)\n}", "tr").unwrap_err();
    assert!(
        matches!(&error, Error::DynamicMessage { macro_name, line: 2 } if macro_name == "tr"),
        "{error:?}"
    );
    assert_eq!(
        error.to_string(),
        "tr! requires a literal source message at line 2"
    );

    let error = extract_messages("\"unterminated", "tr").unwrap_err();
    assert!(matches!(error, Error::RustSource { .. }), "{error:?}");
    assert!(error.source().is_some());
}
