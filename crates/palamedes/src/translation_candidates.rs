use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::io::Write;
use std::path::PathBuf;

use ferrocat::{
    convert_catalog, machine_translation_hash, CatalogMessageKey, CatalogMode,
    ConvertCatalogOptions, EffectiveTranslationRef, Header, MsgStr, PoFile, PoItem,
    SerializeOptions,
};
use ferrocat_icu::{parse_icu, stringify_icu, IcuMessage, IcuNode, IcuOption, IcuPluralKind};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[cfg(test)]
thread_local! {
    static SOURCE_CATALOG_PARSE_COUNT: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

use crate::catalog_artifact::resolve_catalog_path;
use crate::catalog_update::{po_serialize_options, AiProvenance, MachineMetadata};
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
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
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
    locale: String,
    patch_indexes: Vec<usize>,
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
    mut replace_catalog: F,
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

    let mut prepared = Vec::new();
    for (batch, patch_indexes) in groups {
        let catalog = &request.config.catalogs[batch.catalog_index];
        let mut loaded = load_catalog(&request.config, catalog, &batch.locale)?;
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
            if let Err(message) = validate_patch_translation(&current.source, &patch.translation) {
                rejected.insert(patch_index);
                diagnostics.push(workflow_diagnostic(
                    "translation.shape_mismatch",
                    message,
                    Some(patch.id.clone()),
                ));
            }
            if let Some(machine) = &patch.machine {
                if let Err(message) = validate_machine_provenance(machine) {
                    rejected.insert(patch_index);
                    diagnostics.push(workflow_diagnostic(
                        "translation.invalid_provenance",
                        message,
                        Some(patch.id.clone()),
                    ));
                }
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
            prepared.push(PreparedCatalog {
                path: loaded.path,
                locale: batch.locale,
                patch_indexes,
                changed: content != loaded.original,
                content,
            });
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

    let mut completed_patches = BTreeSet::new();
    let mut catalogs_updated = 0;
    let mut replacement_diagnostics = Vec::new();
    for catalog in &prepared {
        if catalog.changed {
            match replace_catalog(catalog, &request.config.source_locale, request.po.as_ref()) {
                Ok(CatalogReplacement::Durable) => {}
                Ok(CatalogReplacement::CommittedWithDurabilityWarning(source)) => {
                    replacement_diagnostics.push(TranslationWorkflowDiagnostic {
                        code: "translation.catalog_durability".to_owned(),
                        message: format!(
                            "Catalog replacement committed, but synchronizing its directory failed: {source}"
                        ),
                        id: None,
                        catalog_path: Some(catalog.path.to_string_lossy().into_owned()),
                        locale: Some(catalog.locale.clone()),
                    });
                }
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
            catalogs_updated += 1;
        }
        completed_patches.extend(&catalog.patch_indexes);
    }

    Ok(completed_translation_patch_result(
        &request.patches,
        &changed_patches,
        &completed_patches,
        catalogs_updated,
        replacement_diagnostics,
    ))
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
    let path = resolve_catalog_path(config, catalog, locale);
    let original = fs::read_to_string(&path).map_err(|source| PalamedesError::ReadFile {
        path: path.clone(),
        source,
    })?;
    let po = parse_catalog_as_po(&original, &config.source_locale, locale, catalog.format)?;
    let mut messages = BTreeMap::new();
    let mut ambiguous_messages = BTreeSet::new();
    for (index, item) in po.items.iter().enumerate() {
        validate_icu_native_po_item(item)?;
        parse_machine_metadata(item)?;
        let key = CatalogMessageKey::new(item.msgid.clone(), item.msgctxt.clone());
        if messages.insert(key.clone(), index).is_some() {
            ambiguous_messages.insert(key);
        }
    }
    let po_item_indexes = po_item_indexes(&po);
    Ok(LoadedCatalog {
        scope: catalog.path.clone(),
        locale: locale.to_owned(),
        path,
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
    let mut declared_order = false;
    for tag in fields {
        let (key, raw_value) = tag.split_once('=').ok_or_else(|| {
            ferrocat::ApiError::InvalidArguments(format!("invalid FCL header tag {tag:?}"))
        })?;
        let value = unescape_fcl(raw_value)?;
        match key {
            "source" => declared_source = Some(value),
            "locale" => {}
            "order" if declared_order => {
                return Err(ferrocat::ApiError::InvalidArguments(
                    "duplicate FCL header key `order`".to_owned(),
                )
                .into())
            }
            "order" if value == "collated" => declared_order = true,
            "order" => {
                return Err(ferrocat::ApiError::InvalidArguments(format!(
                    "unknown FCL order {value:?}"
                ))
                .into())
            }
            _ => {
                return Err(ferrocat::ApiError::InvalidArguments(format!(
                    "unknown FCL header key {key:?}"
                ))
                .into())
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
    let mut po = PoFile {
        headers: vec![Header {
            key: "Language".to_owned(),
            value: locale.to_owned(),
        }],
        ..PoFile::default()
    };
    let mut identities = BTreeSet::new();
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
        if !identities.insert((item.msgid.clone(), item.msgctxt.clone())) {
            return Err(ferrocat::ApiError::Conflict(format!(
                "duplicate FCL entry for id {:?} and context {:?}",
                item.msgid, item.msgctxt
            ))
            .into());
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
                )))
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
                )))
            }
            None => {
                return Err(ferrocat::ApiError::InvalidArguments(
                    "dangling `\\` at end of FCL value".to_owned(),
                ))
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
    let parsed = parse_icu(value).ok()?;
    let [IcuNode::Plural {
        name,
        kind,
        offset,
        options,
    }] = parsed.nodes.as_slice()
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

fn validate_patch_translation(
    source: &TranslationValue,
    translation: &TranslationValue,
) -> Result<(), &'static str> {
    match (source, translation) {
        (TranslationValue::Singular { .. }, TranslationValue::Singular { value }) => {
            if value.is_empty() {
                Err("Completed singular translations must not be empty.")
            } else {
                Ok(())
            }
        }
        (
            TranslationValue::Plural {
                variable: source_variable,
                plural_kind: source_kind,
                offset: source_offset,
                values: source_values,
            },
            TranslationValue::Plural {
                variable,
                plural_kind,
                offset,
                values,
            },
        ) => {
            if variable != source_variable || plural_kind != source_kind || offset != source_offset
            {
                return Err("Plural variable, kind, and offset must match the source candidate.");
            }
            if values.keys().ne(source_values.keys()) {
                return Err(
                    "Plural translation selectors must exactly match the source candidate.",
                );
            }
            if values.values().any(String::is_empty) {
                return Err("Completed plural translation branches must not be empty.");
            }
            Ok(())
        }
        _ => Err("Translation shape must match the source candidate."),
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

fn render_translation_value(value: &TranslationValue) -> PalamedesResult<String> {
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
    atomic_replace_catalog_with_directory_sync(catalog, sync_catalog_directory)
}

fn atomic_replace_catalog_with_directory_sync<F>(
    catalog: &PreparedCatalog,
    sync_directory: F,
) -> PalamedesResult<CatalogReplacement>
where
    F: FnOnce(&std::path::Path) -> std::io::Result<()>,
{
    // `PreparedCatalog::content` has already been rendered into its target format. Writing it
    // directly avoids asking `convert_catalog_file` to parse and render the same catalog again.
    // Keep the replacement atomic and fully durable when the filesystem permits it: sync the
    // temporary content, rename beside the target, then sync the containing directory. `persist`
    // is the visible commit point, so a later directory-sync failure is a successful replacement
    // with an explicit durability warning rather than a false "not applied" error.
    let directory = catalog
        .path
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."));
    fs::create_dir_all(directory).map_err(|source| PalamedesError::WriteFile {
        path: catalog.path.clone(),
        source,
    })?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(directory).map_err(|source| PalamedesError::WriteFile {
            path: catalog.path.clone(),
            source,
        })?;
    temporary
        .write_all(catalog.content.as_bytes())
        .map_err(|source| PalamedesError::WriteFile {
            path: catalog.path.clone(),
            source,
        })?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|source| PalamedesError::WriteFile {
            path: catalog.path.clone(),
            source,
        })?;
    temporary
        .persist(&catalog.path)
        .map_err(|source| PalamedesError::WriteFile {
            path: catalog.path.clone(),
            source: source.error,
        })?;
    Ok(match sync_directory(directory) {
        Ok(()) => CatalogReplacement::Durable,
        Err(source) => CatalogReplacement::CommittedWithDurabilityWarning(source),
    })
}

#[cfg(unix)]
fn sync_catalog_directory(directory: &std::path::Path) -> std::io::Result<()> {
    fs::File::open(directory).and_then(|file| file.sync_all())
}

#[cfg(not(unix))]
fn sync_catalog_directory(_directory: &std::path::Path) -> std::io::Result<()> {
    Ok(())
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
        convert_catalog, machine_translation_hash, parse_catalog, parse_po, CatalogMessageKey,
        CatalogMode, ConvertCatalogOptions, EffectiveTranslationRef, ParseCatalogOptions,
    };

    use super::{
        apply_translation_patches, apply_translation_patches_with_replacement,
        atomic_replace_catalog, atomic_replace_catalog_with_directory_sync, build_candidate,
        find_po_item, list_translation_candidates, load_catalog, po_item_indexes,
        reset_source_catalog_parse_count, source_catalog_parse_count, TranslationCandidate,
        TranslationCandidateId, TranslationCandidateRequest, TranslationMachineProvenance,
        TranslationPatch, TranslationPatchOutcomeStatus, TranslationPatchRequest,
        TranslationPluralKind, TranslationValue,
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
        assert!(result
            .candidates
            .windows(2)
            .all(|pair| pair[0].id <= pair[1].id));
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
        assert!(!result
            .candidates
            .iter()
            .any(|candidate| candidate.id.message == "Old"));

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
        assert!(default_result
            .candidates
            .iter()
            .all(|candidate| candidate.id.locale == "de"));
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
        assert!(missing
            .iter()
            .all(|diagnostic| diagnostic.message.contains("pmds extract")));

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
        assert!(result
            .outcomes
            .iter()
            .all(|outcome| outcome.status == TranslationPatchOutcomeStatus::Applied));

        let path = fixture.path().join("messages/de.po");
        let output = fs::read_to_string(&path).expect("read patched PO");
        assert!(output.contains("\"X-Custom: keep-me\\n\""));
        let raw = parse_po(&output).expect("parse patched PO");
        let hello = raw.items.iter().find(|item| item.msgid == "Hello").unwrap();
        assert_eq!(hello.msgstr.first(), Some("Hallo"));
        assert!(hello
            .references
            .iter()
            .any(|origin| origin == "src/home.tsx#HomePage"));
        assert!(hello.metadata.iter().any(|(key, _)| key == "lock"));
        assert!(hello
            .metadata
            .iter()
            .any(|(key, value)| key == "ai" && value == "example/new:0.9"));
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
        assert!(raw
            .items
            .iter()
            .any(|item| item.msgid == "Old" && item.obsolete));
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
        assert!(diagnostics
            .iter()
            .all(|diagnostic| diagnostic.id.as_ref() == Some(&plural.id)));
        assert!(diagnostics
            .iter()
            .any(|diagnostic| diagnostic.message.contains("translation.values.one")));
        assert!(diagnostics
            .iter()
            .any(|diagnostic| diagnostic.message.contains("translation.values.other")));
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
        assert!(fs::read_to_string(&first_path)
            .expect("read first catalog")
            .contains("msgstr \"Hallo\""));
        assert!(fs::read_to_string(&second_path)
            .expect("read second catalog")
            .contains("msgstr \"\""));
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
        assert!(result.diagnostics[0]
            .message
            .contains("injected directory sync failure"));
        assert!(fs::read_to_string(path)
            .expect("read visibly committed catalog")
            .contains("msgstr \"Hallo\""));
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
        assert!(duplicate
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "translation.duplicate_patch"));
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
        assert!(atomic
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "translation.unknown_message"));
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
        assert!(stale
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "translation.stale_candidate"));
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
        assert!(result
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "translation.ambiguous_message"));
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
}
