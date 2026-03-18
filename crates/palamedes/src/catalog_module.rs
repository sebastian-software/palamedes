use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use ferrocat::{
    compile_catalog_artifact as ferrocat_compile_catalog_artifact,
    compile_catalog_artifact_selected as ferrocat_compile_catalog_artifact_selected, compiled_key,
    parse_catalog, CompileCatalogArtifactOptions, CompileSelectedCatalogArtifactOptions,
    CompiledCatalogIdIndex, CompiledKeyStrategy, DiagnosticSeverity as FerrocatDiagnosticSeverity,
    NormalizedParsedCatalog, ParseCatalogOptions, PluralEncoding,
};
use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogArtifactRequest {
    pub config: CatalogArtifactConfig,
    pub resource_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogArtifactConfig {
    pub root_dir: String,
    pub locales: Vec<String>,
    pub source_locale: String,
    pub fallback_locales: Option<FallbackLocales>,
    pub pseudo_locale: Option<String>,
    pub catalogs: Vec<CatalogConfig>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogArtifactSelectedRequest {
    pub config: CatalogArtifactConfig,
    pub resource_path: String,
    pub compiled_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum FallbackLocales {
    Shared(Vec<String>),
    PerLocale(BTreeMap<String, Vec<String>>),
}

#[derive(Debug, Deserialize)]
pub struct CatalogConfig {
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogArtifactResult {
    pub messages: BTreeMap<String, String>,
    pub watch_files: Vec<String>,
    pub missing: Vec<CatalogArtifactMissingMessage>,
    pub diagnostics: Vec<CatalogArtifactDiagnostic>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_locale_chain: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogArtifactSourceKey {
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CatalogArtifactDiagnosticSeverity {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogArtifactMissingMessage {
    pub compiled_id: String,
    pub source_key: CatalogArtifactSourceKey,
    pub requested_locale: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_locale: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogArtifactDiagnostic {
    pub severity: CatalogArtifactDiagnosticSeverity,
    pub code: String,
    pub message: String,
    pub compiled_id: String,
    pub source_key: CatalogArtifactSourceKey,
    pub locale: String,
}

#[derive(Debug, Clone)]
struct ResolvedCatalogRequest {
    locale: String,
    primary_file: PathBuf,
}

type LocaleCatalogs = BTreeMap<String, NormalizedParsedCatalog>;

pub fn compile_catalog_artifact(
    request: CatalogArtifactRequest,
) -> Result<CatalogArtifactResult, String> {
    let prepared = prepare_compilation(&request.config, &request.resource_path)?;
    let catalogs = prepared.loaded.values().collect::<Vec<_>>();
    let ferrocat_fallback_chain = ferrocat_fallback_chain(
        &prepared.fallback_chain,
        &prepared.locale,
        &request.config.source_locale,
    );
    let artifact = ferrocat_compile_catalog_artifact(
        &catalogs,
        &CompileCatalogArtifactOptions {
            requested_locale: &prepared.locale,
            source_locale: &request.config.source_locale,
            fallback_chain: &ferrocat_fallback_chain,
            key_strategy: CompiledKeyStrategy::FerrocatV1,
            source_fallback: true,
            strict_icu: false,
        },
    )
    .map_err(|error| format!("Failed to compile catalog artifact: {error}"))?;

    build_artifact_result(
        artifact,
        prepared.watch_files,
        prepared.fallback_chain,
        request.config.pseudo_locale.as_deref(),
        &prepared.locale,
    )
}

pub fn compile_catalog_artifact_selected(
    request: CatalogArtifactSelectedRequest,
) -> Result<CatalogArtifactResult, String> {
    let prepared = prepare_compilation(&request.config, &request.resource_path)?;
    let catalogs = prepared.loaded.values().collect::<Vec<_>>();
    let compiled_id_index = CompiledCatalogIdIndex::new(&catalogs, CompiledKeyStrategy::FerrocatV1)
        .map_err(|error| format!("Failed to build compiled ID index: {error}"))?;
    let ferrocat_fallback_chain = ferrocat_fallback_chain(
        &prepared.fallback_chain,
        &prepared.locale,
        &request.config.source_locale,
    );
    let artifact = ferrocat_compile_catalog_artifact_selected(
        &catalogs,
        &compiled_id_index,
        &CompileSelectedCatalogArtifactOptions {
            requested_locale: &prepared.locale,
            source_locale: &request.config.source_locale,
            fallback_chain: &ferrocat_fallback_chain,
            key_strategy: CompiledKeyStrategy::FerrocatV1,
            source_fallback: true,
            strict_icu: false,
            compiled_ids: &request.compiled_ids,
        },
    )
    .map_err(|error| format!("Failed to compile selected catalog artifact: {error}"))?;

    build_artifact_result(
        artifact,
        prepared.watch_files,
        prepared.fallback_chain,
        request.config.pseudo_locale.as_deref(),
        &prepared.locale,
    )
}

struct PreparedCompilation {
    locale: String,
    fallback_chain: Vec<String>,
    watch_files: Vec<PathBuf>,
    loaded: LocaleCatalogs,
}

fn prepare_compilation(
    config: &CatalogArtifactConfig,
    resource_path: &str,
) -> Result<PreparedCompilation, String> {
    let resource_path = PathBuf::from(resource_path);
    let root_dir = PathBuf::from(&config.root_dir);
    let resolved = resolve_catalog_request(config, &resource_path)?;

    let fallback_chain = resolve_locale_chain(config, &resolved.locale);
    let watch_files =
        collect_watch_files(&root_dir, &resolved.primary_file, config, &fallback_chain);
    let loaded = load_catalogs(&watch_files, config)?;

    Ok(PreparedCompilation {
        locale: resolved.locale,
        fallback_chain,
        watch_files,
        loaded,
    })
}

fn build_artifact_result(
    mut artifact: ferrocat::CompiledCatalogArtifact,
    watch_files: Vec<PathBuf>,
    fallback_chain: Vec<String>,
    pseudo_locale: Option<&str>,
    locale: &str,
) -> Result<CatalogArtifactResult, String> {
    if pseudo_locale == Some(locale) {
        for value in artifact.messages.values_mut() {
            *value = maybe_pseudolocalize(value, pseudo_locale, locale);
        }
    }

    Ok(CatalogArtifactResult {
        messages: artifact.messages,
        watch_files: watch_files
            .into_iter()
            .map(|file| file.to_string_lossy().into_owned())
            .collect(),
        missing: artifact
            .missing
            .into_iter()
            .map(CatalogArtifactMissingMessage::from)
            .collect(),
        diagnostics: artifact
            .diagnostics
            .into_iter()
            .map(CatalogArtifactDiagnostic::from)
            .collect(),
        resolved_locale_chain: Some(fallback_chain),
    })
}

fn resolve_catalog_request(
    config: &CatalogArtifactConfig,
    resource_path: &Path,
) -> Result<ResolvedCatalogRequest, String> {
    for catalog in &config.catalogs {
        let absolute_catalog_path = Path::new(&config.root_dir).join(&catalog.path);
        let absolute_po_path = absolute_catalog_path.with_extension("po");
        let pattern = normalize_path(&absolute_po_path);
        let escaped = regex::escape(&pattern);
        let regex_pattern = escaped.replace("\\{locale\\}", "([^/]+)");
        let matcher = Regex::new(&format!("^{regex_pattern}$"))
            .map_err(|error| format!("Invalid catalog path pattern {}: {error}", catalog.path))?;
        let normalized_resource = normalize_path(resource_path);

        if let Some(captures) = matcher.captures(&normalized_resource) {
            let locale = captures
                .get(1)
                .map(|value| value.as_str().to_owned())
                .ok_or_else(|| {
                    format!("Could not resolve locale from {}", resource_path.display())
                })?;
            if !config
                .locales
                .iter()
                .any(|configured| configured == &locale)
            {
                return Err(format!(
                    "Resolved locale {locale} for {} is not listed in palamedes.config locales.",
                    resource_path.display()
                ));
            }
            return Ok(ResolvedCatalogRequest {
                locale,
                primary_file: resource_path.to_path_buf(),
            });
        }
    }

    Err(format!(
        "Requested resource {} is not matched to any configured catalog path.",
        resource_path.display()
    ))
}

fn resolve_locale_chain(config: &CatalogArtifactConfig, locale: &str) -> Vec<String> {
    let mut chain = Vec::new();
    chain.push(locale.to_owned());

    match &config.fallback_locales {
        Some(FallbackLocales::Shared(shared)) => {
            chain.extend(
                shared
                    .iter()
                    .filter(|fallback| fallback.as_str() != locale)
                    .cloned(),
            );
        }
        Some(FallbackLocales::PerLocale(map)) => {
            if let Some(fallbacks) = map.get(locale) {
                chain.extend(
                    fallbacks
                        .iter()
                        .filter(|fallback| fallback.as_str() != locale)
                        .cloned(),
                );
            }
            if let Some(defaults) = map.get("default") {
                for fallback in defaults {
                    if fallback != locale && !chain.contains(fallback) {
                        chain.push(fallback.clone());
                    }
                }
            }
        }
        None => {}
    }

    if !chain.contains(&config.source_locale) {
        chain.push(config.source_locale.clone());
    }

    chain
}

fn ferrocat_fallback_chain(
    resolved_locale_chain: &[String],
    requested_locale: &str,
    source_locale: &str,
) -> Vec<String> {
    resolved_locale_chain
        .iter()
        .filter(|locale| locale.as_str() != requested_locale && locale.as_str() != source_locale)
        .cloned()
        .collect()
}

fn collect_watch_files(
    root_dir: &Path,
    primary_file: &Path,
    config: &CatalogArtifactConfig,
    locale_chain: &[String],
) -> Vec<PathBuf> {
    let mut files = vec![primary_file.to_path_buf()];

    for catalog in &config.catalogs {
        let absolute_catalog_path = root_dir.join(&catalog.path);
        let pattern = normalize_path(&absolute_catalog_path.with_extension("po"));
        let primary_pattern = normalize_path(primary_file);
        let escaped = regex::escape(&pattern);
        let regex_pattern = escaped.replace("\\{locale\\}", "([^/]+)");
        let matcher = Regex::new(&format!("^{regex_pattern}$"));

        let Ok(matcher) = matcher else {
            continue;
        };

        if matcher.is_match(&primary_pattern) {
            for locale in locale_chain {
                let candidate = root_dir
                    .join(catalog.path.replace("{locale}", locale))
                    .with_extension("po");
                if !files.contains(&candidate) {
                    files.push(candidate);
                }
            }
            break;
        }
    }

    files
}

fn load_catalogs(
    files: &[PathBuf],
    config: &CatalogArtifactConfig,
) -> Result<LocaleCatalogs, String> {
    let mut loaded = LocaleCatalogs::new();

    for file in files {
        if !file.exists() {
            if file == &files[0] {
                return Err(format!("Catalog file not found: {}", file.display()));
            }
            continue;
        }

        let locale = infer_locale_from_path(file, config)
            .ok_or_else(|| format!("Could not infer locale for {}", file.display()))?;
        let content = fs::read_to_string(file)
            .map_err(|error| format!("Failed to read {}: {error}", file.display()))?;
        let parsed = parse_catalog(ParseCatalogOptions {
            content: &content,
            locale: Some(locale.as_str()),
            source_locale: &config.source_locale,
            plural_encoding: PluralEncoding::Icu,
            strict: false,
        })
        .map_err(|error| format!("Failed to parse {}: {error}", file.display()))?;

        loaded.insert(
            locale,
            parsed
                .into_normalized_view()
                .map_err(|error| format!("Failed to normalize {}: {error}", file.display()))?,
        );
    }

    Ok(loaded)
}

fn infer_locale_from_path(path: &Path, config: &CatalogArtifactConfig) -> Option<String> {
    let normalized_resource = normalize_path(path);
    for catalog in &config.catalogs {
        let absolute_catalog_path = Path::new(&config.root_dir)
            .join(&catalog.path)
            .with_extension("po");
        let pattern = normalize_path(&absolute_catalog_path);
        let escaped = regex::escape(&pattern);
        let regex_pattern = escaped.replace("\\{locale\\}", "([^/]+)");
        let matcher = Regex::new(&format!("^{regex_pattern}$")).ok()?;
        if let Some(captures) = matcher.captures(&normalized_resource) {
            return captures.get(1).map(|value| value.as_str().to_owned());
        }
    }
    None
}

impl CatalogArtifactSourceKey {
    fn new(message: String, context: Option<String>) -> Self {
        Self { message, context }
    }
}

impl From<ferrocat::CompiledCatalogMissingMessage> for CatalogArtifactMissingMessage {
    fn from(value: ferrocat::CompiledCatalogMissingMessage) -> Self {
        Self {
            compiled_id: compiled_key(&value.source_key.msgid, value.source_key.msgctxt.as_deref()),
            source_key: CatalogArtifactSourceKey::new(
                value.source_key.msgid,
                value.source_key.msgctxt,
            ),
            requested_locale: value.requested_locale,
            resolved_locale: value.resolved_locale,
        }
    }
}

impl From<FerrocatDiagnosticSeverity> for CatalogArtifactDiagnosticSeverity {
    fn from(value: FerrocatDiagnosticSeverity) -> Self {
        match value {
            FerrocatDiagnosticSeverity::Info => Self::Info,
            FerrocatDiagnosticSeverity::Warning => Self::Warning,
            FerrocatDiagnosticSeverity::Error => Self::Error,
        }
    }
}

impl From<ferrocat::CompiledCatalogDiagnostic> for CatalogArtifactDiagnostic {
    fn from(value: ferrocat::CompiledCatalogDiagnostic) -> Self {
        Self {
            severity: value.severity.into(),
            code: value.code,
            message: value.message,
            compiled_id: compiled_key(&value.msgid, value.msgctxt.as_deref()),
            source_key: CatalogArtifactSourceKey::new(value.msgid, value.msgctxt),
            locale: value.locale,
        }
    }
}

fn maybe_pseudolocalize(message: &str, pseudo_locale: Option<&str>, locale: &str) -> String {
    if pseudo_locale != Some(locale) {
        return message.to_owned();
    }

    message
        .chars()
        .map(|ch| match ch {
            'a' => 'á',
            'b' => 'ƀ',
            'c' => 'ç',
            'd' => 'ď',
            'e' => 'ē',
            'f' => 'ƒ',
            'g' => 'ğ',
            'h' => 'ħ',
            'i' => 'ī',
            'j' => 'ĵ',
            'k' => 'ķ',
            'l' => 'ľ',
            'm' => 'ɱ',
            'n' => 'ń',
            'o' => 'ō',
            'p' => 'ƥ',
            'q' => 'ʠ',
            'r' => 'ř',
            's' => 'ş',
            't' => 'ŧ',
            'u' => 'ū',
            'v' => 'ṽ',
            'w' => 'ŵ',
            'x' => 'ẋ',
            'y' => 'ŷ',
            'z' => 'ž',
            'A' => 'Å',
            'B' => 'ß',
            'C' => 'Ç',
            'D' => 'Đ',
            'E' => 'Ē',
            'F' => 'Ƒ',
            'G' => 'Ğ',
            'H' => 'Ħ',
            'I' => 'Ī',
            'J' => 'Ĵ',
            'K' => 'Ķ',
            'L' => 'Ŀ',
            'M' => 'Ṁ',
            'N' => 'Ń',
            'O' => 'Ø',
            'P' => 'Ƥ',
            'Q' => 'Ǫ',
            'R' => 'Ř',
            'S' => 'Š',
            'T' => 'Ŧ',
            'U' => 'Ū',
            'V' => 'Ṽ',
            'W' => 'Ŵ',
            'X' => 'Ẋ',
            'Y' => 'Ŷ',
            'Z' => 'Ž',
            other => other,
        })
        .collect()
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[cfg(test)]
mod tests {
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
        assert!(result
            .messages
            .get(&compiled_key("Only source", None))
            .is_none());
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
}
