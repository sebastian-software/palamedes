use std::collections::btree_map::Entry;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use ferrocat::{
    CatalogMessageKey, CatalogMode, ConvertCatalogOptions, EffectiveTranslationRef, Header, MsgStr,
    PoFile, PoItem, SerializeOptions,
    collation::{CollationKey, collation_key},
    convert_catalog, machine_translation_hash,
};
use ferrocat_icu::{IcuMessage, IcuNode, IcuOption, IcuPluralKind, stringify_icu};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;

mod references;

pub use references::{
    DEFAULT_TRANSLATION_REFERENCE_LIMIT, MAX_TRANSLATION_REFERENCE_LIMIT,
    TranslationReferenceEntry, TranslationReferenceIndex, TranslationReferenceMatch,
    TranslationReferenceMatches, TranslationReferenceRequest, TranslationReferenceResult,
    find_translation_references,
};

#[cfg(test)]
thread_local! {
    static SOURCE_CATALOG_PARSE_COUNT: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

use crate::catalog_artifact::resolve_catalog_path;
use crate::catalog_update::{AiProvenance, MachineMetadata, po_serialize_options};
use crate::contained_fs::{
    ContainedDir, ContainedFsError, ContainedNewFileMode, ContainedWriteDurability,
    DirFilenameEquivalence, FileIdentity, split_relative_catalog_path,
};
use crate::icu_compatibility::compare_runtime_icu;
use crate::icu_text::parse_runtime_icu;
use crate::{
    CatalogArtifactConfig, CatalogConfig, PalamedesCatalogFormat, PalamedesError, PalamedesResult,
    PoOutputOptions,
};

/// Default maximum number of origins returned for each translation candidate.
pub const DEFAULT_TRANSLATION_CANDIDATE_MAX_ORIGINS: usize = 8;

// v2 fingerprints include every origin, rather than the response's bounded origin list.
// Candidates listed by v1 builds must be listed again before they can be patched.
const CANDIDATE_FINGERPRINT_NAMESPACE: &[u8] = b"palamedes:translation-candidate:v2";

/// Stable catalog and message identity used by translation workflow APIs.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationCandidateId {
    /// Configured catalog path pattern, used as the catalog scope.
    pub catalog: String,
    /// Target catalog locale.
    pub locale: String,
    /// Source message identity.
    pub message: String,
    /// Optional gettext context that disambiguates equal source messages.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
}

/// Request for enumerating translation candidates across configured catalogs.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationCandidateRequest {
    /// Catalog configuration used to resolve catalog files and locales.
    pub config: CatalogArtifactConfig,
    /// Optional target-locale subset. Empty selects every configured non-source locale.
    #[serde(default)]
    pub locales: Vec<String>,
    /// Explicit identities for re-run or review. Empty selects missing active entries.
    #[serde(default)]
    pub targets: Vec<TranslationCandidateId>,
    /// Maximum number of origins exposed per candidate.
    #[serde(default = "default_max_origins")]
    pub max_origins: usize,
}

/// Result of translation candidate enumeration.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationCandidateResult {
    /// Deterministically ordered translation candidates.
    pub candidates: Vec<TranslationCandidate>,
    /// Structured diagnostics for unknown or duplicate explicit targets.
    pub diagnostics: Vec<TranslationWorkflowDiagnostic>,
}

/// One provider-neutral unit of translation work.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationCandidate {
    /// Stable catalog/message identity.
    pub id: TranslationCandidateId,
    /// Resolved catalog path on disk.
    pub target_path: String,
    /// Catalog storage format.
    pub format: PalamedesCatalogFormat,
    /// Source content, projected into singular or top-level plural form.
    pub source: TranslationValue,
    /// Current target content in the same provider-neutral representation when possible.
    pub translation: TranslationValue,
    /// Extracted translator-facing comments.
    pub comments: Vec<String>,
    /// Bounded source origins.
    pub origins: Vec<TranslationWorkflowOrigin>,
    /// Current technical translation and review state.
    pub review: TranslationReviewState,
    /// Native Ferrocat machine provenance for the current value.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub machine: Option<MachineMetadata>,
    /// Per-candidate optimistic concurrency fingerprint.
    pub fingerprint: String,
}

/// Source origin exposed to translation workflow consumers.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationWorkflowOrigin {
    /// Source filename.
    pub file: String,
    /// Optional stable authoring scope within the file.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
}

/// Current technical state of a translation candidate.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationReviewState {
    /// Whether all effective target values are non-empty.
    pub translated: bool,
    /// Whether the catalog entry carries the native fuzzy review flag.
    pub fuzzy: bool,
    /// Whether the catalog entry is obsolete.
    pub obsolete: bool,
}

/// Cardinal or ordinal ICU plural behavior.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TranslationPluralKind {
    /// Cardinal plural such as one/other.
    Cardinal,
    /// Ordinal plural such as one/two/few/other.
    Ordinal,
}

/// Format-neutral singular or plural translation content.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TranslationValue {
    /// One translation string.
    Singular {
        /// Singular source or target value.
        value: String,
    },
    /// One top-level ICU plural projected into selector branches.
    Plural {
        /// ICU argument used for plural selection.
        variable: String,
        /// Cardinal or ordinal plural behavior.
        plural_kind: TranslationPluralKind,
        /// ICU plural offset.
        offset: u32,
        /// Values keyed by ICU selector, for example `one`, `other`, or `=0`.
        values: BTreeMap<String, String>,
    },
}

/// Machine provenance attached to a completed translation patch.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationMachineProvenance {
    /// Optional native AI provenance. Absence still marks the value as machine-managed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ai: Option<AiProvenance>,
}

/// One completed translation patch.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationPatch {
    /// Stable identity returned by candidate enumeration.
    pub id: TranslationCandidateId,
    /// Fingerprint returned with the candidate.
    pub fingerprint: String,
    /// Completed singular or plural target value.
    pub translation: TranslationValue,
    /// Optional native machine provenance. Core computes the integrity lock.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub machine: Option<TranslationMachineProvenance>,
}

/// Request for validating and applying a batch of translation patches.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationPatchRequest {
    /// Catalog configuration used to resolve target files.
    pub config: CatalogArtifactConfig,
    /// Completed translation patches applied as one validation batch.
    pub patches: Vec<TranslationPatch>,
    /// Optional PO-specific output controls used when replacing PO catalogs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub po: Option<PoOutputOptions>,
}

/// Result of a translation patch batch.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationPatchResult {
    /// Whether at least one catalog changed on disk.
    pub updated: bool,
    /// Deterministic patch and catalog counters.
    pub stats: TranslationPatchStats,
    /// One outcome per requested patch in request order.
    pub outcomes: Vec<TranslationPatchOutcome>,
    /// Structured validation diagnostics. Validation failures leave all catalogs unchanged.
    pub diagnostics: Vec<TranslationWorkflowDiagnostic>,
}

/// Aggregate translation patch counters.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationPatchStats {
    /// Requested patch count.
    pub requested: usize,
    /// Patches written with a changed target value or provenance.
    pub applied: usize,
    /// Valid patches whose rendered catalog was already equivalent.
    pub unchanged: usize,
    /// Catalog files atomically replaced.
    pub catalogs_updated: usize,
}

/// Status of one requested translation patch.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TranslationPatchOutcomeStatus {
    /// Patch was applied and changed its catalog.
    Applied,
    /// Patch was valid but already represented by the catalog.
    Unchanged,
    /// Patch was rejected by validation.
    Rejected,
    /// Patch was valid but its catalog was not replaced before the batch stopped.
    NotApplied,
}

/// Outcome for one requested translation patch.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationPatchOutcome {
    /// Stable identity of the requested patch.
    pub id: TranslationCandidateId,
    /// Result status.
    pub status: TranslationPatchOutcomeStatus,
}

/// Structured translation workflow diagnostic.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationWorkflowDiagnostic {
    /// Stable machine-readable diagnostic code.
    pub code: String,
    /// Human-readable explanation.
    pub message: String,
    /// Associated candidate identity, when available.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<TranslationCandidateId>,
    /// Resolved catalog path associated with this diagnostic, when applicable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub catalog_path: Option<String>,
    /// Target locale associated with this diagnostic, when applicable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locale: Option<String>,
}

#[derive(Debug)]
struct LoadedCatalog {
    scope: String,
    locale: String,
    path: PathBuf,
    parent_dir: Arc<ContainedDir>,
    file_name: OsString,
    format: PalamedesCatalogFormat,
    original: String,
    po: PoFile,
    po_item_indexes: HashMap<CatalogMessageKey, PoItemIndexes>,
    messages: BTreeMap<CatalogMessageKey, usize>,
    ambiguous_messages: BTreeSet<CatalogMessageKey>,
}

/// Positions of raw PO entries sharing one source-string-first identity.
///
/// Candidate reads historically use the first item in source order, while mutations reject
/// duplicate identities. Keep both facts in the index so lookup preserves those contracts
/// without scanning the catalog once per candidate or patch.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PoItemIndexes {
    first: usize,
    unique: bool,
}

#[derive(Debug)]
struct PreparedCatalog {
    path: PathBuf,
    parent_dir: Arc<ContainedDir>,
    file_name: OsString,
    expected_original: Option<String>,
    content: String,
}

#[derive(Debug)]
struct PreparedCatalogPlan {
    catalog_index: usize,
    path: PathBuf,
    relative_parent: PathBuf,
    file_name: OsString,
    locale: String,
    patch_indexes: Vec<usize>,
    original: String,
    content: String,
    changed: bool,
}

#[derive(Debug)]
enum CatalogReplacement {
    Durable,
    CommittedWithDurabilityWarning(std::io::Error),
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct CatalogBatchKey {
    catalog_index: usize,
    locale: String,
}

/// Enumerates missing targets by default, or explicitly selected entries for re-run/review.
///
/// # Errors
///
/// Returns an error when a selected catalog cannot be read or parsed.
pub fn list_translation_candidates(
    request: &TranslationCandidateRequest,
) -> PalamedesResult<TranslationCandidateResult> {
    let locales = selected_locales(&request.config, &request.locales, &request.targets);
    let default_locale_selection = request.locales.is_empty() && request.targets.is_empty();
    let explicit = !request.targets.is_empty();
    let mut requested = BTreeMap::<TranslationCandidateId, usize>::new();
    let mut diagnostics = Vec::new();
    for target in &request.targets {
        if is_source_locale(&request.config, &target.locale) {
            diagnostics.push(source_locale_diagnostic(target.clone()));
            continue;
        }
        let count = requested.entry(target.clone()).or_default();
        *count += 1;
        if *count == 2 {
            diagnostics.push(workflow_diagnostic(
                "translation.duplicate_target",
                "Explicit candidate target was requested more than once.",
                Some(target.clone()),
            ));
        }
    }

    let mut candidates = Vec::new();
    let mut seen = BTreeSet::new();
    for catalog in &request.config.catalogs {
        for locale in &locales {
            let loaded = match load_catalog(&request.config, catalog, locale) {
                Ok(loaded) => loaded,
                Err(PalamedesError::ReadFile { path, source })
                    if default_locale_selection
                        && source.kind() == std::io::ErrorKind::NotFound =>
                {
                    diagnostics.push(missing_catalog_diagnostic(locale, path));
                    continue;
                }
                Err(error) => return Err(error),
            };
            for (key, item_index) in &loaded.messages {
                let item = &loaded.po.items[*item_index];
                let id = TranslationCandidateId {
                    catalog: loaded.scope.clone(),
                    locale: locale.clone(),
                    message: key.msgid.clone(),
                    context: key.msgctxt.clone(),
                };
                if loaded.ambiguous_messages.contains(key) {
                    if !explicit || requested.contains_key(&id) {
                        seen.insert(id.clone());
                        diagnostics.push(workflow_diagnostic(
                            "translation.ambiguous_message",
                            "Catalog contains more than one definition for the selected message identity.",
                            Some(id),
                        ));
                    }
                    continue;
                }
                let selected = if explicit {
                    requested.contains_key(&id)
                } else {
                    !item.obsolete && !po_item_is_translated(item)
                };
                if !selected {
                    continue;
                }
                let candidate = build_candidate(&loaded, key, item, request.max_origins)?;
                seen.insert(id);
                candidates.push(candidate);
            }
        }
    }

    if explicit {
        for id in requested.keys().filter(|id| !seen.contains(*id)) {
            diagnostics.push(workflow_diagnostic(
                "translation.unknown_target",
                "Explicit candidate target did not resolve to a configured catalog message.",
                Some(id.clone()),
            ));
        }
    }
    candidates.sort_by(|left, right| left.id.cmp(&right.id));
    diagnostics.sort_by(|left, right| diagnostic_sort_key(left).cmp(&diagnostic_sort_key(right)));
    Ok(TranslationCandidateResult {
        candidates,
        diagnostics,
    })
}

/// Validates a patch batch completely, then atomically replaces each changed catalog file.
///
/// Validation errors are returned as structured diagnostics and leave every original file
/// unchanged. Successful multi-catalog batches provide per-file atomic replacement.
///
/// # Errors
///
/// Returns an error when catalogs cannot be read, parsed, rendered, or replaced. When replacing
/// a later catalog fails, the error retains the completed per-file report through
/// [`PalamedesError::translation_patch_result`].
pub fn apply_translation_patches(
    request: TranslationPatchRequest,
) -> PalamedesResult<TranslationPatchResult> {
    apply_translation_patches_with_replacement(request, atomic_replace_catalog)
}

fn apply_translation_patches_with_replacement<F>(
    request: TranslationPatchRequest,
    replace_catalog: F,
) -> PalamedesResult<TranslationPatchResult>
where
    F: FnMut(
        &PreparedCatalog,
        &str,
        Option<&PoOutputOptions>,
    ) -> PalamedesResult<CatalogReplacement>,
{
    apply_translation_patches_with_options(request, replace_catalog, false, None, None)
}

#[allow(clippy::too_many_arguments)]
fn apply_translation_patches_with_options<F>(
    request: TranslationPatchRequest,
    mut replace_catalog: F,
    simulate_missing_file_identity: bool,
    simulated_dir_equivalence: Option<Option<DirFilenameEquivalence>>,
    simulated_8dot3_alias_probe: Option<Option<bool>>,
) -> PalamedesResult<TranslationPatchResult>
where
    F: FnMut(
        &PreparedCatalog,
        &str,
        Option<&PoOutputOptions>,
    ) -> PalamedesResult<CatalogReplacement>,
{
    let requested_count = request.patches.len();
    if request.patches.is_empty() {
        return Ok(TranslationPatchResult {
            updated: false,
            stats: TranslationPatchStats::default(),
            outcomes: Vec::new(),
            diagnostics: Vec::new(),
        });
    }

    let mut diagnostics = Vec::new();
    let mut rejected = BTreeSet::new();
    let mut changed_patches = BTreeSet::new();
    let mut identities = BTreeMap::<TranslationCandidateId, usize>::new();
    let mut groups = BTreeMap::<CatalogBatchKey, Vec<usize>>::new();

    for (index, patch) in request.patches.iter().enumerate() {
        if is_source_locale(&request.config, &patch.id.locale) {
            rejected.insert(index);
            diagnostics.push(source_locale_diagnostic(patch.id.clone()));
            continue;
        }

        for message in validate_translation_icu(&patch.translation) {
            rejected.insert(index);
            diagnostics.push(workflow_diagnostic(
                "translation.invalid_icu",
                message,
                Some(patch.id.clone()),
            ));
        }

        if let Some(previous) = identities.insert(patch.id.clone(), index) {
            rejected.insert(previous);
            rejected.insert(index);
            diagnostics.push(workflow_diagnostic(
                "translation.duplicate_patch",
                "A translation patch identity occurs more than once in the batch.",
                Some(patch.id.clone()),
            ));
        }

        let matches = request
            .config
            .catalogs
            .iter()
            .enumerate()
            .filter(|(_, catalog)| catalog.path == patch.id.catalog)
            .map(|(catalog_index, _)| catalog_index)
            .collect::<Vec<_>>();
        match matches.as_slice() {
            [] => {
                rejected.insert(index);
                diagnostics.push(workflow_diagnostic(
                    "translation.unknown_catalog",
                    "Patch catalog scope is not present in the supplied configuration.",
                    Some(patch.id.clone()),
                ));
            }
            [catalog_index] => {
                if !request
                    .config
                    .locales
                    .iter()
                    .any(|locale| locale == &patch.id.locale)
                {
                    rejected.insert(index);
                    diagnostics.push(workflow_diagnostic(
                        "translation.unknown_locale",
                        "Patch locale is not present in the supplied configuration.",
                        Some(patch.id.clone()),
                    ));
                } else {
                    groups
                        .entry(CatalogBatchKey {
                            catalog_index: *catalog_index,
                            locale: patch.id.locale.clone(),
                        })
                        .or_default()
                        .push(index);
                }
            }
            _ => {
                rejected.insert(index);
                diagnostics.push(workflow_diagnostic(
                    "translation.ambiguous_catalog",
                    "Patch catalog scope matches multiple configured catalogs.",
                    Some(patch.id.clone()),
                ));
            }
        }
    }

    if !rejected.is_empty() {
        return Ok(rejected_translation_patch_result(
            request.patches,
            requested_count,
            &rejected,
            diagnostics,
        ));
    }

    let mut target_batches: BTreeMap<(PathBuf, OsString), Vec<CatalogBatchKey>> = BTreeMap::new();
    for batch in groups.keys() {
        let catalog = &request.config.catalogs[batch.catalog_index];
        let path = resolve_catalog_path(&request.config, catalog, &batch.locale)?;
        let (relative_parent, file_name) =
            split_relative_catalog_path(Path::new(&request.config.root_dir), &path).map_err(
                |error| PalamedesError::UnsafeCatalogPath {
                    path: path.to_string_lossy().into_owned(),
                    reason: error.to_string(),
                },
            )?;
        target_batches
            .entry((relative_parent, file_name))
            .or_default()
            .push(batch.clone());
    }

    // Collect every configured (catalog, locale) target not already in `groups`
    // — including source-locale catalogs — so a requested write can never
    // silently modify an unpatched source catalog or another configured scope
    // that resolves to the same file. Check source-locale targets first so
    // collisions against a source catalog always report `source_locale_read_only`.
    let mut configured_locales = Vec::with_capacity(request.config.locales.len() + 1);
    configured_locales.push(request.config.source_locale.as_str());
    for locale in &request.config.locales {
        if !configured_locales.contains(&locale.as_str()) {
            configured_locales.push(locale.as_str());
        }
    }
    let mut unpatched_targets_by_parent: BTreeMap<PathBuf, Vec<(OsString, bool)>> = BTreeMap::new();
    for (catalog_index, catalog) in request.config.catalogs.iter().enumerate() {
        for &locale in &configured_locales {
            let key = CatalogBatchKey {
                catalog_index,
                locale: locale.to_owned(),
            };
            if groups.contains_key(&key) {
                continue;
            }
            let path = resolve_catalog_path(&request.config, catalog, locale)?;
            let (relative_parent, file_name) =
                split_relative_catalog_path(Path::new(&request.config.root_dir), &path).map_err(
                    |error| PalamedesError::UnsafeCatalogPath {
                        path: path.to_string_lossy().into_owned(),
                        reason: error.to_string(),
                    },
                )?;
            let is_source = is_source_locale(&request.config, locale);
            if let Some(colliding) =
                target_batches.get(&(relative_parent.clone(), file_name.clone()))
            {
                for batch in colliding {
                    if let Some(patch_indexes) = groups.get(batch) {
                        for &patch_index in patch_indexes {
                            if rejected.insert(patch_index) {
                                if is_source {
                                    diagnostics.push(workflow_diagnostic(
                                        "translation.source_locale",
                                        "Patch target resolves to the same file as a configured source-locale catalog and cannot be modified.",
                                        Some(request.patches[patch_index].id.clone()),
                                    ));
                                } else {
                                    diagnostics.push(workflow_diagnostic(
                                        "translation.ambiguous_catalog",
                                        "Multiple configured catalog scopes resolve to the same target file.",
                                        Some(request.patches[patch_index].id.clone()),
                                    ));
                                }
                            }
                        }
                    }
                }
            }
            unpatched_targets_by_parent
                .entry(relative_parent)
                .or_default()
                .push((file_name, is_source));
        }
    }

    for colliding in target_batches.values().filter(|batches| batches.len() > 1) {
        for batch in colliding {
            if let Some(patch_indexes) = groups.get(batch) {
                for &patch_index in patch_indexes {
                    if rejected.insert(patch_index) {
                        diagnostics.push(workflow_diagnostic(
                            "translation.ambiguous_catalog",
                            "Multiple configured catalog scopes resolve to the same target file.",
                            Some(request.patches[patch_index].id.clone()),
                        ));
                    }
                }
            }
        }
    }
    if !rejected.is_empty() {
        return Ok(rejected_translation_patch_result(
            request.patches,
            requested_count,
            &rejected,
            diagnostics,
        ));
    }

    let root_dir = Path::new(&request.config.root_dir);
    // Phase 1: validate the entire batch opening at most one catalog directory
    // descriptor at a time so large multi-locale batches stay within low
    // `RLIMIT_NOFILE` budgets while still rejecting invalid patches before any
    // write occurs.
    let mut seen_identities: HashMap<FileIdentity, Vec<usize>> = HashMap::new();
    let mut dir_eq_cache: HashMap<PathBuf, Option<DirFilenameEquivalence>> = HashMap::new();
    let mut alias_probe_cache: HashMap<(PathBuf, OsString, OsString), bool> = HashMap::new();
    let mut unidentified_trie = UnidentifiedPatchNode::default();
    let mut prepared_plans = Vec::new();
    for (batch, patch_indexes) in groups {
        let catalog = &request.config.catalogs[batch.catalog_index];
        let mut loaded = load_catalog(&request.config, catalog, &batch.locale)?;
        let (relative_parent, _) =
            split_relative_catalog_path(root_dir, &loaded.path).map_err(|error| {
                PalamedesError::UnsafeCatalogPath {
                    path: loaded.path.to_string_lossy().into_owned(),
                    reason: error.to_string(),
                }
            })?;
        let identity = if simulate_missing_file_identity {
            None
        } else {
            loaded
                .parent_dir
                .file_identity(&loaded.file_name)
                .map_err(|error| match error {
                    ContainedFsError::Containment(reason) => PalamedesError::UnsafeCatalogPath {
                        path: loaded.path.to_string_lossy().into_owned(),
                        reason,
                    },
                    ContainedFsError::Io(source) => PalamedesError::ReadFile {
                        path: loaded.path.clone(),
                        source,
                    },
                })?
        };
        if let Some(identity) = identity {
            let entry = seen_identities.entry(identity).or_default();
            if !entry.is_empty() {
                reject_ambiguous_catalog_patches(
                    entry,
                    &patch_indexes,
                    &request.patches,
                    &mut rejected,
                    &mut diagnostics,
                );
            }
            entry.extend(patch_indexes.iter().copied());
        } else {
            // When `file_identity` is unavailable (for example, on a Windows
            // volume that does not expose `FileIdInfo`), fall back to each
            // containing directory's filename-equivalence rules and indexed
            // 8.3 short-name matching so aliased scopes such as
            // `Locales/{locale}` and `locales/{locale}` or `σ/{locale}` and
            // `ς/{locale}` are rejected before Phase 2 commits any write.
            let segments = resolve_unidentified_patch_segments(
                root_dir,
                &relative_parent,
                Some(&loaded.parent_dir),
                &loaded.file_name,
                &mut dir_eq_cache,
                simulated_dir_equivalence,
            )?;
            let mut colliding_priors = Vec::new();
            let mut probe_ctx = UnidentifiedAliasProbeContext {
                root_dir,
                leaf_parent_rel: &relative_parent,
                leaf_parent_dir: Some(&loaded.parent_dir),
                cache: &mut alias_probe_cache,
                simulated_8dot3_alias_probe,
            };
            unidentified_trie.collect_colliding_leaf_patches(
                &segments,
                Path::new(""),
                &mut probe_ctx,
                &mut colliding_priors,
            );
            if !colliding_priors.is_empty() {
                reject_ambiguous_catalog_patches(
                    &colliding_priors,
                    &patch_indexes,
                    &request.patches,
                    &mut rejected,
                    &mut diagnostics,
                );
            }
            unidentified_trie.insert(&segments, &patch_indexes);
        }
        for &patch_index in &patch_indexes {
            if rejected.contains(&patch_index) {
                continue;
            }
            let patch = &request.patches[patch_index];
            let key = CatalogMessageKey::new(patch.id.message.clone(), patch.id.context.clone());
            if loaded.ambiguous_messages.contains(&key) {
                rejected.insert(patch_index);
                diagnostics.push(workflow_diagnostic(
                    "translation.ambiguous_message",
                    "Catalog contains more than one definition for the patch identity.",
                    Some(patch.id.clone()),
                ));
                continue;
            }
            let Some(item_index) = loaded.messages.get(&key) else {
                rejected.insert(patch_index);
                diagnostics.push(workflow_diagnostic(
                    "translation.unknown_message",
                    "Patch identity does not exist in the resolved catalog.",
                    Some(patch.id.clone()),
                ));
                continue;
            };
            let current =
                build_candidate(&loaded, &key, &loaded.po.items[*item_index], usize::MAX)?;
            if current.fingerprint != patch.fingerprint {
                rejected.insert(patch_index);
                diagnostics.push(workflow_diagnostic(
                    "translation.stale_candidate",
                    "Patch fingerprint no longer matches the current catalog entry.",
                    Some(patch.id.clone()),
                ));
                continue;
            }
            if let Err(message) = validate_patch_translation(&patch.translation) {
                rejected.insert(patch_index);
                diagnostics.push(workflow_diagnostic(
                    "translation.shape_mismatch",
                    message,
                    Some(patch.id.clone()),
                ));
            } else {
                let compatibility =
                    render_translation_value(&patch.translation).and_then(|translation| {
                        compare_runtime_icu(&current.id.message, &translation)
                            .map_err(PalamedesError::from)
                    });
                match compatibility {
                    Ok(compatibility) => {
                        for diagnostic in compatibility.into_iter().filter(|diagnostic| {
                            diagnostic.severity == ferrocat_icu::IcuDiagnosticSeverity::Error
                        }) {
                            rejected.insert(patch_index);
                            diagnostics.push(workflow_diagnostic(
                                diagnostic.code.as_ref(),
                                diagnostic.message,
                                Some(patch.id.clone()),
                            ));
                        }
                    }
                    Err(error) => {
                        rejected.insert(patch_index);
                        diagnostics.push(workflow_diagnostic(
                            "translation.invalid_icu",
                            format!("Source or rendered translation is not valid ICU: {error}"),
                            Some(patch.id.clone()),
                        ));
                    }
                }
            }
            if let Some(machine) = &patch.machine
                && let Err(message) = validate_machine_provenance(machine)
            {
                rejected.insert(patch_index);
                diagnostics.push(workflow_diagnostic(
                    "translation.invalid_provenance",
                    message,
                    Some(patch.id.clone()),
                ));
            }
            if !rejected.contains(&patch_index) && patch_changes_candidate(&current, patch)? {
                changed_patches.insert(patch_index);
            }
        }

        if patch_indexes
            .iter()
            .all(|patch_index| !rejected.contains(patch_index))
        {
            for &patch_index in &patch_indexes {
                apply_patch_to_po(
                    &mut loaded.po,
                    &loaded.po_item_indexes,
                    &request.patches[patch_index],
                )?;
            }
            let po = ferrocat::stringify_po(&loaded.po, &SerializeOptions::default());
            let content = render_target_catalog(
                &po,
                &request.config.source_locale,
                &batch.locale,
                loaded.format,
                request.po.as_ref(),
            )?;
            let changed = content != loaded.original;
            prepared_plans.push(PreparedCatalogPlan {
                catalog_index: batch.catalog_index,
                path: loaded.path,
                relative_parent,
                file_name: loaded.file_name,
                locale: batch.locale,
                patch_indexes,
                original: loaded.original,
                content,
                changed,
            });
        }
        // `loaded` (and its `ContainedDir` descriptor) drops at the end of each
        // iteration, keeping open descriptors bounded to O(1).
    }

    // Check every unpatched configured (catalog, locale) target — including
    // source-locale catalogs — against the live file identities and
    // filesystem-equivalence trie of the patched targets so a single patch can
    // never mutate an unpatched source catalog or another scope that aliases
    // the same file on disk (e.g., via case-folding, NFD, or 8.3 short names).
    if !seen_identities.is_empty() || !unidentified_trie.is_empty() {
        for (unpatched_rel_parent, entries) in &unpatched_targets_by_parent {
            let parent_dir = match ContainedDir::open_subpath(root_dir, unpatched_rel_parent, false)
            {
                Ok(Some(dir)) => Some(dir),
                Ok(None) => None,
                Err(ContainedFsError::Containment(reason)) => {
                    return Err(PalamedesError::UnsafeCatalogPath {
                        path: root_dir
                            .join(unpatched_rel_parent)
                            .to_string_lossy()
                            .into_owned(),
                        reason,
                    });
                }
                Err(ContainedFsError::Io(source)) => {
                    return Err(PalamedesError::ReadFile {
                        path: root_dir.join(unpatched_rel_parent),
                        source,
                    });
                }
            };
            // Check source-locale entries before non-source entries so a target
            // aliasing a source catalog always reports `translation.source_locale`.
            let ordered_entries = entries
                .iter()
                .filter(|(_, is_source)| *is_source)
                .chain(entries.iter().filter(|(_, is_source)| !*is_source));
            for (file_name, is_source) in ordered_entries {
                let mut colliding_patch_indexes: Vec<usize> = Vec::new();
                if !seen_identities.is_empty()
                    && !simulate_missing_file_identity
                    && let Some(ref dir) = parent_dir
                {
                    let identity = dir.file_identity(file_name).map_err(|error| {
                        let target_path = root_dir.join(unpatched_rel_parent).join(file_name);
                        match error {
                            ContainedFsError::Containment(reason) => {
                                PalamedesError::UnsafeCatalogPath {
                                    path: target_path.to_string_lossy().into_owned(),
                                    reason,
                                }
                            }
                            ContainedFsError::Io(source) => PalamedesError::ReadFile {
                                path: target_path,
                                source,
                            },
                        }
                    })?;
                    if let Some(identity) = identity
                        && let Some(indexes) = seen_identities.get(&identity)
                    {
                        colliding_patch_indexes.extend_from_slice(indexes);
                    }
                }
                if !unidentified_trie.is_empty() {
                    let segments = resolve_unidentified_patch_segments(
                        root_dir,
                        unpatched_rel_parent,
                        parent_dir.as_ref(),
                        file_name,
                        &mut dir_eq_cache,
                        simulated_dir_equivalence,
                    )?;
                    let mut probe_ctx = UnidentifiedAliasProbeContext {
                        root_dir,
                        leaf_parent_rel: unpatched_rel_parent,
                        leaf_parent_dir: parent_dir.as_ref(),
                        cache: &mut alias_probe_cache,
                        simulated_8dot3_alias_probe,
                    };
                    unidentified_trie.collect_colliding_leaf_patches(
                        &segments,
                        Path::new(""),
                        &mut probe_ctx,
                        &mut colliding_patch_indexes,
                    );
                }
                for patch_index in colliding_patch_indexes {
                    if rejected.insert(patch_index) {
                        if *is_source {
                            diagnostics.push(workflow_diagnostic(
                                "translation.source_locale",
                                "Patch target resolves to the same file as a configured source-locale catalog and cannot be modified.",
                                Some(request.patches[patch_index].id.clone()),
                            ));
                        } else {
                            diagnostics.push(workflow_diagnostic(
                                "translation.ambiguous_catalog",
                                "Multiple configured catalog scopes resolve to the same target file.",
                                Some(request.patches[patch_index].id.clone()),
                            ));
                        }
                    }
                }
            }
        }
    }

    if !rejected.is_empty() {
        return Ok(rejected_translation_patch_result(
            request.patches,
            requested_count,
            &rejected,
            diagnostics,
        ));
    }

    // Phase 2: commit each changed catalog one at a time under its pinned
    // directory handle and exclusive cross-process target lock (at most 3 open
    // descriptors at any point, regardless of how many locales are patched).
    let mut completed_patches = BTreeSet::new();
    let mut catalogs_updated = 0;
    let mut replacement_diagnostics = Vec::new();
    for plan in prepared_plans {
        if !plan.changed {
            completed_patches.extend(&plan.patch_indexes);
            continue;
        }
        let commit_result: PalamedesResult<Option<CatalogReplacement>> = (|| {
            let parent_dir =
                match ContainedDir::open_subpath(root_dir, &plan.relative_parent, false) {
                    Ok(Some(dir)) => Arc::new(dir),
                    Ok(None) => {
                        return Err(PalamedesError::ReadFile {
                            path: plan.path.clone(),
                            source: std::io::Error::new(
                                std::io::ErrorKind::NotFound,
                                "catalog file does not exist",
                            ),
                        });
                    }
                    Err(ContainedFsError::Containment(reason)) => {
                        return Err(PalamedesError::UnsafeCatalogPath {
                            path: plan.path.to_string_lossy().into_owned(),
                            reason,
                        });
                    }
                    Err(ContainedFsError::Io(source)) => {
                        return Err(PalamedesError::ReadFile {
                            path: plan.path.clone(),
                            source,
                        });
                    }
                };
            let _target_lock =
                parent_dir
                    .lock_target(&plan.file_name)
                    .map_err(|error| match error {
                        ContainedFsError::Containment(reason) => {
                            PalamedesError::UnsafeCatalogPath {
                                path: plan.path.to_string_lossy().into_owned(),
                                reason,
                            }
                        }
                        ContainedFsError::Io(source) => PalamedesError::WriteFile {
                            path: plan.path.clone(),
                            source,
                        },
                    })?;
            let current_original = match parent_dir.read_optional_file(&plan.file_name) {
                Ok(Some(content)) => content,
                Ok(None) => {
                    return Err(PalamedesError::ReadFile {
                        path: plan.path.clone(),
                        source: std::io::Error::new(
                            std::io::ErrorKind::NotFound,
                            "catalog file does not exist",
                        ),
                    });
                }
                Err(ContainedFsError::Containment(reason)) => {
                    return Err(PalamedesError::UnsafeCatalogPath {
                        path: plan.path.to_string_lossy().into_owned(),
                        reason,
                    });
                }
                Err(ContainedFsError::Io(source)) => {
                    return Err(PalamedesError::ReadFile {
                        path: plan.path.clone(),
                        source,
                    });
                }
            };
            let (changed, content, expected_original) = if current_original == plan.original {
                (true, plan.content, current_original)
            } else {
                // Another writer modified this catalog after Phase 1 validation.
                // Re-parse under the exclusive lock, re-verify every patch
                // fingerprint against the live file, and re-render so unrelated
                // concurrent edits are preserved and conflicting edits fail
                // cleanly instead of being overwritten.
                let catalog_cfg = &request.config.catalogs[plan.catalog_index];
                let mut reloaded = build_loaded_catalog_from_content(
                    &request.config,
                    catalog_cfg,
                    &plan.locale,
                    plan.path.clone(),
                    Arc::clone(&parent_dir),
                    plan.file_name.clone(),
                    current_original,
                )?;
                for &patch_index in &plan.patch_indexes {
                    let patch = &request.patches[patch_index];
                    let key =
                        CatalogMessageKey::new(patch.id.message.clone(), patch.id.context.clone());
                    let item_index = reloaded.messages.get(&key).copied().ok_or_else(|| {
                        PalamedesError::WriteFile {
                            path: plan.path.clone(),
                            source: std::io::Error::new(
                                std::io::ErrorKind::AlreadyExists,
                                "catalog changed concurrently and patch target no longer exists",
                            ),
                        }
                    })?;
                    if reloaded.ambiguous_messages.contains(&key) {
                        return Err(PalamedesError::WriteFile {
                            path: plan.path.clone(),
                            source: std::io::Error::new(
                                std::io::ErrorKind::AlreadyExists,
                                "catalog changed concurrently and patch target became ambiguous",
                            ),
                        });
                    }
                    let current = build_candidate(
                        &reloaded,
                        &key,
                        &reloaded.po.items[item_index],
                        usize::MAX,
                    )?;
                    if current.fingerprint != patch.fingerprint {
                        return Err(PalamedesError::WriteFile {
                            path: plan.path.clone(),
                            source: std::io::Error::new(
                                std::io::ErrorKind::AlreadyExists,
                                "catalog changed concurrently and patch fingerprint is now stale",
                            ),
                        });
                    }
                }
                for &patch_index in &plan.patch_indexes {
                    apply_patch_to_po(
                        &mut reloaded.po,
                        &reloaded.po_item_indexes,
                        &request.patches[patch_index],
                    )?;
                }
                let po = ferrocat::stringify_po(&reloaded.po, &SerializeOptions::default());
                let rendered = render_target_catalog(
                    &po,
                    &request.config.source_locale,
                    &plan.locale,
                    reloaded.format,
                    request.po.as_ref(),
                )?;
                (rendered != reloaded.original, rendered, reloaded.original)
            };
            if !changed {
                return Ok(None);
            }
            let prepared_catalog = PreparedCatalog {
                path: plan.path.clone(),
                parent_dir: Arc::clone(&parent_dir),
                file_name: plan.file_name.clone(),
                expected_original: Some(expected_original),
                content,
            };
            replace_catalog(
                &prepared_catalog,
                &request.config.source_locale,
                request.po.as_ref(),
            )
            .map(Some)
        })();

        match commit_result {
            Ok(Some(CatalogReplacement::Durable)) => {
                catalogs_updated += 1;
            }
            Ok(Some(CatalogReplacement::CommittedWithDurabilityWarning(source))) => {
                catalogs_updated += 1;
                replacement_diagnostics.push(TranslationWorkflowDiagnostic {
                    code: "translation.catalog_durability".to_owned(),
                    message: format!(
                        "Catalog replacement committed, but synchronizing its directory failed: {source}"
                    ),
                    id: None,
                    catalog_path: Some(plan.path.to_string_lossy().into_owned()),
                    locale: Some(plan.locale),
                });
            }
            Ok(None) => {}
            Err(source) => {
                return Err(PalamedesError::TranslationPatchWrite {
                    result: completed_translation_patch_result(
                        &request.patches,
                        &changed_patches,
                        &completed_patches,
                        catalogs_updated,
                        replacement_diagnostics,
                    ),
                    source: Box::new(source),
                });
            }
        }
        completed_patches.extend(&plan.patch_indexes);
    }

    Ok(completed_translation_patch_result(
        &request.patches,
        &changed_patches,
        &completed_patches,
        catalogs_updated,
        replacement_diagnostics,
    ))
}

fn reject_ambiguous_catalog_patches(
    prior_indexes: &[usize],
    current_indexes: &[usize],
    patches: &[TranslationPatch],
    rejected: &mut BTreeSet<usize>,
    diagnostics: &mut Vec<TranslationWorkflowDiagnostic>,
) {
    for &prior_index in prior_indexes {
        if rejected.insert(prior_index) {
            diagnostics.push(workflow_diagnostic(
                "translation.ambiguous_catalog",
                "Multiple configured catalog scopes resolve to the same target file.",
                Some(patches[prior_index].id.clone()),
            ));
        }
    }
    for &patch_index in current_indexes {
        if rejected.insert(patch_index) {
            diagnostics.push(workflow_diagnostic(
                "translation.ambiguous_catalog",
                "Multiple configured catalog scopes resolve to the same target file.",
                Some(patches[patch_index].id.clone()),
            ));
        }
    }
}

struct UnidentifiedPatchSegment {
    raw: OsString,
    folded: OsString,
    equivalence: Option<DirFilenameEquivalence>,
}

#[cfg(windows)]
fn ntfs_casefold(text: &str) -> String {
    #[link(name = "ntdll")]
    unsafe extern "system" {
        fn RtlUpcaseUnicodeChar(source_character: u16) -> u16;
    }

    let upcased: Vec<u16> = text
        .encode_utf16()
        .map(|unit| {
            // SAFETY: `RtlUpcaseUnicodeChar` is a pure code-unit table lookup.
            unsafe { RtlUpcaseUnicodeChar(unit) }
        })
        .collect();
    String::from_utf16_lossy(&upcased)
}

#[cfg(not(windows))]
fn ntfs_casefold(text: &str) -> String {
    // NTFS `$UpCase` is a 65,536-entry UTF-16 code-unit table: supplementary
    // plane characters (> U+FFFF, encoded as surrogate pairs) are untouched,
    // multi-character expansions such as `ß` -> `SS` stay distinct, `σ` and `ς`
    // both map to `Σ`, and dotless `ı` (U+0131) does not fold to `I`.
    let mut folded = String::with_capacity(text.len());
    for ch in text.chars() {
        if (ch as u32) > 0xFFFF || ch == '\u{0131}' {
            folded.push(ch);
            continue;
        }
        let mut upper = ch.to_uppercase();
        if let Some(first) = upper.next()
            && upper.next().is_none()
            && (first as u32) <= 0xFFFF
        {
            folded.push(first);
        } else {
            folded.push(ch);
        }
    }
    folded
}

const fn is_default_ignorable_code_point(ch: char) -> bool {
    let cp = ch as u32;
    matches!(
        cp,
        0x00ad
            | 0x034f
            | 0x061c
            | 0x115f..=0x1160
            | 0x17b4..=0x17b5
            | 0x180b..=0x180f
            | 0x200b..=0x200f
            | 0x202a..=0x202e
            | 0x2060..=0x206f
            | 0x3164
            | 0xfe00..=0xfe0f
            | 0xfeff
            | 0xffa0
            | 0xfff0..=0xfff8
            | 0x1bca0..=0x1bca3
            | 0x1d173..=0x1d17a
            | 0xe0000..=0xe0fff
    )
}

fn unicode_full_casefold_nfd(text: &str, strip_default_ignorables: bool) -> String {
    // Unicode CaseFolding (C + F) over NFD, matching extract's conservative
    // normalization/casefolding rules (so `café` and `cafe\u{0301}` match,
    // `σ`/`ς`/`Σ` all fold to `σ`, `ß`/`ẞ` fold to `ss`, `µ` folds to `μ`,
    // and `ﬁ` folds to `fi`).
    let mut folded = String::with_capacity(text.len());
    for ch in text.nfd() {
        if strip_default_ignorables && is_default_ignorable_code_point(ch) {
            continue;
        }
        match ch {
            '\u{13a0}'..='\u{13f5}' => folded.push(ch),
            '\u{13f8}'..='\u{13fd}' => {
                folded.push(char::from_u32((ch as u32) - 8).unwrap_or(ch));
            }
            '\u{ab70}'..='\u{abbf}' => {
                folded.push(char::from_u32(0x13a0 + ((ch as u32) - 0xab70)).unwrap_or(ch));
            }
            '\u{00b5}' => folded.push('\u{03bc}'),
            '\u{00df}' | '\u{1e9e}' => folded.push_str("ss"),
            '\u{0149}' => folded.push_str("\u{02bc}n"),
            '\u{017f}' => folded.push('s'),
            '\u{0345}' => folded.push('\u{03b9}'),
            '\u{03c2}' => folded.push('\u{03c3}'),
            '\u{03d0}' => folded.push('\u{03b2}'),
            '\u{03d1}' => folded.push('\u{03b8}'),
            '\u{03d5}' => folded.push('\u{03c6}'),
            '\u{03d6}' => folded.push('\u{03c0}'),
            '\u{03f0}' => folded.push('\u{03ba}'),
            '\u{03f1}' => folded.push('\u{03c1}'),
            '\u{03f5}' => folded.push('\u{03b5}'),
            '\u{0587}' => folded.push_str("\u{0565}\u{0582}"),
            '\u{1c80}' => folded.push('\u{0432}'),
            '\u{1c81}' => folded.push('\u{0434}'),
            '\u{1c82}' => folded.push('\u{043e}'),
            '\u{1c83}' => folded.push('\u{0441}'),
            '\u{1c84}' | '\u{1c85}' => folded.push('\u{0442}'),
            '\u{1c86}' => folded.push('\u{044a}'),
            '\u{1c87}' => folded.push('\u{0463}'),
            '\u{1c88}' => folded.push('\u{a64b}'),
            '\u{1e9a}' => folded.push_str("a\u{02be}"),
            '\u{fb00}' => folded.push_str("ff"),
            '\u{fb01}' => folded.push_str("fi"),
            '\u{fb02}' => folded.push_str("fl"),
            '\u{fb03}' => folded.push_str("ffi"),
            '\u{fb04}' => folded.push_str("ffl"),
            '\u{fb05}' | '\u{fb06}' => folded.push_str("st"),
            '\u{fb13}' => folded.push_str("\u{0574}\u{0576}"),
            '\u{fb14}' => folded.push_str("\u{0574}\u{0565}"),
            '\u{fb15}' => folded.push_str("\u{0574}\u{056b}"),
            '\u{fb16}' => folded.push_str("\u{057e}\u{0576}"),
            '\u{fb17}' => folded.push_str("\u{0574}\u{056d}"),
            other => {
                for lower in other.to_lowercase() {
                    folded.push(lower);
                }
            }
        }
    }
    folded.nfd().collect()
}

fn fold_patch_segment(segment: &OsStr, equivalence: Option<DirFilenameEquivalence>) -> OsString {
    match equivalence {
        Some(DirFilenameEquivalence::Exact) => segment.to_os_string(),
        Some(DirFilenameEquivalence::UnicodeNfd | DirFilenameEquivalence::UnicodeHfsPlus) => {
            segment.to_str().map_or_else(
                || segment.to_os_string(),
                |text| OsString::from(text.nfd().collect::<String>()),
            )
        }
        Some(DirFilenameEquivalence::CaseInsensitiveNtfs) => segment.to_str().map_or_else(
            || segment.to_os_string(),
            |text| OsString::from(ntfs_casefold(text.trim_end_matches(['.', ' ']))),
        ),
        Some(
            DirFilenameEquivalence::CaseInsensitiveVfat
            | DirFilenameEquivalence::CaseInsensitiveExfat,
        ) => segment.to_str().map_or_else(
            || segment.to_os_string(),
            |text| OsString::from(ntfs_casefold(text.trim_end_matches('.'))),
        ),
        Some(
            DirFilenameEquivalence::CaseInsensitiveUnicodeNfd
            | DirFilenameEquivalence::CaseInsensitiveHfsPlus,
        ) => segment.to_str().map_or_else(
            || segment.to_os_string(),
            |text| OsString::from(unicode_full_casefold_nfd(text, false)),
        ),
        Some(DirFilenameEquivalence::CaseInsensitiveUnicodeNfdicf) => segment.to_str().map_or_else(
            || segment.to_os_string(),
            |text| OsString::from(unicode_full_casefold_nfd(text, true)),
        ),
        None => segment.to_str().map_or_else(
            || segment.to_os_string(),
            |text| {
                OsString::from(unicode_full_casefold_nfd(
                    text.trim_end_matches(['.', ' ']),
                    true,
                ))
            },
        ),
    }
}

fn query_cached_dir_equivalence(
    root_dir: &Path,
    relative_dir: &Path,
    open_dir: Option<&ContainedDir>,
    cache: &mut HashMap<PathBuf, Option<DirFilenameEquivalence>>,
    simulated_dir_equivalence: Option<Option<DirFilenameEquivalence>>,
) -> PalamedesResult<Option<DirFilenameEquivalence>> {
    if let Some(simulated) = simulated_dir_equivalence {
        return Ok(simulated);
    }
    if let Some(&cached) = cache.get(relative_dir) {
        return Ok(cached);
    }
    let eq = if let Some(dir) = open_dir {
        dir.filename_equivalence()
    } else {
        match ContainedDir::open_subpath(root_dir, relative_dir, false) {
            Ok(Some(dir)) => dir.filename_equivalence(),
            Ok(None) => None,
            Err(ContainedFsError::Containment(reason)) => {
                return Err(PalamedesError::UnsafeCatalogPath {
                    path: root_dir.join(relative_dir).to_string_lossy().into_owned(),
                    reason,
                });
            }
            Err(ContainedFsError::Io(_)) => None,
        }
    };
    cache.insert(relative_dir.to_path_buf(), eq);
    Ok(eq)
}

fn resolve_unidentified_patch_segments(
    root_dir: &Path,
    relative_parent: &Path,
    parent_dir: Option<&ContainedDir>,
    file_name: &OsStr,
    dir_eq_cache: &mut HashMap<PathBuf, Option<DirFilenameEquivalence>>,
    simulated_dir_equivalence: Option<Option<DirFilenameEquivalence>>,
) -> PalamedesResult<Vec<UnidentifiedPatchSegment>> {
    let mut segments = Vec::new();
    let mut current_rel = PathBuf::new();

    for component in relative_parent.components() {
        let raw = component.as_os_str().to_os_string();
        let eq = query_cached_dir_equivalence(
            root_dir,
            &current_rel,
            None,
            dir_eq_cache,
            simulated_dir_equivalence,
        )?;
        let folded = fold_patch_segment(&raw, eq);
        segments.push(UnidentifiedPatchSegment {
            raw,
            folded,
            equivalence: eq,
        });
        current_rel.push(component.as_os_str());
    }

    let file_eq = query_cached_dir_equivalence(
        root_dir,
        relative_parent,
        parent_dir,
        dir_eq_cache,
        simulated_dir_equivalence,
    )?;
    let file_raw = file_name.to_os_string();
    let file_folded = fold_patch_segment(&file_raw, file_eq);
    segments.push(UnidentifiedPatchSegment {
        raw: file_raw,
        folded: file_folded,
        equivalence: file_eq,
    });

    Ok(segments)
}

const fn equivalence_allows_8dot3(equivalence: Option<DirFilenameEquivalence>) -> bool {
    matches!(
        equivalence,
        None | Some(
            DirFilenameEquivalence::CaseInsensitiveNtfs
                | DirFilenameEquivalence::CaseInsensitiveVfat
        )
    )
}

const fn is_valid_8dot3_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric()
        || matches!(
            ch,
            '!' | '#'
                | '$'
                | '%'
                | '&'
                | '\''
                | '('
                | ')'
                | '-'
                | '@'
                | '^'
                | '_'
                | '`'
                | '{'
                | '}'
                | '~'
        )
}

fn is_valid_8dot3_name(name: &str) -> bool {
    if name.is_empty() || name.starts_with(['.', ' ']) || name.ends_with(['.', ' ']) {
        return false;
    }
    let mut parts = name.split('.');
    let Some(stem) = parts.next() else {
        return false;
    };
    let ext = parts.next().unwrap_or("");
    if parts.next().is_some() || stem.is_empty() || stem.len() > 8 || ext.len() > 3 {
        return false;
    }
    stem.chars().all(is_valid_8dot3_char) && ext.chars().all(is_valid_8dot3_char)
}

struct Short83Candidate {
    prefix: String,
    hash_prefix: Option<String>,
    digits_len: usize,
    ext: String,
}

struct Long83Derived {
    base: String,
    ext: String,
    has_non_ascii: bool,
}

fn parse_8dot3_short_name(segment: &OsStr) -> Option<Short83Candidate> {
    let text = segment.to_str()?;
    if !is_valid_8dot3_name(text) {
        return None;
    }
    let (stem_raw, ext_raw) = text.split_once('.').unwrap_or((text, ""));
    let (prefix_raw, digits) = stem_raw.rsplit_once('~')?;
    if prefix_raw.is_empty()
        || digits.is_empty()
        || digits.len() > 6
        || !digits.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    let prefix = prefix_raw.to_ascii_uppercase();
    let hash_prefix = if prefix.len() >= 5
        && prefix.len() <= 6
        && prefix[prefix.len() - 4..]
            .bytes()
            .all(|b| b.is_ascii_hexdigit())
    {
        Some(prefix[..prefix.len() - 4].to_owned())
    } else {
        None
    };
    Some(Short83Candidate {
        prefix,
        hash_prefix,
        digits_len: digits.len(),
        ext: ext_raw.to_ascii_uppercase(),
    })
}

fn parse_8dot3_long_name(segment: &OsStr) -> Option<Long83Derived> {
    let Some(text) = segment.to_str() else {
        return Some(Long83Derived {
            base: String::new(),
            ext: "_".to_owned(),
            has_non_ascii: true,
        });
    };
    if is_valid_8dot3_name(text) {
        return None;
    }
    let trimmed = text.trim_end_matches(['.', ' ']);
    let (raw_stem, raw_ext) = match trimmed.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => (stem, ext),
        _ => (trimmed, ""),
    };
    let has_non_ascii = !trimmed.is_ascii();
    let mut base = String::new();
    for ch in raw_stem.chars() {
        if ch == ' ' || ch == '.' {
            continue;
        }
        if !ch.is_ascii() {
            base.push('_');
        } else if is_valid_8dot3_char(ch) {
            base.push(ch.to_ascii_uppercase());
        } else {
            base.push('_');
        }
    }
    let mut ext = String::new();
    for ch in raw_ext.chars() {
        if ch == ' ' || ch == '.' {
            continue;
        }
        if ext.len() == 3 {
            break;
        }
        if !ch.is_ascii() {
            ext.push('_');
        } else if is_valid_8dot3_char(ch) {
            ext.push(ch.to_ascii_uppercase());
        } else {
            ext.push('_');
        }
    }
    Some(Long83Derived {
        base,
        ext,
        has_non_ascii,
    })
}

struct UnidentifiedAliasProbeContext<'a> {
    root_dir: &'a Path,
    leaf_parent_rel: &'a Path,
    leaf_parent_dir: Option<&'a ContainedDir>,
    cache: &'a mut HashMap<(PathBuf, OsString, OsString), bool>,
    simulated_8dot3_alias_probe: Option<Option<bool>>,
}

impl UnidentifiedAliasProbeContext<'_> {
    fn verify_8dot3_pair(&mut self, dir_rel: &Path, left: &OsStr, right: &OsStr) -> bool {
        if left == right {
            return true;
        }
        let (first, second) = if left <= right {
            (left.to_os_string(), right.to_os_string())
        } else {
            (right.to_os_string(), left.to_os_string())
        };
        let key = (dir_rel.to_path_buf(), first, second);
        if let Some(&cached) = self.cache.get(&key) {
            return cached;
        }
        let probed = if let Some(simulated) = self.simulated_8dot3_alias_probe {
            simulated
        } else if dir_rel == self.leaf_parent_rel {
            // Both catalog paths already exist in their containing directory,
            // so inspect the live entries directly (file IDs or Windows
            // `FileAlternateNameInformation`) without probing an empty
            // directory where populated-directory numeric tails (`~2`, etc.)
            // would differ.
            self.leaf_parent_dir
                .and_then(|dir| dir.probe_existing_names_equivalent(left, right))
        } else {
            ContainedDir::open_subpath(self.root_dir, dir_rel, false)
                .ok()
                .flatten()
                .and_then(|dir| dir.probe_existing_names_equivalent(left, right))
        };
        // Only treat the pair as distinct when the filesystem explicitly
        // disproves aliasing (`Some(false)`); fail closed on `Some(true)` or
        // unprobeable (`None`).
        let collides = probed != Some(false);
        self.cache.insert(key, collides);
        collides
    }
}

#[derive(Default)]
struct UnidentifiedPatchNode {
    leaf_patch_indexes: Vec<usize>,
    child_nodes: Vec<(OsString, Self)>,
    by_folded: HashMap<OsString, usize>,
    // Bidirectional O(1) indexes for NTFS/FAT 8.3 short/long aliases.
    long_by_prefix: HashMap<(String, String, usize), Vec<usize>>,
    long_by_hash_prefix: HashMap<(String, String), Vec<usize>>,
    non_ascii_long_by_ext: HashMap<String, Vec<usize>>,
    any_non_ascii_ext_long: Vec<usize>,
    short_by_prefix: HashMap<(String, String, usize), Vec<usize>>,
    short_by_hash_prefix: HashMap<(String, String), Vec<usize>>,
    short_by_ext: HashMap<String, Vec<usize>>,
    all_shorts: Vec<usize>,
}

impl UnidentifiedPatchNode {
    fn is_empty(&self) -> bool {
        self.leaf_patch_indexes.is_empty() && self.child_nodes.is_empty()
    }

    fn matching_8dot3_children(&self, raw: &OsStr) -> Vec<usize> {
        let mut matches = Vec::new();
        let mut seen = HashSet::new();
        let mut push_unique = |idx: usize| {
            if seen.insert(idx) {
                matches.push(idx);
            }
        };

        if let Some(short) = parse_8dot3_short_name(raw) {
            if let Some(indices) = self.long_by_prefix.get(&(
                short.ext.clone(),
                short.prefix.clone(),
                short.digits_len,
            )) {
                for &idx in indices {
                    push_unique(idx);
                }
            }
            if let Some(ref hash_prefix) = short.hash_prefix
                && let Some(indices) = self
                    .long_by_hash_prefix
                    .get(&(short.ext.clone(), hash_prefix.clone()))
            {
                for &idx in indices {
                    push_unique(idx);
                }
            }
            if let Some(indices) = self.non_ascii_long_by_ext.get(&short.ext) {
                for &idx in indices {
                    push_unique(idx);
                }
            }
            for &idx in &self.any_non_ascii_ext_long {
                push_unique(idx);
            }
            return matches;
        }

        if self.all_shorts.is_empty() {
            return matches;
        }

        if let Some(long) = parse_8dot3_long_name(raw) {
            if long.has_non_ascii {
                if long.ext.contains('_') {
                    for &idx in &self.all_shorts {
                        push_unique(idx);
                    }
                } else if let Some(indices) = self.short_by_ext.get(&long.ext) {
                    for &idx in indices {
                        push_unique(idx);
                    }
                }
            } else {
                for digits_len in 1..=6 {
                    let prefix_len = long.base.len().min(7 - digits_len);
                    if prefix_len > 0
                        && let Some(indices) = self.short_by_prefix.get(&(
                            long.ext.clone(),
                            long.base[..prefix_len].to_owned(),
                            digits_len,
                        ))
                    {
                        for &idx in indices {
                            push_unique(idx);
                        }
                    }
                }
                let max_hash = long.base.len().min(2);
                for len in 1..=max_hash {
                    if let Some(indices) = self
                        .short_by_hash_prefix
                        .get(&(long.ext.clone(), long.base[..len].to_owned()))
                    {
                        for &idx in indices {
                            push_unique(idx);
                        }
                    }
                }
            }
        }
        matches
    }

    fn record_8dot3_child(&mut self, raw: &OsStr, child_idx: usize) {
        if let Some(short) = parse_8dot3_short_name(raw) {
            self.all_shorts.push(child_idx);
            self.short_by_ext
                .entry(short.ext.clone())
                .or_default()
                .push(child_idx);
            self.short_by_prefix
                .entry((short.ext.clone(), short.prefix, short.digits_len))
                .or_default()
                .push(child_idx);
            if let Some(hash_prefix) = short.hash_prefix {
                self.short_by_hash_prefix
                    .entry((short.ext, hash_prefix))
                    .or_default()
                    .push(child_idx);
            }
            return;
        }
        if let Some(long) = parse_8dot3_long_name(raw) {
            if long.has_non_ascii && long.ext.contains('_') {
                self.any_non_ascii_ext_long.push(child_idx);
            }
            if long.has_non_ascii {
                self.non_ascii_long_by_ext
                    .entry(long.ext)
                    .or_default()
                    .push(child_idx);
            } else {
                for digits_len in 1..=6 {
                    let prefix_len = long.base.len().min(7 - digits_len);
                    if prefix_len > 0 {
                        self.long_by_prefix
                            .entry((
                                long.ext.clone(),
                                long.base[..prefix_len].to_owned(),
                                digits_len,
                            ))
                            .or_default()
                            .push(child_idx);
                    }
                }
                let max_hash = long.base.len().min(2);
                for len in 1..=max_hash {
                    self.long_by_hash_prefix
                        .entry((long.ext.clone(), long.base[..len].to_owned()))
                        .or_default()
                        .push(child_idx);
                }
            }
        }
    }

    fn collect_colliding_leaf_patches(
        &self,
        segments: &[UnidentifiedPatchSegment],
        current_rel: &Path,
        probe_ctx: &mut UnidentifiedAliasProbeContext<'_>,
        out: &mut Vec<usize>,
    ) {
        let Some((seg, rest)) = segments.split_first() else {
            out.extend_from_slice(&self.leaf_patch_indexes);
            return;
        };

        let mut matched_children = Vec::new();
        if let Some(&child_idx) = self.by_folded.get(&seg.folded) {
            matched_children.push(child_idx);
        }
        if equivalence_allows_8dot3(seg.equivalence) {
            for child_idx in self.matching_8dot3_children(&seg.raw) {
                if !matched_children.contains(&child_idx)
                    && probe_ctx.verify_8dot3_pair(
                        current_rel,
                        &self.child_nodes[child_idx].0,
                        &seg.raw,
                    )
                {
                    matched_children.push(child_idx);
                }
            }
        }

        for child_idx in matched_children {
            let next_rel = current_rel.join(&seg.raw);
            self.child_nodes[child_idx]
                .1
                .collect_colliding_leaf_patches(rest, &next_rel, probe_ctx, out);
        }
    }

    fn insert(&mut self, segments: &[UnidentifiedPatchSegment], patch_indexes: &[usize]) {
        let mut node = self;
        for seg in segments {
            let child_idx = if let Some(&existing_idx) = node.by_folded.get(&seg.folded) {
                existing_idx
            } else {
                let new_idx = node.child_nodes.len();
                node.child_nodes.push((seg.raw.clone(), Self::default()));
                node.by_folded.insert(seg.folded.clone(), new_idx);
                if equivalence_allows_8dot3(seg.equivalence) {
                    node.record_8dot3_child(&seg.raw, new_idx);
                }
                new_idx
            };
            node = &mut node.child_nodes[child_idx].1;
        }
        node.leaf_patch_indexes.extend_from_slice(patch_indexes);
    }
}

#[cfg(feature = "test-support")]
#[doc(hidden)]
pub fn apply_translation_patches_with_injected_write_failure(
    request: TranslationPatchRequest,
    failing_path: &std::path::Path,
) -> PalamedesResult<TranslationPatchResult> {
    apply_translation_patches_with_replacement(request, |catalog, source_locale, po| {
        if catalog.path == failing_path {
            return Err(PalamedesError::WriteFile {
                path: catalog.path.clone(),
                source: std::io::Error::other("injected catalog replacement failure"),
            });
        }
        atomic_replace_catalog(catalog, source_locale, po)
    })
}

fn default_max_origins() -> usize {
    DEFAULT_TRANSLATION_CANDIDATE_MAX_ORIGINS
}

fn selected_locales(
    config: &CatalogArtifactConfig,
    requested: &[String],
    targets: &[TranslationCandidateId],
) -> Vec<String> {
    let mut locales = if requested.is_empty() {
        if targets.is_empty() {
            config
                .locales
                .iter()
                .filter(|locale| !is_source_locale(config, locale))
                .cloned()
                .collect::<Vec<_>>()
        } else {
            targets
                .iter()
                .map(|target| &target.locale)
                .filter(|locale| {
                    config.locales.contains(*locale) && !is_source_locale(config, locale)
                })
                .cloned()
                .collect::<Vec<_>>()
        }
    } else {
        requested
            .iter()
            .filter(|locale| config.locales.contains(locale) && !is_source_locale(config, locale))
            .cloned()
            .collect::<Vec<_>>()
    };
    locales.sort();
    locales.dedup();
    locales
}

fn is_source_locale(config: &CatalogArtifactConfig, locale: &str) -> bool {
    // Catalog paths and candidate identities use the configured locale spelling verbatim.
    // Keep the comparison on that canonical configuration value rather than accepting a
    // differently spelled locale that would resolve to a different on-disk path.
    locale == config.source_locale
}

fn load_catalog(
    config: &CatalogArtifactConfig,
    catalog: &CatalogConfig,
    locale: &str,
) -> PalamedesResult<LoadedCatalog> {
    load_catalog_with_dir_cache(config, catalog, locale, &mut HashMap::new())
}

fn load_catalog_with_dir_cache(
    config: &CatalogArtifactConfig,
    catalog: &CatalogConfig,
    locale: &str,
    pinned_dirs: &mut HashMap<PathBuf, Arc<ContainedDir>>,
) -> PalamedesResult<LoadedCatalog> {
    let root_dir = Path::new(&config.root_dir);
    let path = resolve_catalog_path(config, catalog, locale)?;
    let (relative_parent, file_name) =
        split_relative_catalog_path(root_dir, &path).map_err(|error| {
            PalamedesError::UnsafeCatalogPath {
                path: path.to_string_lossy().into_owned(),
                reason: error.to_string(),
            }
        })?;
    let parent_dir = if let Some(cached) = pinned_dirs.get(&relative_parent) {
        Arc::clone(cached)
    } else {
        let opened = match ContainedDir::open_subpath(root_dir, &relative_parent, false) {
            Ok(Some(dir)) => Arc::new(dir),
            Ok(None) => {
                return Err(PalamedesError::ReadFile {
                    path,
                    source: std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        "catalog file does not exist",
                    ),
                });
            }
            Err(ContainedFsError::Containment(reason)) => {
                return Err(PalamedesError::UnsafeCatalogPath {
                    path: path.to_string_lossy().into_owned(),
                    reason,
                });
            }
            Err(ContainedFsError::Io(source)) => {
                return Err(PalamedesError::ReadFile { path, source });
            }
        };
        pinned_dirs.insert(relative_parent, Arc::clone(&opened));
        opened
    };
    let original = match parent_dir.read_optional_file(&file_name) {
        Ok(Some(content)) => content,
        Ok(None) => {
            return Err(PalamedesError::ReadFile {
                path,
                source: std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "catalog file does not exist",
                ),
            });
        }
        Err(ContainedFsError::Containment(reason)) => {
            return Err(PalamedesError::UnsafeCatalogPath {
                path: path.to_string_lossy().into_owned(),
                reason,
            });
        }
        Err(ContainedFsError::Io(source)) => return Err(PalamedesError::ReadFile { path, source }),
    };
    build_loaded_catalog_from_content(
        config, catalog, locale, path, parent_dir, file_name, original,
    )
}

fn build_loaded_catalog_from_content(
    config: &CatalogArtifactConfig,
    catalog: &CatalogConfig,
    locale: &str,
    path: PathBuf,
    parent_dir: Arc<ContainedDir>,
    file_name: OsString,
    original: String,
) -> PalamedesResult<LoadedCatalog> {
    let po = parse_catalog_as_po(&original, &config.source_locale, locale, catalog.format)?;
    let mut messages = BTreeMap::new();
    let mut ambiguous_messages = BTreeSet::new();
    for (index, item) in po.items.iter().enumerate() {
        validate_icu_native_po_item(item)?;
        parse_machine_metadata(item)?;
        let key = CatalogMessageKey::new(item.msgid.clone(), item.msgctxt.clone());
        match messages.entry(key) {
            Entry::Vacant(entry) => {
                entry.insert(index);
            }
            Entry::Occupied(entry) => {
                ambiguous_messages.insert(entry.key().clone());
            }
        }
    }
    let po_item_indexes = po_item_indexes(&po);
    Ok(LoadedCatalog {
        scope: catalog.path.clone(),
        locale: locale.to_owned(),
        path,
        parent_dir,
        file_name,
        format: catalog.format,
        original,
        po,
        po_item_indexes,
        messages,
        ambiguous_messages,
    })
}

fn parse_catalog_as_po(
    content: &str,
    source_locale: &str,
    locale: &str,
    format: PalamedesCatalogFormat,
) -> PalamedesResult<PoFile> {
    #[cfg(test)]
    SOURCE_CATALOG_PARSE_COUNT.with(|count| count.set(count.get() + 1));
    if source_locale.trim().is_empty() {
        return Err(ferrocat::ApiError::InvalidArguments(
            "source_locale must not be empty".to_owned(),
        )
        .into());
    }
    match format {
        PalamedesCatalogFormat::Po => Ok(ferrocat::parse_po(content)?),
        PalamedesCatalogFormat::Fcl => parse_fcl_as_po(content, source_locale, locale),
    }
}

#[cfg(test)]
fn reset_source_catalog_parse_count() {
    SOURCE_CATALOG_PARSE_COUNT.with(|count| count.set(0));
}

#[cfg(test)]
fn source_catalog_parse_count() -> usize {
    SOURCE_CATALOG_PARSE_COUNT.with(std::cell::Cell::get)
}

fn validate_icu_native_po_item(item: &PoItem) -> PalamedesResult<()> {
    if item.msgid_plural.is_some() || matches!(item.msgstr, MsgStr::Plural(_)) {
        return Err(ferrocat::ApiError::Unsupported(
            "classic gettext plural requires compat mode".to_owned(),
        )
        .into());
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FclOrder {
    LegacyBytewise,
    Collated,
}

#[derive(PartialEq, Eq, PartialOrd, Ord)]
struct FclCollatedKey {
    message: CollationKey,
    context: CollationKey,
    raw_message: String,
    raw_context: Option<String>,
    obsolete: bool,
}

fn fcl_collated_key(item: &PoItem) -> FclCollatedKey {
    FclCollatedKey {
        message: collation_key(&item.msgid),
        context: collation_key(item.msgctxt.as_deref().unwrap_or("")),
        raw_message: item.msgid.clone(),
        raw_context: item.msgctxt.clone(),
        obsolete: item.obsolete,
    }
}

fn parse_fcl_as_po(content: &str, source_locale: &str, locale: &str) -> PalamedesResult<PoFile> {
    let mut lines = content.lines().enumerate();
    let (_, header) = lines.next().ok_or_else(|| {
        ferrocat::ApiError::InvalidArguments(
            "FCL catalog must start with the `%FCL1` header".to_owned(),
        )
    })?;
    let mut fields = header.split('\t');
    if fields.next() != Some("%FCL1") {
        return Err(ferrocat::ApiError::InvalidArguments(
            "FCL catalog must start with the `%FCL1` header".to_owned(),
        )
        .into());
    }
    let mut declared_source = None;
    let mut declared_locale = None;
    let mut declared_order = false;
    let mut order = FclOrder::LegacyBytewise;
    for tag in fields {
        let (key, raw_value) = tag.split_once('=').ok_or_else(|| {
            ferrocat::ApiError::InvalidArguments(format!("invalid FCL header tag {tag:?}"))
        })?;
        let value = unescape_fcl(raw_value)?;
        match key {
            "source" => declared_source = Some(value),
            "locale" => declared_locale = Some(value),
            "order" if declared_order => {
                return Err(ferrocat::ApiError::InvalidArguments(
                    "duplicate FCL header key `order`".to_owned(),
                )
                .into());
            }
            "order" if value == "collated" => {
                declared_order = true;
                order = FclOrder::Collated;
            }
            "order" => {
                return Err(ferrocat::ApiError::InvalidArguments(format!(
                    "unknown FCL order {value:?}"
                ))
                .into());
            }
            _ => {
                return Err(ferrocat::ApiError::InvalidArguments(format!(
                    "unknown FCL header key {key:?}"
                ))
                .into());
            }
        }
    }
    if declared_source
        .as_deref()
        .is_some_and(|value| value != source_locale)
    {
        return Err(ferrocat::ApiError::InvalidArguments(format!(
            "FCL source {:?} did not match requested source_locale {source_locale:?}",
            declared_source.as_deref().unwrap_or_default()
        ))
        .into());
    }
    if declared_locale
        .as_deref()
        .is_some_and(|value| value != locale)
    {
        return Err(ferrocat::ApiError::InvalidArguments(format!(
            "FCL locale {:?} did not match requested locale {locale:?}",
            declared_locale.as_deref().unwrap_or_default()
        ))
        .into());
    }
    let mut po = PoFile {
        headers: vec![Header {
            key: "Language".to_owned(),
            value: locale.to_owned(),
        }],
        ..PoFile::default()
    };
    let mut previous_collated_key: Option<FclCollatedKey> = None;
    for (line_index, line) in lines {
        if line.is_empty() {
            continue;
        }
        if line.starts_with("<<<<<<<") || line.starts_with("=======") || line.starts_with(">>>>>>>")
        {
            return Err(ferrocat::ApiError::InvalidArguments(format!(
                "git conflict marker in FCL catalog on line {}",
                line_index + 1
            ))
            .into());
        }
        let item = parse_fcl_item(line).map_err(|error| {
            ferrocat::ApiError::InvalidArguments(format!(
                "invalid FCL entry on line {}: {error}",
                line_index + 1
            ))
        })?;
        if let Some(previous) = po.items.last() {
            let identity_order = (item.msgid.as_str(), item.msgctxt.as_deref())
                .cmp(&(previous.msgid.as_str(), previous.msgctxt.as_deref()));
            if identity_order.is_eq() {
                return Err(ferrocat::ApiError::Conflict(format!(
                    "duplicate FCL entry for id {:?} and context {:?}",
                    item.msgid, item.msgctxt
                ))
                .into());
            }
            if order == FclOrder::LegacyBytewise && identity_order.is_lt() {
                return Err(ferrocat::ApiError::InvalidArguments(format!(
                    "FCL entries must be sorted by (id, ctxt); line {} is out of order",
                    line_index + 1
                ))
                .into());
            }
        }
        if order == FclOrder::Collated {
            let key = fcl_collated_key(&item);
            if previous_collated_key
                .as_ref()
                .is_some_and(|previous| key < *previous)
            {
                return Err(ferrocat::ApiError::InvalidArguments(format!(
                    "FCL entries must follow the declared collated order; line {} is out of order",
                    line_index + 1
                ))
                .into());
            }
            previous_collated_key = Some(key);
        }
        po.items.push(item);
    }
    Ok(po)
}

fn parse_fcl_item(line: &str) -> Result<PoItem, ferrocat::ApiError> {
    let mut fields = line.split('\t');
    let msgid = unescape_fcl(fields.next().ok_or_else(|| {
        ferrocat::ApiError::InvalidArguments("FCL entry is missing the id field".to_owned())
    })?)?;
    let context = unescape_fcl(fields.next().ok_or_else(|| {
        ferrocat::ApiError::InvalidArguments("FCL entry is missing the ctxt field".to_owned())
    })?)?;
    let target = unescape_fcl(fields.next().ok_or_else(|| {
        ferrocat::ApiError::InvalidArguments("FCL entry is missing the target field".to_owned())
    })?)?;
    let mut item = PoItem {
        msgid,
        msgctxt: (!context.is_empty()).then_some(context),
        msgstr: MsgStr::Singular(target),
        ..PoItem::default()
    };
    let mut last_rank = 0_u8;
    let mut obsolete = false;
    let mut lock = false;
    let mut ai = false;
    for tag in fields {
        if tag == "o" {
            validate_fcl_tag_order(&mut last_rank, 4, "o")?;
            if std::mem::replace(&mut obsolete, true) {
                return Err(ferrocat::ApiError::InvalidArguments(
                    "duplicate FCL tag `o`".to_owned(),
                ));
            }
            item.obsolete = true;
            continue;
        }
        let (key, raw_value) = tag.split_once('=').ok_or_else(|| {
            ferrocat::ApiError::InvalidArguments(format!("invalid FCL tag {tag:?}"))
        })?;
        let value = unescape_fcl(raw_value)?;
        let rank = match key {
            "r" => 0,
            "c" => 1,
            "tc" => 2,
            "f" => 3,
            "o" => 4,
            "lock" => 5,
            "ai" => 6,
            _ => {
                return Err(ferrocat::ApiError::InvalidArguments(format!(
                    "unknown FCL tag key {key:?}"
                )));
            }
        };
        validate_fcl_tag_order(&mut last_rank, rank, key)?;
        match key {
            "r" => item.references.push(value),
            "c" => item.extracted_comments.push(value),
            "tc" => item.comments.push(value),
            "f" => item.flags.push(value),
            "o" => {
                if std::mem::replace(&mut obsolete, true) {
                    return Err(ferrocat::ApiError::InvalidArguments(
                        "duplicate FCL tag `o`".to_owned(),
                    ));
                }
                item.obsolete = true;
                item.metadata.push(("obsolete-since".to_owned(), value));
            }
            "lock" => {
                if std::mem::replace(&mut lock, true) {
                    return Err(ferrocat::ApiError::InvalidArguments(
                        "duplicate FCL tag `lock`".to_owned(),
                    ));
                }
                item.metadata.push(("lock".to_owned(), value));
            }
            "ai" => {
                if std::mem::replace(&mut ai, true) {
                    return Err(ferrocat::ApiError::InvalidArguments(
                        "duplicate FCL tag `ai`".to_owned(),
                    ));
                }
                item.metadata.push(("ai".to_owned(), value));
            }
            _ => unreachable!("known FCL tag"),
        }
    }
    Ok(item)
}

fn validate_fcl_tag_order(
    last_rank: &mut u8,
    rank: u8,
    key: &str,
) -> Result<(), ferrocat::ApiError> {
    if rank < *last_rank {
        return Err(ferrocat::ApiError::InvalidArguments(format!(
            "FCL tag `{key}` is out of canonical order"
        )));
    }
    *last_rank = rank;
    Ok(())
}

fn unescape_fcl(value: &str) -> Result<String, ferrocat::ApiError> {
    let mut output = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(character) = chars.next() {
        if character != '\\' {
            output.push(character);
            continue;
        }
        match chars.next() {
            Some('\\') => output.push('\\'),
            Some('t') => output.push('\t'),
            Some('n') => output.push('\n'),
            Some(other) => {
                return Err(ferrocat::ApiError::InvalidArguments(format!(
                    "invalid FCL escape `\\{other}`"
                )));
            }
            None => {
                return Err(ferrocat::ApiError::InvalidArguments(
                    "dangling `\\` at end of FCL value".to_owned(),
                ));
            }
        }
    }
    Ok(output)
}

fn parse_machine_metadata(item: &PoItem) -> PalamedesResult<Option<MachineMetadata>> {
    let mut lock = None;
    let mut ai = None;
    for (key, value) in &item.metadata {
        if key == "lock" {
            if lock.replace(value).is_some() {
                return Err(ferrocat::ApiError::InvalidArguments(
                    "duplicate `lock` metadata for PO item".to_owned(),
                )
                .into());
            }
        } else if key == "ai" && ai.replace(value).is_some() {
            return Err(ferrocat::ApiError::InvalidArguments(
                "duplicate `ai` metadata for PO item".to_owned(),
            )
            .into());
        }
    }
    let Some(lock) = lock else {
        if ai.is_some() {
            return Err(ferrocat::ApiError::InvalidArguments(
                "PO `ai` metadata requires a `lock`".to_owned(),
            )
            .into());
        }
        return Ok(None);
    };
    if lock.trim().is_empty() {
        return Err(ferrocat::ApiError::InvalidArguments(
            "machine-managed lock must not be empty".to_owned(),
        )
        .into());
    }
    let ai = ai.map(|descriptor| {
        let (model, confidence) = descriptor
            .rsplit_once(':')
            .and_then(|(model, suffix)| {
                suffix
                    .parse::<f32>()
                    .ok()
                    .filter(|value| (0.0..=1.0).contains(value))
                    .map(|confidence| (model, Some(confidence)))
            })
            .unwrap_or((descriptor.as_str(), None));
        AiProvenance {
            model: model.to_owned(),
            confidence,
        }
    });
    if ai.as_ref().is_some_and(|ai| ai.model.trim().is_empty()) {
        return Err(
            ferrocat::ApiError::InvalidArguments("ai model must not be empty".to_owned()).into(),
        );
    }
    Ok(Some(MachineMetadata {
        lock: lock.clone(),
        ai,
    }))
}

fn parse_workflow_origin(reference: &str) -> TranslationWorkflowOrigin {
    let (file, scope) = match reference.rsplit_once('#') {
        Some((file, scope)) if !scope.is_empty() => (file, Some(scope)),
        _ => (reference, None),
    };
    let file = match file.rsplit_once(':') {
        Some((trimmed, line))
            if !line.is_empty() && line.bytes().all(|byte| byte.is_ascii_digit()) =>
        {
            trimmed
        }
        _ => file,
    };
    TranslationWorkflowOrigin {
        file: file.to_owned(),
        scope: scope.map(str::to_owned),
    }
}

fn build_candidate(
    loaded: &LoadedCatalog,
    key: &CatalogMessageKey,
    item: &PoItem,
    max_origins: usize,
) -> PalamedesResult<TranslationCandidate> {
    let raw = find_po_item(&loaded.po, &loaded.po_item_indexes, key);
    let source = project_source(&item.msgid);
    let translation = project_po_translation(item, &source);
    let review = TranslationReviewState {
        translated: value_is_translated(&translation),
        fuzzy: raw.is_some_and(|item| item.flags.iter().any(|flag| flag == "fuzzy")),
        obsolete: item.obsolete,
    };
    let comments = raw.map_or_else(Vec::new, |item| {
        item.extracted_comments.iter().cloned().collect()
    });
    let mut all_origins = item
        .references
        .iter()
        .map(|origin| parse_workflow_origin(origin))
        .collect::<Vec<_>>();
    all_origins.sort();
    all_origins.dedup();
    let id = TranslationCandidateId {
        catalog: loaded.scope.clone(),
        locale: loaded.locale.clone(),
        message: key.msgid.clone(),
        context: key.msgctxt.clone(),
    };
    let mut candidate = TranslationCandidate {
        id,
        target_path: loaded.path.to_string_lossy().into_owned(),
        format: loaded.format,
        source,
        translation,
        comments,
        origins: all_origins.iter().take(max_origins).cloned().collect(),
        review,
        machine: parse_machine_metadata(item)?,
        fingerprint: String::new(),
    };
    candidate.fingerprint = candidate_fingerprint(&candidate, &all_origins);
    Ok(candidate)
}

fn project_source(message: &str) -> TranslationValue {
    project_icu_plural(message).unwrap_or_else(|| TranslationValue::Singular {
        value: message.to_owned(),
    })
}

fn project_po_translation(item: &PoItem, source: &TranslationValue) -> TranslationValue {
    let value = item.msgstr.first().unwrap_or_default();
    if matches!(source, TranslationValue::Plural { .. }) {
        if value.is_empty() {
            return empty_plural_like(source);
        }
        if let Some(projected) = project_icu_plural(value) {
            return projected;
        }
    }
    TranslationValue::Singular {
        value: value.to_owned(),
    }
}

fn project_icu_plural(value: &str) -> Option<TranslationValue> {
    let parsed = parse_runtime_icu(value).ok()?;
    let [
        IcuNode::Plural {
            name,
            kind,
            offset,
            options,
        },
    ] = parsed.nodes.as_slice()
    else {
        return None;
    };
    let values = options
        .iter()
        .map(|option| {
            (
                option.selector.clone(),
                stringify_icu(&IcuMessage {
                    nodes: option.value.clone(),
                }),
            )
        })
        .collect();
    Some(TranslationValue::Plural {
        variable: name.clone(),
        plural_kind: match kind {
            IcuPluralKind::Cardinal => TranslationPluralKind::Cardinal,
            IcuPluralKind::Ordinal => TranslationPluralKind::Ordinal,
        },
        offset: *offset,
        values,
    })
}

fn empty_plural_like(source: &TranslationValue) -> TranslationValue {
    match source {
        TranslationValue::Plural {
            variable,
            plural_kind,
            offset,
            values,
        } => TranslationValue::Plural {
            variable: variable.clone(),
            plural_kind: *plural_kind,
            offset: *offset,
            values: values
                .keys()
                .map(|key| (key.clone(), String::new()))
                .collect(),
        },
        TranslationValue::Singular { .. } => TranslationValue::Singular {
            value: String::new(),
        },
    }
}

fn po_item_is_translated(item: &PoItem) -> bool {
    item.msgstr.first().is_some_and(|value| !value.is_empty())
}

fn value_is_translated(value: &TranslationValue) -> bool {
    match value {
        TranslationValue::Singular { value } => !value.is_empty(),
        TranslationValue::Plural { values, .. } => {
            !values.is_empty() && values.values().all(|value| !value.is_empty())
        }
    }
}

fn candidate_fingerprint(
    candidate: &TranslationCandidate,
    all_origins: &[TranslationWorkflowOrigin],
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(CANDIDATE_FINGERPRINT_NAMESPACE);
    hash_json(&mut hasher, &candidate.id);
    hash_json(&mut hasher, &candidate.source);
    hash_json(&mut hasher, &candidate.translation);
    hash_json(&mut hasher, &candidate.comments);
    hash_json(&mut hasher, all_origins);
    hash_json(&mut hasher, &candidate.review);
    hash_json(&mut hasher, &candidate.machine);
    let digest = hasher.finalize();
    digest[..16]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn hash_json<T: Serialize + ?Sized>(hasher: &mut Sha256, value: &T) {
    let bytes = serde_json::to_vec(value).expect("translation fingerprint payload is serializable");
    hasher.update((bytes.len() as u64).to_be_bytes());
    hasher.update(bytes);
}

fn validate_patch_translation(translation: &TranslationValue) -> Result<(), &'static str> {
    match translation {
        TranslationValue::Singular { value } if value.is_empty() => {
            Err("Completed singular translations must not be empty.")
        }
        TranslationValue::Plural { values, .. }
            if values.is_empty() || values.values().any(String::is_empty) =>
        {
            Err("Completed plural translation branches must not be empty.")
        }
        _ => Ok(()),
    }
}

fn validate_translation_icu(value: &TranslationValue) -> Vec<String> {
    match value {
        TranslationValue::Singular { value } => parse_runtime_icu(value)
            .err()
            .map(|source| vec![format!("Singular translation is not valid ICU: {source}")])
            .unwrap_or_default(),
        TranslationValue::Plural {
            variable,
            plural_kind,
            values,
            ..
        } => values
            .iter()
            .filter_map(|(selector, branch)| {
                parse_plural_branch(variable, *plural_kind, branch)
                    .err()
                    .map(|source| {
                        format!(
                            "Plural translation branch `translation.values.{selector}` is not valid ICU: {source}"
                        )
                    })
            })
            .collect(),
    }
}

fn validate_machine_provenance(machine: &TranslationMachineProvenance) -> Result<(), &'static str> {
    if let Some(ai) = &machine.ai {
        if ai.model.trim().is_empty() {
            return Err("AI model must not be empty.");
        }
        if ai
            .confidence
            .is_some_and(|confidence| !(0.0..=1.0).contains(&confidence))
        {
            return Err("AI confidence must be between 0 and 1.");
        }
    }
    Ok(())
}

fn patch_changes_candidate(
    candidate: &TranslationCandidate,
    patch: &TranslationPatch,
) -> PalamedesResult<bool> {
    if candidate.translation != patch.translation {
        return Ok(true);
    }
    // Confirming a fuzzy entry rewrites the catalog even when the patch repeats
    // the value already stored there.
    if patch.machine.is_none() && candidate.review.fuzzy {
        return Ok(true);
    }
    let expected_machine = match &patch.machine {
        Some(machine) => {
            let rendered = render_translation_value(&patch.translation)?;
            Some(MachineMetadata {
                lock: machine_translation_hash(EffectiveTranslationRef::Singular(&rendered)),
                ai: machine.ai.clone(),
            })
        }
        None => None,
    };
    Ok(candidate.machine != expected_machine)
}

fn apply_patch_to_po(
    po: &mut PoFile,
    po_item_indexes: &HashMap<CatalogMessageKey, PoItemIndexes>,
    patch: &TranslationPatch,
) -> PalamedesResult<()> {
    let key = CatalogMessageKey::new(patch.id.message.clone(), patch.id.context.clone());
    let Some(indexes) = po_item_indexes.get(&key).filter(|indexes| indexes.unique) else {
        return Err(ferrocat::ApiError::Conflict(format!(
            "catalog mutation identity {:?} with context {:?} is missing or ambiguous",
            patch.id.message, patch.id.context
        ))
        .into());
    };
    let item = &mut po.items[indexes.first];
    let rendered = render_translation_value(&patch.translation)?;
    item.msgstr = MsgStr::Singular(rendered.clone());
    item.msgid_plural = None;
    /*
     * A patch without machine provenance is an authored completion, which is
     * what `fuzzy` asks for — gettext clears the marker at exactly that point,
     * and leaving it set kept the entry incomplete in coverage with no API able
     * to finish it. Machine patches keep whatever review state they had: they
     * record provenance in `lock`/`ai` and are the case review exists for. All
     * other flags survive either way.
     */
    if patch.machine.is_none() {
        item.flags = std::mem::take(&mut item.flags)
            .into_iter()
            .filter(|flag| flag != "fuzzy")
            .collect();
    }
    item.metadata = std::mem::take(&mut item.metadata)
        .into_iter()
        .filter(|(key, _)| key != "lock" && key != "ai")
        .collect();
    if let Some(machine) = &patch.machine {
        let lock = machine_translation_hash(EffectiveTranslationRef::Singular(&rendered));
        item.metadata.push(("lock".to_owned(), lock));
        if let Some(ai) = &machine.ai {
            let descriptor = match ai.confidence {
                Some(confidence) => format!("{}:{confidence}", ai.model),
                None => ai.model.clone(),
            };
            item.metadata.push(("ai".to_owned(), descriptor));
        }
    }
    Ok(())
}

pub(crate) fn render_translation_value(value: &TranslationValue) -> PalamedesResult<String> {
    match value {
        TranslationValue::Singular { value } => Ok(value.clone()),
        TranslationValue::Plural {
            variable,
            plural_kind,
            offset,
            values,
        } => {
            let options = values
                .iter()
                .map(|(selector, value)| {
                    let value = parse_plural_branch(variable, *plural_kind, value)?;
                    Ok(IcuOption {
                        selector: selector.clone(),
                        value,
                    })
                })
                .collect::<Result<Vec<_>, ferrocat_icu::IcuParseError>>()?;
            Ok(stringify_icu(&IcuMessage {
                nodes: vec![IcuNode::Plural {
                    name: variable.clone(),
                    kind: match plural_kind {
                        TranslationPluralKind::Cardinal => IcuPluralKind::Cardinal,
                        TranslationPluralKind::Ordinal => IcuPluralKind::Ordinal,
                    },
                    offset: *offset,
                    options,
                }],
            }))
        }
    }
}

fn parse_plural_branch(
    variable: &str,
    plural_kind: TranslationPluralKind,
    value: &str,
) -> Result<Vec<IcuNode>, ferrocat_icu::IcuParseError> {
    let formatter = match plural_kind {
        TranslationPluralKind::Cardinal => "plural",
        TranslationPluralKind::Ordinal => "selectordinal",
    };
    let wrapped = format!("{{{variable}, {formatter}, other {{{value}}}}}");
    let parsed = parse_runtime_icu(&wrapped)?;
    let [IcuNode::Plural { options, .. }] = parsed.nodes.as_slice() else {
        unreachable!("the generated plural wrapper always parses to one plural node");
    };
    /*
     * A value such as `# Datei} one {# Dateien` closes the wrapper's own branch
     * and opens another one, which is valid ICU. Keeping the first option would
     * accept the value and then write it truncated; a branch that describes
     * more than its own branch is a rejection.
     */
    let [option] = options.as_slice() else {
        return Err(ferrocat_icu::IcuParseError::syntax(
            "a plural branch value must not open another plural branch",
            value,
            0,
        ));
    };
    Ok(option.value.clone())
}

fn render_target_catalog(
    po_content: &str,
    source_locale: &str,
    locale: &str,
    format: PalamedesCatalogFormat,
    po_options: Option<&PoOutputOptions>,
) -> PalamedesResult<String> {
    let target_mode = format.ferrocat_mode();
    Ok(convert_catalog(
        ConvertCatalogOptions::new(po_content, source_locale, CatalogMode::IcuPo, target_mode)
            .with_locale(locale)
            .with_po_serialize_options(po_serialize_options(po_options)),
    )?
    .content)
}

fn atomic_replace_catalog(
    catalog: &PreparedCatalog,
    _source_locale: &str,
    _po: Option<&PoOutputOptions>,
) -> PalamedesResult<CatalogReplacement> {
    atomic_replace_catalog_with_directory_sync(catalog, ContainedDir::sync_directory)
}

fn atomic_replace_catalog_with_directory_sync<F>(
    catalog: &PreparedCatalog,
    sync_directory: F,
) -> PalamedesResult<CatalogReplacement>
where
    F: FnOnce(&ContainedDir) -> std::io::Result<()>,
{
    // `PreparedCatalog::content` has already been rendered into its target format. Commit the
    // replacement directly through the verified `ContainedDir` handle captured during load so
    // ancestor path swaps between preparation and commit cannot redirect the write outside the
    // configured root. Metadata and ACLs are restored before the temporary file is synced and
    // renamed; a later directory-sync failure returns an explicit durability warning because the
    // rename is already visibly committed.
    let write_result = if let Some(expected_original) = catalog.expected_original.as_deref() {
        catalog.parent_dir.write_file_atomically_if_unchanged(
            &catalog.file_name,
            catalog.content.as_bytes(),
            Some(expected_original.as_bytes()),
            ContainedNewFileMode::Private,
            ContainedWriteDurability::FileOnly,
        )
    } else {
        catalog.parent_dir.write_file_atomically(
            &catalog.file_name,
            catalog.content.as_bytes(),
            ContainedNewFileMode::Private,
            ContainedWriteDurability::FileOnly,
        )
    };
    write_result.map_err(|error| match error {
        ContainedFsError::Containment(reason) => PalamedesError::UnsafeCatalogPath {
            path: catalog.path.to_string_lossy().into_owned(),
            reason,
        },
        ContainedFsError::Io(source) => PalamedesError::WriteFile {
            path: catalog.path.clone(),
            source,
        },
    })?;
    Ok(match sync_directory(&catalog.parent_dir) {
        Ok(()) => CatalogReplacement::Durable,
        Err(source) => CatalogReplacement::CommittedWithDurabilityWarning(source),
    })
}

fn po_item_indexes(po: &PoFile) -> HashMap<CatalogMessageKey, PoItemIndexes> {
    let mut indexes = HashMap::with_capacity(po.items.len());
    for (index, item) in po.items.iter().enumerate() {
        let key = CatalogMessageKey::new(item.msgid.clone(), item.msgctxt.clone());
        indexes
            .entry(key)
            .and_modify(|indexes: &mut PoItemIndexes| indexes.unique = false)
            .or_insert(PoItemIndexes {
                first: index,
                unique: true,
            });
    }
    indexes
}

fn find_po_item<'a>(
    po: &'a PoFile,
    po_item_indexes: &HashMap<CatalogMessageKey, PoItemIndexes>,
    key: &CatalogMessageKey,
) -> Option<&'a PoItem> {
    po_item_indexes
        .get(key)
        .map(|indexes| &po.items[indexes.first])
}

fn completed_translation_patch_result(
    patches: &[TranslationPatch],
    changed_patches: &BTreeSet<usize>,
    completed_patches: &BTreeSet<usize>,
    catalogs_updated: usize,
    mut diagnostics: Vec<TranslationWorkflowDiagnostic>,
) -> TranslationPatchResult {
    diagnostics.sort_by(|left, right| diagnostic_sort_key(left).cmp(&diagnostic_sort_key(right)));
    let applied = changed_patches
        .iter()
        .filter(|index| completed_patches.contains(index))
        .count();
    let unchanged = completed_patches.len() - applied;
    let outcomes = patches
        .iter()
        .enumerate()
        .map(|(index, patch)| TranslationPatchOutcome {
            id: patch.id.clone(),
            status: if !completed_patches.contains(&index) {
                TranslationPatchOutcomeStatus::NotApplied
            } else if changed_patches.contains(&index) {
                TranslationPatchOutcomeStatus::Applied
            } else {
                TranslationPatchOutcomeStatus::Unchanged
            },
        })
        .collect();

    TranslationPatchResult {
        updated: catalogs_updated > 0,
        stats: TranslationPatchStats {
            requested: patches.len(),
            applied,
            unchanged,
            catalogs_updated,
        },
        outcomes,
        diagnostics,
    }
}

fn rejected_translation_patch_result(
    patches: Vec<TranslationPatch>,
    requested_count: usize,
    rejected: &BTreeSet<usize>,
    mut diagnostics: Vec<TranslationWorkflowDiagnostic>,
) -> TranslationPatchResult {
    diagnostics.sort_by(|left, right| diagnostic_sort_key(left).cmp(&diagnostic_sort_key(right)));
    let outcomes = patches
        .into_iter()
        .enumerate()
        .map(|(index, patch)| TranslationPatchOutcome {
            id: patch.id,
            status: if rejected.contains(&index) {
                TranslationPatchOutcomeStatus::Rejected
            } else {
                TranslationPatchOutcomeStatus::NotApplied
            },
        })
        .collect();
    TranslationPatchResult {
        updated: false,
        stats: TranslationPatchStats {
            requested: requested_count,
            ..TranslationPatchStats::default()
        },
        outcomes,
        diagnostics,
    }
}

fn workflow_diagnostic(
    code: &str,
    message: impl Into<String>,
    id: Option<TranslationCandidateId>,
) -> TranslationWorkflowDiagnostic {
    TranslationWorkflowDiagnostic {
        code: code.to_owned(),
        message: message.into(),
        id,
        catalog_path: None,
        locale: None,
    }
}

fn source_locale_diagnostic(id: TranslationCandidateId) -> TranslationWorkflowDiagnostic {
    let locale = id.locale.clone();
    TranslationWorkflowDiagnostic {
        code: "translation.source_locale".to_owned(),
        message: format!(
            "Locale `{locale}` is the configured source locale and cannot be selected or patched. Select a configured target locale instead."
        ),
        id: Some(id),
        catalog_path: None,
        locale: Some(locale),
    }
}

fn missing_catalog_diagnostic(locale: &str, path: PathBuf) -> TranslationWorkflowDiagnostic {
    let catalog_path = path.to_string_lossy().into_owned();
    TranslationWorkflowDiagnostic {
        code: "translation.missing_catalog".to_owned(),
        message: format!(
            "Translation catalog for locale `{locale}` is missing at `{catalog_path}`. Run `pmds extract` to create it before requesting this locale explicitly."
        ),
        id: None,
        catalog_path: Some(catalog_path),
        locale: Some(locale.to_owned()),
    }
}

fn diagnostic_sort_key(
    diagnostic: &TranslationWorkflowDiagnostic,
) -> (
    &str,
    Option<&str>,
    Option<&str>,
    Option<&TranslationCandidateId>,
) {
    (
        &diagnostic.code,
        diagnostic.catalog_path.as_deref(),
        diagnostic.locale.as_deref(),
        diagnostic.id.as_ref(),
    )
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use ferrocat::{
        CatalogMessageKey, CatalogMode, ConvertCatalogOptions, EffectiveTranslationRef,
        ParseCatalogOptions, convert_catalog, machine_translation_hash, parse_catalog, parse_po,
    };

    use super::{
        PreparedCatalog, TranslationCandidate, TranslationCandidateId, TranslationCandidateRequest,
        TranslationMachineProvenance, TranslationPatch, TranslationPatchOutcomeStatus,
        TranslationPatchRequest, TranslationPluralKind, TranslationValue,
        apply_translation_patches, apply_translation_patches_with_replacement,
        atomic_replace_catalog, atomic_replace_catalog_with_directory_sync, build_candidate,
        find_po_item, list_translation_candidates, load_catalog, parse_catalog_as_po,
        po_item_indexes, reset_source_catalog_parse_count, source_catalog_parse_count,
    };
    use crate::{CatalogArtifactConfig, CatalogConfig, PalamedesCatalogFormat, PalamedesError};

    const FIXTURE: &str = include_str!("../fixtures/translation-workflow.de.po");

    #[test]
    fn loads_po_and_fcl_once_with_equivalent_candidate_projection() {
        let fixture = tempfile::tempdir().expect("fixture directory");
        write_po_fixture(&fixture.path().join("messages/de.po"), "de");
        write_fcl_fixture(&fixture.path().join("features/de.fcl"), "de");
        let po_catalog = CatalogConfig {
            path: "messages/{locale}".to_owned(),
            format: PalamedesCatalogFormat::Po,
        };
        let fcl_catalog = CatalogConfig {
            path: "features/{locale}".to_owned(),
            format: PalamedesCatalogFormat::Fcl,
        };

        reset_source_catalog_parse_count();
        let po = load_catalog(&po_config(fixture.path()), &po_catalog, "de").expect("load PO once");
        assert_eq!(source_catalog_parse_count(), 1);
        reset_source_catalog_parse_count();
        let fcl =
            load_catalog(&fcl_config(fixture.path()), &fcl_catalog, "de").expect("load FCL once");
        assert_eq!(source_catalog_parse_count(), 1);
        assert_eq!(
            po.messages.keys().collect::<Vec<_>>(),
            fcl.messages.keys().collect::<Vec<_>>()
        );

        for key in po.messages.keys() {
            let po_candidate =
                build_candidate(&po, key, &po.po.items[po.messages[key]], usize::MAX)
                    .expect("project PO candidate");
            let fcl_candidate =
                build_candidate(&fcl, key, &fcl.po.items[fcl.messages[key]], usize::MAX)
                    .expect("project FCL candidate");
            assert_eq!(po_candidate.source, fcl_candidate.source);
            assert_eq!(po_candidate.translation, fcl_candidate.translation);
            assert_eq!(po_candidate.comments, fcl_candidate.comments);
            assert_eq!(po_candidate.origins, fcl_candidate.origins);
            assert_eq!(po_candidate.review, fcl_candidate.review);
            assert_eq!(po_candidate.machine, fcl_candidate.machine);
        }
    }

    #[test]
    fn single_pass_fcl_decoder_rejects_locale_source_and_order_contract_violations() {
        let cases = [
            (
                "%FCL1\tsource=en\tlocale=fr\torder=collated\nAlpha\t\tA\n",
                "en",
                "de",
                "declared target locale",
                false,
            ),
            (
                "%FCL1\tsource=en\tlocale=de\torder=collated\nAlpha\t\tA\n",
                " \n\t ",
                "de",
                "empty source locale",
                true,
            ),
            (
                "%FCL1\tsource=en\tlocale=de\nZulu\t\tZ\nAlpha\t\tA\n",
                "en",
                "de",
                "legacy bytewise order",
                true,
            ),
            (
                "%FCL1\tsource=en\tlocale=de\torder=collated\n<0>Continue</0>\t\tmarkup\n{count, plural, one {#} other {#}}\t\tplaceholder\n",
                "en",
                "de",
                "declared collated order",
                true,
            ),
            (
                "%FCL1\tsource=en\tlocale=de\torder=collated\nAlpha\t\tA\nAlpha\t\tB\n",
                "en",
                "de",
                "duplicate identity",
                true,
            ),
        ];

        for (content, source_locale, locale, contract, ferrocat_rejects) in cases {
            reset_source_catalog_parse_count();
            assert!(
                parse_catalog_as_po(content, source_locale, locale, PalamedesCatalogFormat::Fcl,)
                    .is_err(),
                "single-pass decoder accepted invalid {contract}"
            );
            assert_eq!(
                source_catalog_parse_count(),
                1,
                "rejecting {contract} must not add a second parse"
            );
            if ferrocat_rejects {
                assert!(
                    parse_catalog(
                        ParseCatalogOptions::new(content, source_locale)
                            .with_locale(locale)
                            .with_mode(CatalogMode::IcuFcl),
                    )
                    .is_err(),
                    "Ferrocat accepted invalid {contract}"
                );
            }
        }

        reset_source_catalog_parse_count();
        assert!(
            parse_catalog_as_po(
                "msgid \"Alpha\"\nmsgstr \"A\"\n",
                " \t ",
                "de",
                PalamedesCatalogFormat::Po,
            )
            .is_err(),
            "PO and FCL must share the empty source-locale contract"
        );
        assert_eq!(source_catalog_parse_count(), 1);
    }

    #[test]
    fn candidate_listing_rejects_invalid_fcl_before_exposing_messages() {
        let fixture = tempfile::tempdir().expect("fixture directory");
        let path = fixture.path().join("features/de.fcl");
        fs::create_dir_all(path.parent().expect("catalog parent")).expect("create catalog parent");
        let cases = [
            (
                "%FCL1\tsource=en\tlocale=fr\torder=collated\nAlpha\t\tA\n",
                "en",
            ),
            (
                "%FCL1\tsource=en\tlocale=de\torder=collated\nAlpha\t\tA\n",
                " \t ",
            ),
            ("%FCL1\tsource=en\tlocale=de\nZulu\t\tZ\nAlpha\t\tA\n", "en"),
        ];

        for (content, source_locale) in cases {
            fs::write(&path, content).expect("write invalid FCL fixture");
            let mut config = fcl_config(fixture.path());
            config.source_locale = source_locale.to_owned();
            let result = list_translation_candidates(&TranslationCandidateRequest {
                config,
                locales: vec!["de".to_owned()],
                targets: Vec::new(),
                max_origins: 8,
            });
            assert!(result.is_err(), "candidate listing accepted {content:?}");
        }
    }

    #[test]
    fn fcl_order_validation_preserves_unicode_and_raw_identity_ties() {
        // Fixed behavioral order: punctuation and digits, case, context accents,
        // NFC/NFD raw ties, typographic characters, and uncovered-script fallback.
        // This fixture survives removing the old private key/table mirror.
        let entries = [
            ("“Quoted”", ""),
            ("{count, plural, one {#} other {#}}", ""),
            ("<0>Continue</0>", ""),
            ("10", ""),
            ("2", ""),
            ("alpha", ""),
            ("Alpha", "aá"),
            ("Alpha", "aà"),
            ("Alpha", "áa"),
            ("Alpha", "àa"),
            ("cafe", ""),
            ("cafe\u{0301}", ""),
            ("café", ""),
            ("Em — dash", ""),
            ("Zebra", ""),
            ("ω", ""),
            ("Ω", ""),
            ("日本語", ""),
        ];
        let lines = entries
            .iter()
            .map(|(message, context)| format!("{message}\t{context}\ttranslated"))
            .collect::<Vec<_>>();
        let content = format!(
            "%FCL1\tsource=en\tlocale=de\torder=collated\n{}\n",
            lines.join("\n")
        );
        let decoded = parse_catalog_as_po(&content, "en", "de", PalamedesCatalogFormat::Fcl)
            .expect("decode fixed Unicode order");
        assert_eq!(
            decoded
                .items
                .iter()
                .map(|item| (item.msgid.as_str(), item.msgctxt.as_deref().unwrap_or("")))
                .collect::<Vec<_>>(),
            entries,
        );

        for first in 0..lines.len() - 1 {
            let mut swapped = lines.clone();
            swapped.swap(first, first + 1);
            let invalid = format!(
                "%FCL1\tsource=en\tlocale=de\torder=collated\n{}\n",
                swapped.join("\n")
            );
            assert!(
                parse_catalog_as_po(&invalid, "en", "de", PalamedesCatalogFormat::Fcl).is_err(),
                "decoder accepted swapped entries {first}/{}",
                first + 1
            );
        }

        // Canonically equivalent spellings above remain distinct identities;
        // an exact raw duplicate must still be rejected.
        let duplicate =
            "%FCL1\tsource=en\tlocale=de\torder=collated\ncafé\t\tfirst\ncafé\t\tsecond\n";
        assert!(parse_catalog_as_po(duplicate, "en", "de", PalamedesCatalogFormat::Fcl).is_err());
    }

    #[test]
    fn indexes_large_po_catalogs_once_for_constant_time_candidate_lookups() {
        let content = (0..10_000)
            .map(|index| format!("msgid \"message-{index}\"\nmsgstr \"\"\n\n"))
            .collect::<String>();
        let po = parse_po(&content).expect("parse large PO catalog");
        let indexes = po_item_indexes(&po);

        // The catalog makes one O(N) index build; each candidate lookup below is keyed, rather
        // than repeating an item scan. Check several positions, including the old linear worst
        // case, so a regression cannot silently replace the index with a partial map.
        assert_eq!(indexes.len(), 10_000);
        for index in [0, 4_999, 9_999] {
            let key = CatalogMessageKey::new(format!("message-{index}"), None);
            assert_eq!(
                find_po_item(&po, &indexes, &key).map(|item| item.msgid.as_str()),
                Some(key.msgid.as_str())
            );
        }
    }

    #[test]
    fn po_item_index_keeps_first_candidate_metadata_and_marks_duplicate_mutations_ambiguous() {
        let po = parse_po(
            "#. First metadata\nmsgctxt \"menu\"\nmsgid \"Open\"\nmsgstr \"\"\n\n#. Second metadata\nmsgctxt \"menu\"\nmsgid \"Open\"\nmsgstr \"\"\n",
        )
        .expect("parse duplicate contextual items");
        let indexes = po_item_indexes(&po);
        let key = CatalogMessageKey::with_context("Open", "menu");
        let indexed = indexes.get(&key).expect("index duplicate identity");

        assert_eq!(indexed.first, 0);
        assert!(!indexed.unique);
        assert_eq!(
            find_po_item(&po, &indexes, &key)
                .and_then(|item| item.extracted_comments.first())
                .map(String::as_str),
            Some("First metadata")
        );
    }

    #[test]
    fn duplicate_identity_indexes_build_candidates_from_the_same_first_item() {
        let fixture = tempfile::tempdir().expect("fixture directory");
        let path = fixture.path().join("messages/de.po");
        fs::create_dir_all(path.parent().expect("catalog directory")).expect("catalog directory");
        fs::write(
            &path,
            "#. First metadata\n#: src/first.ts:1\n#, fuzzy\nmsgctxt \"menu\"\nmsgid \"Open\"\nmsgstr \"Erste\"\n\n#. Second metadata\n#: src/second.ts:2\nmsgctxt \"menu\"\nmsgid \"Open\"\nmsgstr \"Zweite\"\n",
        )
        .expect("duplicate catalog");
        let catalog = CatalogConfig {
            path: "messages/{locale}".to_owned(),
            format: PalamedesCatalogFormat::Po,
        };
        let loaded = load_catalog(&po_config(fixture.path()), &catalog, "de")
            .expect("load duplicate catalog");
        let key = CatalogMessageKey::with_context("Open", "menu");

        assert!(loaded.ambiguous_messages.contains(&key));
        assert_eq!(loaded.messages[&key], loaded.po_item_indexes[&key].first);
        assert_eq!(loaded.messages[&key], 0);

        let candidate = build_candidate(
            &loaded,
            &key,
            &loaded.po.items[loaded.messages[&key]],
            usize::MAX,
        )
        .expect("build first duplicate candidate");
        assert_eq!(
            candidate.translation,
            TranslationValue::Singular {
                value: "Erste".to_owned(),
            }
        );
        assert_eq!(candidate.comments, ["First metadata"]);
        assert_eq!(candidate.origins[0].file, "src/first.ts");
        assert!(candidate.review.fuzzy);
    }

    #[test]
    fn enumerates_missing_and_explicit_candidates_across_catalogs_and_locales() {
        let fixture = tempfile::tempdir().expect("fixture directory");
        write_catalog_matrix(fixture.path());
        let result = list_translation_candidates(&TranslationCandidateRequest {
            config: config(fixture.path()),
            locales: Vec::new(),
            targets: Vec::new(),
            max_origins: 1,
        })
        .expect("enumerate missing candidates");

        assert!(result.diagnostics.is_empty());
        assert_eq!(result.candidates.len(), 12);
        assert!(
            result
                .candidates
                .windows(2)
                .all(|pair| pair[0].id <= pair[1].id)
        );
        let plural = result
            .candidates
            .iter()
            .find(|candidate| candidate.id.message.starts_with("{count, plural"))
            .expect("plural candidate");
        assert!(matches!(
            &plural.source,
            TranslationValue::Plural {
                variable,
                plural_kind: TranslationPluralKind::Cardinal,
                offset: 0,
                values,
            } if variable == "count" && values.keys().cloned().collect::<Vec<_>>() == ["one", "other"]
        ));
        assert!(matches!(
            &plural.translation,
            TranslationValue::Plural { values, .. }
                if values.values().all(String::is_empty)
        ));
        let hello = result
            .candidates
            .iter()
            .find(|candidate| {
                candidate.id.catalog == "messages/{locale}"
                    && candidate.id.locale == "de"
                    && candidate.id.message == "Hello"
            })
            .expect("German PO candidate");
        assert_eq!(hello.comments, ["Greeting shown on the home page"]);
        assert_eq!(hello.origins.len(), 1, "origins are bounded by the request");
        assert!(!result.candidates.iter().any(|candidate| {
            candidate.id.message == "Open" && candidate.id.context.as_deref() == Some("adjective")
        }));
        assert!(
            !result
                .candidates
                .iter()
                .any(|candidate| candidate.id.message == "Old")
        );

        let review_id = id("messages/{locale}", "de", "Review me", None);
        let obsolete_id = id("messages/{locale}", "de", "Old", None);
        let machine_id = id("messages/{locale}", "de", "Machine", None);
        let explicit = list_translation_candidates(&TranslationCandidateRequest {
            config: config(fixture.path()),
            locales: vec!["de".to_owned()],
            targets: vec![review_id, obsolete_id, machine_id],
            max_origins: 8,
        })
        .expect("enumerate explicit candidates");
        assert!(explicit.diagnostics.is_empty());
        assert_eq!(explicit.candidates.len(), 3);
        assert!(candidate(&explicit.candidates, "Review me").review.fuzzy);
        assert!(candidate(&explicit.candidates, "Old").review.obsolete);
        let machine = candidate(&explicit.candidates, "Machine")
            .machine
            .as_ref()
            .expect("native machine metadata");
        assert_eq!(
            machine.ai.as_ref().map(|ai| ai.model.as_str()),
            Some("example/model")
        );
    }

    #[test]
    fn excludes_the_source_locale_from_explicit_candidate_requests() {
        let fixture = tempfile::tempdir().expect("fixture directory");
        write_po_fixture(&fixture.path().join("messages/de.po"), "de");

        let explicitly_selected_source =
            list_translation_candidates(&TranslationCandidateRequest {
                config: po_config(fixture.path()),
                locales: vec!["en".to_owned()],
                targets: Vec::new(),
                max_origins: 8,
            })
            .expect("source locale is excluded from explicit selection");
        assert!(explicitly_selected_source.candidates.is_empty());
        assert!(explicitly_selected_source.diagnostics.is_empty());

        let stale_source_target = id("messages/{locale}", "en", "Hello", None);
        let source_target = list_translation_candidates(&TranslationCandidateRequest {
            config: po_config(fixture.path()),
            locales: vec!["en".to_owned()],
            targets: vec![stale_source_target.clone()],
            max_origins: 8,
        })
        .expect("source target is rejected as a diagnostic");
        assert!(source_target.candidates.is_empty());
        assert_eq!(source_target.diagnostics.len(), 1);
        assert_eq!(
            source_target.diagnostics[0].code,
            "translation.source_locale"
        );
        assert_eq!(
            source_target.diagnostics[0].id.as_ref(),
            Some(&stale_source_target)
        );
    }

    #[test]
    fn skips_missing_default_catalogs_with_deterministic_context_but_errors_for_explicit_locales() {
        let fixture = tempfile::tempdir().expect("fixture directory");
        write_po_fixture(&fixture.path().join("messages/de.po"), "de");
        let mut default_config = po_config(fixture.path());
        default_config.locales = vec![
            "en".to_owned(),
            "de".to_owned(),
            "ja".to_owned(),
            "fr".to_owned(),
        ];

        let default_result = list_translation_candidates(&TranslationCandidateRequest {
            config: default_config,
            locales: Vec::new(),
            targets: Vec::new(),
            max_origins: 8,
        })
        .expect("default enumeration skips fresh locale catalogs");
        assert!(
            default_result
                .candidates
                .iter()
                .all(|candidate| candidate.id.locale == "de")
        );
        let missing = default_result
            .diagnostics
            .iter()
            .filter(|diagnostic| diagnostic.code == "translation.missing_catalog")
            .collect::<Vec<_>>();
        assert_eq!(missing.len(), 2);
        assert_eq!(
            missing
                .iter()
                .map(|diagnostic| diagnostic.locale.as_deref())
                .collect::<Vec<_>>(),
            vec![Some("fr"), Some("ja")]
        );
        assert_eq!(
            missing
                .iter()
                .map(|diagnostic| diagnostic.catalog_path.as_deref())
                .collect::<Vec<_>>(),
            vec![
                fixture.path().join("messages/fr.po").to_str(),
                fixture.path().join("messages/ja.po").to_str(),
            ]
        );
        assert!(
            missing
                .iter()
                .all(|diagnostic| diagnostic.message.contains("pmds extract"))
        );

        let mut explicit_config = po_config(fixture.path());
        explicit_config.locales = vec![
            "en".to_owned(),
            "de".to_owned(),
            "ja".to_owned(),
            "fr".to_owned(),
        ];
        let error = list_translation_candidates(&TranslationCandidateRequest {
            config: explicit_config,
            locales: vec!["fr".to_owned()],
            targets: Vec::new(),
            max_origins: 8,
        })
        .expect_err("explicitly requested missing locale remains an error");
        let PalamedesError::ReadFile { path, source } = error else {
            panic!("expected missing catalog read error");
        };
        assert_eq!(path, fixture.path().join("messages/fr.po"));
        assert_eq!(source.kind(), std::io::ErrorKind::NotFound);

        let mut target_config = po_config(fixture.path());
        target_config.locales = vec![
            "en".to_owned(),
            "de".to_owned(),
            "ja".to_owned(),
            "fr".to_owned(),
        ];
        let error = list_translation_candidates(&TranslationCandidateRequest {
            config: target_config,
            locales: Vec::new(),
            targets: vec![id("messages/{locale}", "fr", "Hello", None)],
            max_origins: 8,
        })
        .expect_err("an exact target in a missing catalog remains a read error");
        let PalamedesError::ReadFile { path, source } = error else {
            panic!("expected missing catalog read error for explicit target");
        };
        assert_eq!(path, fixture.path().join("messages/fr.po"));
        assert_eq!(source.kind(), std::io::ErrorKind::NotFound);
    }

    #[test]
    fn explicit_targets_skip_unrelated_missing_locale_catalogs() {
        let fixture = tempfile::tempdir().expect("fixture directory");
        write_po_fixture(&fixture.path().join("messages/de.po"), "de");
        let mut target_config = po_config(fixture.path());
        target_config.locales.push("fr".to_owned());
        let target = id("messages/{locale}", "de", "Hello", None);

        let result = list_translation_candidates(&TranslationCandidateRequest {
            config: target_config,
            locales: Vec::new(),
            targets: vec![target.clone()],
            max_origins: 8,
        })
        .expect("an unrelated missing locale does not block an explicit target");

        assert_eq!(result.candidates.len(), 1);
        assert_eq!(result.candidates[0].id, target);
        assert!(result.diagnostics.is_empty());
    }

    #[test]
    fn does_not_swallow_non_missing_catalog_read_failures() {
        let fixture = tempfile::tempdir().expect("fixture directory");
        write_po_fixture(&fixture.path().join("messages/de.po"), "de");
        fs::create_dir_all(fixture.path().join("messages/fr.po"))
            .expect("create directory where catalog file belongs");
        let mut config = po_config(fixture.path());
        config.locales.push("fr".to_owned());

        let error = list_translation_candidates(&TranslationCandidateRequest {
            config,
            locales: Vec::new(),
            targets: Vec::new(),
            max_origins: 8,
        })
        .expect_err("directory read error is not treated as a missing catalog");
        let PalamedesError::ReadFile { path, source } = error else {
            panic!("expected catalog read error");
        };
        assert_eq!(path, fixture.path().join("messages/fr.po"));
        assert_ne!(source.kind(), std::io::ErrorKind::NotFound);
    }

    #[test]
    fn patch_and_audit_share_icu_compatibility_rules() {
        for (source, target, mut expected_codes) in [
            ("Hello {name}", "Hallo", vec!["icu.missing_argument"]),
            (
                "{count, plural, one {# file} other {# files}}",
                "{count, plural, one {# файл} few {# файла} many {# файлов} other {# файла}}",
                vec![],
            ),
            (
                "Hello {name} {name}",
                "Hallo {name}",
                vec!["icu.argument_occurrence_mismatch"],
            ),
            ("Don't greet {name}", "N'oubliez pas {name}", vec![]),
            (
                "{count, plural, one {Don't touch # file} other {Don't touch # files}}",
                "{count, plural, one {N'oubliez pas # fichier} other {N'oubliez pas # fichiers}}",
                vec![],
            ),
            (
                "{count, plural, one {'#' '{ignored}' {name}} other {# {name}}}",
                "{count, plural, one {'#' '{ignored}' {name}} few {# {name}} other {# {name}}}",
                vec![],
            ),
            (
                "'{ignored}' Hello {name}",
                "'{ignored}' Hallo {name}",
                vec![],
            ),
            ("L'{name} est prêt", "L'{title} ist bereit", vec![]),
            (
                "{gender, select, female {{count, plural, one {{name} has # file} other {{name} has # files}}} other {{name} has files}}",
                "{gender, select, female {{count, plural, one {{name}: # файл} few {{name}: # файла} other {{name}: # файлов}}} other {{name}: файлы}}",
                vec![],
            ),
            (
                "{gender, select, female {{count, plural, one {{name} has # file} other {{name} has # files}}} other {{name} has files}}",
                "{gender, select, female {{count, plural, one {# Datei} other {# Dateien}}} other {Dateien}}",
                vec!["icu.missing_argument"],
            ),
            (
                "{count, plural, one {# file} other {# files}}",
                "{items, plural, one {# Datei} other {# Dateien}}",
                vec!["icu.missing_argument", "icu.extra_argument"],
            ),
            (
                "{count, plural, one {# file} other {# files}}",
                "{count, selectordinal, one {# Datei} other {# Dateien}}",
                vec!["icu.argument_kind_changed"],
            ),
            (
                "{count, plural, offset:1 one {# file} other {# files}}",
                "{count, plural, one {# Datei} other {# Dateien}}",
                vec!["icu.plural_offset_changed"],
            ),
            (
                "{count, plural, =0 {No files} one {# file} other {# files}}",
                "{count, plural, one {# Datei} other {# Dateien}}",
                vec!["icu.missing_plural_selector"],
            ),
            (
                "<strong>Hello {name}</strong>",
                "Hallo {name}",
                vec!["icu.missing_tag"],
            ),
            (
                "Total: {count, number}",
                "Summe: {count}",
                vec!["icu.argument_kind_changed"],
            ),
            (
                "{gender, select, female {She} other {They}}",
                "{gender, select, other {Sie}}",
                vec!["icu.missing_select_selector"],
            ),
            (
                "{count, plural, one {# file} other {# files}}",
                "Dateien: {count, plural, one {# Datei} other {# Dateien}}",
                vec![],
            ),
            // Extra select categories are advisory in audit and do not reject writeback.
            (
                "{gender, select, other {They}}",
                "{gender, select, female {Sie} other {Sie}}",
                vec![],
            ),
        ] {
            let fixture = tempfile::tempdir().expect("fixture directory");
            let path = fixture.path().join("messages/de.po");
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            let catalog = |locale: &str, translation: &str| {
                format!(
                    "msgid \"\"\nmsgstr \"\"\n\"Language: {locale}\\n\"\n\nmsgid {}\nmsgstr {}\n",
                    serde_json::to_string(source).unwrap(),
                    serde_json::to_string(translation).unwrap(),
                )
            };
            fs::write(&path, catalog("de", "")).unwrap();
            fs::write(fixture.path().join("messages/en.po"), catalog("en", source)).unwrap();
            let before = fs::read_to_string(&path).unwrap();
            let listed = list_translation_candidates(&TranslationCandidateRequest {
                config: po_config(fixture.path()),
                locales: vec![],
                targets: vec![],
                max_origins: 8,
            })
            .unwrap();
            let current = &listed.candidates[0];
            let result = apply_translation_patches(TranslationPatchRequest {
                config: po_config(fixture.path()),
                po: None,
                patches: vec![TranslationPatch {
                    id: current.id.clone(),
                    fingerprint: current.fingerprint.clone(),
                    translation: super::project_source(target),
                    machine: None,
                }],
            })
            .unwrap();
            let patch_codes = result
                .diagnostics
                .iter()
                .map(|d| d.code.as_str())
                .collect::<Vec<_>>();
            expected_codes.sort_unstable();
            assert_eq!(
                patch_codes, expected_codes,
                "source {source}; target {target}"
            );
            if expected_codes.is_empty() {
                assert!(result.updated);
            } else {
                assert!(!result.updated);
                assert_eq!(fs::read_to_string(&path).unwrap(), before);
                // Audit a separately authored target after verifying that writeback rejected it.
                fs::write(&path, catalog("de", target)).unwrap();
            }
            let audit = crate::audit_catalogs(crate::CatalogAuditRequest {
                config: po_config(fixture.path()),
                locales: vec![],
                checks: Default::default(),
                metadata: vec![],
            })
            .unwrap();
            let mut audit_errors = audit
                .diagnostics
                .iter()
                .filter(|d| d.severity == crate::CatalogDiagnosticSeverity::Error)
                .map(|d| (d.code.as_str(), d.message.as_str()))
                .collect::<Vec<_>>();
            audit_errors.sort_unstable();
            assert_eq!(
                audit_errors,
                result
                    .diagnostics
                    .iter()
                    .map(|d| (d.code.as_str(), d.message.as_str()))
                    .collect::<Vec<_>>(),
                "source {source}; target {target}",
            );
        }
    }

    #[test]
    fn rejects_incompatible_patch_before_writing_any_catalog() {
        let fixture = tempfile::tempdir().unwrap();
        let mut before = Vec::new();
        for name in ["first", "second"] {
            let path = fixture.path().join(format!("{name}/de.po"));
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            let content = "msgid \"\"\nmsgstr \"\"\n\"Language: de\\n\"\n\nmsgid \"Hello {name}\"\nmsgstr \"\"\n";
            fs::write(&path, content).unwrap();
            before.push((path, content.to_owned()));
        }
        let listed = list_translation_candidates(&TranslationCandidateRequest {
            config: two_catalog_config(fixture.path()),
            locales: vec![],
            targets: vec![],
            max_origins: 8,
        })
        .unwrap();
        let result = apply_translation_patches(TranslationPatchRequest {
            config: two_catalog_config(fixture.path()),
            po: None,
            patches: vec![
                singular_patch(&listed.candidates[0], "Hallo {name}"),
                singular_patch(&listed.candidates[1], "Hallo"),
            ],
        })
        .unwrap();
        assert!(!result.updated);
        assert_eq!(result.stats.applied, 0);
        assert_eq!(result.diagnostics[0].code, "icu.missing_argument");
        assert_eq!(
            result.outcomes[0].status,
            TranslationPatchOutcomeStatus::NotApplied
        );
        assert_eq!(
            result.outcomes[1].status,
            TranslationPatchOutcomeStatus::Rejected
        );
        for (path, content) in before {
            assert_eq!(fs::read_to_string(path).unwrap(), content);
        }
    }

    #[test]
    fn applies_singular_and_plural_po_patches_without_losing_unrelated_state() {
        let fixture = tempfile::tempdir().expect("fixture directory");
        write_po_fixture(&fixture.path().join("messages/de.po"), "de");
        let ids = [
            id("messages/{locale}", "de", "Hello", None),
            id(
                "messages/{locale}",
                "de",
                "{count, plural, one {# file} other {# files}}",
                None,
            ),
        ];
        let listed = list_translation_candidates(&TranslationCandidateRequest {
            config: po_config(fixture.path()),
            locales: vec!["de".to_owned()],
            targets: ids.to_vec(),
            max_origins: 8,
        })
        .expect("list patch candidates");
        let hello = candidate(&listed.candidates, "Hello");
        let plural = candidate(
            &listed.candidates,
            "{count, plural, one {# file} other {# files}}",
        );
        let result = apply_translation_patches(TranslationPatchRequest {
            config: po_config(fixture.path()),
            po: None,
            patches: vec![
                TranslationPatch {
                    id: hello.id.clone(),
                    fingerprint: hello.fingerprint.clone(),
                    translation: TranslationValue::Singular {
                        value: "Hallo".to_owned(),
                    },
                    machine: Some(TranslationMachineProvenance {
                        ai: Some(crate::AiProvenance {
                            model: "example/new".to_owned(),
                            confidence: Some(0.9),
                        }),
                    }),
                },
                TranslationPatch {
                    id: plural.id.clone(),
                    fingerprint: plural.fingerprint.clone(),
                    translation: TranslationValue::Plural {
                        variable: "count".to_owned(),
                        plural_kind: TranslationPluralKind::Cardinal,
                        offset: 0,
                        values: [
                            ("one".to_owned(), "# Datei".to_owned()),
                            ("other".to_owned(), "# Dateien".to_owned()),
                        ]
                        .into_iter()
                        .collect(),
                    },
                    machine: None,
                },
            ],
        })
        .expect("apply PO patches");

        assert!(result.updated);
        assert_eq!(result.stats.applied, 2);
        assert_eq!(result.stats.catalogs_updated, 1);
        assert!(result.diagnostics.is_empty());
        assert!(
            result
                .outcomes
                .iter()
                .all(|outcome| outcome.status == TranslationPatchOutcomeStatus::Applied)
        );

        let path = fixture.path().join("messages/de.po");
        let output = fs::read_to_string(&path).expect("read patched PO");
        assert!(output.contains("\"X-Custom: keep-me\\n\""));
        let raw = parse_po(&output).expect("parse patched PO");
        let hello = raw.items.iter().find(|item| item.msgid == "Hello").unwrap();
        assert_eq!(hello.msgstr.first(), Some("Hallo"));
        assert!(
            hello
                .references
                .iter()
                .any(|origin| origin == "src/home.tsx#HomePage")
        );
        assert!(hello.metadata.iter().any(|(key, _)| key == "lock"));
        assert!(
            hello
                .metadata
                .iter()
                .any(|(key, value)| key == "ai" && value == "example/new:0.9")
        );
        let plural = raw
            .items
            .iter()
            .find(|item| item.msgid.starts_with("{count, plural"))
            .unwrap();
        assert_eq!(
            plural.msgstr.first(),
            Some("{count, plural, one {# Datei} other {# Dateien}}")
        );
        let review = raw
            .items
            .iter()
            .find(|item| item.msgid == "Review me")
            .unwrap();
        assert!(review.flags.iter().any(|flag| flag == "fuzzy"));
        assert!(review.flags.iter().any(|flag| flag == "x-custom"));
        assert_eq!(
            review.comments.first().map(String::as_str),
            Some("Translator-owned review note")
        );
        assert!(
            raw.items
                .iter()
                .any(|item| item.msgid == "Old" && item.obsolete)
        );
        assert_eq!(
            raw.items
                .iter()
                .find(|item| item.msgctxt.as_deref() == Some("adjective"))
                .and_then(|item| item.msgstr.first()),
            Some("Offen")
        );

        let parsed = parse_catalog(
            ParseCatalogOptions::new(&output, "en")
                .with_locale("de")
                .with_mode(CatalogMode::IcuPo),
        )
        .expect("semantic parse");
        let hello = parsed
            .messages
            .iter()
            .find(|message| message.msgid == "Hello")
            .unwrap();
        assert_eq!(
            hello
                .machine
                .as_ref()
                .and_then(|metadata| metadata.ai.as_ref())
                .map(|ai| ai.model.as_str()),
            Some("example/new")
        );
    }

    #[test]
    fn authored_patches_confirm_fuzzy_entries_without_touching_other_flags() {
        let fixture = tempfile::tempdir().expect("fixture directory");
        write_po_fixture(&fixture.path().join("messages/de.po"), "de");
        let listed = list_translation_candidates(&TranslationCandidateRequest {
            config: po_config(fixture.path()),
            locales: vec!["de".to_owned()],
            targets: vec![id("messages/{locale}", "de", "Review me", None)],
            max_origins: 8,
        })
        .expect("list fuzzy candidate");
        let review = candidate(&listed.candidates, "Review me");
        assert!(review.review.fuzzy);

        // Repeating the stored value is the shape of "this translation is fine
        // as it stands", which is the only way to finish a fuzzy entry.
        let result = apply_translation_patches(TranslationPatchRequest {
            config: po_config(fixture.path()),
            po: None,
            patches: vec![singular_patch(review, "Bitte prüfen")],
        })
        .expect("apply authored patch");

        assert_eq!(result.stats.applied, 1);
        assert_eq!(
            result.outcomes[0].status,
            TranslationPatchOutcomeStatus::Applied
        );

        let output = fs::read_to_string(fixture.path().join("messages/de.po"))
            .expect("read patched catalog");
        let patched = parse_po(&output).expect("parse patched PO");
        let review = patched
            .items
            .iter()
            .find(|item| item.msgid == "Review me")
            .expect("review entry");

        assert!(!review.flags.iter().any(|flag| flag == "fuzzy"));
        assert!(review.flags.iter().any(|flag| flag == "x-custom"));
        assert_eq!(review.msgstr.first(), Some("Bitte prüfen"));
        assert_eq!(
            review.comments.first().map(String::as_str),
            Some("Translator-owned review note")
        );
    }

    #[test]
    fn machine_patches_leave_the_fuzzy_marker_for_review() {
        let fixture = tempfile::tempdir().expect("fixture directory");
        write_po_fixture(&fixture.path().join("messages/de.po"), "de");
        let listed = list_translation_candidates(&TranslationCandidateRequest {
            config: po_config(fixture.path()),
            locales: vec!["de".to_owned()],
            targets: vec![id("messages/{locale}", "de", "Review me", None)],
            max_origins: 8,
        })
        .expect("list fuzzy candidate");
        let review = candidate(&listed.candidates, "Review me");

        let result = apply_translation_patches(TranslationPatchRequest {
            config: po_config(fixture.path()),
            po: None,
            patches: vec![TranslationPatch {
                id: review.id.clone(),
                fingerprint: review.fingerprint.clone(),
                translation: TranslationValue::Singular {
                    value: "Maschinell geprüft".to_owned(),
                },
                machine: Some(TranslationMachineProvenance { ai: None }),
            }],
        })
        .expect("apply machine patch");

        assert_eq!(result.stats.applied, 1);

        let output = fs::read_to_string(fixture.path().join("messages/de.po"))
            .expect("read patched catalog");
        let patched = parse_po(&output).expect("parse patched PO");
        let review = patched
            .items
            .iter()
            .find(|item| item.msgid == "Review me")
            .expect("review entry");

        assert!(review.flags.iter().any(|flag| flag == "fuzzy"));
        assert!(review.flags.iter().any(|flag| flag == "x-custom"));
        assert!(review.metadata.iter().any(|(key, _)| key == "lock"));
    }

    #[test]
    fn rejects_source_locale_patch_ids_before_any_catalog_write() {
        let fixture = tempfile::tempdir().expect("fixture directory");
        let target_path = fixture.path().join("messages/de.po");
        let source_path = fixture.path().join("messages/fr.po");
        write_po_fixture(&target_path, "de");
        write_po_fixture(&source_path, "fr");
        let mut listing_config = po_config(fixture.path());
        listing_config.locales = vec!["fr".to_owned(), "de".to_owned()];
        listing_config.source_locale = "fr".to_owned();

        let listed = list_translation_candidates(&TranslationCandidateRequest {
            config: listing_config,
            locales: vec!["de".to_owned()],
            targets: vec![id("messages/{locale}", "de", "Hello", None)],
            max_origins: 8,
        })
        .expect("list target candidate");
        let target = candidate(&listed.candidates, "Hello");
        let source_id = id("tampered/{locale}", "fr", "Hello", None);
        let target_before = fs::read_to_string(&target_path).expect("read target before patch");
        let source_before = fs::read_to_string(&source_path).expect("read source before patch");
        let mut patch_config = po_config(fixture.path());
        patch_config.locales = vec!["fr".to_owned(), "de".to_owned()];
        patch_config.source_locale = "fr".to_owned();

        let result = apply_translation_patches(TranslationPatchRequest {
            config: patch_config,
            po: None,
            patches: vec![
                singular_patch(target, "Hallo"),
                TranslationPatch {
                    id: source_id.clone(),
                    fingerprint: "stale-or-tampered-source-id".to_owned(),
                    translation: TranslationValue::Singular {
                        value: "Bonjour".to_owned(),
                    },
                    machine: None,
                },
            ],
        })
        .expect("source patch is rejected as a structured result");

        assert!(!result.updated);
        assert_eq!(result.stats.requested, 2);
        assert_eq!(
            result
                .outcomes
                .iter()
                .map(|outcome| outcome.status)
                .collect::<Vec<_>>(),
            vec![
                TranslationPatchOutcomeStatus::NotApplied,
                TranslationPatchOutcomeStatus::Rejected,
            ]
        );
        assert!(result.diagnostics.iter().any(|diagnostic| {
            diagnostic.code == "translation.source_locale"
                && diagnostic.id.as_ref() == Some(&source_id)
                && diagnostic.locale.as_deref() == Some("fr")
        }));
        assert_eq!(fs::read_to_string(&target_path).unwrap(), target_before);
        assert_eq!(fs::read_to_string(&source_path).unwrap(), source_before);
    }

    #[test]
    fn returns_source_patch_rejection_before_loading_an_unreadable_target_catalog() {
        let fixture = tempfile::tempdir().expect("fixture directory");
        fs::create_dir_all(fixture.path().join("messages/de.po"))
            .expect("create directory where target catalog belongs");
        let source_id = id("tampered/{locale}", "en", "Hello", None);
        let target_id = id("messages/{locale}", "de", "Hello", None);

        let result = apply_translation_patches(TranslationPatchRequest {
            config: po_config(fixture.path()),
            po: None,
            patches: vec![
                TranslationPatch {
                    id: source_id.clone(),
                    fingerprint: "tampered-source-id".to_owned(),
                    translation: TranslationValue::Singular {
                        value: "Hello".to_owned(),
                    },
                    machine: None,
                },
                TranslationPatch {
                    id: target_id.clone(),
                    fingerprint: "unreadable-target".to_owned(),
                    translation: TranslationValue::Singular {
                        value: "Hallo".to_owned(),
                    },
                    machine: None,
                },
            ],
        })
        .expect("preliminary source rejection returns without reading the target catalog");

        assert!(!result.updated);
        assert_eq!(result.stats.requested, 2);
        assert_eq!(
            result
                .outcomes
                .iter()
                .map(|outcome| (&outcome.id, outcome.status))
                .collect::<Vec<_>>(),
            vec![
                (&source_id, TranslationPatchOutcomeStatus::Rejected),
                (&target_id, TranslationPatchOutcomeStatus::NotApplied),
            ]
        );
        assert_eq!(result.diagnostics.len(), 1);
        assert_eq!(result.diagnostics[0].code, "translation.source_locale");
        assert_eq!(result.diagnostics[0].id.as_ref(), Some(&source_id));
    }

    #[test]
    fn canonicalizes_complete_origins_for_fingerprints_and_response_limits() {
        let fixture = tempfile::tempdir().expect("fixture directory");
        let path = fixture.path().join("messages/de.po");
        write_po_fixture(&path, "de");
        let canonical_origins = (1..=10)
            .map(|index| format!("#: src/origin-{index}.tsx#Origin{index}"))
            .collect::<Vec<_>>()
            .join("\n");
        let origins = format!(
            "{}\n#: src/origin-1.tsx#Origin1",
            (1..=10)
                .rev()
                .map(|index| format!("#: src/origin-{index}.tsx#Origin{index}"))
                .collect::<Vec<_>>()
                .join("\n")
        );
        let content = fs::read_to_string(&path).expect("read fixture");
        let expanded_content = content.replace(
            "#: src/home.tsx#HomePage\n#: src/shared.ts#formatGreeting",
            &origins,
        );
        fs::write(&path, &expanded_content).expect("write expanded origins");

        let target = id("messages/{locale}", "de", "Hello", None);
        let two_origins = list_translation_candidates(&TranslationCandidateRequest {
            config: po_config(fixture.path()),
            locales: vec!["de".to_owned()],
            targets: vec![target.clone()],
            max_origins: 2,
        })
        .expect("list candidate with two origins");
        let six_origins = list_translation_candidates(&TranslationCandidateRequest {
            config: po_config(fixture.path()),
            locales: vec!["de".to_owned()],
            targets: vec![target.clone()],
            max_origins: 6,
        })
        .expect("list candidate with six origins");
        let limited = candidate(&two_origins.candidates, "Hello");
        let expanded = candidate(&six_origins.candidates, "Hello");

        assert_eq!(limited.origins.len(), 2);
        assert_eq!(expanded.origins.len(), 6);
        assert_eq!(limited.fingerprint, expanded.fingerprint);

        fs::write(
            &path,
            content.replace(
                "#: src/home.tsx#HomePage\n#: src/shared.ts#formatGreeting",
                &canonical_origins,
            ),
        )
        .expect("rewrite origins in canonical order without duplicates");
        let rewritten = list_translation_candidates(&TranslationCandidateRequest {
            config: po_config(fixture.path()),
            locales: vec!["de".to_owned()],
            targets: vec![target.clone()],
            max_origins: 2,
        })
        .expect("list candidate after equivalent origin rewrite");
        let rewritten = candidate(&rewritten.candidates, "Hello");
        assert_eq!(limited.origins, rewritten.origins);
        assert_eq!(limited.fingerprint, rewritten.fingerprint);

        fs::write(&path, &expanded_content).expect("restore expanded origins");
        fs::write(
            &path,
            expanded_content.replace("Origin10", "UpdatedOrigin10"),
        )
        .expect("change an origin outside the response limit");
        let changed = list_translation_candidates(&TranslationCandidateRequest {
            config: po_config(fixture.path()),
            locales: vec!["de".to_owned()],
            targets: vec![target],
            max_origins: 2,
        })
        .expect("list candidate after an origin change");
        assert_ne!(
            limited.fingerprint,
            candidate(&changed.candidates, "Hello").fingerprint
        );
        fs::write(&path, expanded_content).expect("restore unchanged catalog");

        let result = apply_translation_patches(TranslationPatchRequest {
            config: po_config(fixture.path()),
            po: None,
            patches: vec![singular_patch(limited, "Hallo")],
        })
        .expect("apply candidate listed with truncated origins");
        assert!(result.updated);
        assert!(result.diagnostics.is_empty());
    }

    #[test]
    fn applies_fcl_patches_and_supports_incremental_batches() {
        let fixture = tempfile::tempdir().expect("fixture directory");
        write_fcl_fixture(&fixture.path().join("features/de.fcl"), "de");
        let targets = vec![
            id("features/{locale}", "de", "Hello", None),
            id("features/{locale}", "de", "Open", Some("verb")),
        ];
        let listed = list_translation_candidates(&TranslationCandidateRequest {
            config: fcl_config(fixture.path()),
            locales: vec!["de".to_owned()],
            targets,
            max_origins: 8,
        })
        .expect("list FCL candidates");
        let hello = candidate(&listed.candidates, "Hello").clone();
        let open = listed
            .candidates
            .iter()
            .find(|candidate| candidate.id.context.as_deref() == Some("verb"))
            .unwrap()
            .clone();

        let first = apply_translation_patches(TranslationPatchRequest {
            config: fcl_config(fixture.path()),
            po: None,
            patches: vec![singular_patch(&open, "Öffnen")],
        })
        .expect("apply first incremental batch");
        assert!(first.updated);
        let second = apply_translation_patches(TranslationPatchRequest {
            config: fcl_config(fixture.path()),
            po: None,
            patches: vec![singular_patch(&hello, "Hallo")],
        })
        .expect("unrelated candidate fingerprint remains valid");
        assert!(second.updated);
        assert!(second.diagnostics.is_empty());

        let output =
            fs::read_to_string(fixture.path().join("features/de.fcl")).expect("read patched FCL");
        assert!(output.starts_with("%FCL1"));
        assert!(output.contains("Hello\t\tHallo"));
        assert!(output.contains("Open\tverb\tÖffnen"));
        assert!(output.contains("\tc=Greeting shown on the home page"));
        assert!(output.contains("Review me\t\tBitte prüfen"));
        assert!(output.contains("\tf=fuzzy\tf=x-custom"));
    }

    #[test]
    fn rejects_invalid_rendered_plural_selectors_without_writing() {
        let fixture = tempfile::tempdir().unwrap();
        let path = fixture.path().join("messages/de.po");
        write_po_fixture(&path, "de");
        let before = fs::read_to_string(&path).unwrap();
        let listed = list_translation_candidates(&TranslationCandidateRequest {
            config: po_config(fixture.path()),
            locales: vec![],
            targets: vec![],
            max_origins: 8,
        })
        .unwrap();
        let plural = listed
            .candidates
            .iter()
            .find(|candidate| matches!(candidate.source, TranslationValue::Plural { .. }))
            .unwrap();
        for values in [
            [("one", "# Datei")]
                .into_iter()
                .map(|(key, value)| (key.to_owned(), value.to_owned()))
                .collect(),
            [("other", "# Dateien"), ("bad selector", "# Dateien")]
                .into_iter()
                .map(|(key, value)| (key.to_owned(), value.to_owned()))
                .collect(),
        ] {
            let result = apply_translation_patches(TranslationPatchRequest {
                config: po_config(fixture.path()),
                po: None,
                patches: vec![TranslationPatch {
                    id: plural.id.clone(),
                    fingerprint: plural.fingerprint.clone(),
                    translation: TranslationValue::Plural {
                        variable: "count".to_owned(),
                        plural_kind: TranslationPluralKind::Cardinal,
                        offset: 0,
                        values,
                    },
                    machine: None,
                }],
            })
            .expect("rendered ICU errors are structured rejections");
            assert!(!result.updated);
            assert_eq!(result.diagnostics[0].code, "translation.invalid_icu");
            assert_eq!(fs::read_to_string(&path).unwrap(), before);
        }
    }

    #[test]
    fn rejects_invalid_singular_icu_as_a_per_patch_diagnostic_without_writing() {
        let fixture = tempfile::tempdir().expect("fixture directory");
        let path = fixture.path().join("messages/de.po");
        write_po_fixture(&path, "de");
        let listed = list_translation_candidates(&TranslationCandidateRequest {
            config: po_config(fixture.path()),
            locales: vec!["de".to_owned()],
            targets: vec![id("messages/{locale}", "de", "Hello", None)],
            max_origins: 8,
        })
        .expect("list singular patch candidate");
        let hello = candidate(&listed.candidates, "Hello");
        let before = fs::read_to_string(&path).expect("read catalog before invalid patch");

        let result = apply_translation_patches(TranslationPatchRequest {
            config: po_config(fixture.path()),
            po: None,
            patches: vec![singular_patch(hello, "Hallo {name")],
        })
        .expect("reject invalid singular ICU as a diagnostic");

        assert!(!result.updated);
        assert_eq!(
            result.outcomes[0].status,
            TranslationPatchOutcomeStatus::Rejected
        );
        assert!(result.diagnostics.iter().any(|diagnostic| {
            diagnostic.code == "translation.invalid_icu"
                && diagnostic.id.as_ref() == Some(&hello.id)
                && diagnostic.message.contains("Singular translation")
        }));
        assert_eq!(fs::read_to_string(&path).unwrap(), before);
    }

    #[test]
    fn accepts_singular_icu_with_runtime_literal_apostrophes() {
        let fixture = tempfile::tempdir().expect("fixture directory");
        let path = fixture.path().join("messages/de.po");
        write_po_fixture(&path, "de");
        let listed = list_translation_candidates(&TranslationCandidateRequest {
            config: po_config(fixture.path()),
            locales: vec!["de".to_owned()],
            targets: vec![id("messages/{locale}", "de", "Hello", None)],
            max_origins: 8,
        })
        .expect("list singular patch candidate");
        let hello = candidate(&listed.candidates, "Hello");

        let result = apply_translation_patches(TranslationPatchRequest {
            config: po_config(fixture.path()),
            po: None,
            patches: vec![singular_patch(hello, "L'{name} est prêt")],
        })
        .expect("accept a singular translation using runtime apostrophe semantics");

        assert!(result.updated);
        assert!(result.diagnostics.is_empty());
    }

    #[test]
    fn rejects_invalid_plural_icu_as_a_per_patch_diagnostic_without_writing() {
        let fixture = tempfile::tempdir().expect("fixture directory");
        let path = fixture.path().join("messages/de.po");
        write_po_fixture(&path, "de");
        let listed = list_translation_candidates(&TranslationCandidateRequest {
            config: po_config(fixture.path()),
            locales: vec!["de".to_owned()],
            targets: vec![
                id("messages/{locale}", "de", "Hello", None),
                id(
                    "messages/{locale}",
                    "de",
                    "{count, plural, one {# file} other {# files}}",
                    None,
                ),
            ],
            max_origins: 8,
        })
        .expect("list plural patch candidates");
        let hello = candidate(&listed.candidates, "Hello");
        let plural = candidate(
            &listed.candidates,
            "{count, plural, one {# file} other {# files}}",
        );
        let mut translation = plural.source.clone();
        let TranslationValue::Plural { values, .. } = &mut translation else {
            panic!("expected a plural candidate");
        };
        values.insert("one".to_owned(), "# Datei }".to_owned());
        values.insert("other".to_owned(), "# Dateien }".to_owned());
        let before = fs::read_to_string(&path).expect("read catalog before invalid patch");

        let result = apply_translation_patches(TranslationPatchRequest {
            config: po_config(fixture.path()),
            po: None,
            patches: vec![
                singular_patch(hello, "Hallo"),
                TranslationPatch {
                    id: plural.id.clone(),
                    fingerprint: plural.fingerprint.clone(),
                    translation,
                    machine: None,
                },
            ],
        })
        .expect("reject invalid ICU as a diagnostic");

        assert!(!result.updated);
        assert_eq!(result.stats.requested, 2);
        assert_eq!(
            result
                .outcomes
                .iter()
                .map(|outcome| outcome.status)
                .collect::<Vec<_>>(),
            vec![
                TranslationPatchOutcomeStatus::NotApplied,
                TranslationPatchOutcomeStatus::Rejected,
            ]
        );
        let diagnostics = result
            .diagnostics
            .iter()
            .filter(|diagnostic| diagnostic.code == "translation.invalid_icu")
            .collect::<Vec<_>>();
        assert_eq!(diagnostics.len(), 2);
        assert!(
            diagnostics
                .iter()
                .all(|diagnostic| diagnostic.id.as_ref() == Some(&plural.id))
        );
        assert!(
            diagnostics
                .iter()
                .any(|diagnostic| diagnostic.message.contains("translation.values.one"))
        );
        assert!(
            diagnostics
                .iter()
                .any(|diagnostic| diagnostic.message.contains("translation.values.other"))
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), before);
    }

    /// A branch value that closes its own branch and opens another one parses
    /// as valid ICU, so it used to be accepted and then written truncated.
    #[test]
    fn rejects_plural_branch_values_that_escape_their_branch() {
        let fixture = tempfile::tempdir().expect("fixture directory");
        let path = fixture.path().join("messages/de.po");
        write_po_fixture(&path, "de");
        let listed = list_translation_candidates(&TranslationCandidateRequest {
            config: po_config(fixture.path()),
            locales: vec!["de".to_owned()],
            targets: vec![id(
                "messages/{locale}",
                "de",
                "{count, plural, one {# file} other {# files}}",
                None,
            )],
            max_origins: 8,
        })
        .expect("list plural patch candidate");
        let plural = candidate(
            &listed.candidates,
            "{count, plural, one {# file} other {# files}}",
        );
        let mut translation = plural.source.clone();
        let TranslationValue::Plural { values, .. } = &mut translation else {
            panic!("expected a plural candidate");
        };
        values.insert("one".to_owned(), "# Datei} one {# Dateien".to_owned());
        values.insert("other".to_owned(), "# Dateien".to_owned());
        let before = fs::read_to_string(&path).expect("read catalog before invalid patch");

        let result = apply_translation_patches(TranslationPatchRequest {
            config: po_config(fixture.path()),
            po: None,
            patches: vec![TranslationPatch {
                id: plural.id.clone(),
                fingerprint: plural.fingerprint.clone(),
                translation,
                machine: None,
            }],
        })
        .expect("reject an escaping branch as a diagnostic");

        assert!(!result.updated);
        assert_eq!(
            result.outcomes[0].status,
            TranslationPatchOutcomeStatus::Rejected
        );
        assert!(result.diagnostics.iter().any(|diagnostic| {
            diagnostic.code == "translation.invalid_icu"
                && diagnostic.message.contains("translation.values.one")
        }));
        assert_eq!(fs::read_to_string(&path).unwrap(), before);
    }

    #[test]
    fn rejects_invalid_selectordinal_branch_as_a_structured_diagnostic() {
        let fixture = tempfile::tempdir().expect("fixture directory");
        let path = fixture.path().join("messages/de.po");
        write_po_fixture(&path, "de");
        let content = fs::read_to_string(&path).expect("read fixture");
        fs::write(
            &path,
            format!(
                "{content}\nmsgid \"{{position, selectordinal, one {{#st}} two {{#nd}} few {{#rd}} other {{#th}}}}\"\nmsgstr \"\"\n"
            ),
        )
        .expect("add ordinal candidate");
        let source = "{position, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}";
        let listed = list_translation_candidates(&TranslationCandidateRequest {
            config: po_config(fixture.path()),
            locales: vec!["de".to_owned()],
            targets: vec![id("messages/{locale}", "de", source, None)],
            max_origins: 8,
        })
        .expect("list ordinal candidate");
        let ordinal = candidate(&listed.candidates, source);
        let mut translation = ordinal.source.clone();
        let TranslationValue::Plural {
            plural_kind,
            values,
            ..
        } = &mut translation
        else {
            panic!("expected an ordinal plural candidate");
        };
        assert_eq!(*plural_kind, TranslationPluralKind::Ordinal);
        values.insert("other".to_owned(), "#te }".to_owned());
        let before = fs::read_to_string(&path).expect("read catalog before invalid ordinal patch");

        let result = apply_translation_patches(TranslationPatchRequest {
            config: po_config(fixture.path()),
            po: None,
            patches: vec![TranslationPatch {
                id: ordinal.id.clone(),
                fingerprint: ordinal.fingerprint.clone(),
                translation,
                machine: None,
            }],
        })
        .expect("reject invalid ordinal ICU as a diagnostic");

        assert_eq!(
            result.outcomes[0].status,
            TranslationPatchOutcomeStatus::Rejected
        );
        assert!(result.diagnostics.iter().any(|diagnostic| {
            diagnostic.code == "translation.invalid_icu"
                && diagnostic.id.as_ref() == Some(&ordinal.id)
                && diagnostic.message.contains("translation.values.other")
        }));
        assert_eq!(fs::read_to_string(&path).unwrap(), before);
    }

    #[test]
    fn retains_completed_per_file_outcomes_when_a_later_replacement_fails() {
        let fixture = tempfile::tempdir().expect("fixture directory");
        let first_path = fixture.path().join("first/de.po");
        let second_path = fixture.path().join("second/de.po");
        write_po_fixture(&first_path, "de");
        write_po_fixture(&second_path, "de");
        let listed = list_translation_candidates(&TranslationCandidateRequest {
            config: two_catalog_config(fixture.path()),
            locales: vec!["de".to_owned()],
            targets: vec![
                id("first/{locale}", "de", "Hello", None),
                id("second/{locale}", "de", "Hello", None),
            ],
            max_origins: 8,
        })
        .expect("list candidates for both files");
        let first = listed
            .candidates
            .iter()
            .find(|candidate| candidate.id.catalog == "first/{locale}")
            .expect("first catalog candidate");
        let second = listed
            .candidates
            .iter()
            .find(|candidate| candidate.id.catalog == "second/{locale}")
            .expect("second catalog candidate");
        let result = apply_translation_patches_with_replacement(
            TranslationPatchRequest {
                config: two_catalog_config(fixture.path()),
                po: None,
                patches: vec![
                    singular_patch(first, "Hallo"),
                    singular_patch(second, "Servus"),
                ],
            },
            |catalog, source_locale, po| {
                if catalog.path == second_path {
                    return Err(PalamedesError::WriteFile {
                        path: catalog.path.clone(),
                        source: std::io::Error::other("injected catalog replacement failure"),
                    });
                }
                atomic_replace_catalog(catalog, source_locale, po)
            },
        );

        let error = result.expect_err("second replacement should fail");
        let PalamedesError::TranslationPatchWrite { source, .. } = &error else {
            panic!("expected a translation patch write error");
        };
        let PalamedesError::WriteFile { source, .. } = source.as_ref() else {
            panic!("expected the injected write-file source error");
        };
        assert_eq!(source.kind(), std::io::ErrorKind::Other);
        assert_eq!(source.to_string(), "injected catalog replacement failure");
        let report = error
            .translation_patch_result()
            .expect("write error retains completed patch report");
        assert!(report.updated);
        assert_eq!(report.stats.catalogs_updated, 1);
        assert_eq!(report.stats.applied, 1);
        assert_eq!(
            report
                .outcomes
                .iter()
                .map(|outcome| outcome.status)
                .collect::<Vec<_>>(),
            vec![
                TranslationPatchOutcomeStatus::Applied,
                TranslationPatchOutcomeStatus::NotApplied,
            ]
        );
        assert!(
            fs::read_to_string(&first_path)
                .expect("read first catalog")
                .contains("msgstr \"Hallo\"")
        );
        assert!(
            fs::read_to_string(&second_path)
                .expect("read second catalog")
                .contains("msgstr \"\"")
        );
    }

    #[test]
    fn reports_post_commit_directory_sync_failure_as_applied_with_durability_warning() {
        let fixture = tempfile::tempdir().expect("fixture directory");
        let path = fixture.path().join("messages/de.po");
        write_po_fixture(&path, "de");
        let listed = list_translation_candidates(&TranslationCandidateRequest {
            config: po_config(fixture.path()),
            locales: vec!["de".to_owned()],
            targets: vec![id("messages/{locale}", "de", "Hello", None)],
            max_origins: 8,
        })
        .expect("list candidate");
        let hello = candidate(&listed.candidates, "Hello");

        let result = apply_translation_patches_with_replacement(
            TranslationPatchRequest {
                config: po_config(fixture.path()),
                po: None,
                patches: vec![singular_patch(hello, "Hallo")],
            },
            |catalog, _, _| {
                atomic_replace_catalog_with_directory_sync(catalog, |_| {
                    Err(std::io::Error::other("injected directory sync failure"))
                })
            },
        )
        .expect("visible commit remains a successful patch result");

        assert!(result.updated);
        assert_eq!(result.stats.applied, 1);
        assert_eq!(result.stats.catalogs_updated, 1);
        assert_eq!(
            result.outcomes[0].status,
            TranslationPatchOutcomeStatus::Applied
        );
        assert_eq!(result.diagnostics.len(), 1);
        assert_eq!(result.diagnostics[0].code, "translation.catalog_durability");
        assert!(
            result.diagnostics[0]
                .message
                .contains("injected directory sync failure")
        );
        assert!(
            fs::read_to_string(path)
                .expect("read visibly committed catalog")
                .contains("msgstr \"Hallo\"")
        );
    }

    #[cfg(unix)]
    #[test]
    fn public_fcl_patch_preserves_existing_unix_permissions() {
        use std::os::unix::fs::PermissionsExt;

        for mode in [0o644, 0o755] {
            let fixture = tempfile::tempdir().expect("fixture directory");
            let path = fixture.path().join("features/de.fcl");
            write_fcl_fixture(&path, "de");
            fs::set_permissions(&path, fs::Permissions::from_mode(mode))
                .expect("set catalog mode before patch");
            let listed = list_translation_candidates(&TranslationCandidateRequest {
                config: fcl_config(fixture.path()),
                locales: vec!["de".to_owned()],
                targets: vec![id("features/{locale}", "de", "Hello", None)],
                max_origins: 8,
            })
            .expect("list FCL candidate");
            let hello = candidate(&listed.candidates, "Hello");

            let result = apply_translation_patches(TranslationPatchRequest {
                config: fcl_config(fixture.path()),
                po: None,
                patches: vec![singular_patch(hello, "Hallo")],
            })
            .expect("apply FCL patch through the public API");

            assert!(result.updated);
            assert_eq!(
                fs::metadata(&path)
                    .expect("read patched catalog metadata")
                    .permissions()
                    .mode()
                    & 0o7777,
                mode,
                "replacement changed mode {mode:o}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn new_direct_replacement_keeps_secure_tempfile_permissions() {
        use std::ffi::OsString;
        use std::os::unix::fs::PermissionsExt;
        use std::sync::Arc;

        use crate::contained_fs::ContainedDir;

        let fixture = tempfile::tempdir().expect("fixture directory");
        let path = fixture.path().join("new/messages.po");
        let parent_dir = Arc::new(
            ContainedDir::open_subpath(fixture.path(), Path::new("new"), true)
                .expect("open contained parent")
                .expect("created parent"),
        );
        let prepared = PreparedCatalog {
            path: path.clone(),
            parent_dir,
            file_name: OsString::from("messages.po"),
            expected_original: None,
            content: "msgid \"Hello\"\nmsgstr \"Hallo\"\n".to_owned(),
        };

        atomic_replace_catalog(&prepared, "en", None).expect("create new catalog atomically");

        assert_eq!(
            fs::metadata(path)
                .expect("read new catalog metadata")
                .permissions()
                .mode()
                & 0o7777,
            0o600
        );
    }

    #[cfg(unix)]
    #[test]
    fn translation_writeback_stays_pinned_to_original_directory_handle_after_parent_swap() {
        use std::os::unix::fs::symlink;

        let fixture = tempfile::tempdir().expect("fixture directory");
        let outside = tempfile::tempdir().expect("outside directory");
        let outside_catalog = outside.path().join("de.po");
        fs::write(&outside_catalog, "outside-untouched").expect("seed outside target");

        let path = fixture.path().join("messages/de.po");
        write_po_fixture(&path, "de");
        let listed = list_translation_candidates(&TranslationCandidateRequest {
            config: po_config(fixture.path()),
            locales: vec!["de".to_owned()],
            targets: vec![id("messages/{locale}", "de", "Hello", None)],
            max_origins: 8,
        })
        .expect("list candidate");
        let hello = candidate(&listed.candidates, "Hello");

        let moved_dir = fixture.path().join("messages-moved");
        let result = apply_translation_patches_with_replacement(
            TranslationPatchRequest {
                config: po_config(fixture.path()),
                po: None,
                patches: vec![singular_patch(hello, "Hallo")],
            },
            |catalog, source_locale, po| {
                // Swap `messages` to a symlink pointing outside after preparation, right before commit.
                fs::rename(fixture.path().join("messages"), &moved_dir).expect("move real dir");
                symlink(outside.path(), fixture.path().join("messages")).expect("swap symlink");
                atomic_replace_catalog(catalog, source_locale, po)
            },
        )
        .expect("pinned replacement stays inside original directory handle");

        assert!(result.updated);
        assert_eq!(
            fs::read_to_string(&outside_catalog).expect("read outside file"),
            "outside-untouched"
        );
        assert!(
            fs::read_to_string(moved_dir.join("de.po"))
                .expect("read moved original dir")
                .contains("msgstr \"Hallo\"")
        );
    }

    #[test]
    fn rejects_batches_whose_catalog_scopes_normalize_to_the_same_target_file() {
        let fixture = tempfile::tempdir().expect("fixture directory");
        let path = fixture.path().join("messages/de.po");
        write_po_fixture(&path, "de");
        let before = fs::read_to_string(&path).expect("read original catalog");

        let config = CatalogArtifactConfig {
            root_dir: fixture.path().to_string_lossy().into_owned(),
            locales: vec!["en".to_owned(), "de".to_owned()],
            source_locale: "en".to_owned(),
            fallback_locales: None,
            pseudo_locale: None,
            catalogs: vec![
                CatalogConfig {
                    path: "messages/{locale}".to_owned(),
                    format: PalamedesCatalogFormat::Po,
                },
                CatalogConfig {
                    path: r"messages\{locale}".to_owned(),
                    format: PalamedesCatalogFormat::Po,
                },
            ],
        };
        let listed = list_translation_candidates(&TranslationCandidateRequest {
            config: CatalogArtifactConfig {
                root_dir: config.root_dir.clone(),
                locales: config.locales.clone(),
                source_locale: config.source_locale.clone(),
                fallback_locales: None,
                pseudo_locale: None,
                catalogs: vec![CatalogConfig {
                    path: "messages/{locale}".to_owned(),
                    format: PalamedesCatalogFormat::Po,
                }],
            },
            locales: vec!["de".to_owned()],
            targets: vec![id("messages/{locale}", "de", "Hello", None)],
            max_origins: 8,
        })
        .expect("list candidate");
        let hello = candidate(&listed.candidates, "Hello");
        let mut alias_patch = singular_patch(hello, "Servus");
        alias_patch.id.catalog = r"messages\{locale}".to_owned();

        let result = apply_translation_patches(TranslationPatchRequest {
            config,
            po: None,
            patches: vec![singular_patch(hello, "Hallo"), alias_patch],
        })
        .expect("conflicting normalized catalog scopes must be rejected cleanly");

        assert!(!result.updated);
        assert_eq!(result.stats.requested, 2);
        assert_eq!(result.stats.applied, 0);
        assert_eq!(result.outcomes.len(), 2);
        assert!(
            result
                .outcomes
                .iter()
                .all(|outcome| outcome.status == TranslationPatchOutcomeStatus::Rejected)
        );
        assert!(
            result
                .diagnostics
                .iter()
                .all(|diag| diag.code == "translation.ambiguous_catalog")
        );
        assert_eq!(
            fs::read_to_string(&path).expect("read unchanged catalog"),
            before
        );
    }

    #[test]
    fn rejects_batches_whose_catalog_scopes_alias_the_same_on_disk_file() {
        let fixture = tempfile::tempdir().expect("fixture directory");
        let primary = fixture.path().join("messages/de.po");
        write_po_fixture(&primary, "de");
        let alias_dir = fixture.path().join("alias");
        fs::create_dir_all(&alias_dir).expect("alias dir");
        fs::hard_link(&primary, alias_dir.join("de.po")).expect("hard link alias");
        let before = fs::read_to_string(&primary).expect("read original catalog");

        let config = CatalogArtifactConfig {
            root_dir: fixture.path().to_string_lossy().into_owned(),
            locales: vec!["en".to_owned(), "de".to_owned()],
            source_locale: "en".to_owned(),
            fallback_locales: None,
            pseudo_locale: None,
            catalogs: vec![
                CatalogConfig {
                    path: "messages/{locale}".to_owned(),
                    format: PalamedesCatalogFormat::Po,
                },
                CatalogConfig {
                    path: "alias/{locale}".to_owned(),
                    format: PalamedesCatalogFormat::Po,
                },
            ],
        };
        let listed = list_translation_candidates(&TranslationCandidateRequest {
            config: CatalogArtifactConfig {
                root_dir: config.root_dir.clone(),
                locales: config.locales.clone(),
                source_locale: config.source_locale.clone(),
                fallback_locales: None,
                pseudo_locale: None,
                catalogs: vec![CatalogConfig {
                    path: "messages/{locale}".to_owned(),
                    format: PalamedesCatalogFormat::Po,
                }],
            },
            locales: vec!["de".to_owned()],
            targets: vec![id("messages/{locale}", "de", "Hello", None)],
            max_origins: 8,
        })
        .expect("list candidate");
        let hello = candidate(&listed.candidates, "Hello");
        let mut alias_patch = singular_patch(hello, "Servus");
        alias_patch.id.catalog = "alias/{locale}".to_owned();

        let result = apply_translation_patches(TranslationPatchRequest {
            config,
            po: None,
            patches: vec![singular_patch(hello, "Hallo"), alias_patch],
        })
        .expect("aliased on-disk targets must be rejected cleanly");

        assert!(!result.updated);
        assert_eq!(result.stats.applied, 0);
        assert!(
            result
                .outcomes
                .iter()
                .all(|outcome| outcome.status == TranslationPatchOutcomeStatus::Rejected)
        );
        assert!(
            result
                .diagnostics
                .iter()
                .all(|diag| diag.code == "translation.ambiguous_catalog")
        );
        assert_eq!(
            fs::read_to_string(&primary).expect("read unchanged catalog"),
            before
        );
    }

    #[test]
    fn rejects_duplicate_unknown_and_stale_patches_without_writing() {
        let fixture = tempfile::tempdir().expect("fixture directory");
        let path = fixture.path().join("messages/de.po");
        write_po_fixture(&path, "de");
        let listed = list_translation_candidates(&TranslationCandidateRequest {
            config: po_config(fixture.path()),
            locales: vec!["de".to_owned()],
            targets: vec![id("messages/{locale}", "de", "Hello", None)],
            max_origins: 8,
        })
        .expect("list candidate");
        let hello = candidate(&listed.candidates, "Hello").clone();
        let before = fs::read_to_string(&path).expect("read before duplicate batch");
        let duplicate = apply_translation_patches(TranslationPatchRequest {
            config: po_config(fixture.path()),
            po: None,
            patches: vec![
                singular_patch(&hello, "Hallo"),
                singular_patch(&hello, "Servus"),
            ],
        })
        .expect("reject duplicate batch");
        assert!(!duplicate.updated);
        assert!(
            duplicate
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "translation.duplicate_patch")
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), before);

        let unknown = TranslationPatch {
            id: id("messages/{locale}", "de", "Unknown", None),
            fingerprint: "unknown".to_owned(),
            translation: TranslationValue::Singular {
                value: "Unbekannt".to_owned(),
            },
            machine: None,
        };
        let atomic = apply_translation_patches(TranslationPatchRequest {
            config: po_config(fixture.path()),
            po: None,
            patches: vec![singular_patch(&hello, "Hallo"), unknown],
        })
        .expect("reject unknown message batch");
        assert!(!atomic.updated);
        assert!(
            atomic
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "translation.unknown_message")
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), before);

        fs::write(
            &path,
            before.replace(
                "msgid \"Hello\"\nmsgstr \"\"",
                "msgid \"Hello\"\nmsgstr \"Extern\"",
            ),
        )
        .expect("external candidate edit");
        let externally_changed = fs::read_to_string(&path).unwrap();
        let stale = apply_translation_patches(TranslationPatchRequest {
            config: po_config(fixture.path()),
            po: None,
            patches: vec![singular_patch(&hello, "Hallo")],
        })
        .expect("reject stale candidate");
        assert!(!stale.updated);
        assert!(
            stale
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "translation.stale_candidate")
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), externally_changed);
    }

    #[test]
    fn reports_ambiguous_po_identities_as_structured_diagnostics() {
        let fixture = tempfile::tempdir().expect("fixture directory");
        let path = fixture.path().join("messages/de.po");
        write_po_fixture(&path, "de");
        let content = fs::read_to_string(&path).expect("read fixture");
        fs::write(
            &path,
            format!("{content}\n#~ msgid \"Hello\"\n#~ msgstr \"Historisch\"\n"),
        )
        .expect("write ambiguous fixture");
        let target = id("messages/{locale}", "de", "Hello", None);
        let listed = list_translation_candidates(&TranslationCandidateRequest {
            config: po_config(fixture.path()),
            locales: vec!["de".to_owned()],
            targets: vec![target.clone()],
            max_origins: 8,
        })
        .expect("list ambiguous identity");
        assert!(listed.candidates.is_empty());
        assert_eq!(listed.diagnostics.len(), 1);
        assert_eq!(listed.diagnostics[0].code, "translation.ambiguous_message");

        let before = fs::read_to_string(&path).expect("read before rejected patch");
        let result = apply_translation_patches(TranslationPatchRequest {
            config: po_config(fixture.path()),
            po: None,
            patches: vec![TranslationPatch {
                id: target,
                fingerprint: "cannot-be-unambiguous".to_owned(),
                translation: TranslationValue::Singular {
                    value: "Hallo".to_owned(),
                },
                machine: None,
            }],
        })
        .expect("reject ambiguous patch");
        assert!(!result.updated);
        assert_eq!(
            result.outcomes[0].status,
            TranslationPatchOutcomeStatus::Rejected
        );
        assert!(
            result
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "translation.ambiguous_message")
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), before);
    }

    fn config(root: &Path) -> CatalogArtifactConfig {
        CatalogArtifactConfig {
            root_dir: root.to_string_lossy().into_owned(),
            locales: vec!["en".to_owned(), "de".to_owned(), "fr".to_owned()],
            source_locale: "en".to_owned(),
            fallback_locales: None,
            pseudo_locale: None,
            catalogs: vec![
                CatalogConfig {
                    path: "messages/{locale}".to_owned(),
                    format: PalamedesCatalogFormat::Po,
                },
                CatalogConfig {
                    path: "features/{locale}".to_owned(),
                    format: PalamedesCatalogFormat::Fcl,
                },
            ],
        }
    }

    fn po_config(root: &Path) -> CatalogArtifactConfig {
        let mut config = config(root);
        config.locales = vec!["en".to_owned(), "de".to_owned()];
        config.catalogs.truncate(1);
        config
    }

    fn fcl_config(root: &Path) -> CatalogArtifactConfig {
        let mut config = config(root);
        config.locales = vec!["en".to_owned(), "de".to_owned()];
        config.catalogs.remove(0);
        config
    }

    fn two_catalog_config(root: &Path) -> CatalogArtifactConfig {
        CatalogArtifactConfig {
            root_dir: root.to_string_lossy().into_owned(),
            locales: vec!["en".to_owned(), "de".to_owned()],
            source_locale: "en".to_owned(),
            fallback_locales: None,
            pseudo_locale: None,
            catalogs: vec![
                CatalogConfig {
                    path: "first/{locale}".to_owned(),
                    format: PalamedesCatalogFormat::Po,
                },
                CatalogConfig {
                    path: "second/{locale}".to_owned(),
                    format: PalamedesCatalogFormat::Po,
                },
            ],
        }
    }

    fn write_catalog_matrix(root: &Path) {
        for locale in ["de", "fr"] {
            write_po_fixture(&root.join(format!("messages/{locale}.po")), locale);
            write_fcl_fixture(&root.join(format!("features/{locale}.fcl")), locale);
        }
    }

    fn write_po_fixture(path: &Path, locale: &str) {
        fs::create_dir_all(path.parent().unwrap()).expect("catalog parent");
        let lock = machine_translation_hash(EffectiveTranslationRef::Singular("Maschinell"));
        let content = FIXTURE
            .replace("{{LOCK}}", &lock)
            .replace("Language: de", &format!("Language: {locale}"));
        fs::write(path, content).expect("write PO fixture");
    }

    fn write_fcl_fixture(path: &Path, locale: &str) {
        let temporary = path.with_extension("po");
        write_po_fixture(&temporary, locale);
        let po = fs::read_to_string(&temporary).expect("read PO fixture");
        let fcl = convert_catalog(
            ConvertCatalogOptions::new(&po, "en", CatalogMode::IcuPo, CatalogMode::IcuFcl)
                .with_locale(locale),
        )
        .expect("convert fixture to FCL")
        .content;
        fs::write(path, fcl).expect("write FCL fixture");
        fs::remove_file(temporary).expect("remove temporary PO fixture");
    }

    fn id(
        catalog: &str,
        locale: &str,
        message: &str,
        context: Option<&str>,
    ) -> TranslationCandidateId {
        TranslationCandidateId {
            catalog: catalog.to_owned(),
            locale: locale.to_owned(),
            message: message.to_owned(),
            context: context.map(str::to_owned),
        }
    }

    fn candidate<'a>(
        candidates: &'a [TranslationCandidate],
        message: &str,
    ) -> &'a TranslationCandidate {
        candidates
            .iter()
            .find(|candidate| candidate.id.message == message)
            .unwrap_or_else(|| panic!("missing candidate {message}"))
    }

    fn singular_patch(candidate: &TranslationCandidate, value: &str) -> TranslationPatch {
        TranslationPatch {
            id: candidate.id.clone(),
            fingerprint: candidate.fingerprint.clone(),
            translation: TranslationValue::Singular {
                value: value.to_owned(),
            },
            machine: None,
        }
    }

    #[cfg(unix)]
    fn count_open_fds() -> Option<usize> {
        for dir in ["/dev/fd", "/proc/self/fd"] {
            if let Ok(entries) = fs::read_dir(dir) {
                return Some(entries.count());
            }
        }
        None
    }

    #[cfg(unix)]
    #[test]
    fn multi_locale_patch_batch_bounds_open_file_descriptors() {
        let fixture = tempfile::tempdir().expect("fixture directory");
        let locale_count = 100usize;
        let mut locales = Vec::with_capacity(locale_count + 1);
        locales.push("en".to_owned());
        write_po_fixture(&fixture.path().join("locales/en/messages.po"), "en");
        for idx in 0..locale_count {
            let locale = format!("loc-{idx:03}");
            write_po_fixture(
                &fixture.path().join(format!("locales/{locale}/messages.po")),
                &locale,
            );
            locales.push(locale);
        }

        let make_config = || CatalogArtifactConfig {
            root_dir: fixture.path().to_string_lossy().into_owned(),
            locales: locales.clone(),
            source_locale: "en".to_owned(),
            fallback_locales: None,
            pseudo_locale: None,
            catalogs: vec![CatalogConfig {
                path: "locales/{locale}/messages".to_owned(),
                format: PalamedesCatalogFormat::Po,
            }],
        };

        let listed = list_translation_candidates(&TranslationCandidateRequest {
            config: make_config(),
            locales: locales[1..].to_vec(),
            targets: Vec::new(),
            max_origins: 8,
        })
        .expect("list candidates across 100 locale directories");

        let mut patches = Vec::with_capacity(locale_count);
        for locale in &locales[1..] {
            let entry = listed
                .candidates
                .iter()
                .find(|c| c.id.locale == *locale && c.id.message == "Hello")
                .expect("Hello candidate");
            patches.push(singular_patch(entry, &format!("Hello-{locale}")));
        }

        let baseline_fds = count_open_fds();
        let mut peak_fd_delta = 0usize;
        let result = apply_translation_patches_with_replacement(
            TranslationPatchRequest {
                config: make_config(),
                po: None,
                patches,
            },
            |catalog, source_locale, po| {
                if let (Some(base), Some(current)) = (baseline_fds, count_open_fds()) {
                    peak_fd_delta = peak_fd_delta.max(current.saturating_sub(base));
                }
                atomic_replace_catalog(catalog, source_locale, po)
            },
        )
        .expect("100-locale batch must succeed with bounded open descriptors");

        assert!(result.updated);
        assert_eq!(result.stats.catalogs_updated, locale_count);
        assert_eq!(result.stats.applied, locale_count);
        if baseline_fds.is_some() {
            assert!(
                peak_fd_delta <= 32,
                "expected O(1) open descriptors across {locale_count} locale directories, observed peak delta {peak_fd_delta}"
            );
        }
    }

    #[test]
    fn patch_batch_rejects_aliased_catalogs_when_file_identity_is_unavailable() {
        use super::{DirFilenameEquivalence, apply_translation_patches_with_options};

        for simulated_eq in [
            Some(DirFilenameEquivalence::CaseInsensitiveNtfs),
            None, // FAT32 / exFAT / SMB where FileCaseSensitiveInformation is also unavailable
        ] {
            let fixture = tempfile::tempdir().expect("fixture directory");
            let upper_path = fixture.path().join("Locales/de.po");
            let lower_path = fixture.path().join("locales/de.po");
            write_po_fixture(&fixture.path().join("Locales/en.po"), "en");
            write_po_fixture(&fixture.path().join("locales/en.po"), "en");
            write_po_fixture(&upper_path, "de");
            if !lower_path.exists() {
                write_po_fixture(&lower_path, "de");
            }
            let before_upper = fs::read_to_string(&upper_path).expect("read upper before");
            let before_lower = fs::read_to_string(&lower_path).expect("read lower before");

            let make_config = || CatalogArtifactConfig {
                root_dir: fixture.path().to_string_lossy().into_owned(),
                locales: vec!["en".to_owned(), "de".to_owned()],
                source_locale: "en".to_owned(),
                fallback_locales: None,
                pseudo_locale: None,
                catalogs: vec![
                    CatalogConfig {
                        path: "Locales/{locale}".to_owned(),
                        format: PalamedesCatalogFormat::Po,
                    },
                    CatalogConfig {
                        path: "locales/{locale}".to_owned(),
                        format: PalamedesCatalogFormat::Po,
                    },
                ],
            };

            let listed = list_translation_candidates(&TranslationCandidateRequest {
                config: make_config(),
                locales: vec!["de".to_owned()],
                targets: Vec::new(),
                max_origins: 8,
            })
            .expect("list candidates");
            let upper_candidate = listed
                .candidates
                .iter()
                .find(|c| c.id.catalog == "Locales/{locale}" && c.id.message == "Hello")
                .expect("upper Hello candidate");
            let lower_candidate = listed
                .candidates
                .iter()
                .find(|c| c.id.catalog == "locales/{locale}" && c.id.message == "Hello")
                .expect("lower Hello candidate");

            let mut writes = 0usize;
            let result = apply_translation_patches_with_options(
                TranslationPatchRequest {
                    config: make_config(),
                    po: None,
                    patches: vec![
                        singular_patch(upper_candidate, "Hallo Upper"),
                        singular_patch(lower_candidate, "Hallo Lower"),
                    ],
                },
                |catalog, source_locale, po| {
                    writes += 1;
                    atomic_replace_catalog(catalog, source_locale, po)
                },
                true,
                Some(simulated_eq),
                None,
            )
            .expect("ambiguous batch returns structured rejection");

            assert!(!result.updated, "ambiguous batch must not update files");
            assert_eq!(writes, 0, "Phase 2 must not commit any write");
            assert_eq!(result.stats.applied, 0);
            assert_eq!(result.diagnostics.len(), 2);
            assert!(
                result
                    .diagnostics
                    .iter()
                    .all(|diag| diag.code == "translation.ambiguous_catalog"),
                "expected translation.ambiguous_catalog diagnostics, got {:?}",
                result.diagnostics
            );
            assert_eq!(
                fs::read_to_string(&upper_path).expect("read upper after"),
                before_upper
            );
            assert_eq!(
                fs::read_to_string(&lower_path).expect("read lower after"),
                before_lower
            );
        }

        // Distinct files (different locales) still succeed when file_identity is unavailable.
        let fixture = tempfile::tempdir().expect("fixture directory");
        write_po_fixture(&fixture.path().join("locales/en.po"), "en");
        write_po_fixture(&fixture.path().join("locales/de.po"), "de");
        write_po_fixture(&fixture.path().join("locales/fr.po"), "fr");
        let make_distinct_config = || CatalogArtifactConfig {
            root_dir: fixture.path().to_string_lossy().into_owned(),
            locales: vec!["en".to_owned(), "de".to_owned(), "fr".to_owned()],
            source_locale: "en".to_owned(),
            fallback_locales: None,
            pseudo_locale: None,
            catalogs: vec![CatalogConfig {
                path: "locales/{locale}".to_owned(),
                format: PalamedesCatalogFormat::Po,
            }],
        };
        let listed = list_translation_candidates(&TranslationCandidateRequest {
            config: make_distinct_config(),
            locales: vec!["de".to_owned(), "fr".to_owned()],
            targets: Vec::new(),
            max_origins: 8,
        })
        .expect("list distinct candidates");
        let de_candidate = listed
            .candidates
            .iter()
            .find(|c| c.id.locale == "de" && c.id.message == "Hello")
            .expect("de Hello");
        let fr_candidate = listed
            .candidates
            .iter()
            .find(|c| c.id.locale == "fr" && c.id.message == "Hello")
            .expect("fr Hello");
        let result = apply_translation_patches_with_options(
            TranslationPatchRequest {
                config: make_distinct_config(),
                po: None,
                patches: vec![
                    singular_patch(de_candidate, "Hallo"),
                    singular_patch(fr_candidate, "Bonjour"),
                ],
            },
            atomic_replace_catalog,
            true,
            Some(Some(DirFilenameEquivalence::CaseInsensitiveNtfs)),
            None,
        )
        .expect("distinct locales must succeed when file_identity is unavailable");
        assert!(result.updated);
        assert_eq!(result.stats.applied, 2);
        assert_eq!(result.stats.catalogs_updated, 2);
    }

    #[test]
    fn patch_batch_rejects_8dot3_aliased_catalogs_when_file_identity_is_unavailable() {
        use super::{DirFilenameEquivalence, apply_translation_patches_with_options};

        let fixture = tempfile::tempdir().expect("fixture directory");
        write_po_fixture(&fixture.path().join("LongDirectory/en.po"), "en");
        write_po_fixture(&fixture.path().join("LongDirectory/de.po"), "de");
        write_po_fixture(&fixture.path().join("LONGDI~1/en.po"), "en");
        write_po_fixture(&fixture.path().join("LONGDI~1/de.po"), "de");

        let make_config = || CatalogArtifactConfig {
            root_dir: fixture.path().to_string_lossy().into_owned(),
            locales: vec!["en".to_owned(), "de".to_owned()],
            source_locale: "en".to_owned(),
            fallback_locales: None,
            pseudo_locale: None,
            catalogs: vec![
                CatalogConfig {
                    path: "LongDirectory/{locale}".to_owned(),
                    format: PalamedesCatalogFormat::Po,
                },
                CatalogConfig {
                    path: "LONGDI~1/{locale}".to_owned(),
                    format: PalamedesCatalogFormat::Po,
                },
            ],
        };
        let listed = list_translation_candidates(&TranslationCandidateRequest {
            config: make_config(),
            locales: vec!["de".to_owned()],
            targets: Vec::new(),
            max_origins: 8,
        })
        .expect("list 8.3 candidates");
        let long_candidate = listed
            .candidates
            .iter()
            .find(|c| c.id.catalog == "LongDirectory/{locale}" && c.id.message == "Hello")
            .expect("long Hello");
        let short_candidate = listed
            .candidates
            .iter()
            .find(|c| c.id.catalog == "LONGDI~1/{locale}" && c.id.message == "Hello")
            .expect("short Hello");

        // 1. When the filesystem confirms or cannot disprove that `LONGDI~1` aliases
        // `LongDirectory`, reject the ambiguous batch before any write occurs.
        for probe_outcome in [Some(true), None] {
            let mut writes = 0usize;
            let result = apply_translation_patches_with_options(
                TranslationPatchRequest {
                    config: make_config(),
                    po: None,
                    patches: vec![
                        singular_patch(long_candidate, "Hallo Long"),
                        singular_patch(short_candidate, "Hallo Short"),
                    ],
                },
                |catalog, source_locale, po| {
                    writes += 1;
                    atomic_replace_catalog(catalog, source_locale, po)
                },
                true,
                Some(Some(DirFilenameEquivalence::CaseInsensitiveNtfs)),
                Some(probe_outcome),
            )
            .expect("8.3 aliased batch returns structured rejection");

            assert!(!result.updated);
            assert_eq!(writes, 0);
            assert_eq!(result.stats.applied, 0);
            assert_eq!(result.diagnostics.len(), 2);
            assert!(
                result
                    .diagnostics
                    .iter()
                    .all(|diag| diag.code == "translation.ambiguous_catalog")
            );
        }

        // 2. When the live filesystem disproves aliasing (two separately created
        // directories whose names match the 8.3 heuristic, using `LONGDI~2` so
        // `LongDirectory` and `LONGDI~2` remain genuinely distinct even on
        // Windows volumes with 8.3 short names enabled where `LongDirectory`
        // gets `LONGDI~1`), the batch succeeds!
        let distinct_fixture = tempfile::tempdir().expect("distinct 8.3 fixture directory");
        write_po_fixture(&distinct_fixture.path().join("LongDirectory/en.po"), "en");
        write_po_fixture(&distinct_fixture.path().join("LongDirectory/de.po"), "de");
        write_po_fixture(&distinct_fixture.path().join("LONGDI~2/en.po"), "en");
        write_po_fixture(&distinct_fixture.path().join("LONGDI~2/de.po"), "de");
        let make_distinct_config = || CatalogArtifactConfig {
            root_dir: distinct_fixture.path().to_string_lossy().into_owned(),
            locales: vec!["en".to_owned(), "de".to_owned()],
            source_locale: "en".to_owned(),
            fallback_locales: None,
            pseudo_locale: None,
            catalogs: vec![
                CatalogConfig {
                    path: "LongDirectory/{locale}".to_owned(),
                    format: PalamedesCatalogFormat::Po,
                },
                CatalogConfig {
                    path: "LONGDI~2/{locale}".to_owned(),
                    format: PalamedesCatalogFormat::Po,
                },
            ],
        };
        let distinct_listed = list_translation_candidates(&TranslationCandidateRequest {
            config: make_distinct_config(),
            locales: vec!["de".to_owned()],
            targets: Vec::new(),
            max_origins: 8,
        })
        .expect("list distinct 8.3 candidates");
        let distinct_long = distinct_listed
            .candidates
            .iter()
            .find(|c| c.id.catalog == "LongDirectory/{locale}" && c.id.message == "Hello")
            .expect("distinct long Hello");
        let distinct_short = distinct_listed
            .candidates
            .iter()
            .find(|c| c.id.catalog == "LONGDI~2/{locale}" && c.id.message == "Hello")
            .expect("distinct short Hello");
        let result = apply_translation_patches_with_options(
            TranslationPatchRequest {
                config: make_distinct_config(),
                po: None,
                patches: vec![
                    singular_patch(distinct_long, "Hallo Long"),
                    singular_patch(distinct_short, "Hallo Short"),
                ],
            },
            atomic_replace_catalog,
            true,
            Some(Some(DirFilenameEquivalence::CaseInsensitiveNtfs)),
            None,
        )
        .expect("separately created LongDirectory and LONGDI~2 must succeed when distinct on disk");
        assert!(result.updated);
        assert_eq!(result.stats.applied, 2);
        assert_eq!(result.stats.catalogs_updated, 2);
    }

    #[test]
    fn patch_batch_rejects_ntfs_sigma_alias_when_file_identity_is_unavailable() {
        use super::{DirFilenameEquivalence, apply_translation_patches_with_options};

        // Always test Greek sigma vs capital sigma (`σ`/`Σ`) under both
        // confirmed NTFS and unknown equivalence on all platforms (matching
        // Windows `RtlUpcaseUnicodeChar` as well as non-Windows `$UpCase`),
        // and test sigma vs final sigma (`σ`/`ς`) under unknown equivalence on
        // all platforms plus confirmed NTFS on non-Windows hosts (real Windows
        // `RtlUpcaseUnicodeChar` keeps U+03C2 distinct from U+03A3).
        let mut cases = vec![
            (
                "\u{03c3}",
                "\u{03a3}",
                Some(DirFilenameEquivalence::CaseInsensitiveNtfs),
            ),
            ("\u{03c3}", "\u{03a3}", None),
            ("\u{03c3}", "\u{03c2}", None),
        ];
        #[cfg(not(windows))]
        cases.push((
            "\u{03c3}",
            "\u{03c2}",
            Some(DirFilenameEquivalence::CaseInsensitiveNtfs),
        ));

        for (first_dir, second_dir, simulated_eq) in cases {
            let fixture = tempfile::tempdir().expect("fixture directory");
            let sigma_path = fixture.path().join(format!("{first_dir}/de.po"));
            let second_path = fixture.path().join(format!("{second_dir}/de.po"));
            write_po_fixture(&fixture.path().join(format!("{first_dir}/en.po")), "en");
            write_po_fixture(&fixture.path().join(format!("{second_dir}/en.po")), "en");
            write_po_fixture(&sigma_path, "de");
            if !second_path.exists() {
                write_po_fixture(&second_path, "de");
            }
            let before_sigma = fs::read_to_string(&sigma_path).expect("read sigma before");
            let before_second = fs::read_to_string(&second_path).expect("read second before");

            let first_pattern = format!("{first_dir}/{{locale}}");
            let second_pattern = format!("{second_dir}/{{locale}}");
            let make_config = || CatalogArtifactConfig {
                root_dir: fixture.path().to_string_lossy().into_owned(),
                locales: vec!["en".to_owned(), "de".to_owned()],
                source_locale: "en".to_owned(),
                fallback_locales: None,
                pseudo_locale: None,
                catalogs: vec![
                    CatalogConfig {
                        path: first_pattern.clone(),
                        format: PalamedesCatalogFormat::Po,
                    },
                    CatalogConfig {
                        path: second_pattern.clone(),
                        format: PalamedesCatalogFormat::Po,
                    },
                ],
            };
            let listed = list_translation_candidates(&TranslationCandidateRequest {
                config: make_config(),
                locales: vec!["de".to_owned()],
                targets: Vec::new(),
                max_origins: 8,
            })
            .expect("list Greek sigma candidates");
            let sigma_candidate = listed
                .candidates
                .iter()
                .find(|c| c.id.catalog == first_pattern && c.id.message == "Hello")
                .expect("sigma Hello");
            let second_candidate = listed
                .candidates
                .iter()
                .find(|c| c.id.catalog == second_pattern && c.id.message == "Hello")
                .expect("second sigma Hello");

            let mut writes = 0usize;
            let result = apply_translation_patches_with_options(
                TranslationPatchRequest {
                    config: make_config(),
                    po: None,
                    patches: vec![
                        singular_patch(sigma_candidate, "Hallo Sigma"),
                        singular_patch(second_candidate, "Hallo Second Sigma"),
                    ],
                },
                |catalog, source_locale, po| {
                    writes += 1;
                    atomic_replace_catalog(catalog, source_locale, po)
                },
                true,
                Some(simulated_eq),
                None,
            )
            .expect("sigma alias returns structured rejection");

            assert!(!result.updated);
            assert_eq!(writes, 0, "Phase 2 must not commit any write");
            assert_eq!(result.stats.applied, 0);
            assert_eq!(result.diagnostics.len(), 2);
            assert!(
                result
                    .diagnostics
                    .iter()
                    .all(|diag| diag.code == "translation.ambiguous_catalog"),
                "expected translation.ambiguous_catalog for {first_dir}/{second_dir} pair ({simulated_eq:?}), got {:?}",
                result.diagnostics
            );
            assert_eq!(
                fs::read_to_string(&sigma_path).expect("read sigma after"),
                before_sigma
            );
            assert_eq!(
                fs::read_to_string(&second_path).expect("read second after"),
                before_second
            );
        }
    }

    #[test]
    fn patch_batch_rejects_nfc_nfd_aliased_catalogs_when_file_identity_is_unavailable() {
        use super::apply_translation_patches_with_options;

        let fixture = tempfile::tempdir().expect("fixture directory");
        let nfc_scope = "caf\u{00e9}/{locale}";
        let nfd_scope = "cafe\u{0301}/{locale}";
        let nfc_path = fixture.path().join("caf\u{00e9}/de.po");
        let nfd_path = fixture.path().join("cafe\u{0301}/de.po");
        write_po_fixture(&fixture.path().join("caf\u{00e9}/en.po"), "en");
        write_po_fixture(&fixture.path().join("cafe\u{0301}/en.po"), "en");
        write_po_fixture(&nfc_path, "de");
        if !nfd_path.exists() {
            write_po_fixture(&nfd_path, "de");
        }
        let before_nfc = fs::read_to_string(&nfc_path).expect("read nfc before");
        let before_nfd = fs::read_to_string(&nfd_path).expect("read nfd before");

        let make_config = || CatalogArtifactConfig {
            root_dir: fixture.path().to_string_lossy().into_owned(),
            locales: vec!["en".to_owned(), "de".to_owned()],
            source_locale: "en".to_owned(),
            fallback_locales: None,
            pseudo_locale: None,
            catalogs: vec![
                CatalogConfig {
                    path: nfc_scope.to_owned(),
                    format: PalamedesCatalogFormat::Po,
                },
                CatalogConfig {
                    path: nfd_scope.to_owned(),
                    format: PalamedesCatalogFormat::Po,
                },
            ],
        };
        let listed = list_translation_candidates(&TranslationCandidateRequest {
            config: make_config(),
            locales: vec!["de".to_owned()],
            targets: Vec::new(),
            max_origins: 8,
        })
        .expect("list NFC/NFD candidates");
        let nfc_candidate = listed
            .candidates
            .iter()
            .find(|c| c.id.catalog == nfc_scope && c.id.message == "Hello")
            .expect("nfc Hello");
        let nfd_candidate = listed
            .candidates
            .iter()
            .find(|c| c.id.catalog == nfd_scope && c.id.message == "Hello")
            .expect("nfd Hello");

        let mut writes = 0usize;
        let result = apply_translation_patches_with_options(
            TranslationPatchRequest {
                config: make_config(),
                po: None,
                patches: vec![
                    singular_patch(nfc_candidate, "Hallo NFC"),
                    singular_patch(nfd_candidate, "Hallo NFD"),
                ],
            },
            |catalog, source_locale, po| {
                writes += 1;
                atomic_replace_catalog(catalog, source_locale, po)
            },
            true,
            Some(None),
            None,
        )
        .expect("NFC/NFD alias returns structured rejection");

        assert!(!result.updated);
        assert_eq!(writes, 0, "Phase 2 must not commit any write");
        assert_eq!(result.stats.applied, 0);
        assert_eq!(result.diagnostics.len(), 2);
        assert!(
            result
                .diagnostics
                .iter()
                .all(|diag| diag.code == "translation.ambiguous_catalog"),
            "expected translation.ambiguous_catalog for NFC/NFD pair, got {:?}",
            result.diagnostics
        );
        assert_eq!(
            fs::read_to_string(&nfc_path).expect("read nfc after"),
            before_nfc
        );
        assert_eq!(
            fs::read_to_string(&nfd_path).expect("read nfd after"),
            before_nfd
        );
    }

    #[test]
    fn patch_rejects_write_that_collides_with_unpatched_source_or_other_configured_catalog() {
        use super::{DirFilenameEquivalence, apply_translation_patches_with_options};

        // 1. Single patch to `{locale}/en/messages` (`de`) must be rejected as
        // `translation.source_locale_read_only` when unpatched `de\{locale}\messages`
        // (`en`, source locale) resolves to the same `de/en/messages.po` file.
        let fixture = tempfile::tempdir().expect("source collision fixture");
        let shared_path = fixture.path().join("de/en/messages.po");
        write_po_fixture(&fixture.path().join("en/en/messages.po"), "en");
        write_po_fixture(&shared_path, "de");
        write_po_fixture(&fixture.path().join("de/de/messages.po"), "de");
        let before = fs::read_to_string(&shared_path).expect("read shared before");

        let make_config = || CatalogArtifactConfig {
            root_dir: fixture.path().to_string_lossy().into_owned(),
            locales: vec!["en".to_owned(), "de".to_owned()],
            source_locale: "en".to_owned(),
            fallback_locales: None,
            pseudo_locale: None,
            catalogs: vec![
                CatalogConfig {
                    path: "{locale}/en/messages".to_owned(),
                    format: PalamedesCatalogFormat::Po,
                },
                CatalogConfig {
                    path: r"de\{locale}\messages".to_owned(),
                    format: PalamedesCatalogFormat::Po,
                },
            ],
        };
        let listed = list_translation_candidates(&TranslationCandidateRequest {
            config: make_config(),
            locales: vec!["de".to_owned()],
            targets: Vec::new(),
            max_origins: 8,
        })
        .expect("list candidates");
        let candidate = listed
            .candidates
            .iter()
            .find(|c| c.id.catalog == "{locale}/en/messages" && c.id.message == "Hello")
            .expect("target Hello");

        let mut writes = 0usize;
        let result = apply_translation_patches_with_options(
            TranslationPatchRequest {
                config: make_config(),
                po: None,
                patches: vec![singular_patch(candidate, "Hallo")],
            },
            |catalog, source_locale, po| {
                writes += 1;
                atomic_replace_catalog(catalog, source_locale, po)
            },
            false,
            None,
            None,
        )
        .expect("collision with unpatched source catalog returns structured rejection");

        assert!(!result.updated);
        assert_eq!(writes, 0);
        assert_eq!(result.stats.applied, 0);
        assert!(
            result
                .diagnostics
                .iter()
                .any(|diag| diag.code == "translation.source_locale"),
            "expected translation.source_locale, got {:?}",
            result.diagnostics
        );
        assert_eq!(
            fs::read_to_string(&shared_path).expect("read shared after"),
            before
        );

        // 2. Single patch to `{locale}/fr/messages` (`de`) must be rejected as
        // `translation.ambiguous_catalog` when unpatched `de/{locale}/messages`
        // (`fr`) resolves to the same `de/fr/messages.po` file.
        let non_source_fixture = tempfile::tempdir().expect("non-source collision fixture");
        let fr_shared = non_source_fixture.path().join("de/fr/messages.po");
        write_po_fixture(&non_source_fixture.path().join("en/fr/messages.po"), "en");
        write_po_fixture(&non_source_fixture.path().join("de/en/messages.po"), "en");
        write_po_fixture(&non_source_fixture.path().join("de/de/messages.po"), "de");
        write_po_fixture(&fr_shared, "de");
        let before_fr = fs::read_to_string(&fr_shared).expect("read fr shared before");
        let make_non_source_config = || CatalogArtifactConfig {
            root_dir: non_source_fixture.path().to_string_lossy().into_owned(),
            locales: vec!["en".to_owned(), "de".to_owned(), "fr".to_owned()],
            source_locale: "en".to_owned(),
            fallback_locales: None,
            pseudo_locale: None,
            catalogs: vec![
                CatalogConfig {
                    path: "{locale}/fr/messages".to_owned(),
                    format: PalamedesCatalogFormat::Po,
                },
                CatalogConfig {
                    path: "de/{locale}/messages".to_owned(),
                    format: PalamedesCatalogFormat::Po,
                },
            ],
        };
        let listed_fr = list_translation_candidates(&TranslationCandidateRequest {
            config: make_non_source_config(),
            locales: vec!["de".to_owned()],
            targets: Vec::new(),
            max_origins: 8,
        })
        .expect("list fr collision candidates");
        let fr_candidate = listed_fr
            .candidates
            .iter()
            .find(|c| c.id.catalog == "{locale}/fr/messages" && c.id.message == "Hello")
            .expect("fr target Hello");
        let mut fr_writes = 0usize;
        let fr_result = apply_translation_patches_with_options(
            TranslationPatchRequest {
                config: make_non_source_config(),
                po: None,
                patches: vec![singular_patch(fr_candidate, "Hallo")],
            },
            |catalog, source_locale, po| {
                fr_writes += 1;
                atomic_replace_catalog(catalog, source_locale, po)
            },
            false,
            None,
            None,
        )
        .expect("collision with unpatched non-source catalog returns structured rejection");
        assert!(!fr_result.updated);
        assert_eq!(fr_writes, 0);
        assert!(
            fr_result
                .diagnostics
                .iter()
                .any(|diag| diag.code == "translation.ambiguous_catalog"),
            "expected translation.ambiguous_catalog, got {:?}",
            fr_result.diagnostics
        );
        assert_eq!(
            fs::read_to_string(&fr_shared).expect("read fr shared after"),
            before_fr
        );

        // 3. Single patch must also be rejected when an unpatched source-locale
        // catalog aliases it via case-folding when file_identity is unavailable.
        let ci_fixture = tempfile::tempdir().expect("ci source collision fixture");
        let ci_target = ci_fixture.path().join("de/en/messages.po");
        write_po_fixture(&ci_fixture.path().join("en/en/messages.po"), "en");
        write_po_fixture(&ci_fixture.path().join("DE/en/messages.po"), "en");
        write_po_fixture(&ci_fixture.path().join("DE/de/messages.po"), "de");
        write_po_fixture(&ci_target, "de");
        let make_ci_config = || CatalogArtifactConfig {
            root_dir: ci_fixture.path().to_string_lossy().into_owned(),
            locales: vec!["en".to_owned(), "de".to_owned()],
            source_locale: "en".to_owned(),
            fallback_locales: None,
            pseudo_locale: None,
            catalogs: vec![
                CatalogConfig {
                    path: "{locale}/en/messages".to_owned(),
                    format: PalamedesCatalogFormat::Po,
                },
                CatalogConfig {
                    path: "DE/{locale}/messages".to_owned(),
                    format: PalamedesCatalogFormat::Po,
                },
            ],
        };
        let listed_ci = list_translation_candidates(&TranslationCandidateRequest {
            config: make_ci_config(),
            locales: vec!["de".to_owned()],
            targets: Vec::new(),
            max_origins: 8,
        })
        .expect("list ci candidates");
        let ci_candidate = listed_ci
            .candidates
            .iter()
            .find(|c| c.id.catalog == "{locale}/en/messages" && c.id.message == "Hello")
            .expect("ci target Hello");
        let mut ci_writes = 0usize;
        let ci_result = apply_translation_patches_with_options(
            TranslationPatchRequest {
                config: make_ci_config(),
                po: None,
                patches: vec![singular_patch(ci_candidate, "Hallo")],
            },
            |catalog, source_locale, po| {
                ci_writes += 1;
                atomic_replace_catalog(catalog, source_locale, po)
            },
            true,
            Some(Some(DirFilenameEquivalence::CaseInsensitiveNtfs)),
            None,
        )
        .expect("ci source alias returns structured rejection");
        assert!(!ci_result.updated);
        assert_eq!(ci_writes, 0);
        assert!(
            ci_result
                .diagnostics
                .iter()
                .any(|diag| diag.code == "translation.source_locale"),
            "expected translation.source_locale on case-folded unpatched source catalog, got {:?}",
            ci_result.diagnostics
        );
    }

    #[cfg(unix)]
    #[test]
    fn patch_rejects_when_unpatched_source_catalog_is_symlink_to_target() {
        use std::os::unix::fs::symlink;

        // 1. Unpatched source catalog file symlinked to the patched target catalog.
        let file_fixture = tempfile::tempdir().expect("symlinked source file fixture");
        let de_path = file_fixture.path().join("locales/de/messages.po");
        let en_dir = file_fixture.path().join("locales/en");
        fs::create_dir_all(&en_dir).expect("create en dir");
        write_po_fixture(&de_path, "de");
        let before = fs::read_to_string(&de_path).expect("read de before");
        symlink(&de_path, en_dir.join("messages.po")).expect("symlink en -> de");

        let config = CatalogArtifactConfig {
            root_dir: file_fixture.path().to_string_lossy().into_owned(),
            locales: vec!["en".to_owned(), "de".to_owned()],
            source_locale: "en".to_owned(),
            fallback_locales: None,
            pseudo_locale: None,
            catalogs: vec![CatalogConfig {
                path: "locales/{locale}/messages".to_owned(),
                format: PalamedesCatalogFormat::Po,
            }],
        };
        let mut writes = 0usize;
        let err = apply_translation_patches_with_replacement(
            TranslationPatchRequest {
                config,
                po: None,
                patches: vec![TranslationPatch {
                    id: TranslationCandidateId {
                        catalog: "locales/{locale}/messages".to_owned(),
                        locale: "de".to_owned(),
                        message: "Hello".to_owned(),
                        context: None,
                    },
                    fingerprint: "placeholder".to_owned(),
                    translation: TranslationValue::Singular {
                        value: "Hallo".to_owned(),
                    },
                    machine: None,
                }],
            },
            |catalog, source_locale, po| {
                writes += 1;
                atomic_replace_catalog(catalog, source_locale, po)
            },
        )
        .expect_err("symlinked unpatched source catalog file must abort before writing");
        assert!(
            matches!(err, PalamedesError::UnsafeCatalogPath { .. }),
            "expected UnsafeCatalogPath for symlinked source file, got {err:?}"
        );
        assert_eq!(writes, 0);
        assert_eq!(fs::read_to_string(&de_path).expect("read de after"), before);

        // 2. Unpatched source catalog directory symlinked to the patched target directory.
        let dir_fixture = tempfile::tempdir().expect("symlinked source dir fixture");
        let de_dir_path = dir_fixture.path().join("locales/de/messages.po");
        write_po_fixture(&de_dir_path, "de");
        let before_dir = fs::read_to_string(&de_dir_path).expect("read de dir before");
        symlink(
            dir_fixture.path().join("locales/de"),
            dir_fixture.path().join("locales/en"),
        )
        .expect("symlink en dir -> de dir");

        let dir_config = CatalogArtifactConfig {
            root_dir: dir_fixture.path().to_string_lossy().into_owned(),
            locales: vec!["en".to_owned(), "de".to_owned()],
            source_locale: "en".to_owned(),
            fallback_locales: None,
            pseudo_locale: None,
            catalogs: vec![CatalogConfig {
                path: "locales/{locale}/messages".to_owned(),
                format: PalamedesCatalogFormat::Po,
            }],
        };
        let mut dir_writes = 0usize;
        let dir_err = apply_translation_patches_with_replacement(
            TranslationPatchRequest {
                config: dir_config,
                po: None,
                patches: vec![TranslationPatch {
                    id: TranslationCandidateId {
                        catalog: "locales/{locale}/messages".to_owned(),
                        locale: "de".to_owned(),
                        message: "Hello".to_owned(),
                        context: None,
                    },
                    fingerprint: "placeholder".to_owned(),
                    translation: TranslationValue::Singular {
                        value: "Hallo".to_owned(),
                    },
                    machine: None,
                }],
            },
            |catalog, source_locale, po| {
                dir_writes += 1;
                atomic_replace_catalog(catalog, source_locale, po)
            },
        )
        .expect_err("symlinked unpatched source catalog directory must abort before writing");
        assert!(
            matches!(dir_err, PalamedesError::UnsafeCatalogPath { .. }),
            "expected UnsafeCatalogPath for symlinked source dir, got {dir_err:?}"
        );
        assert_eq!(dir_writes, 0);
        assert_eq!(
            fs::read_to_string(&de_dir_path).expect("read de dir after"),
            before_dir
        );
    }
}
