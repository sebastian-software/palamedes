use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use ferrocat::po::diagnostic_codes::catalog::FUZZY_FLAG;
use ferrocat::{
    ApiError, CatalogAuditChecks, CatalogAuditOptions, CatalogMessageKey, NormalizedParsedCatalog,
    ParseCatalogOptions, TranslationShape, audit_catalogs, parse_catalog_for_review,
};
use sha2::{Digest, Sha256};

use super::types::{CatalogArtifactConfig, PalamedesCatalogFormat};
use crate::contained_fs::{
    ContainedDir, ContainedFileMetadata, FileIdentity, map_contained_catalog_read_error,
    open_contained_catalog_parent, split_relative_catalog_path,
};
use crate::error::{PalamedesError, PalamedesResult};

pub(super) type LocaleCatalogs = BTreeMap<String, NormalizedParsedCatalog>;

/// Matches `ExtractCache`'s racy-timestamp guard: files modified within this
/// window of observation cannot safely skip content hashing because a
/// same-granule edit may share the same timestamp.
const RACY_WINDOW_NS: i128 = Duration::from_secs(1).as_nanos() as i128;

pub(super) struct ResolvedCatalogFile {
    pub(super) path: PathBuf,
    pub(super) locale: String,
    pub(super) format: PalamedesCatalogFormat,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct CatalogFileFingerprint {
    size: u64,
    mtime_ns: i128,
    ctime_ns: i128,
    identity: FileIdentity,
}

impl CatalogFileFingerprint {
    fn from_metadata(metadata: ContainedFileMetadata, observed_at: SystemTime) -> Option<Self> {
        let mtime_ns = metadata.mtime_ns?;
        let ctime_ns = metadata.ctime_ns?;
        let identity = metadata.identity?;
        if is_racy(mtime_ns, observed_at) || is_racy(ctime_ns, observed_at) {
            return None;
        }
        Some(Self {
            size: metadata.size,
            mtime_ns,
            ctime_ns,
            identity,
        })
    }
}

fn is_racy(mtime_ns: i128, observed_at: SystemTime) -> bool {
    let Ok(now) = observed_at.duration_since(UNIX_EPOCH) else {
        return true;
    };
    let Ok(now_ns) = i128::try_from(now.as_nanos()) else {
        return true;
    };
    now_ns < mtime_ns || (now_ns - mtime_ns) < RACY_WINDOW_NS
}

pub(super) struct CatalogSource {
    pub(super) path: PathBuf,
    pub(super) locale: String,
    pub(super) format: PalamedesCatalogFormat,
    pub(super) content: String,
    pub(super) digest: [u8; 32],
}

pub(super) type CatalogSources = Vec<CatalogSource>;

pub(super) struct ReadCatalogSourcesResult {
    pub(super) sources: CatalogSources,
    /// Present only when every existing watch file had stable, non-racy
    /// metadata that matched before and after reading.
    pub(super) stable_fingerprints: Option<Vec<Option<CatalogFileFingerprint>>>,
}

pub(super) fn load_catalogs(
    files: &[ResolvedCatalogFile],
    config: &CatalogArtifactConfig,
) -> PalamedesResult<LocaleCatalogs> {
    let sources = read_catalog_sources(files, config)?;
    parse_catalog_sources(&sources, &config.source_locale)
}

/// Reads every configured dependency through verified [`ContainedDir`] handles
/// and computes content digests.
pub(super) fn read_catalog_sources(
    files: &[ResolvedCatalogFile],
    config: &CatalogArtifactConfig,
) -> PalamedesResult<CatalogSources> {
    Ok(read_catalog_sources_with_fingerprints(files, config, || {})?.sources)
}

/// Inspects metadata for every watch file through verified [`ContainedDir`]
/// handles without reading file contents or computing SHA-256 digests.
///
/// Returns `Ok(None)` when any existing file is inside the racy-timestamp
/// window or lacks stable platform metadata, signaling the caller to fall back
/// to full content reads and SHA-256 verification.
pub(super) fn stat_stable_catalog_fingerprints(
    files: &[ResolvedCatalogFile],
    config: &CatalogArtifactConfig,
) -> PalamedesResult<Option<Vec<Option<CatalogFileFingerprint>>>> {
    let root_dir = Path::new(&config.root_dir);
    let observed_at = SystemTime::now();
    let mut fingerprints = Vec::with_capacity(files.len());
    let mut cached_parent: Option<(PathBuf, Option<ContainedDir>)> = None;

    for (index, file) in files.iter().enumerate() {
        let (relative_parent, file_name) = split_relative_catalog_path(root_dir, &file.path)
            .map_err(|error| PalamedesError::UnsafeCatalogPath {
                path: file.path.to_string_lossy().into_owned(),
                reason: error.to_string(),
            })?;
        let parent_dir =
            open_or_reuse_parent(&mut cached_parent, root_dir, &relative_parent, &file.path)?;
        let metadata = match parent_dir {
            Some(dir) => dir
                .stat_optional_file(&file_name)
                .map_err(|error| map_contained_catalog_read_error(&file.path, error))?,
            None => None,
        };
        match metadata {
            Some(meta) => {
                let Some(fingerprint) = CatalogFileFingerprint::from_metadata(meta, observed_at)
                else {
                    return Ok(None);
                };
                fingerprints.push(Some(fingerprint));
            }
            None if index == 0 => {
                return Err(PalamedesError::CatalogFileNotFound {
                    path: file.path.clone(),
                });
            }
            None => fingerprints.push(None),
        }
    }

    Ok(Some(fingerprints))
}

/// Reads every configured dependency through verified [`ContainedDir`] handles,
/// computes SHA-256 content digests, and captures trusted file fingerprints
/// when all existing files are outside the racy window and unchanged across the
/// read.
pub(super) fn read_catalog_sources_with_fingerprints<F>(
    files: &[ResolvedCatalogFile],
    config: &CatalogArtifactConfig,
    mut on_file_read: F,
) -> PalamedesResult<ReadCatalogSourcesResult>
where
    F: FnMut(),
{
    let mut sources = Vec::with_capacity(files.len());
    let mut fingerprints = Vec::with_capacity(files.len());
    let mut all_stable = true;
    let root_dir = Path::new(&config.root_dir);
    let mut cached_parent: Option<(PathBuf, Option<ContainedDir>)> = None;

    for (index, file) in files.iter().enumerate() {
        let (relative_parent, file_name) = split_relative_catalog_path(root_dir, &file.path)
            .map_err(|error| PalamedesError::UnsafeCatalogPath {
                path: file.path.to_string_lossy().into_owned(),
                reason: error.to_string(),
            })?;
        let parent_dir =
            open_or_reuse_parent(&mut cached_parent, root_dir, &relative_parent, &file.path)?;
        let read_started_at = SystemTime::now();
        let read_result = match parent_dir {
            Some(dir) => dir
                .read_optional_file_with_metadata(&file_name)
                .map_err(|error| map_contained_catalog_read_error(&file.path, error))?,
            None => None,
        };
        let (content, meta_before) = match read_result {
            Some(entry) => entry,
            None if index == 0 => {
                return Err(PalamedesError::CatalogFileNotFound {
                    path: file.path.clone(),
                });
            }
            None => {
                if all_stable {
                    fingerprints.push(None);
                }
                continue;
            }
        };
        on_file_read();
        if all_stable {
            let meta_after = parent_dir
                .and_then(|dir| dir.stat_optional_file(&file_name).ok())
                .flatten();
            if meta_after == Some(meta_before)
                && let Some(fingerprint) =
                    CatalogFileFingerprint::from_metadata(meta_before, read_started_at)
            {
                fingerprints.push(Some(fingerprint));
            } else {
                all_stable = false;
            }
        }
        let digest = Sha256::digest(content.as_bytes()).into();
        sources.push(CatalogSource {
            path: file.path.clone(),
            locale: file.locale.clone(),
            format: file.format,
            content,
            digest,
        });
    }

    Ok(ReadCatalogSourcesResult {
        sources,
        stable_fingerprints: all_stable.then_some(fingerprints),
    })
}

fn open_or_reuse_parent<'a>(
    cached_parent: &'a mut Option<(PathBuf, Option<ContainedDir>)>,
    root_dir: &Path,
    relative_parent: &Path,
    target: &Path,
) -> PalamedesResult<Option<&'a ContainedDir>> {
    let matches_cached = cached_parent
        .as_ref()
        .is_some_and(|(cached_path, _)| cached_path == relative_parent);
    if !matches_cached {
        let opened = open_contained_catalog_parent(root_dir, relative_parent, target)?;
        *cached_parent = Some((relative_parent.to_path_buf(), opened));
    }
    Ok(cached_parent.as_ref().and_then(|(_, dir)| dir.as_ref()))
}

pub(super) fn parse_catalog_sources(
    sources: &[CatalogSource],
    source_locale: &str,
) -> PalamedesResult<LocaleCatalogs> {
    parse_catalog_sources_with_observer(sources, source_locale, || {})
}

pub(super) fn parse_catalog_sources_with_observer<F>(
    sources: &[CatalogSource],
    source_locale: &str,
    mut on_parse: F,
) -> PalamedesResult<LocaleCatalogs>
where
    F: FnMut(),
{
    let mut loaded = LocaleCatalogs::new();
    for source in sources {
        let options = ParseCatalogOptions::new(&source.content, source_locale)
            .with_locale(source.locale.as_str())
            .with_mode(source.format.ferrocat_mode());
        on_parse();
        let catalog = parse_catalog_for_compile(options).map_err(|source_error| {
            // Only normalization reports duplicate identities as conflicts.
            if matches!(source_error, ApiError::Conflict(_)) {
                PalamedesError::NormalizeCatalog {
                    path: source.path.clone(),
                    source: source_error,
                }
            } else {
                PalamedesError::ParseCatalog {
                    path: source.path.clone(),
                    source: source_error,
                }
            }
        })?;
        loaded.insert(source.locale.clone(), catalog);
    }
    Ok(loaded)
}

/// Parses one catalog into the normalized view that catalog compilers consume.
///
/// Ferrocat's ordinary normalized projection discards review flags. This
/// projection keeps an active `fuzzy` entry's identity but clears its
/// translation, so compilation resolves it through the fallback chain and the
/// source message and reports it as missing, like an untranslated entry. The
/// JavaScript and Rust catalog targets both compile through this projection.
///
/// The catalog locale must come from `options` or from the catalog content.
///
/// # Errors
///
/// Returns Ferrocat's error when the content cannot be parsed, has no locale,
/// or contains duplicate message identities.
pub fn parse_catalog_for_compile(
    options: ParseCatalogOptions<'_>,
) -> Result<NormalizedParsedCatalog, ApiError> {
    let reviewed = parse_catalog_for_review(options)?;
    let fuzzy = fuzzy_message_keys(&reviewed)?;
    if fuzzy.is_empty() {
        return Ok(reviewed);
    }

    let mut catalog = reviewed.into_parsed_catalog();
    for message in &mut catalog.messages {
        if fuzzy.contains(&message.key()) {
            match &mut message.translation {
                TranslationShape::Singular { value } => value.clear(),
                TranslationShape::Plural { translation, .. } => {
                    translation.values_mut().for_each(String::clear);
                }
            }
        }
    }
    catalog.into_normalized_view()
}

/// Ferrocat exposes review state only through its reports. Auditing the
/// catalog as its own source reports every active fuzzy entry once.
fn fuzzy_message_keys(
    catalog: &NormalizedParsedCatalog,
) -> Result<BTreeSet<CatalogMessageKey>, ApiError> {
    let locale = catalog.parsed_catalog().locale.as_deref().unwrap_or("");
    let checks = CatalogAuditChecks::default()
        .with_completeness(false)
        .with_extra_messages(false)
        .with_icu_syntax(false)
        .with_icu_compatibility(false)
        .with_semantic_metadata(false)
        .with_obsolete_entries(false);
    let report = audit_catalogs(
        &[catalog],
        &CatalogAuditOptions::new(locale).with_checks(checks),
    )?;
    Ok(report
        .diagnostics
        .into_iter()
        .filter(|diagnostic| diagnostic.code.as_str() == FUZZY_FLAG)
        .filter_map(|diagnostic| diagnostic.source_key)
        .map(|key| CatalogMessageKey::new(key.msgid, key.msgctxt))
        .collect())
}
