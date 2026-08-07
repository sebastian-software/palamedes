use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use ferrocat::{CompiledCatalogIdIndex, CompiledKeyStrategy};

use crate::error::{PalamedesError, PalamedesResult};

use super::resolve::{prepare_compilation_snapshot, CompilationSnapshot};
use super::types::{CatalogArtifactConfig, CatalogArtifactSelectedRequest};
use super::{compile_selected_prepared, PreparedCompilation};

/// A bounded cache for selected catalog compilation inputs.
///
/// Callers own the cache. In particular, the Node binding keeps one bounded
/// cache for its native-process lifetime; Rust and CLI callers do not acquire
/// an implicit process-global cache. Each lookup reads every dependency and
/// hashes its content before reusing a value, so coarse timestamps, atomic
/// replacement, and missing-file transitions cannot return stale catalogs.
///
/// Entries are keyed by the resolved catalog set, source locale, catalog
/// configuration, fallback chain, and content hash. Work for a cache key is
/// coalesced behind that key's mutex, while unrelated catalog sets parse and
/// index concurrently.
pub struct CatalogCompilationCache {
    capacity: usize,
    state: Mutex<CacheState>,
    #[cfg(test)]
    statistics: Mutex<CacheStatistics>,
}

struct CacheState {
    entries: HashMap<CompilationCacheKey, Arc<Mutex<Option<Arc<CachedCompilation>>>>>,
    clock: u64,
    last_used: HashMap<CompilationCacheKey, u64>,
}

struct CachedCompilation {
    prepared: PreparedCompilation,
    compiled_id_index: CompiledCatalogIdIndex,
}

#[derive(Clone, Eq, Hash, PartialEq)]
struct CompilationCacheKey {
    root_dir: String,
    locales: Vec<String>,
    source_locale: String,
    catalog_patterns: Vec<(String, super::types::PalamedesCatalogFormat)>,
    locale: String,
    fallback_chain: Vec<String>,
    files: Vec<CatalogContentKey>,
}

#[derive(Clone, Eq, Hash, PartialEq)]
struct CatalogContentKey {
    path: String,
    digest: [u8; 32],
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct CacheStatistics {
    pub(super) parses: usize,
    pub(super) index_builds: usize,
}

impl CatalogCompilationCache {
    /// Creates a cache retaining at most `capacity` resolved catalog sets.
    ///
    /// A capacity of zero disables retention while preserving normal compile
    /// behavior. Existing users can continue calling the uncached API.
    #[must_use]
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity,
            state: Mutex::new(CacheState {
                entries: HashMap::new(),
                clock: 0,
                last_used: HashMap::new(),
            }),
            #[cfg(test)]
            statistics: Mutex::new(CacheStatistics::default()),
        }
    }

    pub(super) fn compile_selected(
        &self,
        request: &CatalogArtifactSelectedRequest,
    ) -> PalamedesResult<super::types::CatalogArtifactResult> {
        let snapshot = prepare_compilation_snapshot(&request.config, &request.resource_path)?;
        let key = CompilationCacheKey::new(&request.config, &snapshot);

        if self.capacity == 0 {
            let cached = self.build(snapshot)?;
            return compile_selected_prepared(&cached.prepared, &cached.compiled_id_index, request);
        }

        let entry = self.entry(key);
        let compiled = {
            let mut entry = entry.lock().expect("catalog cache entry lock poisoned");
            if entry.is_none() {
                *entry = Some(Arc::new(self.build(snapshot)?));
            }
            Arc::clone(entry.as_ref().expect("catalog cache entry initialized"))
        };
        // `CachedCompilation` is immutable after construction, so it remains
        // safe to use after releasing the per-key construction lock.
        compile_selected_prepared(&compiled.prepared, &compiled.compiled_id_index, request)
    }

    fn entry(&self, key: CompilationCacheKey) -> Arc<Mutex<Option<Arc<CachedCompilation>>>> {
        let mut state = self
            .state
            .lock()
            .expect("catalog cache state lock poisoned");
        state.clock = state.clock.wrapping_add(1);
        let now = state.clock;
        if let Some(entry) = state.entries.get(&key) {
            let entry = Arc::clone(entry);
            state.last_used.insert(key, now);
            return entry;
        }

        if state.entries.len() >= self.capacity {
            if let Some(oldest) = state
                .last_used
                .iter()
                .min_by_key(|(_, used)| *used)
                .map(|(key, _)| key.clone())
            {
                state.entries.remove(&oldest);
                state.last_used.remove(&oldest);
            }
        }
        let entry = Arc::new(Mutex::new(None));
        state.entries.insert(key.clone(), Arc::clone(&entry));
        state.last_used.insert(key, now);
        entry
    }

    fn build(&self, snapshot: CompilationSnapshot) -> PalamedesResult<CachedCompilation> {
        #[cfg(test)]
        let parses = snapshot.sources.len();
        let prepared = snapshot.into_prepared()?;
        let catalogs = prepared.loaded.values().collect::<Vec<_>>();
        let compiled_id_index = CompiledCatalogIdIndex::new_with_policy(
            &catalogs,
            CompiledKeyStrategy::FerrocatV1,
            ferrocat::IcuSyntaxPolicy::RuntimeLiteralApostrophes,
        )
        .map_err(PalamedesError::BuildCompiledIdIndex)?;
        #[cfg(test)]
        {
            let mut statistics = self
                .statistics
                .lock()
                .expect("catalog cache statistics lock poisoned");
            statistics.parses += parses;
            statistics.index_builds += 1;
        }
        Ok(CachedCompilation {
            prepared,
            compiled_id_index,
        })
    }

    #[cfg(test)]
    pub(super) fn statistics(&self) -> CacheStatistics {
        *self
            .statistics
            .lock()
            .expect("catalog cache statistics lock poisoned")
    }
}

impl CompilationCacheKey {
    fn new(config: &CatalogArtifactConfig, snapshot: &CompilationSnapshot) -> Self {
        Self {
            root_dir: config.root_dir.clone(),
            locales: config.locales.clone(),
            source_locale: config.source_locale.clone(),
            catalog_patterns: config
                .catalogs
                .iter()
                .map(|catalog| (catalog.path.clone(), catalog.format))
                .collect(),
            locale: snapshot.locale.clone(),
            fallback_chain: snapshot.fallback_chain.clone(),
            files: snapshot
                .sources
                .iter()
                .map(|source| CatalogContentKey {
                    path: source.path.to_string_lossy().into_owned(),
                    digest: source.digest,
                })
                .collect(),
        }
    }
}

impl Default for CatalogCompilationCache {
    fn default() -> Self {
        Self::new(64)
    }
}
