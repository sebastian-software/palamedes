use super::{
    compile_catalog_artifact, compile_catalog_artifact_selected, CatalogArtifactConfig,
    CatalogArtifactDiagnosticSeverity, CatalogArtifactRequest, CatalogArtifactSelectedRequest,
    CatalogConfig, PalamedesCatalogFormat,
};
use ferrocat::compiled_key;
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn compiles_catalog_artifact_with_ferrocat_v1_keys() {
    let fixture = create_fixture_dir("catalog-artifact");
    let locale_dir = fixture.join("src/locales");
    fs::create_dir_all(&locale_dir).expect("locale dir");

    fs::write(
        locale_dir.join("en.po"),
        r#"msgid ""
msgstr ""
"Language: en\n"

msgid "Hello"
msgstr ""

msgid "Only source"
msgstr ""
"#,
    )
    .expect("write en");

    fs::write(
        locale_dir.join("de.po"),
        r#"msgid ""
msgstr ""
"Language: de\n"

msgid "Hello"
msgstr "Hallo"
"#,
    )
    .expect("write de");

    let request = CatalogArtifactRequest {
        config: CatalogArtifactConfig {
            root_dir: fixture.to_string_lossy().into_owned(),
            locales: vec!["en".to_owned(), "de".to_owned()],
            source_locale: "en".to_owned(),
            fallback_locales: None,
            pseudo_locale: None,
            catalogs: vec![CatalogConfig {
                path: "src/locales/{locale}".to_owned(),
                format: PalamedesCatalogFormat::Po,
            }],
        },
        resource_path: locale_dir.join("de.po").to_string_lossy().into_owned(),
    };
    let result = compile_catalog_artifact(&request).expect("catalog artifact");

    assert!(!result.watch_files.is_empty());
    assert_eq!(
        result
            .messages
            .get(&compiled_key("Hello", None))
            .map(String::as_str),
        Some("Hallo")
    );
    assert!(result.messages.values().any(|value| value == "Only source"));
    assert_eq!(result.missing.len(), 1);
    assert_eq!(
        result.missing[0].compiled_id,
        compiled_key("Only source", None)
    );
    assert_eq!(result.missing[0].source_key.message, "Only source");
    assert_eq!(result.missing[0].requested_locale, "de");
    assert_eq!(result.missing[0].resolved_locale.as_deref(), Some("en"));
}

#[test]
fn compile_catalog_artifact_collects_diagnostics() {
    let fixture = create_fixture_dir("catalog-artifact-diagnostics");
    let locale_dir = fixture.join("src/locales");
    fs::create_dir_all(&locale_dir).expect("locale dir");

    fs::write(
        locale_dir.join("en.po"),
        r#"msgid ""
msgstr ""
"Language: en\n"

msgid "Hello"
msgstr ""
"#,
    )
    .expect("write en");

    fs::write(
        locale_dir.join("de.po"),
        r#"msgid ""
msgstr ""
"Language: de\n"

msgid "Hello"
msgstr "{name"
"#,
    )
    .expect("write de");

    let request = CatalogArtifactRequest {
        config: CatalogArtifactConfig {
            root_dir: fixture.to_string_lossy().into_owned(),
            locales: vec!["en".to_owned(), "de".to_owned()],
            source_locale: "en".to_owned(),
            fallback_locales: None,
            pseudo_locale: None,
            catalogs: vec![CatalogConfig {
                path: "src/locales/{locale}".to_owned(),
                format: PalamedesCatalogFormat::Po,
            }],
        },
        resource_path: locale_dir.join("de.po").to_string_lossy().into_owned(),
    };
    let result = compile_catalog_artifact(&request).expect("catalog artifact");

    assert_eq!(result.diagnostics.len(), 1);
    assert_eq!(
        result.diagnostics[0].severity,
        CatalogArtifactDiagnosticSeverity::Error
    );
    assert_eq!(
        result.diagnostics[0].compiled_id,
        compiled_key("Hello", None)
    );
    assert_eq!(result.diagnostics[0].source_key.message, "Hello");
    assert_eq!(result.diagnostics[0].locale, "de");
}

#[test]
fn compile_catalog_artifact_accepts_runtime_literal_apostrophes() {
    let fixture = create_fixture_dir("catalog-artifact-apostrophes");
    let locale_dir = fixture.join("src/locales");
    fs::create_dir_all(&locale_dir).expect("locale dir");

    fs::write(
        locale_dir.join("en.po"),
        r#"msgid ""
msgstr ""
"Language: en\n"

msgid "Couldn't load applied rules"
msgstr ""

msgid "ACH Benefit Threshold"
msgstr ""

msgid "Approved - but the email didn't send"
msgstr ""
"#,
    )
    .expect("write en");

    fs::write(
        locale_dir.join("fr.po"),
        r#"msgid ""
msgstr ""
"Language: fr\n"

msgid "Couldn't load applied rules"
msgstr ""

msgid "ACH Benefit Threshold"
msgstr ""

msgid "Approved - but the email didn't send"
msgstr ""
"#,
    )
    .expect("write fr");

    let request = CatalogArtifactRequest {
        config: CatalogArtifactConfig {
            root_dir: fixture.to_string_lossy().into_owned(),
            locales: vec!["en".to_owned(), "fr".to_owned()],
            source_locale: "en".to_owned(),
            fallback_locales: None,
            pseudo_locale: None,
            catalogs: vec![CatalogConfig {
                path: "src/locales/{locale}".to_owned(),
                format: PalamedesCatalogFormat::Po,
            }],
        },
        resource_path: locale_dir.join("fr.po").to_string_lossy().into_owned(),
    };
    let result = compile_catalog_artifact(&request).expect("catalog artifact");

    assert!(result.diagnostics.is_empty());
}

#[test]
fn compile_catalog_artifact_accepts_self_closing_component_placeholders() {
    let fixture = create_fixture_dir("catalog-artifact-self-closing");
    let locale_dir = fixture.join("src/locales");
    fs::create_dir_all(&locale_dir).expect("locale dir");

    let message = "Line one<0/>Line two";
    write_test_catalog(&locale_dir, "en", &[(message, "")]);
    write_test_catalog(&locale_dir, "de", &[(message, message)]);

    let request = CatalogArtifactRequest {
        config: CatalogArtifactConfig {
            root_dir: fixture.to_string_lossy().into_owned(),
            locales: vec!["en".to_owned(), "de".to_owned()],
            source_locale: "en".to_owned(),
            fallback_locales: None,
            pseudo_locale: None,
            catalogs: vec![CatalogConfig {
                path: "src/locales/{locale}".to_owned(),
                format: PalamedesCatalogFormat::Po,
            }],
        },
        resource_path: locale_dir.join("de.po").to_string_lossy().into_owned(),
    };
    let result = compile_catalog_artifact(&request).expect("catalog artifact");

    assert!(
        result.diagnostics.is_empty(),
        "self-closing component placeholder should compile without diagnostics: {:?}",
        result.diagnostics
    );
    assert_eq!(
        result
            .messages
            .get(&compiled_key(message, None))
            .map(String::as_str),
        Some(message)
    );
}

#[test]
fn compile_catalog_artifact_pseudolocalizes_with_ferrocat_runtime_syntax_policy() {
    let fixture = create_fixture_dir("catalog-artifact-pseudo-ferrocat");
    let locale_dir = fixture.join("src/locales");
    fs::create_dir_all(&locale_dir).expect("locale dir");

    fs::write(
        locale_dir.join("en.po"),
        r#"msgid ""
msgstr ""
"Language: en\n"

msgid "You're {name}"
msgstr ""
"#,
    )
    .expect("write en");

    fs::write(
        locale_dir.join("pseudo.po"),
        r#"msgid ""
msgstr ""
"Language: pseudo\n"
"#,
    )
    .expect("write pseudo");

    let request = CatalogArtifactRequest {
        config: CatalogArtifactConfig {
            root_dir: fixture.to_string_lossy().into_owned(),
            locales: vec!["en".to_owned(), "pseudo".to_owned()],
            source_locale: "en".to_owned(),
            fallback_locales: None,
            pseudo_locale: Some("pseudo".to_owned()),
            catalogs: vec![CatalogConfig {
                path: "src/locales/{locale}".to_owned(),
                format: PalamedesCatalogFormat::Po,
            }],
        },
        resource_path: locale_dir.join("pseudo.po").to_string_lossy().into_owned(),
    };
    let result = compile_catalog_artifact(&request).expect("catalog artifact");
    let message = result
        .messages
        .get(&compiled_key("You're {name}", None))
        .expect("pseudolocalized message");

    assert!(message.starts_with("[!! "));
    assert!(message.ends_with(" !!]"));
    assert!(message.contains("{name}"));
    assert_ne!(message, "You're {name}");
    assert!(result.diagnostics.is_empty());
}

#[test]
fn compile_catalog_artifact_selected_pseudolocalizes_with_ferrocat_runtime_syntax_policy() {
    let fixture = create_fixture_dir("selected-catalog-artifact-pseudo-ferrocat");
    let locale_dir = fixture.join("src/locales");
    fs::create_dir_all(&locale_dir).expect("locale dir");

    fs::write(
        locale_dir.join("en.po"),
        r#"msgid ""
msgstr ""
"Language: en\n"

msgid "You're {name}"
msgstr ""

msgid "Other"
msgstr ""
"#,
    )
    .expect("write en");

    fs::write(
        locale_dir.join("pseudo.po"),
        r#"msgid ""
msgstr ""
"Language: pseudo\n"
"#,
    )
    .expect("write pseudo");

    let request = CatalogArtifactSelectedRequest {
        config: CatalogArtifactConfig {
            root_dir: fixture.to_string_lossy().into_owned(),
            locales: vec!["en".to_owned(), "pseudo".to_owned()],
            source_locale: "en".to_owned(),
            fallback_locales: None,
            pseudo_locale: Some("pseudo".to_owned()),
            catalogs: vec![CatalogConfig {
                path: "src/locales/{locale}".to_owned(),
                format: PalamedesCatalogFormat::Po,
            }],
        },
        resource_path: locale_dir.join("pseudo.po").to_string_lossy().into_owned(),
        compiled_ids: vec![compiled_key("You're {name}", None)],
    };
    let result = compile_catalog_artifact_selected(&request).expect("selected catalog artifact");
    let message = result
        .messages
        .get(&compiled_key("You're {name}", None))
        .expect("pseudolocalized message");

    assert_eq!(result.messages.len(), 1);
    assert!(message.starts_with("[!! "));
    assert!(message.ends_with(" !!]"));
    assert!(message.contains("{name}"));
    assert_ne!(message, "You're {name}");
    assert!(result.diagnostics.is_empty());
}

#[test]
fn compile_catalog_artifact_keeps_icu_compatibility_diagnostics_with_apostrophes() {
    let fixture = create_fixture_dir("catalog-artifact-apostrophe-compatibility");
    let locale_dir = fixture.join("src/locales");
    fs::create_dir_all(&locale_dir).expect("locale dir");

    fs::write(
        locale_dir.join("en.po"),
        r#"msgid ""
msgstr ""
"Language: en\n"

msgid "Couldn't load {name}"
msgstr ""
"#,
    )
    .expect("write en");

    fs::write(
        locale_dir.join("de.po"),
        r#"msgid ""
msgstr ""
"Language: de\n"

msgid "Couldn't load {name}"
msgstr "Konnte {firstName}'s Daten nicht laden"
"#,
    )
    .expect("write de");

    let request = CatalogArtifactRequest {
        config: CatalogArtifactConfig {
            root_dir: fixture.to_string_lossy().into_owned(),
            locales: vec!["en".to_owned(), "de".to_owned()],
            source_locale: "en".to_owned(),
            fallback_locales: None,
            pseudo_locale: None,
            catalogs: vec![CatalogConfig {
                path: "src/locales/{locale}".to_owned(),
                format: PalamedesCatalogFormat::Po,
            }],
        },
        resource_path: locale_dir.join("de.po").to_string_lossy().into_owned(),
    };
    let result = compile_catalog_artifact(&request).expect("catalog artifact");

    assert!(!result
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.code == "compile.invalid_icu_message"));
    assert!(result
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.code == "icu.missing_argument"
            && diagnostic.source_key.message == "Couldn't load {name}"
            && diagnostic.locale == "de"));
    assert!(result
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.code == "icu.extra_argument"));
}

#[test]
fn compile_catalog_artifact_accepts_runtime_valid_translation_when_source_msgid_cannot_parse() {
    let fixture = create_fixture_dir("catalog-artifact-apostrophe-source-invalid");
    let locale_dir = fixture.join("src/locales");
    fs::create_dir_all(&locale_dir).expect("locale dir");

    fs::write(
        locale_dir.join("en.po"),
        r#"msgid ""
msgstr ""
"Language: en\n"

msgid "{unclosed"
msgstr ""
"#,
    )
    .expect("write en");

    fs::write(
        locale_dir.join("de.po"),
        r#"msgid ""
msgstr ""
"Language: de\n"

msgid "{unclosed"
msgstr "John's Daten konnten nicht geladen werden"
"#,
    )
    .expect("write de");

    let request = CatalogArtifactRequest {
        config: CatalogArtifactConfig {
            root_dir: fixture.to_string_lossy().into_owned(),
            locales: vec!["en".to_owned(), "de".to_owned()],
            source_locale: "en".to_owned(),
            fallback_locales: None,
            pseudo_locale: None,
            catalogs: vec![CatalogConfig {
                path: "src/locales/{locale}".to_owned(),
                format: PalamedesCatalogFormat::Po,
            }],
        },
        resource_path: locale_dir.join("de.po").to_string_lossy().into_owned(),
    };
    let result = compile_catalog_artifact(&request).expect("catalog artifact");

    assert!(!result.diagnostics.iter().any(|diagnostic| {
        diagnostic.code == "compile.invalid_icu_message"
            && diagnostic.source_key.message == "{unclosed"
            && diagnostic.locale == "de"
    }));
}

#[test]
fn compile_catalog_artifact_reports_icu_compatibility_diagnostics() {
    let fixture = create_fixture_dir("catalog-artifact-icu-compatibility");
    let locale_dir = fixture.join("src/locales");
    fs::create_dir_all(&locale_dir).expect("locale dir");

    fs::write(
        locale_dir.join("en.po"),
        r#"msgid ""
msgstr ""
"Language: en\n"

msgid "Hello {name}"
msgstr ""
"#,
    )
    .expect("write en");

    fs::write(
        locale_dir.join("de.po"),
        r#"msgid ""
msgstr ""
"Language: de\n"

msgid "Hello {name}"
msgstr "Hallo {firstName}"
"#,
    )
    .expect("write de");

    let request = CatalogArtifactRequest {
        config: CatalogArtifactConfig {
            root_dir: fixture.to_string_lossy().into_owned(),
            locales: vec!["en".to_owned(), "de".to_owned()],
            source_locale: "en".to_owned(),
            fallback_locales: None,
            pseudo_locale: None,
            catalogs: vec![CatalogConfig {
                path: "src/locales/{locale}".to_owned(),
                format: PalamedesCatalogFormat::Po,
            }],
        },
        resource_path: locale_dir.join("de.po").to_string_lossy().into_owned(),
    };
    let result = compile_catalog_artifact(&request).expect("catalog artifact");

    assert!(result
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.code == "icu.missing_argument"
            && diagnostic.source_key.message == "Hello {name}"
            && diagnostic.locale == "de"));
    assert!(result
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.code == "icu.extra_argument"));
}

#[test]
fn compile_catalog_artifact_selected_returns_requested_ids_only() {
    let fixture = create_fixture_dir("catalog-artifact-selected");
    let locale_dir = fixture.join("src/locales");
    fs::create_dir_all(&locale_dir).expect("locale dir");

    fs::write(
        locale_dir.join("en.po"),
        r#"msgid ""
msgstr ""
"Language: en\n"

msgid "Hello"
msgstr ""

msgid "Only source"
msgstr ""
"#,
    )
    .expect("write en");

    fs::write(
        locale_dir.join("de.po"),
        r#"msgid ""
msgstr ""
"Language: de\n"

msgid "Hello"
msgstr "Hallo"
"#,
    )
    .expect("write de");

    let request = CatalogArtifactSelectedRequest {
        config: CatalogArtifactConfig {
            root_dir: fixture.to_string_lossy().into_owned(),
            locales: vec!["en".to_owned(), "de".to_owned()],
            source_locale: "en".to_owned(),
            fallback_locales: None,
            pseudo_locale: None,
            catalogs: vec![CatalogConfig {
                path: "src/locales/{locale}".to_owned(),
                format: PalamedesCatalogFormat::Po,
            }],
        },
        resource_path: locale_dir.join("de.po").to_string_lossy().into_owned(),
        compiled_ids: vec![compiled_key("Hello", None)],
    };
    let result = compile_catalog_artifact_selected(&request).expect("selected catalog artifact");

    assert_eq!(result.messages.len(), 1);
    assert_eq!(
        result
            .messages
            .get(&compiled_key("Hello", None))
            .map(String::as_str),
        Some("Hallo")
    );
    assert!(!result
        .messages
        .contains_key(&compiled_key("Only source", None)));
}

#[test]
fn compile_catalog_artifact_selected_reports_icu_compatibility_diagnostics() {
    let fixture = create_fixture_dir("catalog-artifact-selected-icu-compatibility");
    let locale_dir = fixture.join("src/locales");
    fs::create_dir_all(&locale_dir).expect("locale dir");

    fs::write(
        locale_dir.join("en.po"),
        r#"msgid ""
msgstr ""
"Language: en\n"

msgid "Hello {name}"
msgstr ""
"#,
    )
    .expect("write en");

    fs::write(
        locale_dir.join("de.po"),
        r#"msgid ""
msgstr ""
"Language: de\n"

msgid "Hello {name}"
msgstr "Hallo {firstName}"
"#,
    )
    .expect("write de");

    let request = CatalogArtifactSelectedRequest {
        config: CatalogArtifactConfig {
            root_dir: fixture.to_string_lossy().into_owned(),
            locales: vec!["en".to_owned(), "de".to_owned()],
            source_locale: "en".to_owned(),
            fallback_locales: None,
            pseudo_locale: None,
            catalogs: vec![CatalogConfig {
                path: "src/locales/{locale}".to_owned(),
                format: PalamedesCatalogFormat::Po,
            }],
        },
        resource_path: locale_dir.join("de.po").to_string_lossy().into_owned(),
        compiled_ids: vec![compiled_key("Hello {name}", None)],
    };
    let result = compile_catalog_artifact_selected(&request).expect("selected catalog artifact");

    assert_eq!(result.messages.len(), 1);
    assert!(result
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.code == "icu.missing_argument"));
}

#[test]
fn compile_catalog_artifact_reports_runtime_unsupported_formatter_kinds() {
    let fixture = create_fixture_dir("catalog-artifact-runtime-unsupported-kinds");
    let locale_dir = fixture.join("src/locales");
    fs::create_dir_all(&locale_dir).expect("locale dir");

    let source_entries = unsupported_runtime_formatter_kind_messages()
        .into_iter()
        .map(|message| (message, ""))
        .collect::<Vec<_>>();
    write_test_catalog(&locale_dir, "en", &source_entries);
    write_test_catalog(&locale_dir, "de", &[]);

    let request = CatalogArtifactRequest {
        config: CatalogArtifactConfig {
            root_dir: fixture.to_string_lossy().into_owned(),
            locales: vec!["en".to_owned(), "de".to_owned()],
            source_locale: "en".to_owned(),
            fallback_locales: None,
            pseudo_locale: None,
            catalogs: vec![CatalogConfig {
                path: "src/locales/{locale}".to_owned(),
                format: PalamedesCatalogFormat::Po,
            }],
        },
        resource_path: locale_dir.join("de.po").to_string_lossy().into_owned(),
    };
    let result = compile_catalog_artifact(&request).expect("catalog artifact");
    let diagnostics = result
        .diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.code == "icu.unsupported_formatter_kind")
        .collect::<Vec<_>>();

    assert_eq!(diagnostics.len(), 4);
    assert!(diagnostics.iter().all(|diagnostic| {
        diagnostic.severity == CatalogArtifactDiagnosticSeverity::Error && diagnostic.locale == "en"
    }));
    assert_eq!(
        diagnostics
            .iter()
            .map(|diagnostic| diagnostic.source_key.message.as_str())
            .collect::<BTreeSet<_>>(),
        unsupported_runtime_formatter_kind_messages()
            .into_iter()
            .collect::<BTreeSet<_>>()
    );
    assert_eq!(result.missing.len(), 4);
    assert!(result
        .missing
        .iter()
        .all(|missing| missing.resolved_locale.as_deref() == Some("en")));
}

#[test]
fn compile_catalog_artifact_selected_reports_runtime_unsupported_formatter_kinds() {
    let fixture = create_fixture_dir("catalog-artifact-selected-runtime-unsupported-kinds");
    let locale_dir = fixture.join("src/locales");
    fs::create_dir_all(&locale_dir).expect("locale dir");

    let source_entries = unsupported_runtime_formatter_kind_messages()
        .into_iter()
        .map(|message| (message, ""))
        .collect::<Vec<_>>();
    write_test_catalog(&locale_dir, "en", &source_entries);
    write_test_catalog(&locale_dir, "de", &[]);

    let request = CatalogArtifactSelectedRequest {
        config: CatalogArtifactConfig {
            root_dir: fixture.to_string_lossy().into_owned(),
            locales: vec!["en".to_owned(), "de".to_owned()],
            source_locale: "en".to_owned(),
            fallback_locales: None,
            pseudo_locale: None,
            catalogs: vec![CatalogConfig {
                path: "src/locales/{locale}".to_owned(),
                format: PalamedesCatalogFormat::Po,
            }],
        },
        resource_path: locale_dir.join("de.po").to_string_lossy().into_owned(),
        compiled_ids: unsupported_runtime_formatter_kind_messages()
            .into_iter()
            .map(|message| compiled_key(message, None))
            .collect(),
    };
    let result = compile_catalog_artifact_selected(&request).expect("selected catalog artifact");
    let diagnostics = result
        .diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.code == "icu.unsupported_formatter_kind")
        .collect::<Vec<_>>();

    assert_eq!(result.messages.len(), 4);
    assert_eq!(diagnostics.len(), 4);
    assert!(diagnostics.iter().all(|diagnostic| {
        diagnostic.severity == CatalogArtifactDiagnosticSeverity::Error && diagnostic.locale == "en"
    }));
    assert_eq!(
        diagnostics
            .iter()
            .map(|diagnostic| diagnostic.source_key.message.as_str())
            .collect::<BTreeSet<_>>(),
        unsupported_runtime_formatter_kind_messages()
            .into_iter()
            .collect::<BTreeSet<_>>()
    );
}

#[test]
fn compile_catalog_artifact_reports_runtime_unsupported_formatter_styles() {
    let fixture = create_fixture_dir("catalog-artifact-runtime-unsupported-styles");
    let locale_dir = fixture.join("src/locales");
    fs::create_dir_all(&locale_dir).expect("locale dir");

    write_test_catalog(
        &locale_dir,
        "en",
        &[
            ("Compact {amount, number, ::compact-short}", ""),
            ("Bare currency {amount, number, currency/EUR}", ""),
            ("Pattern {when, date, yyyy-MM-dd}", ""),
        ],
    );
    write_test_catalog(
        &locale_dir,
        "de",
        &[
            (
                "Compact {amount, number, ::compact-short}",
                "Kompakt {amount, number, ::compact-short}",
            ),
            (
                "Bare currency {amount, number, currency/EUR}",
                "Bare Waehrung {amount, number, currency/EUR}",
            ),
            (
                "Pattern {when, date, yyyy-MM-dd}",
                "Muster {when, date, yyyy-MM-dd}",
            ),
        ],
    );

    let request = CatalogArtifactRequest {
        config: CatalogArtifactConfig {
            root_dir: fixture.to_string_lossy().into_owned(),
            locales: vec!["en".to_owned(), "de".to_owned()],
            source_locale: "en".to_owned(),
            fallback_locales: None,
            pseudo_locale: None,
            catalogs: vec![CatalogConfig {
                path: "src/locales/{locale}".to_owned(),
                format: PalamedesCatalogFormat::Po,
            }],
        },
        resource_path: locale_dir.join("de.po").to_string_lossy().into_owned(),
    };
    let result = compile_catalog_artifact(&request).expect("catalog artifact");
    let diagnostics = result
        .diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.code == "icu.unsupported_formatter_style")
        .collect::<Vec<_>>();

    assert_eq!(diagnostics.len(), 3);
    assert!(diagnostics.iter().all(|diagnostic| {
        diagnostic.severity == CatalogArtifactDiagnosticSeverity::Warning
            && diagnostic.locale == "de"
    }));
    assert!(diagnostics
        .iter()
        .any(|diagnostic| diagnostic.source_key.message
            == "Compact {amount, number, ::compact-short}"));
    assert!(diagnostics
        .iter()
        .any(|diagnostic| diagnostic.source_key.message
            == "Bare currency {amount, number, currency/EUR}"));
    assert!(diagnostics
        .iter()
        .any(|diagnostic| diagnostic.source_key.message == "Pattern {when, date, yyyy-MM-dd}"));
}

#[test]
fn compile_catalog_artifact_allows_supported_runtime_formatter_subset() {
    let fixture = create_fixture_dir("catalog-artifact-runtime-supported-formatters");
    let locale_dir = fixture.join("src/locales");
    fs::create_dir_all(&locale_dir).expect("locale dir");
    let message = concat!(
        "Values {plain, number} {percent, number, percent} ",
        "{integer, number, integer} {percentSkeleton, number, ::percent} ",
        "{integerSkeleton, number, ::integer} {currency, number, ::currency/EUR} ",
        "{datePlain, date} {dateShort, date, short} {dateMedium, date, medium} ",
        "{dateLong, date, long} {dateFull, date, full} {timePlain, time} ",
        "{timeShort, time, short} {timeMedium, time, medium} {timeLong, time, long} ",
        "{timeFull, time, full}"
    );

    write_test_catalog(&locale_dir, "en", &[(message, "")]);
    write_test_catalog(&locale_dir, "de", &[(message, message)]);

    let request = CatalogArtifactRequest {
        config: CatalogArtifactConfig {
            root_dir: fixture.to_string_lossy().into_owned(),
            locales: vec!["en".to_owned(), "de".to_owned()],
            source_locale: "en".to_owned(),
            fallback_locales: None,
            pseudo_locale: None,
            catalogs: vec![CatalogConfig {
                path: "src/locales/{locale}".to_owned(),
                format: PalamedesCatalogFormat::Po,
            }],
        },
        resource_path: locale_dir.join("de.po").to_string_lossy().into_owned(),
    };
    let result = compile_catalog_artifact(&request).expect("catalog artifact");

    assert!(!result.diagnostics.iter().any(|diagnostic| diagnostic.code
        == "icu.unsupported_formatter_kind"
        || diagnostic.code == "icu.unsupported_formatter_style"));
}

#[test]
fn compile_catalog_artifact_selected_accepts_runtime_literal_apostrophes() {
    let fixture = create_fixture_dir("catalog-artifact-selected-apostrophes");
    let locale_dir = fixture.join("src/locales");
    fs::create_dir_all(&locale_dir).expect("locale dir");

    fs::write(
        locale_dir.join("en.po"),
        r#"msgid ""
msgstr ""
"Language: en\n"

msgid "Couldn't load applied rules"
msgstr ""
"#,
    )
    .expect("write en");

    fs::write(
        locale_dir.join("fr.po"),
        r#"msgid ""
msgstr ""
"Language: fr\n"

msgid "Couldn't load applied rules"
msgstr "Impossible d'ouvrir les regles"
"#,
    )
    .expect("write fr");

    let request = CatalogArtifactSelectedRequest {
        config: CatalogArtifactConfig {
            root_dir: fixture.to_string_lossy().into_owned(),
            locales: vec!["en".to_owned(), "fr".to_owned()],
            source_locale: "en".to_owned(),
            fallback_locales: None,
            pseudo_locale: None,
            catalogs: vec![CatalogConfig {
                path: "src/locales/{locale}".to_owned(),
                format: PalamedesCatalogFormat::Po,
            }],
        },
        resource_path: locale_dir.join("fr.po").to_string_lossy().into_owned(),
        compiled_ids: vec![compiled_key("Couldn't load applied rules", None)],
    };
    let result = compile_catalog_artifact_selected(&request).expect("selected catalog artifact");

    assert_eq!(result.messages.len(), 1);
    assert_eq!(
        result
            .messages
            .get(&compiled_key("Couldn't load applied rules", None))
            .map(String::as_str),
        Some("Impossible d'ouvrir les regles")
    );
    assert!(result.diagnostics.is_empty());
}

fn create_fixture_dir(prefix: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("palamedes-{prefix}-{unique}"));
    fs::create_dir_all(&dir).expect("create temp dir");
    dir
}

fn unsupported_runtime_formatter_kind_messages() -> [&'static str; 4] {
    [
        "Items {items, list}",
        "Elapsed {elapsed, duration}",
        "Updated {updated, ago}",
        "Owner {owner, name}",
    ]
}

fn write_test_catalog(locale_dir: &Path, locale: &str, entries: &[(&str, &str)]) {
    let mut catalog = format!("msgid \"\"\nmsgstr \"\"\n\"Language: {locale}\\n\"\n");

    for (msgid, msgstr) in entries {
        catalog.push('\n');
        catalog.push_str("msgid ");
        catalog.push_str(&po_string(msgid));
        catalog.push('\n');
        catalog.push_str("msgstr ");
        catalog.push_str(&po_string(msgstr));
        catalog.push('\n');
    }

    fs::write(locale_dir.join(format!("{locale}.po")), catalog).expect("write catalog");
}

fn po_string(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}
