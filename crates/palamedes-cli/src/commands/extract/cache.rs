//! Lifecycle of the on-disk extraction cache (ADR 019): where it lives, when
//! it is valid, and when it has to be rebuilt.

use std::path::{Path, PathBuf};

use palamedes::ExtractCache;

use crate::config::{ConfigLintRules, LoadedConfig};

/// Session-local reporting state for a long-lived watch process.
///
/// A failed save leaves the cache dirty, so every later extraction retries it.
/// Remembering the first warning here keeps a persistent filesystem problem
/// visible without flooding stderr on every watched edit.
#[derive(Default)]
pub(super) struct CachePersistenceWarnings {
    reported: bool,
}

/// Resolves and loads the cache, or a disabled one when it is turned off.
pub(crate) fn load_extract_cache(config: &LoadedConfig, no_cache: bool) -> ExtractCache {
    if no_cache || !config.extract_cache {
        return ExtractCache::disabled();
    }
    ExtractCache::load_with_options(
        &extract_cache_path(config),
        &config.source_reference_root.to_string_lossy(),
        &config.analysis_options(),
    )
}

pub(super) fn extract_cache_path(config: &LoadedConfig) -> PathBuf {
    palamedes::default_cache_path(&config.root_dir)
}

/// Everything about a configuration that decides what a cached entry means or
/// where the cache file lives. A change to any of it invalidates a cache
/// instance that is being reused across config reloads.
fn extract_cache_identity(
    config: &LoadedConfig,
) -> (
    &Path,
    &Path,
    bool,
    bool,
    &palamedes::MdxOptions,
    &ConfigLintRules,
) {
    (
        config.root_dir.as_path(),
        config.source_reference_root.as_path(),
        config.reference_scopes,
        config.extract_cache,
        &config.mdx,
        &config.lint.rules,
    )
}

/*
 * Watch mode keeps one cache alive across rebuilds, but its entries only mean
 * anything under the configuration that produced them: origins follow
 * source-reference-root, records follow reference-scopes, and the file itself
 * lives under root_dir. When a reload changes any of that — including turning
 * `extract-cache` off — the cache is rebuilt through the startup path, after
 * flushing what the previous configuration produced to its own location.
 */
pub(super) fn rebuild_extract_cache_for_reload(
    previous: &LoadedConfig,
    next: &LoadedConfig,
    no_cache: bool,
    cache: &mut ExtractCache,
    warnings: &mut CachePersistenceWarnings,
) {
    if extract_cache_identity(previous) == extract_cache_identity(next) {
        return;
    }

    persist_extract_cache_for_watch(previous, cache, warnings);
    *cache = load_extract_cache(next, no_cache);
}

/*
 * A cache that cannot be written is not a failure: the next run just starts
 * cold. Report it once so a permanently unwritable directory is not silently
 * costing every invocation.
 */
pub(crate) fn persist_extract_cache(config: &LoadedConfig, cache: &mut ExtractCache) {
    let mut warnings = CachePersistenceWarnings::default();
    persist_extract_cache_for_watch(config, cache, &mut warnings);
}

/// Persists a watch-mode cache while reporting at most one write failure for
/// the lifetime of the watcher.
pub(super) fn persist_extract_cache_for_watch(
    config: &LoadedConfig,
    cache: &mut ExtractCache,
    warnings: &mut CachePersistenceWarnings,
) -> bool {
    if let Err(error) = cache.save(&extract_cache_path(config)) {
        if warnings.reported {
            return false;
        }
        warnings.reported = true;
        eprintln!(
            "Warning: could not write the extraction cache to {}: {error}",
            extract_cache_path(config).display()
        );
        return true;
    }
    false
}
