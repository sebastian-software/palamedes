use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use ferrocat::{
    audit_catalogs as ferrocat_audit_catalogs, parse_catalog, CatalogAuditOptions, CatalogMode,
    NormalizedParsedCatalog, ParseCatalogOptions,
};
use serde::{Deserialize, Serialize};

use crate::diagnostic::{CatalogDiagnosticSeverity, CatalogDiagnosticSourceKey};
use crate::error::{PalamedesError, PalamedesResult};
use crate::message_metadata::MessageMetadataInput;

use super::catalog_artifact::{CatalogArtifactConfig, CatalogConfig};

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
    /// Report existing `fuzzy` flags.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fuzzy_flags: Option<bool>,
    /// Report obsolete entries.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub obsolete_entries: Option<bool>,
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
        let mut options = CatalogAuditOptions::new(&request.config.source_locale);
        options.locales = &locale_refs;
        options.metadata = &metadata;
        options.checks = request.checks.to_ferrocat_checks();

        let report = ferrocat_audit_catalogs(&catalogs, &options).map_err(PalamedesError::from)?;
        add_summary(&mut result.summary, &report.summary);

        let paths_by_locale = paths_by_locale(&request.config, catalog);
        for diagnostic in report.diagnostics {
            let locale = diagnostic
                .source_key
                .as_ref()
                .and_then(|source_key| source_key.locale.clone())
                .or_else(|| {
                    diagnostic_locale_from_name(&diagnostic.code, diagnostic.name.as_deref())
                });
            let catalog_path = locale
                .as_deref()
                .and_then(|locale| paths_by_locale.get(locale))
                .cloned()
                .unwrap_or_else(|| source_catalog_path(&request.config, catalog));
            result.diagnostics.push(CatalogAuditDiagnostic {
                severity: diagnostic.severity.into(),
                code: diagnostic.code,
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
    }

    Ok(result)
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
        if let Some(value) = self.fuzzy_flags {
            checks.fuzzy_flags = value;
        }
        if let Some(value) = self.obsolete_entries {
            checks.obsolete_entries = value;
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
        let path = catalog_path(config, catalog, &locale);
        if !path.exists() {
            continue;
        }
        let content = fs::read_to_string(&path).map_err(|source| PalamedesError::ReadFile {
            path: path.clone(),
            source,
        })?;
        let mut options = ParseCatalogOptions::new(&content, &config.source_locale);
        options.locale = Some(locale.as_str());
        options.mode = CatalogMode::IcuPo;

        let parsed = parse_catalog(options).map_err(|source| PalamedesError::ParseCatalog {
            path: path.clone(),
            source,
        })?;
        let catalog =
            parsed
                .into_normalized_view()
                .map_err(|source| PalamedesError::NormalizeCatalog {
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
        .map(|locale| (locale.clone(), catalog_path(config, catalog, locale)))
        .collect()
}

fn catalog_path(config: &CatalogArtifactConfig, catalog: &CatalogConfig, locale: &str) -> PathBuf {
    Path::new(&config.root_dir)
        .join(catalog.path.replace("{locale}", locale))
        .with_extension("po")
}

fn source_catalog_path(config: &CatalogArtifactConfig, catalog: &CatalogConfig) -> PathBuf {
    catalog_path(config, catalog, &config.source_locale)
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
    use crate::{CatalogArtifactConfig, CatalogConfig};

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

    fn config(root: &std::path::Path) -> CatalogArtifactConfig {
        CatalogArtifactConfig {
            root_dir: root.to_string_lossy().into_owned(),
            locales: vec!["en".to_owned(), "de".to_owned(), "es".to_owned()],
            source_locale: "en".to_owned(),
            fallback_locales: None,
            pseudo_locale: None,
            catalogs: vec![CatalogConfig {
                path: "src/locales/{locale}".to_owned(),
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
