//! `pmds extract --watch`: one long-lived process that keeps a warm cache and
//! re-extracts on relevant file changes.

use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use globset::GlobSet;
use notify::{RecursiveMode, Watcher};
use palamedes::{ExtractCache, PalamedesCatalogFormat};

use crate::commands::extract::cache::{
    load_extract_cache, persist_extract_cache, rebuild_extract_cache_for_reload,
};
use crate::commands::extract::sources::{
    build_exclude_set, build_include_set, normalized_include_patterns, walk_roots_for_patterns,
};
use crate::commands::extract::{run_extraction_with_cache, ExtractOptions};
use crate::config::{load_config, LoadedConfig};
use crate::error::CliError;

const WATCH_DEBOUNCE: Duration = Duration::from_millis(150);

/// Upper bound on the debounce drain. A generator that keeps emitting events
/// (a dev server writing into the watched tree, say) never leaves a quiet
/// window, and waiting for one would postpone extraction forever.
const WATCH_DEBOUNCE_MAX: Duration = Duration::from_secs(2);

/// Per-catalog include/exclude matchers, built once per config generation so
/// every filesystem event does not pay glob compilation again.
struct WatchMatchers {
    sets: Vec<(GlobSet, GlobSet)>,
}

impl WatchMatchers {
    fn build(config: &LoadedConfig) -> Self {
        let sets = config
            .catalogs
            .iter()
            .filter_map(|catalog| {
                match (
                    build_include_set(catalog, config),
                    build_exclude_set(catalog, config),
                ) {
                    (Ok(include), Ok(exclude)) => Some((include, exclude)),
                    /*
                     * A catalog whose globs do not compile can never match an
                     * event, so watch mode would silently stop rebuilding it.
                     * Name the catalog and the offending pattern instead.
                     */
                    (include, exclude) => {
                        let error = include.err().or(exclude.err());
                        eprintln!(
                            "Warning: Could not build watch patterns for catalog '{}'{}. Changes to its source files will not trigger extraction until the watcher restarts.",
                            catalog.path,
                            error
                                .map(|error| format!(": {error}"))
                                .unwrap_or_default()
                        );
                        None
                    }
                }
            })
            .collect();
        Self { sets }
    }

    fn matches(&self, path: &Path) -> bool {
        if path
            .components()
            .any(|component| component.as_os_str() == "node_modules")
        {
            return false;
        }
        if is_catalog_storage_path(path) {
            return false;
        }
        self.sets
            .iter()
            .any(|(include, exclude)| include.is_match(path) && !exclude.is_match(path))
    }
}

/// Whether a path is a catalog extraction itself writes. Include patterns that
/// contain glob syntax pass through verbatim, so a catalog stored under such an
/// include matches the include set — and every catalog write would schedule the
/// next extraction. The list covers every storage format, not just PO.
fn is_catalog_storage_path(path: &Path) -> bool {
    let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
        return false;
    };
    [PalamedesCatalogFormat::Po, PalamedesCatalogFormat::Fcl]
        .into_iter()
        .any(|format| format.extension() == extension)
}

/// Roots the watcher must observe: the config root plus every include root
/// that lies outside it (includes may point above or beside root_dir).
fn watch_roots(config: &LoadedConfig) -> Vec<PathBuf> {
    let mut roots = vec![config.root_dir.clone()];
    for catalog in &config.catalogs {
        let patterns = normalized_include_patterns(catalog, config);
        for root in walk_roots_for_patterns(&patterns, &config.root_dir) {
            if !root.starts_with(&config.root_dir) && !roots.contains(&root) {
                roots.push(root);
            }
        }
    }
    roots
}

pub(super) fn run_watch_mode(
    initial_config: &LoadedConfig,
    options: &ExtractOptions,
) -> Result<(), CliError> {
    println!("Watching for changes...");
    let mut config = initial_config.clone();
    /*
     * One cache for the life of the watcher. Every rebuild after the first
     * therefore skips the read and parse of files nobody touched, which is the
     * whole point of watch mode.
     */
    let mut cache = load_extract_cache(&config, options.no_cache);
    run_watch_extraction(&config, options, &mut cache)?;

    let (tx, rx) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(tx)?;
    let mut watched_roots = watch_roots(&config);
    for root in &watched_roots {
        watcher.watch(root, RecursiveMode::Recursive)?;
    }
    // The config file itself is a dependency: locale/fallback/pseudo edits
    // must take effect without restarting the watcher.
    watcher.watch(&config.config_path, RecursiveMode::NonRecursive)?;

    let mut matchers = WatchMatchers::build(&config);

    loop {
        let event = match rx.recv() {
            Ok(Ok(event)) => event,
            Ok(Err(error)) => return Err(CliError::Watch(error)),
            Err(_) => return Ok(()),
        };

        let mut config_changed = touches_config(&event.paths, &config);
        let mut relevant = config_changed || event.paths.iter().any(|path| matchers.matches(path));

        // Debounce: editors and generators emit event bursts; keep draining
        // until the stream is quiet before running a single extraction, but
        // never longer than WATCH_DEBOUNCE_MAX so a continuous event stream
        // cannot starve extraction.
        let drain_deadline = Instant::now() + WATCH_DEBOUNCE_MAX;
        loop {
            let remaining = drain_deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                break;
            }

            match rx.recv_timeout(WATCH_DEBOUNCE.min(remaining)) {
                Ok(Ok(event)) => {
                    config_changed = config_changed || touches_config(&event.paths, &config);
                    relevant = relevant
                        || config_changed
                        || event.paths.iter().any(|path| matchers.matches(path));
                }
                Ok(Err(error)) => return Err(CliError::Watch(error)),
                Err(_) => break,
            }
        }

        if !relevant {
            continue;
        }

        if config_changed {
            match load_config(
                &std::env::current_dir().expect("current dir"),
                options.config.as_deref(),
            ) {
                Ok(reloaded) => {
                    eprintln!(
                        "Config changed; reloaded {}",
                        reloaded.config_path.display()
                    );
                    let next_roots = watch_roots(&reloaded);
                    for stale in watched_roots
                        .iter()
                        .filter(|root| !next_roots.contains(root))
                    {
                        // Dropping removed roots keeps the watcher from
                        // accumulating obsolete registrations across reloads.
                        let _ = watcher.unwatch(stale);
                    }
                    for root in next_roots
                        .iter()
                        .filter(|root| !watched_roots.contains(root))
                    {
                        // A newly configured root that cannot be watched must
                        // be visible, or its source edits are silently missed.
                        if let Err(error) = watcher.watch(root, RecursiveMode::Recursive) {
                            eprintln!(
                                "Warning: Could not watch {}: {error}. Changes under this root will not trigger extraction until the watcher restarts.",
                                root.display()
                            );
                        }
                    }
                    watched_roots = next_roots;

                    rebuild_extract_cache_for_reload(
                        &config,
                        &reloaded,
                        options.no_cache,
                        options.verbose,
                        &mut cache,
                    );
                    config = reloaded;
                    matchers = WatchMatchers::build(&config);
                }
                Err(error) => {
                    eprintln!(
                        "Warning: Could not reload config: {error}. Keeping the previous configuration and continuing to watch for changes."
                    );
                }
            }
        }

        if options.verbose {
            eprintln!("Source changed; extracting catalogs");
        }
        run_watch_extraction(&config, options, &mut cache)?;
    }
}

fn touches_config(paths: &[PathBuf], config: &LoadedConfig) -> bool {
    paths.iter().any(|path| path == &config.config_path)
}

/// Watch mode must survive every extraction failure — including fatal
/// authoring errors like a half-typed `t({ message })` — because the developer
/// is mid-edit and the next save usually fixes the problem.
fn run_watch_extraction(
    config: &LoadedConfig,
    options: &ExtractOptions,
    cache: &mut ExtractCache,
) -> Result<(), CliError> {
    let result = run_extraction_with_cache(config, options, cache);
    persist_extract_cache(config, options.verbose, cache);
    match result {
        Ok(_) => Ok(()),
        Err(error) => {
            eprintln!("Warning: {error} Continuing to watch for changes.");
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use palamedes::ExtractCache;

    use super::{run_watch_extraction, WatchMatchers};
    use crate::commands::extract::cache::{load_extract_cache, rebuild_extract_cache_for_reload};
    use crate::commands::extract::test_support::{cached_extract_options, extract_options};
    use crate::commands::test_support::{temp_dir, write_config};
    use crate::config::load_config;

    /*
     * Catalogs stored under a glob-style include match that include, so an
     * unguarded catalog write schedules the extraction that wrote it. PO was
     * exempt from the start; FCL catalogs looped.
     */
    #[test]
    fn catalog_writes_never_look_like_source_changes() {
        let app = temp_dir("watch-catalog-self-trigger");
        fs::create_dir_all(app.join("src")).expect("create src");
        let config_path = app.join("palamedes.yaml");
        fs::write(
            &config_path,
            r#"locales: [en]
source-locale: en
catalogs:
  - path: src/locales/{locale}/messages
    include: ["src/**/*"]
  - path: src/locales/{locale}/lines
    format: fcl
    include: ["src/**/*"]
"#,
        )
        .expect("write config");

        let config = load_config(&app, Some(&config_path)).expect("load config");
        let matchers = WatchMatchers::build(&config);

        assert!(matchers.matches(&app.join("src/page.tsx")));
        assert!(!matchers.matches(&app.join("src/locales/en/messages.po")));
        assert!(!matchers.matches(&app.join("src/locales/en/lines.fcl")));
    }

    #[test]
    fn watch_extraction_recovers_after_parse_failures() {
        let app = temp_dir("watch-extract-failure");
        fs::create_dir_all(app.join("app")).expect("create app");
        write_config(&app, None);
        let source_path = app.join("app/page.tsx");
        // The macro import keeps the broken file on the parsing path;
        // marker-free files skip the parse and cannot fail extraction.
        fs::write(
            &source_path,
            "import { t } from \"@palamedes/core/macro\"\nconst broken =",
        )
        .expect("write invalid source");

        let config = load_config(&app, Some(&app.join("palamedes.yaml"))).expect("load config");
        run_watch_extraction(&config, &extract_options(), &mut ExtractCache::disabled())
            .expect("watch should remain active");
        assert!(!app.join("locales/en/messages.po").exists());

        fs::write(
            source_path,
            "import { t } from \"@palamedes/core/macro\";\nexport function title() { return t`Recovered`; }\n",
        )
        .expect("repair source");
        run_watch_extraction(&config, &extract_options(), &mut ExtractCache::disabled())
            .expect("watch should recover");

        let output =
            fs::read_to_string(app.join("locales/en/messages.po")).expect("read recovered catalog");
        assert!(output.contains("msgid \"Recovered\""));
    }

    /*
     * A cache that survives a config reload must not answer with entries that
     * were produced under the previous configuration: editing
     * source-reference-root mid-watch changed the origins of every unchanged
     * file, and the rebuilt catalogs kept showing the old ones.
     */
    #[test]
    fn watch_rebuilds_the_cache_after_a_stamp_relevant_config_reload() {
        let repo = temp_dir("watch-reload-cache");
        fs::create_dir(repo.join(".git")).expect("create git marker");
        let app = repo.join("apps/web");
        fs::create_dir_all(app.join("app")).expect("create app");
        let config_path = app.join("palamedes.yaml");
        let write_watch_config =
            |reference_root: &str, extract_cache: bool, placeholder_only: &str| {
                fs::write(
                    &config_path,
                    format!(
                        r#"locales: [en]
source-locale: en
source-reference-root: {reference_root}
extract-cache: {extract_cache}
lint:
  rules:
    placeholder-only: {placeholder_only}
catalogs:
  - path: locales/{{locale}}/messages
    include: [app]
"#
                    ),
                )
                .expect("write config");
            };
        fs::write(
            app.join("app/page.tsx"),
            "import { t } from \"@palamedes/core/macro\";\nexport function title() { return t`Dashboard`; }\n",
        )
        .expect("write source");

        let options = cached_extract_options();
        write_watch_config("config", true, "warning");
        let config = load_config(&app, Some(&config_path)).expect("load config");
        let mut cache = load_extract_cache(&config, options.no_cache);
        run_watch_extraction(&config, &options, &mut cache).expect("first extraction");

        let catalog_path = app.join("locales/en/messages.po");
        assert!(fs::read_to_string(&catalog_path)
            .expect("read catalog")
            .contains("#: app/page.tsx"));

        // Origins move to the git root; every source file is unchanged, so
        // without a rebuilt cache the catalog would keep the old origins.
        write_watch_config("git", true, "warning");
        let reloaded = load_config(&app, Some(&config_path)).expect("reload config");
        rebuild_extract_cache_for_reload(
            &config,
            &reloaded,
            options.no_cache,
            options.verbose,
            &mut cache,
        );
        assert!(
            cache.is_empty(),
            "a stamp-relevant reload must start from an empty cache"
        );
        run_watch_extraction(&reloaded, &options, &mut cache).expect("extraction after reload");

        assert!(fs::read_to_string(&catalog_path)
            .expect("read catalog")
            .contains("#: apps/web/app/page.tsx"));

        // Rule levels contribute to the source-analysis cache stamp too.
        // Reloading only a rule must therefore discard stale analysis.
        write_watch_config("git", true, "off");
        let rules_reloaded = load_config(&app, Some(&config_path)).expect("reload rules");
        rebuild_extract_cache_for_reload(
            &reloaded,
            &rules_reloaded,
            options.no_cache,
            options.verbose,
            &mut cache,
        );
        assert!(
            cache.is_empty(),
            "a rule-level reload must start from an empty cache"
        );
        run_watch_extraction(&rules_reloaded, &options, &mut cache)
            .expect("extraction after rules reload");

        // Turning the cache off mid-watch has to take effect immediately.
        let previous = rules_reloaded;
        write_watch_config("git", false, "off");
        let disabled = load_config(&app, Some(&config_path)).expect("reload config");
        rebuild_extract_cache_for_reload(
            &previous,
            &disabled,
            options.no_cache,
            options.verbose,
            &mut cache,
        );
        run_watch_extraction(&disabled, &options, &mut cache).expect("extraction without cache");
        assert!(cache.is_empty(), "a disabled cache must not store entries");
        assert!(!cache.is_dirty());
    }
}
