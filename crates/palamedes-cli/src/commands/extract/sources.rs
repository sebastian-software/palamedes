//! Turning a catalog's include/exclude patterns into the set of source files
//! to extract from.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use globset::{Glob, GlobSet, GlobSetBuilder};
use ignore::WalkBuilder;

use crate::config::{ConfigCatalog, LoadedConfig};
use crate::error::CliError;

pub(crate) fn collect_source_files(
    catalog: &ConfigCatalog,
    config: &LoadedConfig,
) -> Result<Vec<PathBuf>, CliError> {
    let include_patterns = normalized_include_patterns(catalog, config);
    let include = build_glob_set(&include_patterns, "include")?;
    let exclude_patterns = resolved_exclude_patterns(catalog, config);
    let exclude = build_glob_set(&exclude_patterns, "exclude")?;
    let roots = walk_roots_for_patterns(&include_patterns, &config.root_dir);

    #[cfg(feature = "ferralk-discovery")]
    if let Some(engine) = super::ferralk_discovery::selected_alternative() {
        return Ok(super::ferralk_discovery::collect_source_files(
            engine,
            super::ferralk_discovery::Request {
                roots: &roots,
                include_patterns: &include_patterns,
                exclude_patterns: &exclude_patterns,
                include: &include,
                exclude: &exclude,
                threads: super::ferralk_discovery::threads(config),
            },
        ));
    }

    let mut files = collect_with_ignore(&roots, &include, &exclude);
    sort_and_dedupe_paths(&mut files);
    Ok(files)
}

/// The `ignore`-backed traversal. Unchanged by the ferralk trial: it is both
/// the default engine and the reference the trial's parity check compares
/// against.
pub(crate) fn collect_with_ignore(
    roots: &[PathBuf],
    include: &GlobSet,
    exclude: &GlobSet,
) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for root in roots {
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
                files.push(path.to_path_buf());
            }
        }
    }
    files
}

/*
 * Path::cmp compares component-by-component and re-parses both paths on every
 * comparison, which made the former BTreeSet<PathBuf> collection the single
 * most expensive main-thread item after the catalog writes (~25% of
 * main-thread instructions on the realistic benchmark corpus). Sorting on a
 * cached byte key computes the ordering key once per path instead.
 *
 * On Unix the key maps the separator to 0x00, which is below every byte a
 * component can contain, so byte order on the mapped key equals component
 * order and the resulting file order — and with it catalog origin order — is
 * unchanged. Other platforms keep Path's own ordering.
 */
pub(crate) fn sort_and_dedupe_paths<P: AsRef<Path> + Ord>(paths: &mut Vec<P>) {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        paths.sort_by_cached_key(|path| {
            path.as_ref()
                .as_os_str()
                .as_bytes()
                .iter()
                .map(|&byte| if byte == b'/' { 0 } else { byte })
                .collect::<Vec<u8>>()
        });
    }
    #[cfg(not(unix))]
    paths.sort_unstable();
    paths.dedup_by(|left, right| left.as_ref() == right.as_ref());
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
                format!("{}/**/*.{{js,jsx,ts,tsx,mdx}}", resolved.to_string_lossy())
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
    build_glob_set(&resolved_exclude_patterns(catalog, config), "exclude")
}

/// The exclude patterns as absolute path globs, in catalog order. Split out of
/// `build_exclude_set` because a walker that prunes during traversal needs the
/// patterns themselves, not only the compiled `GlobSet`.
pub(super) fn resolved_exclude_patterns(
    catalog: &ConfigCatalog,
    config: &LoadedConfig,
) -> Vec<String> {
    let excludes = if catalog.exclude.is_empty() {
        vec!["**/node_modules/**".to_owned()]
    } else {
        catalog.exclude.clone()
    };
    excludes
        .iter()
        .map(|pattern| {
            config
                .resolve_pattern(pattern)
                .to_string_lossy()
                .into_owned()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::sort_and_dedupe_paths;

    /*
     * The byte-key sort must reproduce Path::cmp's component order exactly,
     * including the case where a directory name is a prefix of a sibling's
     * ("app" vs "app-shared"): plain byte order on the unmapped path would put
     * "app-shared" first because '-' sorts below '/'.
     */
    #[test]
    fn sorts_in_component_order_and_dedupes() {
        let mut paths = vec![
            PathBuf::from("/repo/app-shared/x.ts"),
            PathBuf::from("/repo/app/y.ts"),
            PathBuf::from("/repo/app/y.ts"),
            PathBuf::from("/repo/app.ts"),
            PathBuf::from("/repo/app/b-c/d.ts"),
            PathBuf::from("/repo/app/b.ts"),
        ];
        let mut expected = paths.clone();
        expected.sort();
        expected.dedup();

        sort_and_dedupe_paths(&mut paths);

        assert_eq!(paths, expected);
    }
}
