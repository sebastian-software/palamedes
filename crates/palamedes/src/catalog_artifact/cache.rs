use std::collections::HashMap;
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};

use ferrocat::{CompiledCatalogIdIndex, CompiledKeyStrategy};

use crate::error::{PalamedesError, PalamedesResult};
use crate::icu_text::RUNTIME_ICU_SYNTAX_POLICY;

use super::resolve::{prepare_compilation_snapshot, CompilationSnapshot};
use super::types::{CatalogArtifactConfig, CatalogArtifactSelectedRequest};
use super::{compile_selected_prepared, PreparedCompilation};

#[cfg(test)]
type BeforeBuildHook = Arc<dyn Fn(&str) + Send + Sync>;

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
    #[cfg(test)]
    before_build: Mutex<Option<BeforeBuildHook>>,
}

struct CacheState {
    ready: HashMap<CompilationCacheKey, Arc<CachedCompilation>>,
    in_flight: HashMap<CompilationCacheKey, Arc<InFlightBuild>>,
    clock: u64,
    last_used: HashMap<CompilationCacheKey, u64>,
}

struct InFlightBuild {
    finished: Mutex<bool>,
    wake: Condvar,
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
                ready: HashMap::new(),
                in_flight: HashMap::new(),
                clock: 0,
                last_used: HashMap::new(),
            }),
            #[cfg(test)]
            statistics: Mutex::new(CacheStatistics::default()),
            #[cfg(test)]
            before_build: Mutex::new(None),
        }
    }

    pub(super) fn compile_selected(
        &self,
        request: &CatalogArtifactSelectedRequest,
    ) -> PalamedesResult<super::types::CatalogArtifactResult> {
        let mut snapshot = Some(prepare_compilation_snapshot(
            &request.config,
            &request.resource_path,
        )?);
        let key = CompilationCacheKey::new(&request.config, snapshot.as_ref().expect("snapshot"));

        if self.capacity == 0 {
            let cached = self.build(snapshot.take().expect("snapshot"))?;
            return compile_selected_prepared(&cached.prepared, &cached.compiled_id_index, request);
        }

        loop {
            if let Some(compiled) = self.ready(&key) {
                return compile_selected_prepared(
                    &compiled.prepared,
                    &compiled.compiled_id_index,
                    request,
                );
            }

            let (in_flight, builds) = self.in_flight(&key);
            if builds {
                let completion = InFlightCompletion::new(self, key.clone(), Arc::clone(&in_flight));
                self.before_build(&key.locale);
                let result = self.build(snapshot.take().expect("snapshot")).map(Arc::new);
                if let Ok(compiled) = &result {
                    self.insert_ready(key.clone(), Arc::clone(compiled));
                }
                drop(completion);
                let compiled = result?;
                return compile_selected_prepared(
                    &compiled.prepared,
                    &compiled.compiled_id_index,
                    request,
                );
            }
            in_flight.wait();
        }
    }

    fn ready(&self, key: &CompilationCacheKey) -> Option<Arc<CachedCompilation>> {
        let mut state = lock_unpoison(&self.state);
        let compiled = state.ready.get(key).map(Arc::clone)?;
        state.clock = state.clock.wrapping_add(1);
        let now = state.clock;
        state.last_used.insert(key.clone(), now);
        Some(compiled)
    }

    fn in_flight(&self, key: &CompilationCacheKey) -> (Arc<InFlightBuild>, bool) {
        let mut state = lock_unpoison(&self.state);
        if let Some(in_flight) = state.in_flight.get(key) {
            return (Arc::clone(in_flight), false);
        }
        let in_flight = Arc::new(InFlightBuild::new());
        state.in_flight.insert(key.clone(), Arc::clone(&in_flight));
        (in_flight, true)
    }

    fn insert_ready(&self, key: CompilationCacheKey, compiled: Arc<CachedCompilation>) {
        let mut state = lock_unpoison(&self.state);
        let superseded = state
            .ready
            .keys()
            .filter(|existing| {
                existing != &&key
                    && existing.files.len() == key.files.len()
                    && existing
                        .files
                        .iter()
                        .zip(&key.files)
                        .all(|(left, right)| left.path == right.path)
            })
            .cloned()
            .collect::<Vec<_>>();
        for stale in superseded {
            state.ready.remove(&stale);
            state.last_used.remove(&stale);
        }
        if state.ready.len() >= self.capacity {
            if let Some(oldest) = state
                .last_used
                .iter()
                .min_by_key(|(_, used)| *used)
                .map(|(key, _)| key.clone())
            {
                state.ready.remove(&oldest);
                state.last_used.remove(&oldest);
            }
        }
        state.clock = state.clock.wrapping_add(1);
        let now = state.clock;
        state.ready.insert(key.clone(), compiled);
        state.last_used.insert(key, now);
    }

    fn finish_in_flight(&self, key: &CompilationCacheKey, in_flight: &Arc<InFlightBuild>) {
        let mut state = lock_unpoison(&self.state);
        if state
            .in_flight
            .get(key)
            .is_some_and(|current| Arc::ptr_eq(current, in_flight))
        {
            state.in_flight.remove(key);
        }
        drop(state);
        in_flight.finish();
    }

    fn build(&self, snapshot: CompilationSnapshot) -> PalamedesResult<CachedCompilation> {
        let prepared = snapshot.into_prepared_with_observer(|| self.record_parse())?;
        let catalogs = prepared.loaded.values().collect::<Vec<_>>();
        self.record_index_build();
        let compiled_id_index = CompiledCatalogIdIndex::new_with_policy(
            &catalogs,
            CompiledKeyStrategy::FerrocatV1,
            RUNTIME_ICU_SYNTAX_POLICY,
        )
        .map_err(PalamedesError::BuildCompiledIdIndex)?;
        Ok(CachedCompilation {
            prepared,
            compiled_id_index,
        })
    }

    #[cfg(test)]
    pub(super) fn statistics(&self) -> CacheStatistics {
        *lock_unpoison(&self.statistics)
    }

    fn record_parse(&self) {
        #[cfg(test)]
        {
            lock_unpoison(&self.statistics).parses += 1;
        }
    }

    fn record_index_build(&self) {
        #[cfg(test)]
        {
            lock_unpoison(&self.statistics).index_builds += 1;
        }
    }

    #[cfg(test)]
    pub(super) fn ready_len(&self) -> usize {
        lock_unpoison(&self.state).ready.len()
    }

    #[cfg(test)]
    pub(super) fn set_before_build_hook(&self, hook: BeforeBuildHook) {
        *lock_unpoison(&self.before_build) = Some(hook);
    }

    #[cfg(test)]
    pub(super) fn clear_before_build_hook(&self) {
        *lock_unpoison(&self.before_build) = None;
    }

    fn before_build(&self, locale: &str) {
        #[cfg(not(test))]
        let _ = locale;
        #[cfg(test)]
        let hook = lock_unpoison(&self.before_build).as_ref().map(Arc::clone);
        #[cfg(test)]
        if let Some(hook) = hook {
            hook(locale);
        }
    }
}

impl InFlightBuild {
    fn new() -> Self {
        Self {
            finished: Mutex::new(false),
            wake: Condvar::new(),
        }
    }

    fn wait(&self) {
        let mut finished = lock_unpoison(&self.finished);
        while !*finished {
            finished = self
                .wake
                .wait(finished)
                .unwrap_or_else(PoisonError::into_inner);
        }
    }

    fn finish(&self) {
        *lock_unpoison(&self.finished) = true;
        self.wake.notify_all();
    }
}

struct InFlightCompletion<'a> {
    cache: &'a CatalogCompilationCache,
    key: CompilationCacheKey,
    in_flight: Arc<InFlightBuild>,
}

impl<'a> InFlightCompletion<'a> {
    fn new(
        cache: &'a CatalogCompilationCache,
        key: CompilationCacheKey,
        in_flight: Arc<InFlightBuild>,
    ) -> Self {
        Self {
            cache,
            key,
            in_flight,
        }
    }
}

impl Drop for InFlightCompletion<'_> {
    fn drop(&mut self) {
        self.cache.finish_in_flight(&self.key, &self.in_flight);
    }
}

fn lock_unpoison<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
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
