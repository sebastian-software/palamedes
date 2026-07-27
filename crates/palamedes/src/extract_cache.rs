//! Per-file extraction cache.
//!
//! Extraction is dominated by reading and parsing source. On a repeat run most
//! files are untouched, so their result is still valid and the work is pure
//! waste. This caches the extracted messages per file and validates entries
//! with a `stat` instead of a read: on the realistic benchmark corpus, reading
//! all 1500 files costs ~25 ms and parsing them ~94 ms, against ~2.7 ms to stat
//! them.
//!
//! The cache is advisory. Anything unexpected — missing file, unreadable
//! directory, corrupt or stale payload, schema change — degrades to a miss and
//! a normal extraction, never to an error.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::extract::ExtractedMessageRecord;

/// Bumped whenever the cached payload shape or the extractor's output changes
/// in a way that makes previously stored entries wrong.
const CACHE_SCHEMA: u32 = 1;

/*
 * A file modified in the same instant it was cached cannot be distinguished
 * from one modified immediately afterwards, so entries that young are never
 * stored. This is the same hazard Git documents as "racy timestamps"; the
 * window is far smaller here because APFS and ext4 report nanoseconds, but the
 * guard costs nothing and removes the class of bug entirely.
 */
const RACY_WINDOW: Duration = Duration::from_secs(1);

/// Identity of a source file as observed without reading it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct FileFingerprint {
    size: u64,
    /// Modification time in nanoseconds since the Unix epoch.
    mtime_ns: u128,
}

impl FileFingerprint {
    fn read(path: &Path) -> Option<Self> {
        let metadata = std::fs::metadata(path).ok()?;
        let mtime = metadata.modified().ok()?;
        Some(Self {
            size: metadata.len(),
            mtime_ns: mtime.duration_since(UNIX_EPOCH).ok()?.as_nanos(),
        })
    }

    fn is_racy(&self, now: SystemTime) -> bool {
        let Ok(now_ns) = now.duration_since(UNIX_EPOCH) else {
            return true;
        };
        now_ns.as_nanos().saturating_sub(self.mtime_ns) < RACY_WINDOW.as_nanos()
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct CacheEntry {
    fingerprint: FileFingerprint,
    /// Origin path as stored in catalogs, which depends on the reference root.
    relative_file: String,
    messages: Vec<ExtractedMessageRecord>,
}

/*
 * Everything that can change extraction output without changing any source
 * file. A mismatch discards the whole cache rather than trying to reason about
 * which entries survived.
 */
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct CacheStamp {
    schema: u32,
    extractor_version: String,
    root_dir: String,
    /// Reference-scope extraction changes the records themselves, so entries
    /// produced under the other setting must not be reused.
    reference_scopes: bool,
}

#[derive(Serialize, Deserialize)]
struct CachePayload {
    stamp: CacheStamp,
    entries: HashMap<String, CacheEntry>,
}

/// Extraction cache for one project root.
///
/// Load once per process and keep it alive: a single `pmds extract` saves the
/// read and parse of every unchanged file, and watch mode reuses the same
/// instance across rebuilds so later runs never touch disk for them.
#[derive(Debug)]
pub struct ExtractCache {
    stamp: CacheStamp,
    entries: HashMap<String, CacheEntry>,
    dirty: bool,
    enabled: bool,
}

impl ExtractCache {
    /// Cache that never hits and never persists.
    #[must_use]
    pub fn disabled() -> Self {
        Self {
            stamp: CacheStamp {
                schema: CACHE_SCHEMA,
                extractor_version: String::new(),
                root_dir: String::new(),
                reference_scopes: false,
            },
            entries: HashMap::new(),
            dirty: false,
            enabled: false,
        }
    }

    /// Loads the cache for `root_dir` from `path`, or starts empty.
    ///
    /// A missing, unreadable, corrupt, or differently-stamped file is not an
    /// error: extraction simply runs cold and rewrites the cache afterwards.
    #[must_use]
    pub fn load(path: &Path, root_dir: &str, reference_scopes: bool) -> Self {
        let stamp = CacheStamp {
            schema: CACHE_SCHEMA,
            extractor_version: env!("CARGO_PKG_VERSION").to_owned(),
            root_dir: root_dir.to_owned(),
            reference_scopes,
        };

        let entries = std::fs::read(path)
            .ok()
            .and_then(|raw| serde_json::from_slice::<CachePayload>(&raw).ok())
            .filter(|payload| payload.stamp == stamp)
            .map(|payload| payload.entries)
            .unwrap_or_default();

        Self {
            stamp,
            entries,
            dirty: false,
            enabled: true,
        }
    }

    /// Cached result for `path`, if the file still looks exactly as it did.
    pub(crate) fn get(&self, path: &str) -> Option<(String, Vec<ExtractedMessageRecord>)>
    where
        ExtractedMessageRecord: Clone,
    {
        if !self.enabled {
            return None;
        }
        let entry = self.entries.get(path)?;
        let current = FileFingerprint::read(Path::new(path))?;
        if current != entry.fingerprint {
            return None;
        }
        Some((entry.relative_file.clone(), entry.messages.clone()))
    }

    /// Records a freshly extracted result.
    pub(crate) fn insert(
        &mut self,
        path: String,
        relative_file: String,
        messages: &[ExtractedMessageRecord],
    ) where
        ExtractedMessageRecord: Clone,
    {
        if !self.enabled {
            return;
        }
        let Some(fingerprint) = FileFingerprint::read(Path::new(&path)) else {
            return;
        };
        if fingerprint.is_racy(SystemTime::now()) {
            return;
        }
        self.entries.insert(
            path,
            CacheEntry {
                fingerprint,
                relative_file,
                messages: messages.to_vec(),
            },
        );
        self.dirty = true;
    }

    /// Drops entries for files that are no longer part of the extraction set,
    /// so a long-lived watch process does not grow without bound.
    pub(crate) fn retain_paths(&mut self, keep: &std::collections::HashSet<&str>) {
        if !self.enabled {
            return;
        }
        let before = self.entries.len();
        self.entries.retain(|path, _| keep.contains(path.as_str()));
        if self.entries.len() != before {
            self.dirty = true;
        }
    }

    /// Whether anything changed since the last load or save.
    #[must_use]
    pub fn is_dirty(&self) -> bool {
        self.enabled && self.dirty
    }

    /// Number of retained entries.
    #[must_use]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Whether the cache holds no entries.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Persists the cache, creating parent directories as needed.
    ///
    /// # Errors
    ///
    /// Returns the underlying I/O or serialization error. Callers are expected
    /// to treat a failed save as non-fatal: the next run simply runs cold.
    pub fn save(&mut self, path: &Path) -> std::io::Result<()> {
        if !self.enabled || !self.dirty {
            return Ok(());
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let payload = CachePayload {
            stamp: self.stamp.clone(),
            entries: self.entries.clone(),
        };
        let encoded = serde_json::to_vec(&payload)
            .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;

        /*
         * Written through a temporary file so a crash or a concurrent reader
         * never observes a half-written cache. A torn cache would be discarded
         * on load anyway, but this keeps that path unreachable.
         */
        let directory = path.parent().unwrap_or_else(|| Path::new("."));
        let mut temporary = tempfile::NamedTempFile::new_in(directory)?;
        std::io::Write::write_all(&mut temporary, &encoded)?;
        temporary.persist(path).map_err(|error| error.error)?;
        self.dirty = false;
        Ok(())
    }
}

/// Default cache location for a project root.
#[must_use]
pub fn default_cache_path(root_dir: &Path) -> PathBuf {
    root_dir.join(".palamedes").join("extract-cache.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "palamedes-cache-{label}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ))
    }

    fn record(message: &str) -> ExtractedMessageRecord {
        ExtractedMessageRecord {
            message: message.to_owned(),
            comment: None,
            context: None,
            placeholders: None,
            origin: ("src/App.tsx".to_owned(), 1, None),
            scope: None,
        }
    }

    /// Backdates a file so it is outside the racy window and can be cached.
    fn write_aged(path: &Path, contents: &str) {
        std::fs::write(path, contents).expect("write");
        let old = SystemTime::now() - Duration::from_secs(10);
        let file = std::fs::File::options()
            .write(true)
            .open(path)
            .expect("open");
        file.set_modified(old).expect("set mtime");
    }

    #[test]
    fn returns_cached_messages_while_the_file_is_untouched() {
        let root = temp_root("hit");
        std::fs::create_dir_all(&root).expect("root");
        let source = root.join("a.tsx");
        write_aged(&source, "const a = 1\n");
        let key = source.to_string_lossy().into_owned();

        let mut cache = ExtractCache::load(&root.join("cache.json"), "root", true);
        cache.insert(key.clone(), "a.tsx".to_owned(), &[record("Hello")]);

        let hit = cache.get(&key).expect("cache hit");
        assert_eq!(hit.0, "a.tsx");
        assert_eq!(hit.1[0].message, "Hello");

        // Any content change moves size and mtime, so the entry stops matching.
        write_aged(&source, "const a = 22222\n");
        assert!(cache.get(&key).is_none());

        std::fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn misses_when_the_stamp_changes() {
        let root = temp_root("stamp");
        std::fs::create_dir_all(&root).expect("root");
        let source = root.join("a.tsx");
        write_aged(&source, "const a = 1\n");
        let key = source.to_string_lossy().into_owned();
        let cache_path = root.join("cache.json");

        let mut cache = ExtractCache::load(&cache_path, "root-one", true);
        cache.insert(key.clone(), "a.tsx".to_owned(), &[record("Hello")]);
        cache.save(&cache_path).expect("save");

        // Same file, different reference root: origins would differ, so the
        // whole cache has to be discarded.
        let reloaded = ExtractCache::load(&cache_path, "root-two", true);
        assert!(reloaded.is_empty());

        let same = ExtractCache::load(&cache_path, "root-one", true);
        assert_eq!(same.len(), 1);

        // Reference scopes change the extracted records, so flipping the flag
        // must discard the cache exactly like a changed reference root does.
        let flipped = ExtractCache::load(&cache_path, "root-one", false);
        assert!(flipped.is_empty());

        std::fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn refuses_to_store_files_modified_within_the_racy_window() {
        let root = temp_root("racy");
        std::fs::create_dir_all(&root).expect("root");
        let source = root.join("a.tsx");
        // Written now, so its mtime is indistinguishable from a modification
        // that lands immediately after this cache write.
        std::fs::write(&source, "const a = 1\n").expect("write");
        let key = source.to_string_lossy().into_owned();

        let mut cache = ExtractCache::load(&root.join("cache.json"), "root", true);
        cache.insert(key.clone(), "a.tsx".to_owned(), &[record("Hello")]);
        assert!(cache.is_empty(), "young files must not be cached");
        assert!(cache.get(&key).is_none());

        std::fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn corrupt_payload_degrades_to_an_empty_cache() {
        let root = temp_root("corrupt");
        std::fs::create_dir_all(&root).expect("root");
        let cache_path = root.join("cache.json");
        std::fs::write(&cache_path, "{ this is not json").expect("write");

        let cache = ExtractCache::load(&cache_path, "root", true);
        assert!(cache.is_empty());
        assert!(!cache.is_dirty());

        std::fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn disabled_cache_never_stores_or_hits() {
        let root = temp_root("disabled");
        std::fs::create_dir_all(&root).expect("root");
        let source = root.join("a.tsx");
        write_aged(&source, "const a = 1\n");
        let key = source.to_string_lossy().into_owned();

        let mut cache = ExtractCache::disabled();
        cache.insert(key.clone(), "a.tsx".to_owned(), &[record("Hello")]);
        assert!(cache.get(&key).is_none());
        assert!(!cache.is_dirty());

        std::fs::remove_dir_all(root).expect("cleanup");
    }
}
