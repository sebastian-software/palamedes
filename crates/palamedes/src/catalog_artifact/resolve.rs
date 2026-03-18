use std::path::{Path, PathBuf};

use regex::Regex;

use crate::error::{PalamedesError, PalamedesResult};

use super::load::load_catalogs;
use super::types::{CatalogArtifactConfig, FallbackLocales};
use super::PreparedCompilation;

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
        collect_watch_files(&root_dir, &resolved.primary_file, config, &fallback_chain);
    let loaded = load_catalogs(&watch_files, config)?;

    Ok(PreparedCompilation {
        locale: resolved.locale,
        fallback_chain,
        watch_files,
        loaded,
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
        let absolute_catalog_path = Path::new(&config.root_dir).join(&catalog.path);
        let absolute_po_path = absolute_catalog_path.with_extension("po");
        let pattern = normalize_path(&absolute_po_path);
        let escaped = regex::escape(&pattern);
        let regex_pattern = escaped.replace("\\{locale\\}", "([^/]+)");
        let matcher = Regex::new(&format!("^{regex_pattern}$")).map_err(|source| {
            PalamedesError::InvalidCatalogPathPattern {
                pattern: catalog.path.clone(),
                source,
            }
        })?;
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

pub(super) fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}
