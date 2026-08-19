//! Trial: source discovery on the [ferralk] walker, behind the
//! `ferralk-discovery` feature.
//!
//! This exists to answer palamedes#875 — whether a walker that prunes excluded
//! subtrees during traversal and parallelises the walk is worth adopting — with
//! a second engine that can be measured against the `ignore` one on the same
//! tree in the same process, rather than with a replacement that has to be
//! trusted.
//!
//! Two alternative engines are compiled, selected by
//! `PALAMEDES_SOURCE_DISCOVERY`:
//!
//! - `ferralk` — ferralk walks and prunes, but the catalog's `GlobSet`s still
//!   make the final include/exclude call on the absolute path. Excluded
//!   subtrees are never descended, and every file the walker does surface is
//!   decided by exactly the matcher the `ignore` engine uses. Parity is
//!   therefore a property of the construction, not a hope.
//! - `ferralk-native` — ferralk's own matcher decides, the way the crate's
//!   README presents it. This is the engine that shows what adopting ferralk's
//!   glob semantics would actually change; see `docs` below.
//!
//! Anything else, including the variable being unset, keeps the `ignore`
//! engine.
//!
//! # Why the split
//!
//! ferralk matches patterns against *root-relative* bytes; palamedes resolves
//! every catalog pattern to an *absolute* path glob and walks several roots.
//! Translating between the two is only sound for some pattern shapes, and the
//! two matchers do not agree on all of them:
//!
//! - `globset` with palamedes' options lets `*` cross `/`; ferralk's `*` is
//!   component-scoped.
//! - `globset` wildcards match a leading `.`; ferralk's do not, and
//!   `ferralk_glob::PatternOptions::match_hidden` is not reachable through
//!   `Walker`. palamedes deliberately walks hidden files
//!   (`WalkBuilder::hidden(false)`), so under `ferralk-native` hidden sources
//!   disappear.
//!
//! The `ferralk` engine is unaffected by both, because it only ever hands
//! ferralk patterns whose translation can be shown to be equal-or-narrower, and
//! narrower is free: the `GlobSet` backstop rejects whatever the walker did not
//! prune.
//!
//! [ferralk]: https://github.com/sebastian-software/ferralk

use std::path::{Path, PathBuf};

use ferralk::{ErrorPolicy, WalkOptions, Walker};
use globset::GlobSet;

use super::sources::sort_and_dedupe_paths;
use crate::config::LoadedConfig;

/// Environment variable that picks the discovery engine for one process.
pub(crate) const ENGINE_VAR: &str = "PALAMEDES_SOURCE_DISCOVERY";
/// Environment variable that overrides the ferralk worker count, so the
/// trial's A/B harness can measure serial and parallel from one binary.
pub(crate) const THREADS_VAR: &str = "PALAMEDES_SOURCE_DISCOVERY_THREADS";

/// One of the two ferralk-backed engines this trial compiles.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Engine {
    /// ferralk traverses and prunes; the catalog `GlobSet`s still decide.
    Backstopped,
    /// ferralk's matcher decides on its own.
    Native,
}

/// Everything a discovery run needs that does not depend on the engine.
pub(crate) struct Request<'a> {
    pub(crate) roots: &'a [PathBuf],
    pub(crate) include_patterns: &'a [String],
    pub(crate) exclude_patterns: &'a [String],
    pub(crate) include: &'a GlobSet,
    pub(crate) exclude: &'a GlobSet,
    pub(crate) threads: usize,
}

/// The engine `PALAMEDES_SOURCE_DISCOVERY` asks for, or `None` to keep the
/// `ignore` engine.
pub(crate) fn selected_alternative() -> Option<Engine> {
    match std::env::var(ENGINE_VAR).ok()?.as_str() {
        "ferralk" => Some(Engine::Backstopped),
        "ferralk-native" => Some(Engine::Native),
        _ => None,
    }
}

/// Worker count for a ferralk walk: the trial override first, then the
/// catalog's configured extraction threads, then the machine's parallelism.
pub(crate) fn threads(config: &LoadedConfig) -> usize {
    if let Some(threads) = std::env::var(THREADS_VAR)
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
    {
        return threads.max(1);
    }
    config
        .extract_threads
        .or_else(|| std::thread::available_parallelism().ok().map(Into::into))
        .unwrap_or(1)
        .max(1)
}

/// Discovers sources with one of the ferralk engines. Ordering and
/// deduplication stay with `sort_and_dedupe_paths`, so catalog origin order is
/// the same whichever engine ran.
pub(crate) fn collect_source_files(engine: Engine, request: Request<'_>) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for root in request.roots {
        let mut walker = Walker::new(root)
            .threads(request.threads)
            // `ignore`'s iterator yields recoverable errors as items and the
            // current code drops them silently. Skip reproduces that; Collect
            // would allocate error records nothing reads.
            .error_policy(ErrorPolicy::Skip)
            // Directories are never candidates. The `is_file` call below still
            // has to happen for symlink parity, but not for every directory.
            .options(WalkOptions::default().files_only(true));

        /*
         * Excludes are handed over for pruning only. A translation that is
         * narrower than the catalog's own exclude costs a subtree that could
         * have been skipped; it can never drop a file, because the GlobSet
         * below still rejects it. A translation that were *broader* could drop
         * a file, which is why `traversal_pattern` refuses everything it
         * cannot show to be equivalent.
         *
         * The `walker.clone()` is not an oversight. `Walker::exclude` takes
         * `self` by value and returns `Result<Self, PatternError>`, so a
         * rejected pattern consumes the builder without handing it back; a
         * caller that wants to skip one bad pattern and keep the rest has no
         * other way to hold on to it.
         */
        for pattern in request.exclude_patterns {
            if let Some(relative) = traversal_pattern(root, pattern) {
                if let Ok(next) = walker.clone().exclude(&relative) {
                    walker = next;
                }
            }
        }

        // Under the native engine the includes drive pruning as well, which is
        // where ferralk's scoped-query advantage comes from. If any include
        // cannot be translated the walk would silently widen to "everything",
        // so the GlobSet include check is kept for that root instead.
        let mut include_is_complete = engine == Engine::Native;
        if engine == Engine::Native {
            for pattern in request.include_patterns {
                match traversal_pattern(root, pattern)
                    .and_then(|relative| walker.clone().include(&relative).ok())
                {
                    Some(next) => walker = next,
                    None => include_is_complete = false,
                }
            }
        }

        let Ok(result) = walker.collect() else {
            continue;
        };

        for entry in result.entries() {
            let path = entry.path();
            /*
             * Deliberately `is_file()` and not ferralk's own entry kind. The
             * `ignore` engine follows the link here, so a symlink to a file
             * counts and a broken symlink does not; ferralk reports the link
             * itself. Keeping the same call keeps the same answer.
             */
            if !path.is_file() {
                continue;
            }
            match engine {
                Engine::Native => {
                    if include_is_complete || request.include.is_match(path) {
                        files.push(path.to_path_buf());
                    }
                }
                Engine::Backstopped => {
                    if request.exclude.is_match(path) {
                        continue;
                    }
                    if request.include.is_match(path) {
                        files.push(path.to_path_buf());
                    }
                }
            }
        }
    }

    sort_and_dedupe_paths(&mut files);
    files
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
/// under a sibling root — returns `None` rather than a guess.
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

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::traversal_pattern;

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
}

/// The trial's own instruments: a parity check and an A/B timing run over one
/// real tree, driven by `PALAMEDES_TRIAL_TREE`.
///
/// Both are `#[ignore]`d, so `cargo test` is unaffected and they are only ever
/// run on purpose:
///
/// ```sh
/// PALAMEDES_TRIAL_TREE=/path/to/tree \
///   cargo test -p palamedes-cli --features ferralk-discovery --release \
///   -- --ignored --nocapture trial::
/// ```
#[cfg(test)]
mod trial {
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    use globset::{Glob, GlobSet, GlobSetBuilder};
    use ignore::{WalkBuilder, WalkState};

    use super::{collect_source_files, Engine, Request};
    use crate::commands::extract::sources::{
        build_exclude_set, build_include_set, collect_with_ignore, normalized_include_patterns,
        resolved_exclude_patterns, sort_and_dedupe_paths, walk_roots_for_patterns,
    };
    use crate::config::{load_config, LoadedConfig};

    const TREE_VAR: &str = "PALAMEDES_TRIAL_TREE";
    const ROUNDS: usize = 9;
    const THREADS: usize = 4;

    /// A config whose single catalog covers `tree` through absolute patterns,
    /// so the tree under measurement never has to be written to.
    fn config_over(tree: &Path) -> LoadedConfig {
        let root = std::env::temp_dir().join(format!(
            "palamedes-ferralk-trial-{}-{:?}",
            std::process::id(),
            Instant::now()
        ));
        std::fs::create_dir_all(&root).expect("create trial config dir");
        std::fs::write(
            root.join("palamedes.yaml"),
            format!(
                "locales: [en, de]\nsource-locale: en\ncatalogs:\n  - path: locales/{{locale}}/messages\n    include: ['{tree}']\n    exclude: ['{tree}/**/node_modules/**']\n",
                tree = tree.display()
            ),
        )
        .expect("write trial config");
        load_config(&root, Some(&root.join("palamedes.yaml"))).expect("load trial config")
    }

    fn tree_under_test() -> Option<PathBuf> {
        let tree = PathBuf::from(std::env::var(TREE_VAR).ok()?);
        assert!(tree.is_dir(), "{TREE_VAR} must point at a directory");
        Some(tree)
    }

    /// Runs one arm once and returns its file list.
    fn run(arm: Arm, threads: usize, config: &LoadedConfig) -> Vec<PathBuf> {
        let catalog = &config.catalogs[0];
        let include_patterns = normalized_include_patterns(catalog, config);
        let include = build_include_set(catalog, config).expect("include set");
        let exclude_patterns = resolved_exclude_patterns(catalog, config);
        let exclude = build_exclude_set(catalog, config).expect("exclude set");
        let roots = walk_roots_for_patterns(&include_patterns, &config.root_dir);

        match arm {
            Arm::Ignore => {
                let mut files = collect_with_ignore(&roots, &include, &exclude);
                sort_and_dedupe_paths(&mut files);
                files
            }
            Arm::PrunedIgnore => collect_with_pruned_ignore(
                &roots,
                &include,
                &exclude,
                &prune_set(&exclude_patterns),
                threads,
            ),
            Arm::Ferralk(engine) => collect_source_files(
                engine,
                Request {
                    roots: &roots,
                    include_patterns: &include_patterns,
                    exclude_patterns: &exclude_patterns,
                    include: &include,
                    exclude: &exclude,
                    threads,
                },
            ),
        }
    }

    /// Every arm the trial measures, in report order.
    fn arms() -> [(&'static str, Arm, usize); 7] {
        [
            ("ignore serial (current)", Arm::Ignore, 1),
            ("ignore pruned serial (#875)", Arm::PrunedIgnore, 1),
            ("ignore pruned x4 (#875)", Arm::PrunedIgnore, THREADS),
            ("ferralk serial", Arm::Ferralk(Engine::Backstopped), 1),
            ("ferralk x4", Arm::Ferralk(Engine::Backstopped), THREADS),
            ("ferralk-native serial", Arm::Ferralk(Engine::Native), 1),
            ("ferralk-native x4", Arm::Ferralk(Engine::Native), THREADS),
        ]
    }

    /// Which arm a timing or parity row is measuring.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum Arm {
        /// `ignore`, serial, no pruning: source discovery as it ships today.
        Ignore,
        /// `ignore` with excluded subtrees pruned during traversal — a compact
        /// stand-in for what palamedes#875 proposes building on the existing
        /// stack. Without it the trial would only be able to say that ferralk
        /// beats an unoptimised baseline, which was never the question.
        PrunedIgnore,
        Ferralk(Engine),
    }

    /// The directory form of every exclude that provably covers a whole
    /// subtree, which is the `**/node_modules/**` -> `**/node_modules`
    /// transformation palamedes#875 asks for. Anything else is left to the
    /// per-file `GlobSet`.
    fn prune_set(exclude_patterns: &[String]) -> GlobSet {
        let mut builder = GlobSetBuilder::new();
        for pattern in exclude_patterns {
            if let Some(directory) = pattern.strip_suffix("/**") {
                if let Ok(glob) = Glob::new(directory) {
                    builder.add(glob);
                }
            }
        }
        builder.build().expect("prune set")
    }

    /// One worker's result buffer. Merging on drop is what keeps the walk from
    /// taking the lock once per discovered path: `run` drops every visitor as
    /// it joins its worker, so each shard is appended exactly once.
    struct Shard<'a> {
        paths: Vec<PathBuf>,
        sink: &'a Mutex<Vec<PathBuf>>,
    }

    impl Drop for Shard<'_> {
        fn drop(&mut self) {
            self.sink
                .lock()
                .expect("shard merge")
                .append(&mut self.paths);
        }
    }

    fn collect_with_pruned_ignore(
        roots: &[PathBuf],
        include: &GlobSet,
        exclude: &GlobSet,
        prune: &GlobSet,
        threads: usize,
    ) -> Vec<PathBuf> {
        let files = Mutex::new(Vec::new());
        for root in roots {
            // `filter_entry` wants a `'static` predicate, so the prune set is
            // cloned per root rather than borrowed. `GlobSet::clone` shares the
            // compiled matchers, so this is not a recompile.
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
        let mut files = files.into_inner().expect("collected files");
        sort_and_dedupe_paths(&mut files);
        files
    }

    fn median(mut samples: Vec<Duration>) -> Duration {
        samples.sort_unstable();
        samples[samples.len() / 2]
    }

    /// Reports every path the two lists disagree on, both directions, rather
    /// than a count: a trial that hides its divergences has measured nothing.
    fn report_difference(label: &str, reference: &[PathBuf], candidate: &[PathBuf], tree: &Path) {
        let missing: Vec<_> = reference
            .iter()
            .filter(|p| !candidate.contains(p))
            .collect();
        let extra: Vec<_> = candidate
            .iter()
            .filter(|p| !reference.contains(p))
            .collect();
        let relative = |path: &Path| {
            path.strip_prefix(tree)
                .unwrap_or(path)
                .display()
                .to_string()
        };
        println!(
            "  {label}: {} files, {} missing vs ignore, {} extra",
            candidate.len(),
            missing.len(),
            extra.len()
        );
        for path in missing.iter().take(25) {
            println!("      only in ignore: {}", relative(path));
        }
        for path in extra.iter().take(25) {
            println!("      only in {label}: {}", relative(path));
        }
        if missing.len() > 25 || extra.len() > 25 {
            println!("      (list truncated at 25 per direction)");
        }
    }

    #[test]
    #[ignore = "needs PALAMEDES_TRIAL_TREE"]
    fn parity() {
        let Some(tree) = tree_under_test() else {
            return;
        };
        let config = config_over(&tree);
        let reference = run(Arm::Ignore, 1, &config);
        println!(
            "tree {} -- ignore found {} files",
            tree.display(),
            reference.len()
        );
        for (label, arm, threads) in arms() {
            if arm == Arm::Ignore {
                continue;
            }
            report_difference(label, &reference, &run(arm, threads, &config), &tree);
        }
    }

    #[test]
    #[ignore = "needs PALAMEDES_TRIAL_TREE"]
    fn timing() {
        let Some(tree) = tree_under_test() else {
            return;
        };
        let config = config_over(&tree);
        // Warm the page cache and the allocator before the first measurement,
        // so round one is not paying for everyone else.
        let files = run(Arm::Ignore, 1, &config).len();
        println!(
            "tree {} -- {files} files, median of {ROUNDS} warm rounds",
            tree.display()
        );
        let mut baseline = None;
        for (label, arm, threads) in arms() {
            let mut samples = Vec::with_capacity(ROUNDS);
            for _ in 0..ROUNDS {
                let started_at = Instant::now();
                let found = run(arm, threads, &config);
                samples.push(started_at.elapsed());
                std::hint::black_box(found);
            }
            let median = median(samples);
            let baseline = *baseline.get_or_insert(median);
            println!(
                "  {label}: {median:?} ({:.2}x)",
                baseline.as_secs_f64() / median.as_secs_f64()
            );
        }
    }
}
