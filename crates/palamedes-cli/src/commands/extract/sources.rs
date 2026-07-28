//! Turning a catalog's include/exclude patterns into the set of source files
//! to extract from.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use globset::{Glob, GlobSet, GlobSetBuilder};
use ignore::WalkBuilder;

use crate::config::{ConfigCatalog, LoadedConfig};
use crate::error::CliError;

pub(super) fn collect_source_files(
    catalog: &ConfigCatalog,
    config: &LoadedConfig,
) -> Result<Vec<PathBuf>, CliError> {
    let include_patterns = normalized_include_patterns(catalog, config);
    let include = build_glob_set(&include_patterns, "include")?;
    let exclude = build_exclude_set(catalog, config)?;
    let mut files = BTreeSet::new();

    for root in walk_roots_for_patterns(&include_patterns, &config.root_dir) {
        for entry in WalkBuilder::new(root)
            .standard_filters(false)
            .hidden(false)
            .build()
        {
            let Ok(entry) = entry else {
                continue;
            };
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if exclude.is_match(path) {
                continue;
            }
            if include.is_match(path) {
                files.insert(path.to_path_buf());
            }
        }
    }

    Ok(files.into_iter().collect())
}

pub(super) fn build_include_set(
    catalog: &ConfigCatalog,
    config: &LoadedConfig,
) -> Result<GlobSet, CliError> {
    build_glob_set(&normalized_include_patterns(catalog, config), "include")
}

pub(super) fn normalized_include_patterns(
    catalog: &ConfigCatalog,
    config: &LoadedConfig,
) -> Vec<String> {
    catalog
        .include
        .iter()
        .map(|pattern| {
            // Collapse `.`/`./` segments so dot paths resolve to a real
            // directory (`.` -> the config root) instead of a literal `/.`
            // fragment that silently matches no source files. Expand bare
            // directories to a recursive source glob; pass through anything
            // that already points at a file or contains glob syntax.
            let resolved: PathBuf = config.resolve_pattern(pattern).components().collect();
            if resolved.is_dir() {
                format!(
                    "{}/**/*.{{js,jsx,mjs,cjs,ts,tsx,mts,cts,mdx}}",
                    resolved.to_string_lossy()
                )
            } else {
                resolved.to_string_lossy().into_owned()
            }
        })
        .collect()
}

fn build_glob_set(patterns: &[String], label: &str) -> Result<GlobSet, CliError> {
    let mut builder = GlobSetBuilder::new();
    for pattern in patterns {
        builder.add(Glob::new(pattern).map_err(|source| CliError::GlobPattern {
            pattern: pattern.clone(),
            source,
        })?);
    }
    builder.build().map_err(|source| CliError::GlobPattern {
        pattern: label.to_owned(),
        source,
    })
}

pub(super) fn walk_roots_for_patterns(patterns: &[String], fallback: &Path) -> Vec<PathBuf> {
    let mut roots = BTreeSet::new();
    for pattern in patterns {
        let prefix_end = pattern.find(['*', '?', '[', '{']).unwrap_or(pattern.len());
        let prefix = Path::new(&pattern[..prefix_end]);
        let root = if prefix.is_dir() {
            prefix.to_path_buf()
        } else {
            prefix
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| fallback.to_path_buf())
        };
        roots.insert(root);
    }
    if roots.is_empty() {
        roots.insert(fallback.to_path_buf());
    }
    roots.into_iter().collect()
}

pub(super) fn build_exclude_set(
    catalog: &ConfigCatalog,
    config: &LoadedConfig,
) -> Result<GlobSet, CliError> {
    let mut builder = GlobSetBuilder::new();
    let excludes = if catalog.exclude.is_empty() {
        vec!["**/node_modules/**".to_owned()]
    } else {
        catalog.exclude.clone()
    };
    for pattern in excludes {
        let resolved = config.resolve_pattern(&pattern);
        let normalized = resolved.to_string_lossy().into_owned();
        builder.add(
            Glob::new(&normalized).map_err(|source| CliError::GlobPattern {
                pattern: normalized,
                source,
            })?,
        );
    }
    builder.build().map_err(|source| CliError::GlobPattern {
        pattern: "exclude".to_owned(),
        source,
    })
}
