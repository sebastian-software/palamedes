use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use ferrocat::{parse_catalog, NormalizedParsedCatalog, ParseCatalogOptions, PluralEncoding};

use crate::error::{PalamedesError, PalamedesResult};

use super::resolve::normalize_path;
use super::types::CatalogArtifactConfig;

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
        let parsed = parse_catalog(ParseCatalogOptions {
            content: &content,
            locale: Some(locale.as_str()),
            source_locale: &config.source_locale,
            plural_encoding: PluralEncoding::Icu,
            strict: false,
        })
        .map_err(|source| PalamedesError::ParseCatalog {
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
            .with_extension("po");
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
