//! Turning a catalog's include/exclude patterns into the set of source files
//! to extract from.
//!
//! Discovery is one [ferralk] walk. The catalog's patterns go to the walker as
//! they are: absolute, `globset`-flavoured, one list of includes and one of
//! excludes across every root. Excluded subtrees are pruned during traversal
//! instead of filtered afterwards and the walk is parallel, which is what
//! palamedes#875 asked for.
//!
//! Two switches make the walker read a palamedes catalog the way `globset`
//! read it, and both are load-bearing rather than decorative -- see
//! [`WildcardMode::SeparatorCrossing`] and [`Walker::match_hidden`] at the call
//! site.
//!
//! [ferralk]: https://github.com/sebastian-software/ferralk

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use ferralk::{ErrorPolicy, Verdict, WalkOptions, Walker, WildcardMode};
use globset::{Glob, GlobSet, GlobSetBuilder};

use crate::config::{ConfigCatalog, LoadedConfig};
use crate::error::CliError;

pub(crate) fn collect_source_files(
    catalog: &ConfigCatalog,
    config: &LoadedConfig,
) -> Result<Vec<PathBuf>, CliError> {
    let include_patterns = normalized_include_patterns(catalog, config);
    let exclude_patterns = resolved_exclude_patterns(catalog, config);
    let roots = discovery_roots(&include_patterns, &config.root_dir);
    let (first, rest) = roots.split_first().expect("discovery always has one root");

    let mut walker = Walker::new(first)
        // A catalog pattern is a `globset` pattern, and `globset` as palamedes
        // builds it lets an ordinary wildcard cross a separator: a single-star
        // segment selects `src/a/b/c.ts` today. Reading the same pattern under
        // filesystem-glob semantics would quietly select less.
        //
        // Unlike `match_hidden`, this one does not recompile patterns already
        // added, so it has to come before them.
        .wildcard_mode(WildcardMode::SeparatorCrossing)
        /*
         * `globset` lets a wildcard cover a leading period, and palamedes
         * discovers hidden sources on purpose: 179 of this repository's own
         * catalog files live under `site/.react-router/`. `skip_hidden` stays at
         * its `false` default -- that governs traversal, this governs what a
         * wildcard may cover.
         */
        .match_hidden(true)
        .threads(discovery_threads(config))
        // Recoverable traversal errors are dropped rather than reported, as the
        // `ignore` walk this replaced dropped its `Err` items.
        .error_policy(ErrorPolicy::Skip)
        .options(WalkOptions::default().files_only(true))
        // `add_root` only compiles the patterns already on the builder, and
        // there are none yet, so this cannot reject anything.
        .add_roots(rest.iter())
        .expect("adding a root before any pattern always succeeds");

    // A catalog pattern the walker refuses is a config problem, so it is named
    // in the failure rather than dropped: unlike the `GlobSet` arrangement this
    // replaced, there is no second matcher to fall back on.
    let rejected = |pattern: &String| {
        let pattern = pattern.clone();
        move |source| CliError::DiscoveryPattern { pattern, source }
    };
    for pattern in &include_patterns {
        walker = walker.include(pattern).map_err(rejected(pattern))?;
    }
    for pattern in &exclude_patterns {
        walker = walker.exclude(pattern).map_err(rejected(pattern))?;
    }

    /*
     * The one thing the walker cannot answer: `is_file` follows a symlink, so a
     * link to a file counts as a source and a broken one does not, while an
     * entry kind describes the link itself. Running it as a visitor keeps the
     * `stat` on the worker that produced the entry rather than on one thread
     * afterwards.
     */
    let result = walker.visit(|entry| {
        if entry.path().is_file() {
            Verdict::Keep
        } else {
            Verdict::Skip
        }
    })?;

    let mut files: Vec<PathBuf> = result
        .entries()
        .iter()
        .map(|entry| entry.path().to_owned())
        .collect();
    sort_and_dedupe_paths(&mut files);
    Ok(files)
}

/// Where the walk starts.
///
/// Every catalog pattern is resolved against the config root, so that is the
/// shallowest anchor any of them can have, and an exclude like
/// `<root>/**/node_modules/**` can only be expressed relative to a root at or
/// above it. Starting there costs nothing: the includes name their own
/// subtrees, so the walker prunes back down to `app/` on its own.
///
/// A pattern resolving outside the config root -- an absolute `include` -- keeps
/// the root [`walk_roots_for_patterns`] derived for it.
fn discovery_roots(include_patterns: &[String], root_dir: &Path) -> Vec<PathBuf> {
    walk_roots_for_patterns(include_patterns, root_dir)
        .into_iter()
        .map(|root| {
            if root.starts_with(root_dir) {
                root_dir.to_path_buf()
            } else {
                root
            }
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

/// Worker count for discovery: the configured extraction threads, else the
/// machine's parallelism. ferralk keeps small walks serial below its own size
/// floor, so this does not need a threshold of its own.
fn discovery_threads(config: &LoadedConfig) -> usize {
    config
        .extract_threads
        .or_else(|| std::thread::available_parallelism().ok().map(Into::into))
        .unwrap_or(1)
        .max(1)
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
    use std::fs;
    use std::path::{Path, PathBuf};

    use super::{collect_source_files, sort_and_dedupe_paths};
    use crate::commands::test_support::temp_dir;
    use crate::config::load_config;

    /// A project whose catalog covers `app/`, with the given source files
    /// written underneath it.
    fn project_with_sources(name: &str, relative_paths: &[&str]) -> PathBuf {
        let root = temp_dir(name);
        fs::write(
            root.join("palamedes.yaml"),
            "locales: [en, de]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}/messages\n    include: [app]\n",
        )
        .expect("write config");
        for relative in relative_paths {
            let path = root.join(relative);
            fs::create_dir_all(path.parent().expect("source has a parent"))
                .expect("create source directory");
            fs::write(path, "export const message = 1;").expect("write source");
        }
        root
    }

    fn discovered(root: &Path) -> Vec<PathBuf> {
        let config = load_config(root, Some(&root.join("palamedes.yaml"))).expect("load config");
        collect_source_files(&config.catalogs[0], &config).expect("collect sources")
    }

    /*
     * Sources under a hidden directory are discoverable and have to stay that
     * way: generated route types land in `site/.react-router/`, and 179 of this
     * repository's own catalog files live there. A walker whose wildcards
     * refuse a leading period drops every one of them silently, and this suite
     * had no test that would have noticed -- which is the reason this one
     * exists and asserts the discovered list rather than a count.
     *
     * Since the includes moved onto the walker this test is load-bearing:
     * turning `Walker::match_hidden` off drops three of the four files below
     * and fails here, which is the whole reason it was written.
     */
    #[test]
    fn discovers_sources_under_hidden_directories() {
        let root = project_with_sources(
            "hidden-sources",
            &[
                "app/page.tsx",
                "app/.react-router/types/+routes.ts",
                "app/.hidden-source.ts",
                "app/nested/.generated/view.tsx",
            ],
        );

        assert_eq!(
            discovered(&root),
            vec![
                root.join("app/.hidden-source.ts"),
                root.join("app/.react-router/types/+routes.ts"),
                root.join("app/nested/.generated/view.tsx"),
                root.join("app/page.tsx"),
            ]
        );
    }

    /*
     * A catalog pattern is a `globset` pattern, and `globset` as palamedes
     * builds it lets an ordinary wildcard cross a separator, so a single-star
     * include reaches a nested file. palamedes' own generated patterns are all
     * `**`-rooted and cannot tell the two readings apart -- only a hand-written
     * include like this one can, which is why the case is a fixture rather than
     * something the real trees would have caught.
     */
    #[test]
    fn a_single_star_include_reaches_nested_files() {
        let root = temp_dir("crossing-wildcard");
        fs::write(
            root.join("palamedes.yaml"),
            "locales: [en, de]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}/messages\n    include: ['app/*.tsx']\n",
        )
        .expect("write config");
        for relative in ["app/page.tsx", "app/nested/deep.tsx", "app/skipped.ts"] {
            let path = root.join(relative);
            fs::create_dir_all(path.parent().expect("source has a parent"))
                .expect("create source directory");
            fs::write(path, "export const message = 1;").expect("write source");
        }

        assert_eq!(
            discovered(&root),
            vec![root.join("app/nested/deep.tsx"), root.join("app/page.tsx")]
        );
    }

    // The counterpart: a hidden directory is not special to the *exclude*
    // either. A `node_modules` nested under a dot directory stays excluded,
    // whether the walker prunes it or the GlobSet rejects it per file.
    #[test]
    fn excludes_dependencies_nested_under_hidden_directories() {
        let root = project_with_sources(
            "hidden-dependencies",
            &[
                "app/page.tsx",
                "app/node_modules/dep/index.ts",
                "app/.cache/node_modules/dep/index.ts",
            ],
        );

        assert_eq!(discovered(&root), vec![root.join("app/page.tsx")]);
    }

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
