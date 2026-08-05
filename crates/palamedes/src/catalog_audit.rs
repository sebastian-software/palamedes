use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use ferrocat::{
    canonicalize_icu_with_policy, parse_catalog_for_review, parse_icu, CatalogAuditIcuOptions,
    CatalogAuditOptions, CatalogMessage, EffectiveTranslationRef, IcuMessage, IcuNode,
    IcuSyntaxPolicy, NormalizedParsedCatalog, ParseCatalogOptions,
};
use ferrocat_po::audit_catalogs as ferrocat_audit_catalogs;
use serde::{Deserialize, Serialize};

use crate::diagnostic::{CatalogDiagnosticSeverity, CatalogDiagnosticSourceKey};
use crate::error::{PalamedesError, PalamedesResult};
use crate::message_metadata::MessageMetadataInput;

use super::catalog_artifact::{resolve_catalog_path, CatalogArtifactConfig, CatalogConfig};

/// Request for auditing configured catalogs.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogAuditRequest {
    /// Catalog configuration used to resolve files and locales.
    pub config: CatalogArtifactConfig,
    /// Optional target locale filter. Defaults to all non-source locales.
    #[serde(default)]
    pub locales: Vec<String>,
    /// Optional check overrides. Missing fields keep Ferrocat defaults.
    #[serde(default)]
    pub checks: CatalogAuditCheckOptions,
    /// Optional source-side semantic metadata records.
    #[serde(default)]
    pub metadata: Vec<MessageMetadataInput>,
}

/// Optional catalog audit check overrides.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogAuditCheckOptions {
    /// Check that target locales cover active source messages.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completeness: Option<bool>,
    /// Check for active target messages that are not active in the source catalog.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra_messages: Option<bool>,
    /// Validate active source and target message strings as ICU MessageFormat v1.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icu_syntax: Option<bool>,
    /// Compare target ICU structure against source ICU structure.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icu_compatibility: Option<bool>,
    /// Validate source-side semantic message metadata.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub semantic_metadata: Option<bool>,
    /// Report obsolete entries.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub obsolete_entries: Option<bool>,
    /// Report entries carrying a fuzzy review marker.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fuzzy_flags: Option<bool>,
}

/// Aggregate catalog audit result.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogAuditResult {
    /// Aggregate audit counters.
    pub summary: CatalogAuditSummary,
    /// Diagnostics found by the audit.
    pub diagnostics: Vec<CatalogAuditDiagnostic>,
}

/// Summary counters for a catalog audit.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogAuditSummary {
    /// Active source messages considered expected by the audit.
    pub source_messages: usize,
    /// Target locales audited.
    pub target_locales: usize,
    /// Total diagnostics emitted.
    pub diagnostics: usize,
    /// Error diagnostics emitted.
    pub errors: usize,
    /// Warning diagnostics emitted.
    pub warnings: usize,
    /// Informational diagnostics emitted.
    pub infos: usize,
}

/// One machine-readable catalog audit diagnostic.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogAuditDiagnostic {
    /// Severity for the diagnostic.
    pub severity: CatalogDiagnosticSeverity,
    /// Stable machine-readable diagnostic code.
    pub code: String,
    /// Human-readable explanation of the condition.
    pub message: String,
    /// Catalog path associated with this diagnostic.
    pub catalog_path: String,
    /// Locale associated with the diagnostic, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locale: Option<String>,
    /// Source identity associated with the diagnostic, when applicable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_key: Option<CatalogDiagnosticSourceKey>,
    /// Argument, selector, tag, locale, or field name associated with the diagnostic.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

struct LoadedAuditCatalog {
    catalog: NormalizedParsedCatalog,
}

/// Audits configured catalogs with Ferrocat catalog QA checks.
///
/// # Errors
///
/// Returns an error when a catalog file cannot be read or parsed.
pub fn audit_catalogs(request: CatalogAuditRequest) -> PalamedesResult<CatalogAuditResult> {
    let metadata = request
        .metadata
        .into_iter()
        .map(ferrocat::MessageMetadataInput::from)
        .collect::<Vec<_>>();
    let target_locales = target_locales(&request.config, &request.locales);
    let mut result = CatalogAuditResult {
        summary: CatalogAuditSummary::default(),
        diagnostics: Vec::new(),
    };

    for catalog in &request.config.catalogs {
        let loaded = load_audit_catalogs(&request.config, catalog, &target_locales)?;
        let catalogs = loaded
            .iter()
            .map(|entry| &entry.catalog)
            .collect::<Vec<_>>();
        let locale_refs = target_locales
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>();
        let icu_options = CatalogAuditIcuOptions::new()
            .with_syntax_policy(IcuSyntaxPolicy::RuntimeLiteralApostrophes);
        let options = CatalogAuditOptions::new(&request.config.source_locale)
            .with_locales(&locale_refs)
            .with_metadata(&metadata)
            .with_checks(request.checks.to_ferrocat_checks())
            .with_icu_options(icu_options);
        let report = ferrocat_audit_catalogs(&catalogs, &options).map_err(PalamedesError::from)?;
        add_summary(&mut result.summary, &report.summary);

        let paths_by_locale = paths_by_locale(&request.config, catalog);
        for diagnostic in report.diagnostics {
            let locale = diagnostic
                .source_key
                .as_ref()
                .and_then(|source_key| source_key.locale.clone())
                .or_else(|| {
                    diagnostic_locale_from_name(
                        diagnostic.code.as_ref(),
                        diagnostic.name.as_deref(),
                    )
                });
            let catalog_path = locale
                .as_deref()
                .and_then(|locale| paths_by_locale.get(locale))
                .cloned()
                .unwrap_or_else(|| source_catalog_path(&request.config, catalog));
            result.diagnostics.push(CatalogAuditDiagnostic {
                severity: diagnostic.severity.into(),
                code: diagnostic.code.to_string(),
                message: diagnostic.message,
                catalog_path: catalog_path.to_string_lossy().into_owned(),
                locale,
                source_key: diagnostic
                    .source_key
                    .map(|source_key| CatalogDiagnosticSourceKey {
                        message: source_key.msgid,
                        context: source_key.msgctxt,
                    }),
                name: diagnostic.name,
            });
        }
        if request.checks.icu_compatibility.unwrap_or(true) {
            add_plain_argument_occurrence_diagnostics(
                &loaded,
                &request.config.source_locale,
                &target_locales,
                &paths_by_locale,
                &mut result,
            );
        }
    }

    Ok(result)
}

fn add_plain_argument_occurrence_diagnostics(
    loaded: &[LoadedAuditCatalog],
    source_locale: &str,
    target_locales: &[String],
    paths_by_locale: &BTreeMap<String, PathBuf>,
    result: &mut CatalogAuditResult,
) {
    let Some(source_catalog) = loaded
        .iter()
        .find(|loaded| loaded.catalog.parsed_catalog().locale.as_deref() == Some(source_locale))
        .map(|loaded| &loaded.catalog)
    else {
        return;
    };

    for target_locale in target_locales {
        let Some(target_catalog) = loaded
            .iter()
            .find(|loaded| {
                loaded.catalog.parsed_catalog().locale.as_deref() == Some(target_locale.as_str())
            })
            .map(|loaded| &loaded.catalog)
        else {
            continue;
        };
        let Some(target_path) = paths_by_locale.get(target_locale) else {
            continue;
        };

        for (key, source_message) in source_catalog.iter() {
            if source_message.obsolete.is_some() {
                continue;
            }
            let Some(target_message) = target_catalog
                .get(key)
                .filter(|message| message.obsolete.is_none())
            else {
                continue;
            };
            let Some(target_value) = singular_translation(target_message)
                .filter(|translation| !translation.trim().is_empty())
            else {
                continue;
            };
            let Some(source_counts) = plain_argument_occurrences(&key.msgid) else {
                continue;
            };
            let Some(target_counts) = plain_argument_occurrences(target_value) else {
                continue;
            };

            for (name, source_count) in source_counts {
                let Some(target_count) = target_counts.get(&name).copied() else {
                    continue;
                };
                if source_count == target_count {
                    continue;
                }

                result.summary.diagnostics += 1;
                result.summary.errors += 1;
                result.diagnostics.push(CatalogAuditDiagnostic {
                    severity: CatalogDiagnosticSeverity::Error,
                    code: "icu.argument_occurrence_mismatch".to_owned(),
                    message: format!(
                        "ICU argument `{name}` appears {source_count} occurrence(s) in the source and {target_count} in the translation."
                    ),
                    catalog_path: target_path.to_string_lossy().into_owned(),
                    locale: Some(target_locale.clone()),
                    source_key: Some(CatalogDiagnosticSourceKey {
                        message: key.msgid.clone(),
                        context: key.msgctxt.clone(),
                    }),
                    name: Some(name),
                });
            }
        }
    }
}

fn singular_translation(message: &CatalogMessage) -> Option<&str> {
    match message.effective_translation() {
        EffectiveTranslationRef::Singular(value) => Some(value),
        EffectiveTranslationRef::Plural(_) => None,
    }
}

fn plain_argument_occurrences(value: &str) -> Option<BTreeMap<String, usize>> {
    let canonical = canonicalize_icu_with_policy(value, IcuSyntaxPolicy::RuntimeLiteralApostrophes);
    let message = parse_icu(&canonical).ok()?;
    let mut counts = BTreeMap::new();
    count_plain_arguments(&message, &mut counts).then_some(counts)
}

fn count_plain_arguments(message: &IcuMessage, counts: &mut BTreeMap<String, usize>) -> bool {
    count_plain_argument_nodes(&message.nodes, counts)
}

fn count_plain_argument_nodes(nodes: &[IcuNode], counts: &mut BTreeMap<String, usize>) -> bool {
    for node in nodes {
        let name = match node {
            IcuNode::Argument { name }
            | IcuNode::Number { name, .. }
            | IcuNode::Date { name, .. }
            | IcuNode::Time { name, .. }
            | IcuNode::List { name, .. }
            | IcuNode::Duration { name, .. }
            | IcuNode::Ago { name, .. }
            | IcuNode::Name { name, .. } => Some(name),
            IcuNode::Select { .. } | IcuNode::Plural { .. } => return false,
            IcuNode::Tag { children, .. } => {
                if !count_plain_argument_nodes(children, counts) {
                    return false;
                }
                None
            }
            IcuNode::Literal(_) | IcuNode::Pound => None,
            _ => None,
        };
        if let Some(name) = name {
            *counts.entry(name.clone()).or_default() += 1;
        }
    }
    true
}

impl CatalogAuditCheckOptions {
    fn to_ferrocat_checks(&self) -> ferrocat::CatalogAuditChecks {
        let mut checks = ferrocat::CatalogAuditChecks::default();
        if let Some(value) = self.completeness {
            checks.completeness = value;
        }
        if let Some(value) = self.extra_messages {
            checks.extra_messages = value;
        }
        if let Some(value) = self.icu_syntax {
            checks.icu_syntax = value;
        }
        if let Some(value) = self.icu_compatibility {
            checks.icu_compatibility = value;
        }
        if let Some(value) = self.semantic_metadata {
            checks.semantic_metadata = value;
        }
        if let Some(value) = self.obsolete_entries {
            checks.obsolete_entries = value;
        }
        if let Some(value) = self.fuzzy_flags {
            checks.fuzzy_flags = value;
        }
        checks
    }
}

fn target_locales(config: &CatalogArtifactConfig, requested: &[String]) -> Vec<String> {
    if requested.is_empty() {
        return config
            .locales
            .iter()
            .filter(|locale| locale.as_str() != config.source_locale)
            .cloned()
            .collect();
    }

    requested
        .iter()
        .filter(|locale| locale.as_str() != config.source_locale)
        .cloned()
        .collect()
}

fn load_audit_catalogs(
    config: &CatalogArtifactConfig,
    catalog: &CatalogConfig,
    target_locales: &[String],
) -> PalamedesResult<Vec<LoadedAuditCatalog>> {
    let mut locales = vec![config.source_locale.clone()];
    for locale in target_locales {
        if !locales.contains(locale) {
            locales.push(locale.clone());
        }
    }

    let mut loaded = Vec::new();
    for locale in locales {
        let path = resolve_catalog_path(config, catalog, &locale);
        if !path.exists() {
            continue;
        }
        let content = fs::read_to_string(&path).map_err(|source| PalamedesError::ReadFile {
            path: path.clone(),
            source,
        })?;
        let options = ParseCatalogOptions::new(&content, &config.source_locale)
            .with_locale(locale.as_str())
            .with_mode(catalog.format.ferrocat_mode());

        let catalog =
            parse_catalog_for_review(options).map_err(|source| PalamedesError::ParseCatalog {
                path: path.clone(),
                source,
            })?;
        loaded.push(LoadedAuditCatalog { catalog });
    }

    Ok(loaded)
}

fn paths_by_locale(
    config: &CatalogArtifactConfig,
    catalog: &CatalogConfig,
) -> BTreeMap<String, PathBuf> {
    config
        .locales
        .iter()
        .map(|locale| {
            (
                locale.clone(),
                resolve_catalog_path(config, catalog, locale),
            )
        })
        .collect()
}

fn source_catalog_path(config: &CatalogArtifactConfig, catalog: &CatalogConfig) -> PathBuf {
    resolve_catalog_path(config, catalog, &config.source_locale)
}

fn diagnostic_locale_from_name(code: &str, name: Option<&str>) -> Option<String> {
    match code {
        "catalog.missing_locale" | "catalog.missing_source_locale" => name.map(str::to_owned),
        _ => None,
    }
}

fn add_summary(target: &mut CatalogAuditSummary, summary: &ferrocat::CatalogAuditSummary) {
    target.source_messages += summary.source_messages;
    target.target_locales += summary.target_locales;
    target.diagnostics += summary.diagnostics;
    target.errors += summary.errors;
    target.warnings += summary.warnings;
    target.infos += summary.infos;
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{audit_catalogs, CatalogAuditCheckOptions, CatalogAuditRequest};
    use crate::{CatalogArtifactConfig, CatalogConfig, PalamedesCatalogFormat};

    #[test]
    fn reports_missing_and_invalid_catalog_entries() {
        let fixture = create_fixture_dir("catalog-audit");
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

        let result = audit_catalogs(CatalogAuditRequest {
            config: config(&fixture),
            locales: vec!["de".to_owned(), "es".to_owned()],
            checks: CatalogAuditCheckOptions::default(),
            metadata: Vec::new(),
        })
        .expect("audit");

        assert!(result.summary.errors >= 2);
        assert!(result
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "icu.missing_argument"
                && diagnostic.locale.as_deref() == Some("de")));
        assert!(result
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "catalog.missing_locale"
                && diagnostic.locale.as_deref() == Some("es")));
    }

    #[test]
    fn reports_changed_argument_occurrences_in_plain_messages() {
        let fixture = create_fixture_dir("catalog-audit-repeated-arguments");
        let locale_dir = fixture.join("src/locales");
        fs::create_dir_all(&locale_dir).expect("locale dir");
        fs::write(
            locale_dir.join("en.po"),
            r#"msgid ""
msgstr ""
"Language: en\n"

msgid "{count} of {count} sites covered"
msgstr ""

msgid "Owner: {name}"
msgstr ""
"#,
        )
        .expect("write en");
        fs::write(
            locale_dir.join("de.po"),
            r#"msgid ""
msgstr ""
"Language: de\n"

msgid "{count} of {count} sites covered"
msgstr "{count} Standorte abgedeckt"

msgid "Owner: {name}"
msgstr "{name}, Eigentümer: {name}"
"#,
        )
        .expect("write de");

        let result = audit_catalogs(CatalogAuditRequest {
            config: config(&fixture),
            locales: vec!["de".to_owned()],
            checks: CatalogAuditCheckOptions::default(),
            metadata: Vec::new(),
        })
        .expect("audit");

        let occurrence_diagnostics = result
            .diagnostics
            .iter()
            .filter(|diagnostic| diagnostic.code == "icu.argument_occurrence_mismatch")
            .collect::<Vec<_>>();
        assert_eq!(occurrence_diagnostics.len(), 2);
        assert!(occurrence_diagnostics.iter().all(|diagnostic| {
            diagnostic.severity == crate::CatalogDiagnosticSeverity::Error
                && diagnostic.locale.as_deref() == Some("de")
        }));
        assert!(occurrence_diagnostics.iter().any(|diagnostic| {
            diagnostic.name.as_deref() == Some("count")
                && diagnostic.message.contains("2 occurrence(s) in the source")
                && diagnostic.message.contains("1 in the translation")
        }));
        assert!(occurrence_diagnostics.iter().any(|diagnostic| {
            diagnostic.name.as_deref() == Some("name")
                && diagnostic.message.contains("1 occurrence(s) in the source")
                && diagnostic.message.contains("2 in the translation")
        }));
    }

    #[test]
    fn allows_argument_occurrence_differences_in_choice_messages() {
        let fixture = create_fixture_dir("catalog-audit-choice-arguments");
        let locale_dir = fixture.join("src/locales");
        fs::create_dir_all(&locale_dir).expect("locale dir");
        fs::write(
            locale_dir.join("en.po"),
            r#"msgid ""
msgstr ""
"Language: en\n"

msgid "{count, plural, one {{site} is covered} other {{site} and {count} sites are covered}}"
msgstr ""
"#,
        )
        .expect("write en");
        fs::write(
            locale_dir.join("de.po"),
            r#"msgid ""
msgstr ""
"Language: de\n"

msgid "{count, plural, one {{site} is covered} other {{site} and {count} sites are covered}}"
msgstr "{count, plural, one {Eine Site ist abgedeckt} other {{site} und weitere Sites sind abgedeckt}}"
"#,
        )
        .expect("write de");

        let result = audit_catalogs(CatalogAuditRequest {
            config: config(&fixture),
            locales: vec!["de".to_owned()],
            checks: CatalogAuditCheckOptions::default(),
            metadata: Vec::new(),
        })
        .expect("audit");

        assert!(!result
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "icu.argument_occurrence_mismatch"));
    }

    #[test]
    fn accepts_runtime_literal_apostrophes_in_catalog_audit() {
        let fixture = create_fixture_dir("catalog-audit-apostrophes");
        let locale_dir = fixture.join("src/locales");
        fs::create_dir_all(&locale_dir).expect("locale dir");
        fs::write(
            locale_dir.join("en.po"),
            r#"msgid ""
msgstr ""
"Language: en\n"

msgid "Set your working hours and let clients book only when you're available."
msgstr ""

msgid "We've got {count, plural, one {one opening} other {# openings}}."
msgstr ""
"#,
        )
        .expect("write en");
        fs::write(
            locale_dir.join("de.po"),
            r#"msgid ""
msgstr ""
"Language: de\n"

msgid "Set your working hours and let clients book only when you're available."
msgstr "Lege deine Arbeitszeiten fest, damit Kund:innen nur buchen, wenn du verfügbar bist."

msgid "We've got {count, plural, one {one opening} other {# openings}}."
msgstr "Wir haben {count, plural, one {einen freien Termin} other {# freie Termine}}."
"#,
        )
        .expect("write de");

        let result = audit_catalogs(CatalogAuditRequest {
            config: config(&fixture),
            locales: vec!["de".to_owned()],
            checks: CatalogAuditCheckOptions::default(),
            metadata: Vec::new(),
        })
        .expect("audit");

        assert!(!result
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "icu.invalid_syntax"));
    }

    #[test]
    fn flags_translations_whose_quote_swallows_a_placeholder() {
        let fixture = create_fixture_dir("catalog-audit-quoted-placeholder");
        let locale_dir = fixture.join("src/locales");
        fs::create_dir_all(&locale_dir).expect("locale dir");
        fs::write(
            locale_dir.join("en.po"),
            r#"msgid ""
msgstr ""
"Language: en\n"

msgid "{title} is ready"
msgstr ""
"#,
        )
        .expect("write en");
        // `L'{title}` is a quoted literal for the runtime parser, so the
        // translation renders `L{title} est prêt` and no longer uses `title`.
        fs::write(
            locale_dir.join("de.po"),
            r#"msgid ""
msgstr ""
"Language: de\n"

msgid "{title} is ready"
msgstr "L'{title} est bereit"
"#,
        )
        .expect("write de");

        let result = audit_catalogs(CatalogAuditRequest {
            config: config(&fixture),
            locales: vec!["de".to_owned()],
            checks: CatalogAuditCheckOptions::default(),
            metadata: Vec::new(),
        })
        .expect("audit");

        assert!(result
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "icu.missing_argument"
                && diagnostic.locale.as_deref() == Some("de")));
    }

    #[test]
    fn reports_fuzzy_entries_through_the_review_aware_catalog() {
        let fixture = create_fixture_dir("catalog-audit-fuzzy");
        let locale_dir = fixture.join("src/locales");
        fs::create_dir_all(&locale_dir).expect("locale dir");
        fs::write(
            locale_dir.join("en.po"),
            "msgid \"Hello\"\nmsgstr \"Hello\"\n",
        )
        .expect("write en");
        fs::write(
            locale_dir.join("de.po"),
            "#, fuzzy\nmsgid \"Hello\"\nmsgstr \"Hallo\"\n",
        )
        .expect("write de");

        let result = audit_catalogs(CatalogAuditRequest {
            config: config(&fixture),
            locales: vec!["de".to_owned()],
            checks: CatalogAuditCheckOptions::default(),
            metadata: Vec::new(),
        })
        .expect("audit");

        assert!(result
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "catalog.fuzzy_flag"
                && diagnostic.locale.as_deref() == Some("de")));
    }

    #[test]
    fn keeps_real_invalid_icu_syntax_in_catalog_audit() {
        let fixture = create_fixture_dir("catalog-audit-invalid-icu");
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
msgstr "Hallo {{name}}"
"#,
        )
        .expect("write de");

        let result = audit_catalogs(CatalogAuditRequest {
            config: config(&fixture),
            locales: vec!["de".to_owned()],
            checks: CatalogAuditCheckOptions::default(),
            metadata: Vec::new(),
        })
        .expect("audit");

        assert!(result
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "icu.invalid_syntax"
                && diagnostic.locale.as_deref() == Some("de")));
    }

    fn config(root: &std::path::Path) -> CatalogArtifactConfig {
        CatalogArtifactConfig {
            root_dir: root.to_string_lossy().into_owned(),
            locales: vec!["en".to_owned(), "de".to_owned(), "es".to_owned()],
            source_locale: "en".to_owned(),
            fallback_locales: None,
            pseudo_locale: None,
            catalogs: vec![CatalogConfig {
                path: "src/locales/{locale}".to_owned(),
                format: PalamedesCatalogFormat::Po,
            }],
        }
    }

    fn create_fixture_dir(name: &str) -> std::path::PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("palamedes-{name}-{}-{stamp}", std::process::id()));
        fs::create_dir_all(&path).expect("fixture dir");
        path
    }
}
