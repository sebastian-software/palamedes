//! Per-file extraction and source-analysis cache.
//!
//! Extraction is dominated by reading and parsing source. On a repeat run most
//! files are untouched, so their result is still valid and the work is pure
//! waste. This caches complete extracted messages, source diagnostics, and
//! parser-owned comment ranges per file. It also stores an extraction-only
//! sentinel for files rejected by the textual marker gate, without letting
//! that incomplete result satisfy source lint. Entries are validated with a
//! `stat` instead of a parse: on the realistic benchmark corpus, reading all
//! 1500 files costs ~25 ms and parsing them ~94 ms, against ~2.7 ms to stat
//! them.
//!
//! The cache is advisory. Anything unexpected — missing file, unreadable
//! directory, corrupt or stale payload, schema change — degrades to a miss and
//! a normal extraction, never to an error.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::extract::{ExtractCatalogMessagesOptions, ExtractedMessageRecord};
use crate::source::{SourceComment, SourceDiagnostic, SourceRuleOptions};

/// Bumped whenever the cached payload shape or the extractor's output changes
/// in a way that makes previously stored entries wrong.
const CACHE_SCHEMA: u32 = 5;

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
pub(crate) struct FileFingerprint {
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

    fn is_racy(&self, read_started_at: SystemTime) -> bool {
        let Ok(now_ns) = read_started_at.duration_since(UNIX_EPOCH) else {
            return true;
        };
        now_ns.as_nanos().saturating_sub(self.mtime_ns) < RACY_WINDOW.as_nanos()
    }
}

/// Identity of a file plus the instant the read that produced the cached
/// messages started.
///
/// The racy-window guard has to be evaluated against the read-start time, not
/// against the time of the insert: on a coarse-mtime filesystem an edit that
/// lands after the read but inside the same mtime granule is indistinguishable
/// from the state that was read, and by insert time that granule may already
/// have elapsed.
#[derive(Clone, Copy, Debug)]
pub(crate) struct ReadStartFingerprint {
    fingerprint: FileFingerprint,
    read_started_at: SystemTime,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct CacheEntry {
    fingerprint: FileFingerprint,
    /// Origin path as stored in catalogs, which depends on the reference root.
    relative_file: String,
    analysis: CachedEntryAnalysis,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum CachedEntryAnalysis {
    /// The textual gate proved that extraction is empty, but no parser-owned
    /// diagnostics or comments were collected for source lint.
    ExtractionOnly,
    Complete {
        messages: Vec<ExtractedMessageRecord>,
        diagnostics: Vec<SourceDiagnostic>,
        comments: Vec<SourceComment>,
    },
}

type CachedAnalysis = (
    String,
    Vec<ExtractedMessageRecord>,
    Vec<SourceDiagnostic>,
    Vec<SourceComment>,
);

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
    /// Configured MDX fields and opt-out semantics also change records.
    mdx_stamp: String,
    /// Rule levels affect diagnostics but never extracted messages.
    rules: SourceRuleOptions,
}

#[derive(Serialize, Deserialize)]
struct CachePayload {
    stamp: CacheStamp,
    entries: HashMap<String, CacheEntry>,
}

/// Extraction and source-analysis cache for one project root.
///
/// Load once per process and keep it alive: a single `pmds extract` saves the
/// read and parse of every unchanged file, `pmds lint` reuses its diagnostics
/// and comment ranges, and watch mode reuses the same instance across rebuilds.
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
                mdx_stamp: String::new(),
                rules: SourceRuleOptions::disabled(),
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
    ///
    /// This compatibility entry point uses the default MDX extraction
    /// semantics. Call [`Self::load_with_options`] when MDX behavior is
    /// configurable.
    #[must_use]
    pub fn load(path: &Path, root_dir: &str, reference_scopes: bool) -> Self {
        Self::load_with_options(
            path,
            root_dir,
            &ExtractCatalogMessagesOptions {
                reference_scopes,
                ..ExtractCatalogMessagesOptions::default()
            },
        )
    }

    /// Loads the cache with all extraction semantics represented in `options`.
    #[must_use]
    pub fn load_with_options(
        path: &Path,
        root_dir: &str,
        options: &ExtractCatalogMessagesOptions,
    ) -> Self {
        let stamp = CacheStamp {
            schema: CACHE_SCHEMA,
            extractor_version: env!("CARGO_PKG_VERSION").to_owned(),
            root_dir: root_dir.to_owned(),
            reference_scopes: options.reference_scopes,
            mdx_stamp: options.mdx.extraction_stamp(),
            rules: options.rules.clone(),
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
    pub(crate) fn get(&self, path: &str) -> Option<CachedAnalysis>
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
        Some(match &entry.analysis {
            CachedEntryAnalysis::ExtractionOnly => (
                entry.relative_file.clone(),
                Vec::new(),
                Vec::new(),
                Vec::new(),
            ),
            CachedEntryAnalysis::Complete {
                messages,
                diagnostics,
                comments,
            } => (
                entry.relative_file.clone(),
                messages.clone(),
                diagnostics.clone(),
                comments.clone(),
            ),
        })
    }

    /// Returns an entry only when `path` stayed unchanged across a caller-owned read.
    pub(crate) fn get_after_read(
        &self,
        path: &str,
        before: Option<ReadStartFingerprint>,
    ) -> Option<CachedAnalysis>
    where
        ExtractedMessageRecord: Clone,
    {
        if !self.enabled {
            return None;
        }
        let before = before?;
        let entry = self.entries.get(path)?;
        let CachedEntryAnalysis::Complete {
            messages,
            diagnostics,
            comments,
        } = &entry.analysis
        else {
            return None;
        };
        let current = FileFingerprint::read(Path::new(path))?;
        if current != before.fingerprint || current != entry.fingerprint {
            return None;
        }
        Some((
            entry.relative_file.clone(),
            messages.clone(),
            diagnostics.clone(),
            comments.clone(),
        ))
    }

    /// Identity of `path` before its contents are read, or `None` when the cache
    /// is disabled and the `stat` would be wasted.
    pub(crate) fn fingerprint_before_read(&self, path: &str) -> Option<ReadStartFingerprint> {
        if !self.enabled {
            return None;
        }
        Some(ReadStartFingerprint {
            fingerprint: FileFingerprint::read(Path::new(path))?,
            read_started_at: SystemTime::now(),
        })
    }

    /// Discards every entry when the request no longer matches the stamp the
    /// cache was loaded with, then re-stamps it for the new request.
    ///
    /// The stamp fields decide what an entry means: `root_dir` decides the
    /// stored origin paths and `reference_scopes` decides the records
    /// themselves. A long-lived cache — watch mode holds one across config
    /// reloads — must therefore be re-validated on every request instead of
    /// only at load time.
    pub(crate) fn reset_if_request_differs(
        &mut self,
        root_dir: &str,
        options: &ExtractCatalogMessagesOptions,
    ) {
        let mdx_stamp = options.mdx.extraction_stamp();
        if !self.enabled
            || (self.stamp.root_dir == root_dir
                && self.stamp.reference_scopes == options.reference_scopes
                && self.stamp.mdx_stamp == mdx_stamp
                && self.stamp.rules == options.rules)
        {
            return;
        }

        self.stamp.root_dir = root_dir.to_owned();
        self.stamp.reference_scopes = options.reference_scopes;
        self.stamp.mdx_stamp = mdx_stamp;
        self.stamp.rules = options.rules.clone();
        if !self.entries.is_empty() {
            self.entries.clear();
            self.dirty = true;
        }
    }

    /// Records a freshly extracted result.
    ///
    /// `before` is the identity observed before the file was read. Storing the
    /// identity observed *after* extraction would pair the contents that were
    /// read with the metadata of an edit that landed in between, and the next
    /// run would accept that as a hit and write stale messages. Re-reading the
    /// identity here and requiring both to agree means a file edited mid-run is
    /// simply not cached.
    pub(crate) fn insert(
        &mut self,
        path: String,
        relative_file: String,
        messages: &[ExtractedMessageRecord],
        diagnostics: &[SourceDiagnostic],
        comments: &[SourceComment],
        before: Option<ReadStartFingerprint>,
    ) where
        ExtractedMessageRecord: Clone,
    {
        self.insert_entry(
            path,
            relative_file,
            CachedEntryAnalysis::Complete {
                messages: messages.to_vec(),
                diagnostics: diagnostics.to_vec(),
                comments: comments.to_vec(),
            },
            before,
        );
    }

    /// Records a marker-less extraction result without claiming that parser
    /// diagnostics or comments were collected. Extraction can reuse the empty
    /// result after one `stat`; source lint still reparses the file and then
    /// replaces this sentinel with a complete entry.
    pub(crate) fn insert_extraction_only(
        &mut self,
        path: String,
        relative_file: String,
        before: Option<ReadStartFingerprint>,
    ) {
        self.insert_entry(
            path,
            relative_file,
            CachedEntryAnalysis::ExtractionOnly,
            before,
        );
    }

    fn insert_entry(
        &mut self,
        path: String,
        relative_file: String,
        analysis: CachedEntryAnalysis,
        before: Option<ReadStartFingerprint>,
    ) {
        if !self.enabled {
            return;
        }
        let (Some(before), Some(fingerprint)) = (before, FileFingerprint::read(Path::new(&path)))
        else {
            return;
        };
        if fingerprint != before.fingerprint {
            return;
        }
        // Measured against the start of the read: an edit inside the same mtime
        // granule as the read is indistinguishable from what was read, even
        // when the insert happens after that granule has passed.
        if fingerprint.is_racy(before.read_started_at) {
            return;
        }
        self.entries.insert(
            path,
            CacheEntry {
                fingerprint,
                relative_file,
                analysis,
            },
        );
        self.dirty = true;
    }

    /// Drops entries for files that are no longer part of the extraction set,
    /// so a long-lived watch process does not grow without bound.
    ///
    /// Call this once with the complete file set. Calling it per catalog would
    /// make each catalog evict the entries of its siblings.
    pub fn retain_paths(&mut self, keep: &std::collections::HashSet<&str>) {
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

    fn options(reference_scopes: bool) -> ExtractCatalogMessagesOptions {
        ExtractCatalogMessagesOptions {
            reference_scopes,
            ..ExtractCatalogMessagesOptions::default()
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
        let comments = [SourceComment {
            range: crate::SourceRange {
                start: 0,
                end: 12,
                line: 1,
                column: 1,
            },
            kind: crate::SourceCommentKind::Line,
        }];

        let mut cache = ExtractCache::load(&root.join("cache.json"), "root", true);
        let before = cache.fingerprint_before_read(&key);
        cache.insert(
            key.clone(),
            "a.tsx".to_owned(),
            &[record("Hello")],
            &[],
            &comments,
            before,
        );

        let hit = cache.get(&key).expect("cache hit");
        assert_eq!(hit.0, "a.tsx");
        assert_eq!(hit.1[0].message, "Hello");
        assert_eq!(hit.3, comments);

        // Any content change moves size and mtime, so the entry stops matching.
        write_aged(&source, "const a = 22222\n");
        assert!(cache.get(&key).is_none());

        std::fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn misses_when_a_file_changes_during_a_caller_owned_read() {
        let root = temp_root("changed-during-read");
        std::fs::create_dir_all(&root).expect("root");
        let source = root.join("a.tsx");
        write_aged(&source, "const a = 1\n");
        let key = source.to_string_lossy().into_owned();

        let mut cache = ExtractCache::load(&root.join("cache.json"), "root", true);
        let cached_read = cache.fingerprint_before_read(&key);
        cache.insert(
            key.clone(),
            "a.tsx".to_owned(),
            &[record("Hello")],
            &[],
            &[],
            cached_read,
        );

        let before = cache.fingerprint_before_read(&key);
        let read_source = std::fs::read_to_string(&source).expect("read source");
        assert_eq!(read_source, "const a = 1\n");
        write_aged(&source, "const a = 22222\n");

        assert!(cache.get_after_read(&key, before).is_none());
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
        let before = cache.fingerprint_before_read(&key);
        cache.insert(
            key.clone(),
            "a.tsx".to_owned(),
            &[record("Hello")],
            &[],
            &[],
            before,
        );
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

        let mdx_changed = ExtractCache::load_with_options(
            &cache_path,
            "root-one",
            &ExtractCatalogMessagesOptions {
                reference_scopes: true,
                mdx: crate::MdxOptions {
                    translatable_attributes: vec!["alt".to_owned(), "title".to_owned()],
                    ..crate::MdxOptions::default()
                },
                ..ExtractCatalogMessagesOptions::default()
            },
        );
        assert!(
            mdx_changed.is_empty(),
            "changed MDX extraction semantics must discard entries"
        );

        let rules_changed = ExtractCache::load_with_options(
            &cache_path,
            "root-one",
            &ExtractCatalogMessagesOptions {
                rules: SourceRuleOptions {
                    placeholder_only: crate::SourceRuleLevel::Error,
                    ..SourceRuleOptions::default()
                },
                ..ExtractCatalogMessagesOptions::default()
            },
        );
        assert!(
            rules_changed.is_empty(),
            "changed source rule levels must discard cached diagnostics"
        );

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
        let before = cache.fingerprint_before_read(&key);
        cache.insert(
            key.clone(),
            "a.tsx".to_owned(),
            &[record("Hello")],
            &[],
            &[],
            before,
        );
        assert!(cache.is_empty(), "young files must not be cached");
        assert!(cache.get(&key).is_none());

        std::fs::remove_dir_all(root).expect("cleanup");
    }

    /*
     * Guards the P1 case: content is read, the file changes, and only then is
     * the identity observed. Storing that pairing would make the next run serve
     * the old messages under the new file's fingerprint.
     */
    #[test]
    fn refuses_to_store_a_file_that_changed_between_read_and_insert() {
        let root = temp_root("mid-run-edit");
        std::fs::create_dir_all(&root).expect("root");
        let source = root.join("a.tsx");
        write_aged(&source, "const a = 1\n");
        let key = source.to_string_lossy().into_owned();

        let mut cache = ExtractCache::load(&root.join("cache.json"), "root", true);
        // Identity as seen before the contents were read.
        let before = cache.fingerprint_before_read(&key);

        // The file is rewritten after the read, and backdated so the racy-window
        // guard alone would not catch it.
        write_aged(&source, "const a = 999999\n");

        cache.insert(
            key.clone(),
            "a.tsx".to_owned(),
            &[record("Stale")],
            &[],
            &[],
            before,
        );
        assert!(
            cache.is_empty(),
            "a file edited between read and insert must not be cached"
        );
        assert!(cache.get(&key).is_none());

        std::fs::remove_dir_all(root).expect("cleanup");
    }

    /*
     * The fingerprint is captured before the read, so the racy window has to be
     * measured from that moment too. Evaluating it at insert time lets a
     * same-size edit inside the file's mtime granule be stored as valid as soon
     * as the granule has elapsed.
     */
    #[test]
    fn measures_the_racy_window_from_the_read_start() {
        let root = temp_root("racy-read-start");
        std::fs::create_dir_all(&root).expect("root");
        let source = root.join("a.tsx");
        std::fs::write(&source, "const a = 1\n").expect("write");
        let key = source.to_string_lossy().into_owned();

        let mut cache = ExtractCache::load(&root.join("cache.json"), "root", true);
        // Captured while the file is still young: an edit landing right after
        // the read cannot be told apart from what was read.
        let before = cache.fingerprint_before_read(&key);

        // Extraction takes long enough for the window to pass before the insert.
        std::thread::sleep(RACY_WINDOW + Duration::from_millis(100));

        cache.insert(
            key.clone(),
            "a.tsx".to_owned(),
            &[record("Hello")],
            &[],
            &[],
            before,
        );
        assert!(
            cache.is_empty(),
            "a file that was young when it was read must not be cached"
        );

        std::fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn resets_entries_when_the_request_no_longer_matches_the_stamp() {
        let root = temp_root("request-stamp");
        std::fs::create_dir_all(&root).expect("root");
        let source = root.join("a.tsx");
        write_aged(&source, "const a = 1\n");
        let key = source.to_string_lossy().into_owned();

        let mut cache = ExtractCache::load(&root.join("cache.json"), "root-one", true);
        let before = cache.fingerprint_before_read(&key);
        cache.insert(
            key.clone(),
            "a.tsx".to_owned(),
            &[record("Hello")],
            &[],
            &[],
            before,
        );
        assert_eq!(cache.len(), 1);

        // Same stamp: entries survive.
        cache.reset_if_request_differs("root-one", &options(true));
        assert_eq!(cache.len(), 1);

        // A different reference root changes stored origins, so nothing may be
        // reused, and later inserts must be stamped for the new request.
        cache.reset_if_request_differs("root-two", &options(true));
        assert!(cache.is_empty());
        assert!(cache.get(&key).is_none());

        let before = cache.fingerprint_before_read(&key);
        cache.insert(
            key.clone(),
            "a.tsx".to_owned(),
            &[record("Hello")],
            &[],
            &[],
            before,
        );
        cache.reset_if_request_differs("root-two", &options(true));
        assert_eq!(cache.len(), 1, "matching requests keep their entries");
        cache.reset_if_request_differs("root-two", &options(false));
        assert!(cache.is_empty(), "flipped reference scopes discard entries");

        std::fs::remove_dir_all(root).expect("cleanup");
    }

    /*
     * Retention runs once with the union of every catalog's files. This guards
     * the multi-catalog case: entries belonging to a sibling catalog must not
     * be evicted, or each run re-extracts what the other catalog cached.
     */
    #[test]
    fn retain_paths_keeps_entries_of_every_catalog() {
        let root = temp_root("retain");
        std::fs::create_dir_all(&root).expect("root");
        let first = root.join("a.tsx");
        let second = root.join("b.tsx");
        let dropped = root.join("c.tsx");
        for path in [&first, &second, &dropped] {
            write_aged(path, "const a = 1\n");
        }

        let mut cache = ExtractCache::load(&root.join("cache.json"), "root", true);
        for path in [&first, &second, &dropped] {
            let key = path.to_string_lossy().into_owned();
            let before = cache.fingerprint_before_read(&key);
            cache.insert(
                key,
                "file.tsx".to_owned(),
                &[record("Hello")],
                &[],
                &[],
                before,
            );
        }
        assert_eq!(cache.len(), 3);

        let first_key = first.to_string_lossy().into_owned();
        let second_key = second.to_string_lossy().into_owned();
        let keep = [first_key.as_str(), second_key.as_str()]
            .into_iter()
            .collect::<std::collections::HashSet<_>>();
        cache.retain_paths(&keep);

        assert_eq!(cache.len(), 2);
        assert!(cache.get(&first_key).is_some());
        assert!(cache.get(&second_key).is_some());
        assert!(cache.get(&dropped.to_string_lossy()).is_none());
        assert!(cache.is_dirty());

        std::fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn retain_paths_on_a_disabled_cache_is_a_no_op() {
        let mut cache = ExtractCache::disabled();
        cache.retain_paths(&std::collections::HashSet::new());
        assert!(cache.is_empty());
        assert!(!cache.is_dirty());
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
        let before = cache.fingerprint_before_read(&key);
        cache.insert(
            key.clone(),
            "a.tsx".to_owned(),
            &[record("Hello")],
            &[],
            &[],
            before,
        );
        assert!(cache.get(&key).is_none());
        assert!(!cache.is_dirty());

        std::fs::remove_dir_all(root).expect("cleanup");
    }
}
