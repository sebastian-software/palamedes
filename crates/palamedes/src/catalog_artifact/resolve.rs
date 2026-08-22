use std::path::{Path, PathBuf};

use regex::Regex;

use crate::error::{PalamedesError, PalamedesResult};

use super::load::{
    load_catalogs, parse_catalog_sources_with_observer, read_catalog_sources, CatalogSources,
};
use super::types::{CatalogArtifactConfig, FallbackLocales};
use super::{resolve_catalog_file_path, resolve_catalog_path, PreparedCompilation};

#[derive(Debug, Clone)]
struct ResolvedCatalogRequest {
    locale: String,
    primary_file: PathBuf,
}

pub(super) fn prepare_compilation(
    config: &CatalogArtifactConfig,
    resource_path: &str,
) -> PalamedesResult<PreparedCompilation> {
    let resource_path = PathBuf::from(resource_path);
    let root_dir = PathBuf::from(&config.root_dir);
    let resolved = resolve_catalog_request(config, &resource_path)?;

    let fallback_chain = resolve_locale_chain(config, &resolved.locale);
    let watch_files =
        collect_watch_files(&root_dir, &resolved.primary_file, config, &fallback_chain)?;
    let loaded = load_catalogs(&watch_files, config)?;

    Ok(PreparedCompilation {
        locale: resolved.locale,
        fallback_chain,
        watch_files,
        loaded,
    })
}

pub(super) struct CompilationSnapshot {
    pub(super) locale: String,
    pub(super) fallback_chain: Vec<String>,
    pub(super) watch_files: Vec<PathBuf>,
    pub(super) sources: CatalogSources,
    source_locale: String,
}

impl CompilationSnapshot {
    pub(super) fn into_prepared_with_observer<F>(
        self,
        on_parse: F,
    ) -> PalamedesResult<PreparedCompilation>
    where
        F: FnMut(),
    {
        let loaded =
            parse_catalog_sources_with_observer(&self.sources, &self.source_locale, on_parse)?;
        Ok(PreparedCompilation {
            locale: self.locale,
            fallback_chain: self.fallback_chain,
            watch_files: self.watch_files,
            loaded,
        })
    }
}

pub(super) fn prepare_compilation_snapshot(
    config: &CatalogArtifactConfig,
    resource_path: &str,
) -> PalamedesResult<CompilationSnapshot> {
    let resource_path = PathBuf::from(resource_path);
    let root_dir = PathBuf::from(&config.root_dir);
    let resolved = resolve_catalog_request(config, &resource_path)?;
    let fallback_chain = resolve_locale_chain(config, &resolved.locale);
    let watch_files =
        collect_watch_files(&root_dir, &resolved.primary_file, config, &fallback_chain)?;
    let sources = read_catalog_sources(&watch_files, config)?;
    Ok(CompilationSnapshot {
        locale: resolved.locale,
        fallback_chain,
        watch_files,
        sources,
        source_locale: config.source_locale.clone(),
    })
}

pub(super) fn resolve_locale_chain(config: &CatalogArtifactConfig, locale: &str) -> Vec<String> {
    let mut chain = vec![locale.to_owned()];

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

pub(super) fn ferrocat_fallback_chain(
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

fn resolve_catalog_request(
    config: &CatalogArtifactConfig,
    resource_path: &Path,
) -> PalamedesResult<ResolvedCatalogRequest> {
    for catalog in &config.catalogs {
        let matcher = catalog_locale_matcher(Path::new(&config.root_dir), catalog)?;
        let normalized_resource = normalize_path(resource_path);

        if let Some(captures) = matcher.captures(&normalized_resource) {
            let locale = captures
                .get(1)
                .map(|value| value.as_str().to_owned())
                .ok_or_else(|| PalamedesError::CouldNotResolveLocale {
                    resource_path: resource_path.to_path_buf(),
                })?;
            if !config
                .locales
                .iter()
                .any(|configured| configured == &locale)
            {
                return Err(PalamedesError::ResolvedLocaleNotConfigured {
                    locale,
                    resource_path: resource_path.to_path_buf(),
                });
            }
            return Ok(ResolvedCatalogRequest {
                locale,
                primary_file: resource_path.to_path_buf(),
            });
        }
    }

    Err(PalamedesError::ResourceNotMatchedToCatalogPath {
        resource_path: resource_path.to_path_buf(),
    })
}

fn collect_watch_files(
    root_dir: &Path,
    primary_file: &Path,
    config: &CatalogArtifactConfig,
    locale_chain: &[String],
) -> PalamedesResult<Vec<PathBuf>> {
    let mut files = vec![primary_file.to_path_buf()];

    for catalog in &config.catalogs {
        let matcher = catalog_locale_matcher(root_dir, catalog)?;
        let primary_pattern = normalize_path(primary_file);

        if matcher.is_match(&primary_pattern) {
            for locale in locale_chain {
                let candidate = resolve_catalog_path(config, catalog, locale);
                if !files.contains(&candidate) {
                    files.push(candidate);
                }
            }
            break;
        }
    }

    Ok(files)
}

/// Builds the locale-capturing matcher used to resolve a catalog resource and
/// its fallback watch files. Invalid patterns must fail both paths equally.
pub(super) fn catalog_locale_matcher(
    root_dir: &Path,
    catalog: &super::types::CatalogConfig,
) -> PalamedesResult<Regex> {
    let absolute_catalog_path =
        resolve_catalog_file_path(root_dir, &catalog.path, "{locale}", catalog.format);
    let pattern = normalize_path(&absolute_catalog_path);
    let regex_pattern = regex::escape(&pattern).replace("\\{locale\\}", "([^/]+)");
    Regex::new(&format!("^{regex_pattern}$")).map_err(|source| {
        PalamedesError::InvalidCatalogPathPattern {
            pattern: catalog.path.clone(),
            source,
        }
    })
}

pub(super) fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::{catalog_locale_matcher, normalize_path};
    use crate::{CatalogConfig, PalamedesCatalogFormat};
    use std::path::Path;

    #[test]
    fn locale_matcher_preserves_dotted_names_and_captures_dotted_locales() {
        let root = Path::new("workspace");
        let catalog = CatalogConfig {
            path: "locales/{locale}/messages.v2".to_owned(),
            format: PalamedesCatalogFormat::Po,
        };
        let matcher = catalog_locale_matcher(root, &catalog).expect("catalog matcher");
        let expected = normalize_path(&root.join("locales/pt.BR/messages.v2.po"));
        let captures = matcher.captures(&expected).expect("dotted catalog match");

        assert_eq!(captures.get(1).map(|value| value.as_str()), Some("pt.BR"));
        assert!(!matcher.is_match(&normalize_path(&root.join("locales/pt.BR/messages.po"))));
        assert!(!matcher.is_match(&normalize_path(&root.join("locales/pt.BR/messages.v2.fcl"))));
    }

    #[test]
    fn locale_matcher_does_not_duplicate_a_configured_storage_extension() {
        let root = Path::new("workspace");
        let catalog = CatalogConfig {
            path: "locales/{locale}/messages.po".to_owned(),
            format: PalamedesCatalogFormat::Po,
        };
        let matcher = catalog_locale_matcher(root, &catalog).expect("catalog matcher");

        assert!(matcher.is_match(&normalize_path(&root.join("locales/de/messages.po"))));
        assert!(!matcher.is_match(&normalize_path(&root.join("locales/de/messages.po.po"))));
    }
}
