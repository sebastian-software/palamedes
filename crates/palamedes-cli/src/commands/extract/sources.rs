//! Turning a catalog's include/exclude patterns into the set of source files
//! to extract from.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use ferralk::{ErrorPolicy, Walker};
use globset::{Glob, GlobSet, GlobSetBuilder};

use crate::config::{ConfigCatalog, LoadedConfig};
use crate::error::CliError;

pub(crate) fn collect_source_files(
    catalog: &ConfigCatalog,
    config: &LoadedConfig,
) -> Result<Vec<PathBuf>, CliError> {
    let include_patterns = normalized_include_patterns(catalog, config);
    let include = build_glob_set(&include_patterns, "include")?;
    let exclude = build_exclude_set(catalog, config)?;
    let mut files = Vec::new();

    for root in walk_roots_for_patterns(&include_patterns, &config.root_dir) {
        let Ok(walk) = Walker::new(root)
            // Source collection was serial before this replacement. Keep that
            // scheduling contract; extraction itself owns its worker pool.
            .threads(1)
            // Match ignore::WalkBuilder's best-effort iteration: retain
            // recoverable traversal errors without turning them into an
            // extraction failure.
            .error_policy(ErrorPolicy::Collect)
            .collect()
        else {
            continue;
        };

        for entry in walk.entries() {
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

    sort_and_dedupe_paths(&mut files);
    Ok(files)
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

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use super::{collect_source_files, sort_and_dedupe_paths};
    use crate::commands::test_support::{temp_dir, write_config};
    use crate::config::load_config;

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

    #[test]
    fn collects_nested_sources_with_the_ferralk_walker() {
        let app = temp_dir("ferralk-source-walker");
        fs::create_dir_all(app.join("app/nested")).expect("create source tree");
        fs::create_dir_all(app.join("node_modules/package")).expect("create dependency tree");
        write_config(&app, None);
        fs::write(app.join("app/page.tsx"), "export const page = 1;").expect("write source");
        fs::write(app.join("app/nested/view.tsx"), "export const view = 1;")
            .expect("write nested source");
        fs::write(
            app.join("node_modules/package/index.tsx"),
            "export const dep = 1;",
        )
        .expect("write excluded dependency source");

        let config = load_config(&app, Some(&app.join("palamedes.yaml"))).expect("load config");
        let files = collect_source_files(&config.catalogs[0], &config).expect("collect sources");

        assert_eq!(
            files,
            vec![app.join("app/nested/view.tsx"), app.join("app/page.tsx")]
        );
    }
}
