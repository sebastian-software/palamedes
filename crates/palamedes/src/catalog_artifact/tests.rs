use super::{
    compile_catalog_artifact, compile_catalog_artifact_selected,
    compile_catalog_artifact_selected_cached, resolve_catalog_file_path, CatalogArtifactConfig,
    CatalogArtifactDiagnosticSeverity, CatalogArtifactRequest, CatalogArtifactSelectedRequest,
    CatalogCompilationCache, CatalogConfig, PalamedesCatalogFormat,
};
use crate::test_support::scope_macro_test_source;
use ferrocat::compiled_key;
use std::collections::BTreeSet;
use std::fs;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn catalog_file_paths_preserve_logical_dots_and_canonicalize_storage_extensions() {
    let root = Path::new("workspace");
    let cases = [
        (
            "locales/{locale}/messages.v2",
            "de",
            PalamedesCatalogFormat::Po,
            "locales/de/messages.v2.po",
        ),
        (
            "locales/{locale}",
            "pt.BR",
            PalamedesCatalogFormat::Po,
            "locales/pt.BR.po",
        ),
        (
            "locales/{locale}/messages.po",
            "de",
            PalamedesCatalogFormat::Po,
            "locales/de/messages.po",
        ),
        (
            "locales/{locale}/messages.PO",
            "de",
            PalamedesCatalogFormat::Po,
            "locales/de/messages.po",
        ),
        (
            "locales/{locale}/messages.Po",
            "de",
            PalamedesCatalogFormat::Po,
            "locales/de/messages.po",
        ),
        (
            "locales/{locale}/messages.",
            "de",
            PalamedesCatalogFormat::Po,
            "locales/de/messages.po",
        ),
        (
            "locales/{locale}/messages.fcl",
            "de",
            PalamedesCatalogFormat::Fcl,
            "locales/de/messages.fcl",
        ),
        (
            "locales/{locale}/messages.po",
            "de",
            PalamedesCatalogFormat::Fcl,
            "locales/de/messages.po.fcl",
        ),
        (
            r"locales\{locale}\messages.v2",
            "de",
            PalamedesCatalogFormat::Po,
            r"locales\de\messages.v2.po",
        ),
    ];

    for (pattern, locale, format, expected) in cases {
        assert_eq!(
            resolve_catalog_file_path(root, pattern, locale, format),
            root.join(expected),
            "pattern {pattern} for locale {locale}",
        );
    }
}

#[test]
fn compiles_a_dotted_catalog_name_for_a_dotted_locale() {
    let fixture = create_fixture_dir("catalog-artifact-dotted-path");
    let source_dir = fixture.join("src/locales/en");
    let target_dir = fixture.join("src/locales/pt.BR");
    fs::create_dir_all(&source_dir).expect("source locale dir");
    fs::create_dir_all(&target_dir).expect("target locale dir");
    fs::write(
        source_dir.join("messages.v2.po"),
        "msgid \"\"\nmsgstr \"\"\n\"Language: en\\n\"\n\nmsgid \"Hello\"\nmsgstr \"\"\n",
    )
    .expect("write source catalog");
    fs::write(
        target_dir.join("messages.v2.po"),
        "msgid \"\"\nmsgstr \"\"\n\"Language: pt.BR\\n\"\n\nmsgid \"Hello\"\nmsgstr \"Olá\"\n",
    )
    .expect("write target catalog");

    let target_path = target_dir.join("messages.v2.po");
    let request = CatalogArtifactRequest {
        config: CatalogArtifactConfig {
            root_dir: fixture.to_string_lossy().into_owned(),
            locales: vec!["en".to_owned(), "pt.BR".to_owned()],
            source_locale: "en".to_owned(),
            fallback_locales: None,
            pseudo_locale: None,
            catalogs: vec![CatalogConfig {
                path: "src/locales/{locale}/messages.v2".to_owned(),
                format: PalamedesCatalogFormat::Po,
            }],
        },
        resource_path: target_path.to_string_lossy().into_owned(),
    };

    let result = compile_catalog_artifact(&request).expect("compile dotted catalog path");

    assert_eq!(
        result
            .messages
            .get(&compiled_key("Hello", None))
            .map(String::as_str),
        Some("Olá"),
    );
    assert_eq!(
        result.watch_files,
        vec![target_path, source_dir.join("messages.v2.po")]
    );
}

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
        .get(&compiled_key("You''re {name}", None))
        .expect("pseudolocalized message");

    assert!(message.starts_with("[!! "));
    assert!(message.ends_with(" !!]"));
    assert!(message.contains("{name}"));
    assert_ne!(message, "You''re {name}");
    // The escaped apostrophe stays a single literal apostrophe for the runtime
    // parser instead of being doubled into two.
    assert_eq!(message.matches('\'').count(), 2);
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
        compiled_ids: vec![compiled_key("You''re {name}", None)],
    };
    let result = compile_catalog_artifact_selected(&request).expect("selected catalog artifact");
    let message = result
        .messages
        .get(&compiled_key("You''re {name}", None))
        .expect("pseudolocalized message");

    assert_eq!(result.messages.len(), 1);
    assert!(message.starts_with("[!! "));
    assert!(message.ends_with(" !!]"));
    assert!(message.contains("{name}"));
    assert_ne!(message, "You''re {name}");
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
fn selected_catalog_cache_reuses_parses_and_index_across_sidecars() {
    let fixture = create_fixture_dir("selected-catalog-cache-reuse");
    let locale_dir = fixture.join("src/locales");
    fs::create_dir_all(&locale_dir).expect("locale dir");
    write_numbered_catalog(&locale_dir, "en", "", 64);
    write_numbered_catalog(&locale_dir, "de", "DE ", 64);
    let cache = CatalogCompilationCache::new(8);

    // Each distinct requested ID represents a separate module sidecar. The
    // counters are incremented at the actual parser and ID-index construction
    // sites, so this fails if either heavy operation is keyed by selection.
    for index in 0..64 {
        let message = format!("Message {index}");
        let request = selected_request(&fixture, &locale_dir, &message);
        let result = compile_catalog_artifact_selected_cached(&cache, &request)
            .expect("selected catalog artifact");
        assert_eq!(result.messages.len(), 1);
        let expected = format!("DE {message}");
        assert_eq!(
            result
                .messages
                .get(&compiled_key(&message, None))
                .map(String::as_str),
            Some(expected.as_str())
        );
    }

    assert_eq!(
        cache.statistics(),
        super::cache::CacheStatistics {
            parses: 2,
            index_builds: 1,
        }
    );
}

#[test]
fn selected_catalog_cache_invalidates_equal_mtime_content_replacement() {
    let fixture = create_fixture_dir("selected-catalog-cache-content-replacement");
    let locale_dir = fixture.join("src/locales");
    fs::create_dir_all(&locale_dir).expect("locale dir");
    write_test_catalog(&locale_dir, "en", &[("Hello", "")]);
    write_test_catalog(&locale_dir, "de", &[("Hello", "Hallo")]);
    let request = selected_request(&fixture, &locale_dir, "Hello");
    let cache = CatalogCompilationCache::new(8);

    let first = compile_catalog_artifact_selected_cached(&cache, &request)
        .expect("first selected catalog artifact");
    assert_eq!(
        first
            .messages
            .get(&compiled_key("Hello", None))
            .map(String::as_str),
        Some("Hallo")
    );

    let de_catalog = locale_dir.join("de.po");
    let original_mtime = fs::metadata(&de_catalog)
        .expect("catalog metadata")
        .modified()
        .expect("catalog modified time");
    fs::write(&de_catalog, "this is not a catalog").expect("write malformed catalog");
    restore_mtime(&de_catalog, original_mtime);
    assert!(
        compile_catalog_artifact_selected_cached(&cache, &request).is_err(),
        "a changed malformed catalog must not be hidden behind the prior cached snapshot"
    );

    write_test_catalog(&locale_dir, "de", &[("Hello", "Guten Tag")]);
    restore_mtime(&de_catalog, original_mtime);

    let second = compile_catalog_artifact_selected_cached(&cache, &request)
        .expect("updated selected catalog artifact");
    assert_eq!(
        second
            .messages
            .get(&compiled_key("Hello", None))
            .map(String::as_str),
        Some("Guten Tag")
    );
    assert_eq!(
        cache.ready_len(),
        1,
        "a changed catalog must replace, rather than retain, its superseded cache generation"
    );
    assert_eq!(
        cache.statistics(),
        super::cache::CacheStatistics {
            parses: 5,
            index_builds: 2,
        }
    );
}

#[test]
fn selected_catalog_cache_failures_do_not_consume_ready_capacity() {
    let fixture = create_fixture_dir("selected-catalog-cache-failure-capacity");
    let locale_dir = fixture.join("src/locales");
    fs::create_dir_all(&locale_dir).expect("locale dir");
    write_test_catalog(&locale_dir, "en", &[("Hello", "")]);
    write_test_catalog(&locale_dir, "de", &[("Hello", "Hallo")]);
    write_test_catalog(&locale_dir, "fr", &[("Hello", "Bonjour")]);
    let cache = CatalogCompilationCache::new(1);
    let fr = selected_request_for_locale(&fixture, &locale_dir, "fr", "Hello");
    compile_catalog_artifact_selected_cached(&cache, &fr).expect("warm ready entry");

    fs::write(locale_dir.join("de.po"), "not a catalog").expect("write malformed catalog");
    let de = selected_request_for_locale(&fixture, &locale_dir, "de", "Hello");
    for _ in 0..3 {
        assert!(compile_catalog_artifact_selected_cached(&cache, &de).is_err());
    }
    assert_eq!(
        cache.ready_len(),
        1,
        "failed snapshots must not occupy the LRU"
    );
    compile_catalog_artifact_selected_cached(&cache, &fr).expect("hot ready entry survives");
    assert_eq!(
        cache.statistics(),
        super::cache::CacheStatistics {
            parses: 5,
            index_builds: 1,
        }
    );
}

#[test]
fn selected_catalog_cache_keeps_identical_builds_coalesced_under_capacity_pressure() {
    let fixture = create_fixture_dir("selected-catalog-cache-in-flight-capacity");
    let locale_dir = fixture.join("src/locales");
    fs::create_dir_all(&locale_dir).expect("locale dir");
    write_test_catalog(&locale_dir, "en", &[("Hello", "")]);
    write_test_catalog(&locale_dir, "de", &[("Hello", "Hallo")]);
    write_test_catalog(&locale_dir, "fr", &[("Hello", "Bonjour")]);
    let cache = Arc::new(CatalogCompilationCache::new(1));
    let (started_tx, started_rx) = mpsc::sync_channel(2);
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    let release_rx = Arc::new(Mutex::new(release_rx));
    cache.set_before_build_hook(Arc::new(move |locale| {
        if locale == "de" {
            started_tx.send(()).expect("report build start");
            release_rx
                .lock()
                .expect("release lock")
                .recv()
                .expect("release build");
        }
    }));

    let first_cache = Arc::clone(&cache);
    let first_fixture = fixture.clone();
    let first_dir = locale_dir.clone();
    let first = thread::spawn(move || {
        compile_catalog_artifact_selected_cached(
            &first_cache,
            &selected_request_for_locale(&first_fixture, &first_dir, "de", "Hello"),
        )
    });
    started_rx.recv().expect("first build started");
    compile_catalog_artifact_selected_cached(
        &cache,
        &selected_request_for_locale(&fixture, &locale_dir, "fr", "Hello"),
    )
    .expect("capacity pressure build");

    let second_cache = Arc::clone(&cache);
    let second_fixture = fixture.clone();
    let second_dir = locale_dir.clone();
    let second = thread::spawn(move || {
        compile_catalog_artifact_selected_cached(
            &second_cache,
            &selected_request_for_locale(&second_fixture, &second_dir, "de", "Hello"),
        )
    });
    assert!(
        matches!(
            started_rx.recv_timeout(Duration::from_millis(200)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ),
        "an identical request must wait for the original in-flight build"
    );
    release_tx.send(()).expect("release first build");
    first.join().expect("first join").expect("first result");
    second.join().expect("second join").expect("second result");
    assert_eq!(
        cache.statistics(),
        super::cache::CacheStatistics {
            parses: 4,
            index_builds: 2,
        }
    );
}

#[test]
fn selected_catalog_cache_cleans_up_an_unwinding_in_flight_build() {
    let fixture = create_fixture_dir("selected-catalog-cache-panic-cleanup");
    let locale_dir = fixture.join("src/locales");
    fs::create_dir_all(&locale_dir).expect("locale dir");
    write_test_catalog(&locale_dir, "en", &[("Hello", "")]);
    write_test_catalog(&locale_dir, "de", &[("Hello", "Hallo")]);
    let cache = CatalogCompilationCache::new(1);
    cache.set_before_build_hook(Arc::new(|locale| {
        if locale == "de" {
            panic!("test-only build interruption");
        }
    }));
    let request = selected_request(&fixture, &locale_dir, "Hello");
    assert!(catch_unwind(AssertUnwindSafe(|| {
        compile_catalog_artifact_selected_cached(&cache, &request)
    }))
    .is_err());

    cache.clear_before_build_hook();
    compile_catalog_artifact_selected_cached(&cache, &request)
        .expect("retry after unwinding build");
    assert_eq!(cache.ready_len(), 1);
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
        compiled_ids: vec![compiled_key("Couldn''t load applied rules", None)],
    };
    let result = compile_catalog_artifact_selected(&request).expect("selected catalog artifact");

    assert_eq!(result.messages.len(), 1);
    assert_eq!(
        result
            .messages
            .get(&compiled_key("Couldn''t load applied rules", None))
            .map(String::as_str),
        // Literal apostrophes are emitted in escaped form, which the runtime
        // parser renders as a single apostrophe.
        Some("Impossible d''ouvrir les regles")
    );
    assert!(result.diagnostics.is_empty());
}

/// Cross-locks the two id derivations that have to agree for a runtime lookup
/// to resolve: the id the transform embeds in `getI18n()._("…")` and the key
/// [`compile_catalog_artifact`] derives from the extracted `msgid`.
///
/// Catalog texts are canonicalized into strict ICU quoting when they are
/// loaded, so the compiled key is always the hash of the canonicalized text.
/// The raw-ICU authoring surfaces (descriptor string literals and the
/// `<Trans message>` attribute) therefore only resolve when the transform
/// hashes the canonicalized text as well, while already-escaped authored text
/// has to keep the exact id it had before, because canonicalization is
/// idempotent.
#[test]
fn transform_lookup_ids_match_compiled_catalog_keys() {
    let source = r##"import { t } from "@palamedes/core/macro";
import { Trans } from "@palamedes/react/macro";

const descriptor = t({ message: "Don't greet {name}" }, { name });
const rich = <Trans message="Don't wave at {name}" />;
const authored = t`L'${title} est prêt`;
const colliding = <Trans>{user.name} vs {team.name}</Trans>;
"##;
    let scoped_source = scope_macro_test_source(source, "test.tsx");
    let extracted = crate::extract::extract_messages(&scoped_source, "test.tsx")
        .expect("apostrophe messages should extract");
    let transformed = crate::transform::transform_macros(
        &scoped_source,
        "test.tsx",
        Some(crate::transform::NativeTransformOptions {
            keep_source_fallbacks: Some(true),
            ..crate::transform::NativeTransformOptions::default()
        }),
    )
    .expect("apostrophe messages should transform");

    // Raw-ICU surfaces stay raw in the catalog, authored text stays escaped.
    assert_eq!(
        extracted
            .iter()
            .map(|message| message.message.as_str())
            .collect::<Vec<_>>(),
        vec![
            "Don't greet {name}",
            "Don't wave at {name}",
            "L''{title} est prêt",
            "{name} vs {name_1}",
        ]
    );

    let fixture = create_fixture_dir("catalog-artifact-transform-parity");
    let locale_dir = fixture.join("src/locales");
    fs::create_dir_all(&locale_dir).expect("locale dir");
    let source_entries = extracted
        .iter()
        .map(|message| (message.message.as_str(), ""))
        .collect::<Vec<_>>();
    let translations = extracted
        .iter()
        .map(|message| format!("DE {}", message.message))
        .collect::<Vec<_>>();
    let target_entries = extracted
        .iter()
        .zip(&translations)
        .map(|(message, translation)| (message.message.as_str(), translation.as_str()))
        .collect::<Vec<_>>();
    write_test_catalog(&locale_dir, "en", &source_entries);
    write_test_catalog(&locale_dir, "de", &target_entries);

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

    assert_eq!(transformed.compiled_ids.len(), extracted.len());
    let available = result.messages.keys().cloned().collect::<BTreeSet<_>>();
    let unreachable = transformed
        .compiled_ids
        .iter()
        .zip(&extracted)
        .filter(|(id, _)| !available.contains(*id))
        .map(|(id, message)| format!("{:?} -> {id}", message.message))
        .collect::<Vec<_>>();
    assert!(
        unreachable.is_empty(),
        "transform lookup ids missing from the compiled catalog {:?}: {unreachable:?}",
        available
    );

    // Each translation is actually reachable, not just present as some key.
    // Keep the expected canonical strings independent of Ferrocat's helper so
    // a future policy change cannot silently move both sides of this test.
    let expected_translations = [
        "DE Don''t greet {name}",
        "DE Don''t wave at {name}",
        "DE L''{title} est prêt",
        "DE {name} vs {name_1}",
    ];
    for (id, expected) in transformed.compiled_ids.iter().zip(expected_translations) {
        assert_eq!(result.messages.get(id).map(String::as_str), Some(expected));
    }

    // The raw-ICU surfaces resolve through the canonical form of their text ...
    assert_eq!(
        transformed.compiled_ids[0],
        compiled_key("Don''t greet {name}", None)
    );
    assert_eq!(
        transformed.compiled_ids[1],
        compiled_key("Don''t wave at {name}", None)
    );
    // ... while the escaped authored path keeps the id it already had, because
    // canonicalization is a fixed point there.
    assert_eq!(
        transformed.compiled_ids[2],
        compiled_key("L''{title} est prêt", None)
    );
    assert_eq!(
        transformed.compiled_ids[3],
        compiled_key("{name} vs {name_1}", None)
    );

    // The embedded runtime message text is untouched: only the key is derived
    // from the canonical form.
    assert!(transformed
        .code
        .contains(r#"message: "Don't greet {name}""#));
    assert!(transformed
        .code
        .contains(r#"message={"Don't wave at {name}"}"#));
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

fn selected_request(
    fixture: &Path,
    locale_dir: &Path,
    message: &str,
) -> CatalogArtifactSelectedRequest {
    CatalogArtifactSelectedRequest {
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
        compiled_ids: vec![compiled_key(message, None)],
    }
}

fn selected_request_for_locale(
    fixture: &Path,
    locale_dir: &Path,
    locale: &str,
    message: &str,
) -> CatalogArtifactSelectedRequest {
    let mut request = selected_request(fixture, locale_dir, message);
    request.config.locales.push("fr".to_owned());
    request.resource_path = locale_dir
        .join(format!("{locale}.po"))
        .to_string_lossy()
        .into_owned();
    request
}

fn write_numbered_catalog(locale_dir: &Path, locale: &str, translation_prefix: &str, count: usize) {
    let mut catalog = format!("msgid \"\"\nmsgstr \"\"\n\"Language: {locale}\\n\"\n");
    for index in 0..count {
        let message = format!("Message {index}");
        let translation = format!("{translation_prefix}{message}");
        catalog.push_str(&format!(
            "\nmsgid {}\nmsgstr {}\n",
            po_string(&message),
            po_string(&translation)
        ));
    }
    fs::write(locale_dir.join(format!("{locale}.po")), catalog).expect("write numbered catalog");
}

fn restore_mtime(path: &Path, mtime: SystemTime) {
    fs::OpenOptions::new()
        .write(true)
        .open(path)
        .expect("catalog file")
        .set_times(std::fs::FileTimes::new().set_modified(mtime))
        .expect("restore catalog mtime");
}

fn po_string(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}
