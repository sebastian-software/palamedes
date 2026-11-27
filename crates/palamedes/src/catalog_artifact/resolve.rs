use std::path::{Path, PathBuf};

use crate::error::{PalamedesError, PalamedesResult};

use super::load::{
    CatalogSources, ResolvedCatalogFile, load_catalogs, parse_catalog_sources_with_observer,
};
use super::types::{CatalogArtifactConfig, CatalogConfig, FallbackLocales};
use super::{
    PreparedCompilation, is_valid_locale, resolve_catalog_file_path, try_resolve_catalog_file_path,
    validate_catalog_path_pattern,
};

#[derive(Debug, Clone)]
struct ResolvedCatalogRequest {
    locale: String,
    catalog_index: usize,
    primary_file: PathBuf,
}

pub(super) struct PreparedCompilationRequest {
    pub(super) locale: String,
    pub(super) fallback_chain: Vec<String>,
    pub(super) resolved_files: Vec<ResolvedCatalogFile>,
    pub(super) watch_files: Vec<PathBuf>,
}

impl PreparedCompilationRequest {
    pub(super) fn into_snapshot(
        self,
        sources: CatalogSources,
        source_locale: String,
    ) -> CompilationSnapshot {
        CompilationSnapshot {
            locale: self.locale,
            fallback_chain: self.fallback_chain,
            watch_files: self.watch_files,
            sources,
            source_locale,
        }
    }
}

pub(super) fn prepare_compilation_request(
    config: &CatalogArtifactConfig,
    resource_path: &str,
) -> PalamedesResult<PreparedCompilationRequest> {
    let resource_path = PathBuf::from(resource_path);
    let root_dir = PathBuf::from(&config.root_dir);
    let resolved = resolve_catalog_request(config, &resource_path)?;

    let fallback_chain = resolve_locale_chain(config, &resolved.locale);
    let catalog = &config.catalogs[resolved.catalog_index];
    let resolved_files = collect_watch_files(&root_dir, &resolved, catalog, &fallback_chain)?;
    let watch_files = resolved_files
        .iter()
        .map(|file| file.path.clone())
        .collect();

    Ok(PreparedCompilationRequest {
        locale: resolved.locale,
        fallback_chain,
        resolved_files,
        watch_files,
    })
}

pub(super) fn prepare_compilation(
    config: &CatalogArtifactConfig,
    resource_path: &str,
) -> PalamedesResult<PreparedCompilation> {
    let prepared = prepare_compilation_request(config, resource_path)?;
    let loaded = load_catalogs(&prepared.resolved_files, config)?;

    Ok(PreparedCompilation {
        locale: prepared.locale,
        fallback_chain: prepared.fallback_chain,
        watch_files: prepared.watch_files,
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
    let normalized_resource = normalize_path(resource_path);
    let root_dir = Path::new(&config.root_dir);
    let mut deferred_error: Option<PalamedesError> = None;

    for (catalog_index, catalog) in config.catalogs.iter().enumerate() {
        validate_catalog_path_pattern(&catalog.path).map_err(|reason| {
            PalamedesError::UnsafeCatalogPath {
                path: catalog.path.clone(),
                reason: reason.to_owned(),
            }
        })?;
        if !catalog.path.contains("{locale}") {
            let expected =
                try_resolve_catalog_file_path(root_dir, &catalog.path, "a", catalog.format)?;
            if normalize_path(&expected) == normalized_resource {
                return Err(PalamedesError::CouldNotResolveLocale {
                    resource_path: resource_path.to_path_buf(),
                });
            }
            continue;
        }

        let matcher = catalog_locale_matcher(root_dir, catalog)?;
        let Some(captured) = matcher.capture_locale(&normalized_resource) else {
            continue;
        };
        let locale = captured.to_owned();
        if !is_valid_locale(&locale) {
            let expanded_matches = normalize_path(&resolve_catalog_file_path(
                root_dir,
                &catalog.path,
                &locale,
                catalog.format,
            )) == normalized_resource;
            if expanded_matches && deferred_error.is_none() {
                deferred_error = Some(PalamedesError::InvalidCatalogLocale { locale });
            }
            continue;
        }
        let expected_primary =
            try_resolve_catalog_file_path(root_dir, &catalog.path, &locale, catalog.format)?;
        if normalize_path(&expected_primary) != normalized_resource {
            continue;
        }
        if config
            .locales
            .iter()
            .any(|configured| configured == &locale)
        {
            let primary_file = if resource_path.strip_prefix(root_dir).is_ok() {
                resource_path.to_path_buf()
            } else {
                expected_primary
            };
            return Ok(ResolvedCatalogRequest {
                locale,
                catalog_index,
                primary_file,
            });
        }
        if deferred_error.is_none() {
            deferred_error = Some(PalamedesError::ResolvedLocaleNotConfigured {
                locale,
                resource_path: resource_path.to_path_buf(),
            });
        }
    }

    if let Some(error) = deferred_error {
        return Err(error);
    }

    Err(PalamedesError::ResourceNotMatchedToCatalogPath {
        resource_path: resource_path.to_path_buf(),
    })
}

fn collect_watch_files(
    root_dir: &Path,
    resolved: &ResolvedCatalogRequest,
    catalog: &CatalogConfig,
    locale_chain: &[String],
) -> PalamedesResult<Vec<ResolvedCatalogFile>> {
    let mut files = vec![ResolvedCatalogFile {
        path: resolved.primary_file.clone(),
        locale: resolved.locale.clone(),
        format: catalog.format,
    }];

    for locale in locale_chain {
        if locale == &resolved.locale {
            continue;
        }
        let candidate =
            try_resolve_catalog_file_path(root_dir, &catalog.path, locale, catalog.format)?;
        if !files.iter().any(|existing| existing.path == candidate) {
            files.push(ResolvedCatalogFile {
                path: candidate,
                locale: locale.clone(),
                format: catalog.format,
            });
        }
    }

    Ok(files)
}

/// Direct prefix/suffix and segment matcher for `{locale}` placeholders without
/// compiling a regular expression on every catalog lookup.
pub(super) struct CatalogLocaleMatcher {
    root_prefix: String,
    relative_pattern: String,
}

impl CatalogLocaleMatcher {
    pub(super) fn capture_locale<'a>(&self, normalized_resource: &'a str) -> Option<&'a str> {
        let relative_resource = normalized_resource.strip_prefix(&self.root_prefix)?;
        match_catalog_locale_pattern(&self.relative_pattern, relative_resource)
    }

    #[cfg(test)]
    pub(super) fn is_match(&self, normalized_resource: &str) -> bool {
        self.capture_locale(normalized_resource).is_some()
    }
}

/// Builds the locale-capturing matcher used to resolve a catalog resource and
/// its fallback watch files.
pub(super) fn catalog_locale_matcher(
    root_dir: &Path,
    catalog: &CatalogConfig,
) -> PalamedesResult<CatalogLocaleMatcher> {
    validate_catalog_path_pattern(&catalog.path).map_err(|reason| {
        PalamedesError::UnsafeCatalogPath {
            path: catalog.path.clone(),
            reason: reason.to_owned(),
        }
    })?;
    let portable_catalog_path = catalog.path.replace('\\', "/");
    let relative_pattern = normalize_path(&resolve_catalog_file_path(
        Path::new(""),
        &portable_catalog_path,
        "{locale}",
        catalog.format,
    ));
    let root_prefix = normalized_root_prefix(root_dir);
    Ok(CatalogLocaleMatcher {
        root_prefix,
        relative_pattern,
    })
}

fn normalized_root_prefix(root_dir: &Path) -> String {
    const PROBE_SEGMENT: &str = "__pmds_root_probe__";
    let joined = normalize_path(&root_dir.join(PROBE_SEGMENT));
    joined
        .strip_suffix(PROBE_SEGMENT)
        .unwrap_or(&joined)
        .to_owned()
}

fn match_catalog_locale_pattern<'a>(pattern: &str, resource: &'a str) -> Option<&'a str> {
    let (prefix, suffix) = pattern.split_once("{locale}")?;
    if !suffix.contains("{locale}") {
        let remainder = resource.strip_prefix(prefix)?;
        let locale = remainder.strip_suffix(suffix)?;
        return (!locale.is_empty() && !locale.contains('/')).then_some(locale);
    }

    let mut pat_segments = pattern.split('/');
    let mut res_segments = resource.split('/');
    let mut captured: Option<&'a str> = None;
    loop {
        match (pat_segments.next(), res_segments.next()) {
            (Some(pat_segment), Some(res_segment)) => {
                if let Some(locale) = match_segment_locale(pat_segment, res_segment, captured)? {
                    match captured {
                        Some(previous) if previous != locale => return None,
                        None => captured = Some(locale),
                        Some(_) => {}
                    }
                }
            }
            (None, None) => return captured,
            _ => return None,
        }
    }
}

fn match_segment_locale<'a>(
    pattern_segment: &str,
    resource_segment: &'a str,
    known_locale: Option<&str>,
) -> Option<Option<&'a str>> {
    if !pattern_segment.contains("{locale}") {
        return (pattern_segment == resource_segment).then_some(None);
    }

    let mut part_count = 0usize;
    let mut literal_len = 0usize;
    for part in pattern_segment.split("{locale}") {
        part_count += 1;
        literal_len += part.len();
    }
    let placeholder_count = part_count - 1;
    let remaining_len = resource_segment.len().checked_sub(literal_len)?;
    if remaining_len < placeholder_count || !remaining_len.is_multiple_of(placeholder_count) {
        return None;
    }
    let locale_len = remaining_len / placeholder_count;

    let mut parts = pattern_segment.split("{locale}");
    let first_literal = parts.next()?;
    let rest = resource_segment.strip_prefix(first_literal)?;
    if !rest.is_char_boundary(locale_len) {
        return None;
    }
    let (locale, mut rest) = rest.split_at(locale_len);
    if locale.is_empty() {
        return None;
    }
    if let Some(previous) = known_locale
        && previous != locale
    {
        return None;
    }

    let mut remaining_parts = parts.peekable();
    while let Some(literal) = remaining_parts.next() {
        rest = rest.strip_prefix(literal)?;
        if remaining_parts.peek().is_some() {
            rest = rest.strip_prefix(locale)?;
        }
    }

    rest.is_empty().then_some(Some(locale))
}

pub(super) fn normalize_path(path: &Path) -> String {
    let portable = path.to_string_lossy().replace('\\', "/");
    let has_dir_suffix = portable == "." || portable.ends_with('/') || portable.ends_with("/.");
    let (prefix, rest) = if let Some(after) = portable.strip_prefix("//") {
        ("//", after)
    } else if let Some(after) = portable.strip_prefix('/') {
        ("/", after)
    } else {
        let bytes = portable.as_bytes();
        if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
            if bytes.len() >= 3 && bytes[2] == b'/' {
                (&portable[..3], &portable[3..])
            } else {
                (&portable[..2], &portable[2..])
            }
        } else {
            ("", portable.as_str())
        }
    };
    // Remove harmless repeated separators and interior `.` segments while
    // keeping `..` and directory-only terminal suffixes (`/` or `/.`) intact so
    // traversal paths and directory-only spellings never match regular files.
    let segments: Vec<&str> = rest
        .split('/')
        .filter(|segment| !segment.is_empty() && *segment != ".")
        .collect();
    let mut normalized = if segments.is_empty() {
        if prefix.is_empty() {
            portable
        } else {
            prefix.to_owned()
        }
    } else {
        format!("{prefix}{}", segments.join("/"))
    };
    if has_dir_suffix && !normalized.ends_with('/') {
        normalized.push('/');
    }
    normalized
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
        assert_eq!(matcher.capture_locale(&expected), Some("pt.BR"));
        assert!(!matcher.is_match(&normalize_path(&root.join("locales/pt.BR/messages.po"))));
        assert!(!matcher.is_match(&normalize_path(&root.join("locales/pt.BR/messages.v2.fcl"))));
        assert!(
            !matcher.is_match(&normalize_path(Path::new(
                "workspace/locales/pt.BR/messages.v2.po/"
            ))),
            "directory-only trailing slash must not match a catalog file pattern"
        );
        assert!(
            !matcher.is_match(&normalize_path(Path::new(
                "workspace/locales/pt.BR/messages.v2.po/."
            ))),
            "directory-only trailing /. must not match a catalog file pattern"
        );
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

    #[test]
    fn locale_matcher_handles_repeated_placeholders_metacharacters_and_utf8() {
        let root = Path::new("workspace+v1[test]({locale})");

        let repeated_segments = catalog_locale_matcher(
            root,
            &CatalogConfig {
                path: "locales/{locale}/{locale}".to_owned(),
                format: PalamedesCatalogFormat::Po,
            },
        )
        .expect("repeated segment matcher");
        assert_eq!(
            repeated_segments.capture_locale(&normalize_path(&root.join("locales/de-CH/de-CH.po"))),
            Some("de-CH")
        );
        assert_eq!(
            repeated_segments.capture_locale(&normalize_path(&root.join("locales/en/de.po"))),
            None
        );

        let repeated_in_segment = catalog_locale_matcher(
            root,
            &CatalogConfig {
                path: "locales/{locale}-{locale}".to_owned(),
                format: PalamedesCatalogFormat::Po,
            },
        )
        .expect("same-segment repeated matcher");
        assert_eq!(
            repeated_in_segment
                .capture_locale(&normalize_path(&root.join("locales/zh-Hans-zh-Hans.po"))),
            Some("zh-Hans")
        );
        assert_eq!(
            repeated_in_segment.capture_locale(&normalize_path(&root.join("locales/en-de.po"))),
            None
        );

        let adjacent = catalog_locale_matcher(
            root,
            &CatalogConfig {
                path: "locales/{locale}{locale}".to_owned(),
                format: PalamedesCatalogFormat::Po,
            },
        )
        .expect("adjacent repeated matcher");
        assert_eq!(
            adjacent.capture_locale(&normalize_path(&root.join("locales/enen.po"))),
            Some("en")
        );
        assert_eq!(
            adjacent.capture_locale(&normalize_path(&root.join("locales/ééé.po"))),
            None
        );
    }
}
