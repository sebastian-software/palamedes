//! Extraction fixtures shared by the extraction and watch-mode tests.

use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime};

use super::ExtractOptions;

/// Extraction options with the on-disk cache turned off, which is what most
/// tests want: they assert on catalog contents, not on cache behavior.
pub(super) fn extract_options() -> ExtractOptions {
    ExtractOptions {
        config: None,
        watch: false,
        clean: false,
        force_clean: false,
        threads: None,
        no_cache: true,
        verbose: false,
    }
}

/// Extraction options with the on-disk cache enabled.
pub(super) fn cached_extract_options() -> ExtractOptions {
    ExtractOptions {
        no_cache: false,
        ..extract_options()
    }
}

/// Backdates a file out of the cache's racy window so it can be cached.
pub(super) fn age_file(path: &Path) {
    let aged = SystemTime::now() - Duration::from_secs(10);
    fs::File::options()
        .write(true)
        .open(path)
        .expect("open source")
        .set_modified(aged)
        .expect("age source");
}
