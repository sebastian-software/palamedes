use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use ferrocat::{parse_catalog, NormalizedParsedCatalog, ParseCatalogOptions};

use crate::error::{PalamedesError, PalamedesResult};

use super::resolve::normalize_path;
use super::types::{CatalogArtifactConfig, CatalogConfig};

pub(super) type LocaleCatalogs = BTreeMap<String, NormalizedParsedCatalog>;

pub(super) fn load_catalogs(
    files: &[std::path::PathBuf],
    config: &CatalogArtifactConfig,
) -> PalamedesResult<LocaleCatalogs> {
    let mut loaded = LocaleCatalogs::new();

    for file in files {
        if !file.exists() {
            if file == &files[0] {
                return Err(PalamedesError::CatalogFileNotFound { path: file.clone() });
            }
            continue;
        }

        let locale = infer_locale_from_path(file, config)
            .ok_or_else(|| PalamedesError::CouldNotInferLocale { path: file.clone() })?;
        let content = fs::read_to_string(file).map_err(|source| PalamedesError::ReadFile {
            path: file.clone(),
            source,
        })?;
        let catalog = catalog_for_path(file, config)
            .ok_or_else(|| PalamedesError::CouldNotInferLocale { path: file.clone() })?;
        let options = ParseCatalogOptions::new(&content, &config.source_locale)
            .with_locale(locale.as_str())
            .with_mode(catalog.format.ferrocat_mode());

        let parsed = parse_catalog(options).map_err(|source| PalamedesError::ParseCatalog {
            path: file.clone(),
            source,
        })?;

        loaded.insert(
            locale,
            parsed
                .into_normalized_view()
                .map_err(|source| PalamedesError::NormalizeCatalog {
                    path: file.clone(),
                    source,
                })?,
        );
    }

    Ok(loaded)
}

fn infer_locale_from_path(path: &Path, config: &CatalogArtifactConfig) -> Option<String> {
    let normalized_resource = normalize_path(path);
    for catalog in &config.catalogs {
        let absolute_catalog_path = Path::new(&config.root_dir)
            .join(&catalog.path)
            .with_extension(catalog.format.extension());
        let pattern = normalize_path(&absolute_catalog_path);
        let escaped = regex::escape(&pattern);
        let regex_pattern = escaped.replace("\\{locale\\}", "([^/]+)");
        let matcher = regex::Regex::new(&format!("^{regex_pattern}$")).ok()?;
        if let Some(captures) = matcher.captures(&normalized_resource) {
            return captures.get(1).map(|value| value.as_str().to_owned());
        }
    }
    None
}

fn catalog_for_path<'a>(
    path: &Path,
    config: &'a CatalogArtifactConfig,
) -> Option<&'a CatalogConfig> {
    let normalized_resource = normalize_path(path);
    config.catalogs.iter().find(|catalog| {
        let absolute_catalog_path = Path::new(&config.root_dir)
            .join(&catalog.path)
            .with_extension(catalog.format.extension());
        let pattern = normalize_path(&absolute_catalog_path);
        let escaped = regex::escape(&pattern);
        let regex_pattern = escaped.replace("\\{locale\\}", "([^/]+)");
        regex::Regex::new(&format!("^{regex_pattern}$"))
            .map(|matcher| matcher.is_match(&normalized_resource))
            .unwrap_or(false)
    })
}
