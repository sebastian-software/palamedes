use super::{
    compile_catalog_artifact, compile_catalog_artifact_selected, CatalogArtifactConfig,
    CatalogArtifactDiagnosticSeverity, CatalogArtifactRequest, CatalogArtifactSelectedRequest,
    CatalogConfig,
};
use ferrocat::compiled_key;
use std::fs;
use std::path::PathBuf;
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

    let result = compile_catalog_artifact(CatalogArtifactRequest {
        config: CatalogArtifactConfig {
            root_dir: fixture.to_string_lossy().into_owned(),
            locales: vec!["en".to_owned(), "de".to_owned()],
            source_locale: "en".to_owned(),
            fallback_locales: None,
            pseudo_locale: None,
            catalogs: vec![CatalogConfig {
                path: "src/locales/{locale}".to_owned(),
            }],
        },
        resource_path: locale_dir.join("de.po").to_string_lossy().into_owned(),
    })
    .expect("catalog artifact");

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

    let result = compile_catalog_artifact(CatalogArtifactRequest {
        config: CatalogArtifactConfig {
            root_dir: fixture.to_string_lossy().into_owned(),
            locales: vec!["en".to_owned(), "de".to_owned()],
            source_locale: "en".to_owned(),
            fallback_locales: None,
            pseudo_locale: None,
            catalogs: vec![CatalogConfig {
                path: "src/locales/{locale}".to_owned(),
            }],
        },
        resource_path: locale_dir.join("de.po").to_string_lossy().into_owned(),
    })
    .expect("catalog artifact");

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

    let result = compile_catalog_artifact_selected(CatalogArtifactSelectedRequest {
        config: CatalogArtifactConfig {
            root_dir: fixture.to_string_lossy().into_owned(),
            locales: vec!["en".to_owned(), "de".to_owned()],
            source_locale: "en".to_owned(),
            fallback_locales: None,
            pseudo_locale: None,
            catalogs: vec![CatalogConfig {
                path: "src/locales/{locale}".to_owned(),
            }],
        },
        resource_path: locale_dir.join("de.po").to_string_lossy().into_owned(),
        compiled_ids: vec![compiled_key("Hello", None)],
    })
    .expect("selected catalog artifact");

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

fn create_fixture_dir(prefix: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("palamedes-{prefix}-{unique}"));
    fs::create_dir_all(&dir).expect("create temp dir");
    dir
}
