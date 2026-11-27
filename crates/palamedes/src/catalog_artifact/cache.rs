use std::borrow::Borrow;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};

use ferrocat::{CompiledCatalogIdIndex, CompiledKeyStrategy};

use crate::error::{PalamedesError, PalamedesResult};
use crate::icu_text::RUNTIME_ICU_SYNTAX_POLICY;

use super::load::{
    CatalogFileFingerprint, read_catalog_sources, read_catalog_sources_with_fingerprints,
    stat_stable_catalog_fingerprints,
};
use super::resolve::{CompilationSnapshot, prepare_compilation_request};
use super::types::{CatalogArtifactConfig, CatalogArtifactSelectedRequest, PalamedesCatalogFormat};
use super::{PreparedCompilation, compile_selected_prepared};

const DEFAULT_CACHE_CAPACITY: usize = 256;

type SlotId = u64;

#[cfg(test)]
type BeforeBuildHook = Arc<dyn Fn(&str) + Send + Sync>;

/// A bounded cache for selected catalog compilation inputs.
///
/// Callers own the cache. In particular, the Node binding keeps one bounded
/// cache for its native-process lifetime; Rust and CLI callers do not acquire
/// an implicit process-global cache.
///
/// On warm lookups whose watch files are outside the racy-timestamp window, a
/// contained metadata check `(size, mtime_ns, inode/dev)` validates the cached
/// snapshot without re-reading or SHA-256 hashing unchanged catalog files. Any
/// metadata mismatch, missing-file transition, atomic replacement, or file
/// modified within the racy window falls back to full content reads and SHA-256
/// content-key verification.
///
/// Entries are keyed by the resolved catalog set, source locale, catalog
/// configuration, fallback chain, and content hash. Work for a cache key is
/// coalesced behind that key's condvar, while unrelated catalog sets parse and
/// index concurrently.
pub struct CatalogCompilationCache {
    capacity: usize,
    state: Mutex<CacheState>,
    #[cfg(test)]
    statistics: Mutex<CacheStatistics>,
    #[cfg(test)]
    counters: Mutex<CacheTestCounters>,
    #[cfg(test)]
    before_build: Mutex<Option<BeforeBuildHook>>,
}

struct CacheState {
    next_slot_id: SlotId,
    clock: u64,
    slots: HashMap<SlotId, CacheSlot>,
    by_content_key: HashMap<Arc<CompilationCacheKey>, SlotId>,
    by_request: HashMap<Arc<RequestIdentity>, SlotId>,
    in_flight: HashMap<Arc<CompilationCacheKey>, Arc<InFlightBuild>>,
}

struct CacheSlot {
    key: Arc<CompilationCacheKey>,
    compiled: Arc<CachedCompilation>,
    last_used: u64,
    metadata: Option<Vec<Option<CatalogFileFingerprint>>>,
}

struct InFlightBuild {
    finished: Mutex<bool>,
    wake: Condvar,
}

struct CachedCompilation {
    prepared: PreparedCompilation,
    compiled_id_index: CompiledCatalogIdIndex,
}

trait RequestIdentityKey {
    fn root_dir(&self) -> &str;
    fn locales(&self) -> &[String];
    fn source_locale(&self) -> &str;
    fn catalog_pattern_len(&self) -> usize;
    fn catalog_pattern(&self, index: usize) -> (&str, PalamedesCatalogFormat);
    fn locale(&self) -> &str;
    fn fallback_chain(&self) -> &[String];
    fn watch_files(&self) -> &[PathBuf];
}

fn hash_request_identity_key<H: Hasher>(key: &(dyn RequestIdentityKey + '_), state: &mut H) {
    key.root_dir().hash(state);
    key.locales().hash(state);
    key.source_locale().hash(state);
    let len = key.catalog_pattern_len();
    len.hash(state);
    for index in 0..len {
        key.catalog_pattern(index).hash(state);
    }
    key.locale().hash(state);
    key.fallback_chain().hash(state);
    key.watch_files().hash(state);
}

fn eq_request_identity_key(
    left: &(dyn RequestIdentityKey + '_),
    right: &(dyn RequestIdentityKey + '_),
) -> bool {
    if left.root_dir() != right.root_dir()
        || left.locales() != right.locales()
        || left.source_locale() != right.source_locale()
        || left.catalog_pattern_len() != right.catalog_pattern_len()
        || left.locale() != right.locale()
        || left.fallback_chain() != right.fallback_chain()
        || left.watch_files() != right.watch_files()
    {
        return false;
    }
    for index in 0..left.catalog_pattern_len() {
        if left.catalog_pattern(index) != right.catalog_pattern(index) {
            return false;
        }
    }
    true
}

impl PartialEq for dyn RequestIdentityKey + '_ {
    fn eq(&self, other: &Self) -> bool {
        eq_request_identity_key(self, other)
    }
}

impl Eq for dyn RequestIdentityKey + '_ {}

impl Hash for dyn RequestIdentityKey + '_ {
    fn hash<H: Hasher>(&self, state: &mut H) {
        hash_request_identity_key(self, state);
    }
}

#[derive(Clone)]
struct RequestIdentity {
    root_dir: String,
    locales: Vec<String>,
    source_locale: String,
    catalog_patterns: Vec<(String, PalamedesCatalogFormat)>,
    locale: String,
    fallback_chain: Vec<String>,
    watch_files: Vec<PathBuf>,
}

impl RequestIdentityKey for RequestIdentity {
    fn root_dir(&self) -> &str {
        &self.root_dir
    }

    fn locales(&self) -> &[String] {
        &self.locales
    }

    fn source_locale(&self) -> &str {
        &self.source_locale
    }

    fn catalog_pattern_len(&self) -> usize {
        self.catalog_patterns.len()
    }

    fn catalog_pattern(&self, index: usize) -> (&str, PalamedesCatalogFormat) {
        let (path, format) = &self.catalog_patterns[index];
        (path.as_str(), *format)
    }

    fn locale(&self) -> &str {
        &self.locale
    }

    fn fallback_chain(&self) -> &[String] {
        &self.fallback_chain
    }

    fn watch_files(&self) -> &[PathBuf] {
        &self.watch_files
    }
}

impl PartialEq for RequestIdentity {
    fn eq(&self, other: &Self) -> bool {
        eq_request_identity_key(self, other)
    }
}

impl Eq for RequestIdentity {}

impl Hash for RequestIdentity {
    fn hash<H: Hasher>(&self, state: &mut H) {
        hash_request_identity_key(self, state);
    }
}

impl<'a> Borrow<dyn RequestIdentityKey + 'a> for Arc<RequestIdentity> {
    fn borrow(&self) -> &(dyn RequestIdentityKey + 'a) {
        &**self
    }
}

struct RequestIdentityRef<'a> {
    config: &'a CatalogArtifactConfig,
    locale: &'a str,
    fallback_chain: &'a [String],
    watch_files: &'a [PathBuf],
}

impl<'a> RequestIdentityRef<'a> {
    fn new(
        config: &'a CatalogArtifactConfig,
        locale: &'a str,
        fallback_chain: &'a [String],
        watch_files: &'a [PathBuf],
    ) -> Self {
        Self {
            config,
            locale,
            fallback_chain,
            watch_files,
        }
    }
}

impl RequestIdentityKey for RequestIdentityRef<'_> {
    fn root_dir(&self) -> &str {
        &self.config.root_dir
    }

    fn locales(&self) -> &[String] {
        &self.config.locales
    }

    fn source_locale(&self) -> &str {
        &self.config.source_locale
    }

    fn catalog_pattern_len(&self) -> usize {
        self.config.catalogs.len()
    }

    fn catalog_pattern(&self, index: usize) -> (&str, PalamedesCatalogFormat) {
        let catalog = &self.config.catalogs[index];
        (catalog.path.as_str(), catalog.format)
    }

    fn locale(&self) -> &str {
        self.locale
    }

    fn fallback_chain(&self) -> &[String] {
        self.fallback_chain
    }

    fn watch_files(&self) -> &[PathBuf] {
        self.watch_files
    }
}

#[derive(Eq, Hash, PartialEq)]
struct CompilationCacheKey {
    request: Arc<RequestIdentity>,
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

#[cfg(test)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct CacheTestCounters {
    file_reads: usize,
    metadata_hits: usize,
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
                next_slot_id: 0,
                clock: 0,
                slots: HashMap::new(),
                by_content_key: HashMap::new(),
                by_request: HashMap::new(),
                in_flight: HashMap::new(),
            }),
            #[cfg(test)]
            statistics: Mutex::new(CacheStatistics::default()),
            #[cfg(test)]
            counters: Mutex::new(CacheTestCounters::default()),
            #[cfg(test)]
            before_build: Mutex::new(None),
        }
    }

    pub(super) fn compile_selected(
        &self,
        request: &CatalogArtifactSelectedRequest,
    ) -> PalamedesResult<super::types::CatalogArtifactResult> {
        self.compile_selected_with_wait(request, true)
    }

    pub(super) fn compile_selected_without_waiting(
        &self,
        request: &CatalogArtifactSelectedRequest,
    ) -> PalamedesResult<super::types::CatalogArtifactResult> {
        self.compile_selected_with_wait(request, false)
    }

    fn compile_selected_with_wait(
        &self,
        request: &CatalogArtifactSelectedRequest,
        wait_for_in_flight: bool,
    ) -> PalamedesResult<super::types::CatalogArtifactResult> {
        let prepared = prepare_compilation_request(&request.config, &request.resource_path)?;

        if self.capacity == 0 {
            let sources = read_catalog_sources(&prepared.resolved_files, &request.config)?;
            let snapshot = prepared.into_snapshot(sources, request.config.source_locale.clone());
            let cached = self.build(snapshot)?;
            return compile_selected_prepared(&cached.prepared, &cached.compiled_id_index, request);
        }

        let request_ref = RequestIdentityRef::new(
            &request.config,
            &prepared.locale,
            &prepared.fallback_chain,
            &prepared.watch_files,
        );

        if self.has_metadata_entry(&request_ref)
            && let Some(fingerprints) =
                stat_stable_catalog_fingerprints(&prepared.resolved_files, &request.config)?
            && let Some(compiled) = self.ready_by_metadata(&request_ref, &fingerprints)
        {
            return compile_selected_prepared(
                &compiled.prepared,
                &compiled.compiled_id_index,
                request,
            );
        }

        let read_result = read_catalog_sources_with_fingerprints(
            &prepared.resolved_files,
            &request.config,
            || self.record_file_read(),
        )?;
        let stable_fingerprints = read_result.stable_fingerprints;
        let mut snapshot =
            Some(prepared.into_snapshot(read_result.sources, request.config.source_locale.clone()));
        let key = Arc::new(CompilationCacheKey::new(
            &request.config,
            snapshot.as_ref().expect("snapshot"),
        ));

        loop {
            if let Some(compiled) = self.ready(&key, stable_fingerprints.as_deref()) {
                return compile_selected_prepared(
                    &compiled.prepared,
                    &compiled.compiled_id_index,
                    request,
                );
            }

            let (in_flight, builds) = self.in_flight(&key);
            if builds {
                let completion =
                    InFlightCompletion::new(self, Arc::clone(&key), Arc::clone(&in_flight));
                self.before_build(&key.request.locale);
                let result = self.build(snapshot.take().expect("snapshot")).map(Arc::new);
                if let Ok(compiled) = &result {
                    self.insert_ready(key, Arc::clone(compiled), stable_fingerprints);
                }
                drop(completion);
                let compiled = result?;
                return compile_selected_prepared(
                    &compiled.prepared,
                    &compiled.compiled_id_index,
                    request,
                );
            }
            if !wait_for_in_flight {
                // A synchronous caller must never park the Node main thread
                // on the async worker's Condvar. Build independently and
                // leave the in-flight owner responsible for warming the
                // shared cache when it completes.
                self.before_build(&key.request.locale);
                let compiled = self.build(snapshot.take().expect("snapshot"))?;
                return compile_selected_prepared(
                    &compiled.prepared,
                    &compiled.compiled_id_index,
                    request,
                );
            }
            in_flight.wait();
        }
    }

    fn has_metadata_entry(&self, request: &RequestIdentityRef<'_>) -> bool {
        let state = lock_unpoison(&self.state);
        if state.by_request.is_empty() {
            return false;
        }
        let lookup: &dyn RequestIdentityKey = request;
        state.by_request.contains_key(lookup)
    }

    fn ready_by_metadata(
        &self,
        request: &RequestIdentityRef<'_>,
        fingerprints: &[Option<CatalogFileFingerprint>],
    ) -> Option<Arc<CachedCompilation>> {
        let mut state = lock_unpoison(&self.state);
        let lookup: &dyn RequestIdentityKey = request;
        let slot_id = *state.by_request.get(lookup)?;
        state.clock = state.clock.wrapping_add(1);
        let now = state.clock;
        let slot = state.slots.get_mut(&slot_id)?;
        if slot.metadata.as_deref() != Some(fingerprints) {
            return None;
        }
        slot.last_used = now;
        let compiled = Arc::clone(&slot.compiled);
        drop(state);
        self.record_metadata_hit();
        Some(compiled)
    }

    fn ready(
        &self,
        key: &Arc<CompilationCacheKey>,
        stable_fingerprints: Option<&[Option<CatalogFileFingerprint>]>,
    ) -> Option<Arc<CachedCompilation>> {
        let mut state = lock_unpoison(&self.state);
        let slot_id = *state.by_content_key.get(key)?;
        state.clock = state.clock.wrapping_add(1);
        let now = state.clock;
        let (compiled, request_arc) = {
            let slot = state.slots.get_mut(&slot_id)?;
            slot.last_used = now;
            slot.metadata = stable_fingerprints.map(ToOwned::to_owned);
            (Arc::clone(&slot.compiled), Arc::clone(&slot.key.request))
        };
        if stable_fingerprints.is_some() {
            state.by_request.insert(request_arc, slot_id);
        } else if state.by_request.get(&request_arc) == Some(&slot_id) {
            state.by_request.remove(&request_arc);
        }
        Some(compiled)
    }

    fn in_flight(&self, key: &Arc<CompilationCacheKey>) -> (Arc<InFlightBuild>, bool) {
        let mut state = lock_unpoison(&self.state);
        if let Some(in_flight) = state.in_flight.get(key) {
            return (Arc::clone(in_flight), false);
        }
        let in_flight = Arc::new(InFlightBuild::new());
        state
            .in_flight
            .insert(Arc::clone(key), Arc::clone(&in_flight));
        (in_flight, true)
    }

    fn insert_ready(
        &self,
        key: Arc<CompilationCacheKey>,
        compiled: Arc<CachedCompilation>,
        metadata: Option<Vec<Option<CatalogFileFingerprint>>>,
    ) {
        let mut state = lock_unpoison(&self.state);
        let superseded = state
            .slots
            .iter()
            .filter(|(_, slot)| {
                slot.key == key
                    || slot.key.request == key.request
                    || (slot.key.files.len() == key.files.len()
                        && slot
                            .key
                            .files
                            .iter()
                            .zip(&key.files)
                            .all(|(left, right)| left.path == right.path))
            })
            .map(|(&slot_id, _)| slot_id)
            .collect::<Vec<_>>();
        for stale_slot in superseded {
            remove_slot(&mut state, stale_slot);
        }
        if state.slots.len() >= self.capacity
            && let Some(oldest_slot) = state
                .slots
                .iter()
                .min_by_key(|(_, slot)| slot.last_used)
                .map(|(&slot_id, _)| slot_id)
        {
            remove_slot(&mut state, oldest_slot);
        }
        state.next_slot_id = state.next_slot_id.wrapping_add(1);
        let slot_id = state.next_slot_id;
        state.clock = state.clock.wrapping_add(1);
        let now = state.clock;
        let has_metadata = metadata.is_some();
        let request_arc = Arc::clone(&key.request);
        state.by_content_key.insert(Arc::clone(&key), slot_id);
        state.slots.insert(
            slot_id,
            CacheSlot {
                key,
                compiled,
                last_used: now,
                metadata,
            },
        );
        if has_metadata {
            state.by_request.insert(request_arc, slot_id);
        }
    }

    fn finish_in_flight(&self, key: &Arc<CompilationCacheKey>, in_flight: &Arc<InFlightBuild>) {
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

    #[cfg(test)]
    pub(super) fn file_reads(&self) -> usize {
        lock_unpoison(&self.counters).file_reads
    }

    #[cfg(test)]
    pub(super) fn metadata_hits(&self) -> usize {
        lock_unpoison(&self.counters).metadata_hits
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

    fn record_file_read(&self) {
        #[cfg(test)]
        {
            lock_unpoison(&self.counters).file_reads += 1;
        }
    }

    fn record_metadata_hit(&self) {
        #[cfg(test)]
        {
            lock_unpoison(&self.counters).metadata_hits += 1;
        }
    }

    #[cfg(test)]
    pub(super) fn ready_len(&self) -> usize {
        lock_unpoison(&self.state).slots.len()
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

fn remove_slot(state: &mut CacheState, slot_id: SlotId) {
    if let Some(slot) = state.slots.remove(&slot_id) {
        state.by_content_key.remove(&slot.key);
        if state.by_request.get(&slot.key.request) == Some(&slot_id) {
            state.by_request.remove(&slot.key.request);
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
    key: Arc<CompilationCacheKey>,
    in_flight: Arc<InFlightBuild>,
}

impl<'a> InFlightCompletion<'a> {
    fn new(
        cache: &'a CatalogCompilationCache,
        key: Arc<CompilationCacheKey>,
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
            request: Arc::new(RequestIdentity {
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
                watch_files: snapshot.watch_files.clone(),
            }),
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
        Self::new(DEFAULT_CACHE_CAPACITY)
    }
}
