use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use ferrocat::{parse_catalog, NormalizedParsedCatalog, ParseCatalogOptions};
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
        let parsed =
            parse_catalog(options).map_err(|source_error| PalamedesError::ParseCatalog {
                path: source.path.clone(),
                source: source_error,
            })?;
        loaded.insert(
            source.locale.clone(),
            parsed.into_normalized_view().map_err(|source_error| {
                PalamedesError::NormalizeCatalog {
                    path: source.path.clone(),
                    source: source_error,
                }
            })?,
        );
    }
    Ok(loaded)
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
