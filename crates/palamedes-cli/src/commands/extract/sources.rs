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
        .add_roots(rest.iter())
        .map_err(|source| discovery_pattern_error(&roots, source))?;

    for pattern in &include_patterns {
        walker = walker
            .include(pattern)
            .map_err(|source| CliError::DiscoveryPattern {
                pattern: pattern.clone(),
                source,
            })?;
    }
    for pattern in &exclude_patterns {
        walker = walker
            .exclude(pattern)
            .map_err(|source| CliError::DiscoveryPattern {
                pattern: pattern.clone(),
                source,
            })?;
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

/// `add_roots` reports which pattern it could not compile but not which root it
/// was compiling against, so name the roots rather than guess.
fn discovery_pattern_error(
    roots: &[PathBuf],
    source: ferralk::ferralk_glob::PatternError,
) -> CliError {
    CliError::DiscoveryPattern {
        pattern: roots
            .iter()
            .map(|root| root.to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join(", "),
        source,
    }
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

/// TEMPORARY parity scaffold: compares the ferralk walk against the `ignore` +
/// `globset` implementation it replaced, on a real tree named by
/// `PALAMEDES_TRIAL_TREE`. Removed before this branch is proposed; it exists to
/// prove the caller-matcher-free path on trees no fixture can imitate.
#[cfg(test)]
mod parity_scaffold {
    use std::path::{Path, PathBuf};

    use ignore::WalkBuilder;

    use super::{
        build_include_set, collect_source_files, normalized_include_patterns,
        resolved_exclude_patterns, sort_and_dedupe_paths, walk_roots_for_patterns,
    };
    use crate::config::{load_config, LoadedConfig};

    fn config_over(tree: &Path) -> LoadedConfig {
        let root = std::env::temp_dir().join(format!(
            "palamedes-parity-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).expect("create config dir");
        std::fs::write(
            root.join("palamedes.yaml"),
            format!(
                "locales: [en, de]\nsource-locale: en\ncatalogs:\n  - path: locales/{{locale}}/messages\n    include: ['{tree}']\n    exclude: ['{tree}/**/node_modules/**']\n",
                tree = tree.display()
            ),
        )
        .expect("write config");
        load_config(&root, Some(&root.join("palamedes.yaml"))).expect("load config")
    }

    /// Source discovery exactly as it stood before the ferralk work started.
    fn reference(config: &LoadedConfig) -> Vec<PathBuf> {
        let catalog = &config.catalogs[0];
        let include_patterns = normalized_include_patterns(catalog, config);
        let include = build_include_set(catalog, config).expect("include set");
        let exclude = super::build_glob_set(&resolved_exclude_patterns(catalog, config), "exclude")
            .expect("exclude set");
        let mut files = Vec::new();
        for root in walk_roots_for_patterns(&include_patterns, &config.root_dir) {
            for entry in WalkBuilder::new(root)
                .standard_filters(false)
                .hidden(false)
                .build()
            {
                let Ok(entry) = entry else { continue };
                let path = entry.path();
                if path.is_file() && !exclude.is_match(path) && include.is_match(path) {
                    files.push(path.to_path_buf());
                }
            }
        }
        sort_and_dedupe_paths(&mut files);
        files
    }

    /// `ignore` in parallel with excluded subtrees pruned through
    /// `filter_entry` and per-worker shards: what palamedes#875 proposed
    /// building on the stack that was already here. The arm this branch has to
    /// beat to be worth a dependency.
    fn pruned_ignore(config: &LoadedConfig, threads: usize) -> Vec<PathBuf> {
        use std::sync::Mutex;

        use globset::{Glob, GlobSetBuilder};
        use ignore::WalkState;

        let catalog = &config.catalogs[0];
        let include_patterns = normalized_include_patterns(catalog, config);
        let include = build_include_set(catalog, config).expect("include set");
        let exclude_patterns = resolved_exclude_patterns(catalog, config);
        let exclude = super::build_glob_set(&exclude_patterns, "exclude").expect("exclude set");
        let mut prune = GlobSetBuilder::new();
        for pattern in &exclude_patterns {
            if let Some(directory) = pattern.strip_suffix("/**") {
                if let Ok(glob) = Glob::new(directory) {
                    prune.add(glob);
                }
            }
        }
        let prune = prune.build().expect("prune set");

        struct Shard<'a> {
            paths: Vec<PathBuf>,
            sink: &'a Mutex<Vec<PathBuf>>,
        }
        impl Drop for Shard<'_> {
            fn drop(&mut self) {
                self.sink.lock().expect("merge").append(&mut self.paths);
            }
        }

        // The visitor closure is `move`, so hand it shared references rather
        // than the matchers themselves.
        let (include, exclude) = (&include, &exclude);
        let files = Mutex::new(Vec::new());
        for root in walk_roots_for_patterns(&include_patterns, &config.root_dir) {
            let prune = prune.clone();
            WalkBuilder::new(root)
                .standard_filters(false)
                .hidden(false)
                .threads(threads)
                .filter_entry(move |entry| {
                    !entry.file_type().is_some_and(|kind| kind.is_dir())
                        || !prune.is_match(entry.path())
                })
                .build_parallel()
                .run(|| {
                    let mut shard = Shard {
                        paths: Vec::new(),
                        sink: &files,
                    };
                    Box::new(move |entry| {
                        if let Ok(entry) = entry {
                            let path = entry.path();
                            if path.is_file() && !exclude.is_match(path) && include.is_match(path) {
                                shard.paths.push(path.to_path_buf());
                            }
                        }
                        WalkState::Continue
                    })
                });
        }
        let mut files = files.into_inner().expect("collected");
        sort_and_dedupe_paths(&mut files);
        files
    }

    #[test]
    #[ignore = "needs PALAMEDES_TRIAL_TREE"]
    fn timing() {
        let Ok(tree) = std::env::var("PALAMEDES_TRIAL_TREE") else {
            return;
        };
        let tree = PathBuf::from(tree);
        let rounds = 9usize;
        let mut config = config_over(&tree);

        // Warm the cache before anyone is timed.
        let files = reference(&config).len();
        println!(
            "tree {} -- {files} files, median of {rounds} warm rounds",
            tree.display()
        );

        let mut medians: Vec<(&str, std::time::Duration)> = Vec::new();
        for (label, threads) in [
            ("ignore serial (previous)", Some(1usize)),
            ("ignore pruned x4 (#875)", Some(4)),
            ("ferralk serial", None),
            ("ferralk x4", None),
        ] {
            let ferralk_threads = match label {
                "ferralk serial" => Some(1),
                "ferralk x4" => Some(4),
                _ => None,
            };
            config.extract_threads = ferralk_threads;
            let mut samples = Vec::with_capacity(rounds);
            for _ in 0..rounds {
                let started = std::time::Instant::now();
                let found = match (label, threads) {
                    ("ignore serial (previous)", _) => reference(&config),
                    ("ignore pruned x4 (#875)", Some(n)) => pruned_ignore(&config, n),
                    _ => collect_source_files(&config.catalogs[0], &config).expect("discover"),
                };
                samples.push(started.elapsed());
                assert_eq!(found.len(), files, "{label} found a different file count");
                std::hint::black_box(found);
            }
            samples.sort_unstable();
            medians.push((label, samples[samples.len() / 2]));
        }
        let baseline = medians[0].1;
        let target = medians[1].1;
        for (label, median) in &medians {
            println!(
                "  {label}: {median:?} ({:.2}x vs previous, {:.2}x vs #875 x4)",
                baseline.as_secs_f64() / median.as_secs_f64(),
                target.as_secs_f64() / median.as_secs_f64()
            );
        }
    }

    #[test]
    #[ignore = "needs PALAMEDES_TRIAL_TREE"]
    fn matches_the_previous_implementation() {
        let Ok(tree) = std::env::var("PALAMEDES_TRIAL_TREE") else {
            return;
        };
        let tree = PathBuf::from(tree);
        let config = config_over(&tree);
        let expected = reference(&config);
        let actual = collect_source_files(&config.catalogs[0], &config).expect("discover");

        let missing: Vec<_> = expected.iter().filter(|p| !actual.contains(p)).collect();
        let extra: Vec<_> = actual.iter().filter(|p| !expected.contains(p)).collect();
        println!(
            "tree {} -- reference {} files, ferralk {} files, {} missing, {} extra",
            tree.display(),
            expected.len(),
            actual.len(),
            missing.len(),
            extra.len()
        );
        for path in missing.iter().take(25) {
            println!("    only in reference: {}", path.display());
        }
        for path in extra.iter().take(25) {
            println!("    only in ferralk:   {}", path.display());
        }
        assert_eq!(actual, expected, "discovered sets differ");
    }
}
