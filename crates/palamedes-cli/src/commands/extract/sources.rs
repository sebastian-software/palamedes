//! Turning a catalog's include/exclude patterns into the set of source files
//! to extract from.
//!
//! Discovery walks on [ferralk]. Excluded subtrees are pruned during traversal
//! rather than filtered afterwards, and the walk is parallel, which is what
//! palamedes#875 asked for; on this repository that is 30x the previous serial
//! `ignore` walk and 1.07x a hand-pruned parallel `ignore` one.
//!
//! The catalog's `GlobSet`s still make the final include/exclude call, inside
//! the visitor so the check runs on the worker that produced the entry. They
//! are kept for one reason: `globset` as palamedes configures it lets `*` cross
//! `/`, so `src/*.ts` matches `src/a/b/c.ts` today, while ferralk's `*` is
//! component-scoped. ferralk#79 would make that mode reachable from the walker
//! and let the `GlobSet` go.
//!
//! [ferralk]: https://github.com/sebastian-software/ferralk

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use ferralk::{ErrorPolicy, Verdict, WalkEntry, WalkOptions, Walker};
use globset::{Glob, GlobSet, GlobSetBuilder};

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
    let threads = discovery_threads(config);

    let mut files = Vec::new();
    for root in &roots {
        let mut walker = Walker::new(root)
            .threads(threads)
            // Recoverable traversal errors are dropped rather than reported, as
            // the `ignore` walk this replaced dropped its `Err` items. Collect
            // would allocate error records nothing reads.
            .error_policy(ErrorPolicy::Skip)
            // Directories are never candidates. The `is_file` call below still
            // has to happen for symlinks, but not for every directory.
            .options(WalkOptions::default().files_only(true))
            /*
             * Aligns ferralk's wildcards with `globset`'s, which cover a
             * leading period. Here that affects pruning only: without it a
             * `node_modules` nested under a dot directory is walked and then
             * rejected per file instead of being skipped whole. The discovered
             * set is the same either way, because the `GlobSet` in the visitor
             * decides -- but the two matchers should agree about what an
             * exclude covers, and they must agree once ferralk#79 lets the
             * includes move over too.
             *
             * `skip_hidden` stays at its `false` default: that one governs
             * traversal, this one governs what a wildcard may cover. Hidden
             * *sources* stay discoverable because of the former.
             */
            .match_hidden(true);

        /*
         * Excludes are handed over for pruning. A rewrite that is narrower than
         * the catalog's own exclude costs a subtree that could have been
         * skipped; it can never drop a file, because the `GlobSet` in the
         * visitor still rejects it. A rewrite that were *broader* could drop a
         * file, which is why `traversal_pattern` refuses everything it cannot
         * show to be equivalent.
         *
         * The `walker.clone()` is not an oversight. `Walker::exclude` takes
         * `self` by value and returns `Result<Self, PatternError>`, so a
         * rejected pattern consumes the builder without handing it back; a
         * caller that wants to skip one bad pattern and keep the rest has no
         * other way to hold on to it. ferralk#78 would remove the rewrite
         * entirely by taking absolute patterns.
         */
        for pattern in &exclude_patterns {
            if let Some(relative) = traversal_pattern(root, pattern) {
                if let Ok(next) = walker.clone().exclude(&relative) {
                    walker = next;
                }
            }
        }

        /*
         * `visit` runs this on the worker that produced the entry, so the
         * `GlobSet` check is as parallel as the traversal. Collecting first and
         * filtering afterwards made the walk slower than a hand-pruned parallel
         * `ignore` one, because the filter was single-threaded.
         *
         * `Verdict::Skip` does not prune: a rejected directory is still
         * descended into. Pruning is what `exclude` above expresses.
         */
        let verdict = |entry: &WalkEntry| {
            let path = entry.path();
            /*
             * Deliberately `is_file()` and not ferralk's own entry kind, which
             * describes the link rather than its target: a symlink to a file
             * counts as a source and a broken one does not.
             */
            if !path.is_file() {
                return Verdict::Skip;
            }
            if !exclude.is_match(path) && include.is_match(path) {
                Verdict::Keep
            } else {
                Verdict::Skip
            }
        };

        // A walk that cannot start contributes no files, the way the previous
        // walker's unreadable-root `Err` item did.
        let Ok(result) = walker.visit(verdict) else {
            continue;
        };
        files.extend(result.entries().iter().map(|entry| entry.path().to_owned()));
    }

    sort_and_dedupe_paths(&mut files);
    Ok(files)
}

/// Worker count for discovery: the configured extraction threads, else the
/// machine's parallelism. ferralk keeps small walks serial on its own, so this
/// does not need a size floor of its own.
fn discovery_threads(config: &LoadedConfig) -> usize {
    config
        .extract_threads
        .or_else(|| std::thread::available_parallelism().ok().map(Into::into))
        .unwrap_or(1)
        .max(1)
}

/// Rewrites an absolute catalog pattern into one ferralk can match against
/// paths relative to `root`, or `None` when no rewrite is provably equivalent.
///
/// Two shapes are accepted:
///
/// 1. The pattern starts at this root — `/repo/src` + `/repo/src/**/*.ts`
///    becomes `**/*.ts`. Every candidate under the root has the prefix
///    stripped in exactly the same way, so the two forms accept the same set.
/// 2. The pattern is position-independent below a directory that contains this
///    root — `/repo/src` + `/repo/**/node_modules/**` becomes
///    `**/node_modules/**`. A leading `**/` matches zero or more components in
///    both matchers, so re-anchoring it deeper does not change which
///    descendants match.
///
/// Anything else — `/repo/*/node_modules/**` against a nested root, a pattern
/// under a sibling root — returns `None` rather than a guess. ferralk#78 would
/// retire this function by accepting absolute patterns directly.
fn traversal_pattern(root: &Path, pattern: &str) -> Option<String> {
    let root = root.to_string_lossy();
    let root = root.strip_suffix('/').unwrap_or(&root);

    if let Some(relative) = pattern
        .strip_prefix(root)
        .and_then(|rest| rest.strip_prefix('/'))
    {
        return Some(relative.to_owned());
    }

    let literal_end = pattern.find(['*', '?', '[', ']', '{', '}', '!', '@', '+', '('])?;
    let literal = pattern[..literal_end].strip_suffix('/')?;
    let rest = &pattern[literal_end..];
    let contains_root = root == literal || root.starts_with(&format!("{literal}/"));
    (rest.starts_with("**/") && contains_root).then(|| rest.to_owned())
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

    use super::{collect_source_files, sort_and_dedupe_paths, traversal_pattern};
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
     * Today the contract holds because discovery hands ferralk no include
     * patterns and the `GlobSet` decides, so the test passes even with
     * `Walker::match_hidden` off. That is precisely why it is worth keeping:
     * when ferralk#79 lets the includes move onto the walker, this is the test
     * that stops them moving over with hidden matching disabled.
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

    #[test]
    fn strips_the_root_a_pattern_already_starts_at() {
        assert_eq!(
            traversal_pattern(Path::new("/repo/src"), "/repo/src/**/*.{ts,tsx}").as_deref(),
            Some("**/*.{ts,tsx}")
        );
    }

    #[test]
    fn reanchors_a_position_independent_pattern_below_the_root() {
        assert_eq!(
            traversal_pattern(Path::new("/repo/src"), "/repo/**/node_modules/**").as_deref(),
            Some("**/node_modules/**")
        );
    }

    // A single-star segment names exactly one component; re-anchoring it under
    // `/repo/src` would make it name a component one level deeper, which is a
    // different set.
    #[test]
    fn refuses_a_pattern_that_is_anchored_to_a_depth() {
        assert_eq!(
            traversal_pattern(Path::new("/repo/src"), "/repo/*/node_modules/**"),
            None
        );
    }

    #[test]
    fn refuses_a_pattern_rooted_in_a_sibling_directory() {
        assert_eq!(
            traversal_pattern(Path::new("/repo/src"), "/repo/docs/**/*.mdx"),
            None
        );
    }

    /*
     * A root whose name merely begins with the literal prefix is not below it:
     * `/repo-vendor` must not pick up `/repo`'s patterns.
     */
    #[test]
    fn refuses_a_root_that_only_shares_a_name_prefix() {
        assert_eq!(
            traversal_pattern(Path::new("/repo-vendor"), "/repo/**/node_modules/**"),
            None
        );
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
