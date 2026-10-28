use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

use ferrocat::po::diagnostic_codes::catalog::FUZZY_FLAG;
use ferrocat::{
    ApiError, CatalogAuditChecks, CatalogAuditOptions, CatalogMessageKey, NormalizedParsedCatalog,
    ParseCatalogOptions, TranslationShape, audit_catalogs, parse_catalog_for_review,
};
use sha2::{Digest, Sha256};

use super::resolve::{catalog_locale_matcher, normalize_path};
use super::types::{CatalogArtifactConfig, CatalogConfig};
use crate::error::{PalamedesError, PalamedesResult};

pub(super) type LocaleCatalogs = BTreeMap<String, NormalizedParsedCatalog>;

pub(super) struct CatalogSource {
    pub(super) path: std::path::PathBuf,
    pub(super) locale: String,
    pub(super) format: super::types::PalamedesCatalogFormat,
    pub(super) content: String,
    pub(super) digest: [u8; 32],
}

pub(super) type CatalogSources = Vec<CatalogSource>;

pub(super) fn load_catalogs(
    files: &[std::path::PathBuf],
    config: &CatalogArtifactConfig,
) -> PalamedesResult<LocaleCatalogs> {
    let sources = read_catalog_sources(files, config)?;
    parse_catalog_sources(&sources, &config.source_locale)
}

/// Reads every configured dependency before cache lookup. A content digest is
/// deliberately used instead of metadata: some editors retain timestamps when
/// atomically replacing a catalog, and serving that older snapshot would make
/// dev rebuilds observably stale.
pub(super) fn read_catalog_sources(
    files: &[std::path::PathBuf],
    config: &CatalogArtifactConfig,
) -> PalamedesResult<CatalogSources> {
    let mut sources = Vec::new();

    for (index, file) in files.iter().enumerate() {
        let locale = infer_locale_from_path(file, config)?
            .ok_or_else(|| PalamedesError::CouldNotInferLocale { path: file.clone() })?;
        let content = match fs::read_to_string(file) {
            Ok(content) => content,
            Err(source) if source.kind() == std::io::ErrorKind::NotFound && index == 0 => {
                return Err(PalamedesError::CatalogFileNotFound { path: file.clone() });
            }
            Err(source) if source.kind() == std::io::ErrorKind::NotFound => continue,
            Err(source) => {
                return Err(PalamedesError::ReadFile {
                    path: file.clone(),
                    source,
                });
            }
        };
        let catalog = catalog_for_path(file, config)?
            .ok_or_else(|| PalamedesError::CouldNotInferLocale { path: file.clone() })?;
        let digest = Sha256::digest(content.as_bytes()).into();
        sources.push(CatalogSource {
            path: file.clone(),
            locale,
            format: catalog.format,
            content,
            digest,
        });
    }

    Ok(sources)
}

pub(super) fn parse_catalog_sources(
    sources: &[CatalogSource],
    source_locale: &str,
) -> PalamedesResult<LocaleCatalogs> {
    parse_catalog_sources_with_observer(sources, source_locale, || {})
}

pub(super) fn parse_catalog_sources_with_observer<F>(
    sources: &[CatalogSource],
    source_locale: &str,
    mut on_parse: F,
) -> PalamedesResult<LocaleCatalogs>
where
    F: FnMut(),
{
    let mut loaded = LocaleCatalogs::new();
    for source in sources {
        let options = ParseCatalogOptions::new(&source.content, source_locale)
            .with_locale(source.locale.as_str())
            .with_mode(source.format.ferrocat_mode());
        on_parse();
        let catalog = parse_catalog_for_compile(options).map_err(|source_error| {
            // Only normalization reports duplicate identities as conflicts.
            if matches!(source_error, ApiError::Conflict(_)) {
                PalamedesError::NormalizeCatalog {
                    path: source.path.clone(),
                    source: source_error,
                }
            } else {
                PalamedesError::ParseCatalog {
                    path: source.path.clone(),
                    source: source_error,
                }
            }
        })?;
        loaded.insert(source.locale.clone(), catalog);
    }
    Ok(loaded)
}

/// Parses one catalog into the normalized view that catalog compilers consume.
///
/// Ferrocat's ordinary normalized projection discards review flags. This
/// projection keeps an active `fuzzy` entry's identity but clears its
/// translation, so compilation resolves it through the fallback chain and the
/// source message and reports it as missing, like an untranslated entry. The
/// JavaScript and Rust catalog targets both compile through this projection.
///
/// The catalog locale must come from `options` or from the catalog content.
///
/// # Errors
///
/// Returns Ferrocat's error when the content cannot be parsed, has no locale,
/// or contains duplicate message identities.
pub fn parse_catalog_for_compile(
    options: ParseCatalogOptions<'_>,
) -> Result<NormalizedParsedCatalog, ApiError> {
    let reviewed = parse_catalog_for_review(options)?;
    let fuzzy = fuzzy_message_keys(&reviewed)?;
    if fuzzy.is_empty() {
        return Ok(reviewed);
    }

    let mut catalog = reviewed.into_parsed_catalog();
    for message in &mut catalog.messages {
        if fuzzy.contains(&message.key()) {
            match &mut message.translation {
                TranslationShape::Singular { value } => value.clear(),
                TranslationShape::Plural { translation, .. } => {
                    translation.values_mut().for_each(String::clear);
                }
            }
        }
    }
    catalog.into_normalized_view()
}

/// Ferrocat exposes review state only through its reports. Auditing the
/// catalog as its own source reports every active fuzzy entry once.
fn fuzzy_message_keys(
    catalog: &NormalizedParsedCatalog,
) -> Result<BTreeSet<CatalogMessageKey>, ApiError> {
    let locale = catalog.parsed_catalog().locale.as_deref().unwrap_or("");
    let checks = CatalogAuditChecks::default()
        .with_completeness(false)
        .with_extra_messages(false)
        .with_icu_syntax(false)
        .with_icu_compatibility(false)
        .with_semantic_metadata(false)
        .with_obsolete_entries(false);
    let report = audit_catalogs(
        &[catalog],
        &CatalogAuditOptions::new(locale).with_checks(checks),
    )?;
    Ok(report
        .diagnostics
        .into_iter()
        .filter(|diagnostic| diagnostic.code.as_str() == FUZZY_FLAG)
        .filter_map(|diagnostic| diagnostic.source_key)
        .map(|key| CatalogMessageKey::new(key.msgid, key.msgctxt))
        .collect())
}

fn infer_locale_from_path(
    path: &Path,
    config: &CatalogArtifactConfig,
) -> PalamedesResult<Option<String>> {
    let normalized_resource = normalize_path(path);
    for catalog in &config.catalogs {
        let matcher = catalog_locale_matcher(Path::new(&config.root_dir), catalog)?;
        if let Some(captures) = matcher.captures(&normalized_resource) {
            return Ok(captures.get(1).map(|value| value.as_str().to_owned()));
        }
    }
    Ok(None)
}

fn catalog_for_path<'a>(
    path: &Path,
    config: &'a CatalogArtifactConfig,
) -> PalamedesResult<Option<&'a CatalogConfig>> {
    let normalized_resource = normalize_path(path);
    for catalog in &config.catalogs {
        let matcher = catalog_locale_matcher(Path::new(&config.root_dir), catalog)?;
        if matcher.is_match(&normalized_resource) {
            return Ok(Some(catalog));
        }
    }
    Ok(None)
}
