use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::Write;
use std::path::PathBuf;

use ferrocat::{
    convert_catalog, convert_catalog_file, machine_translation_hash, parse_catalog,
    CatalogFileFormat as FerrocatCatalogFileFormat, CatalogMessage, CatalogMessageKey, CatalogMode,
    ConvertCatalogFileOptions, ConvertCatalogOptions, EffectiveTranslationRef, MsgStr,
    ParseCatalogOptions, PoFile, PoItem, SerializeOptions, TranslationShape,
};
use ferrocat_icu::{parse_icu, stringify_icu, IcuMessage, IcuNode, IcuOption, IcuPluralKind};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::catalog_artifact::resolve_catalog_path;
use crate::catalog_update::{po_serialize_options, AiProvenance, MachineMetadata};
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
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
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
    /// Structured validation diagnostics. Any error leaves all catalogs unchanged.
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
    /// Patch was valid but not written because another patch invalidated the atomic batch.
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
}

#[derive(Debug)]
struct LoadedCatalog {
    scope: String,
    locale: String,
    path: PathBuf,
    format: PalamedesCatalogFormat,
    original: String,
    po: PoFile,
    messages: BTreeMap<CatalogMessageKey, CatalogMessage>,
    ambiguous_messages: BTreeSet<CatalogMessageKey>,
}

#[derive(Debug)]
struct PreparedCatalog {
    path: PathBuf,
    format: PalamedesCatalogFormat,
    locale: String,
    content: String,
    changed: bool,
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
    let locales = selected_locales(&request.config, &request.locales);
    let explicit = !request.targets.is_empty();
    let mut requested = BTreeMap::<TranslationCandidateId, usize>::new();
    let mut diagnostics = Vec::new();
    for target in &request.targets {
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
            let loaded = load_catalog(&request.config, catalog, locale)?;
            for (key, message) in &loaded.messages {
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
                    message.obsolete.is_none() && !is_translated(message)
                };
                if !selected {
                    continue;
                }
                let candidate = build_candidate(&loaded, key, message, request.max_origins);
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
/// Returns an error when catalogs cannot be read, parsed, rendered, or replaced.
pub fn apply_translation_patches(
    request: TranslationPatchRequest,
) -> PalamedesResult<TranslationPatchResult> {
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
            let Some(message) = loaded.messages.get(&key) else {
                rejected.insert(patch_index);
                diagnostics.push(workflow_diagnostic(
                    "translation.unknown_message",
                    "Patch identity does not exist in the resolved catalog.",
                    Some(patch.id.clone()),
                ));
                continue;
            };
            let current = build_candidate(&loaded, &key, message, usize::MAX);
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
                apply_patch_to_po(&mut loaded.po, &request.patches[patch_index])?;
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
                format: loaded.format,
                locale: batch.locale,
                changed: content != loaded.original,
                content,
            });
        }
    }

    if !rejected.is_empty() {
        diagnostics
            .sort_by(|left, right| diagnostic_sort_key(left).cmp(&diagnostic_sort_key(right)));
        let outcomes = request
            .patches
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
        return Ok(TranslationPatchResult {
            updated: false,
            stats: TranslationPatchStats {
                requested: requested_count,
                ..TranslationPatchStats::default()
            },
            outcomes,
            diagnostics,
        });
    }

    let catalogs_updated = prepared.iter().filter(|catalog| catalog.changed).count();
    for catalog in prepared.iter().filter(|catalog| catalog.changed) {
        atomic_replace_catalog(catalog, &request.config.source_locale, request.po.as_ref())?;
    }
    let outcomes = request
        .patches
        .into_iter()
        .enumerate()
        .map(|(index, patch)| TranslationPatchOutcome {
            id: patch.id,
            status: if changed_patches.contains(&index) {
                TranslationPatchOutcomeStatus::Applied
            } else {
                TranslationPatchOutcomeStatus::Unchanged
            },
        })
        .collect();

    Ok(TranslationPatchResult {
        updated: catalogs_updated > 0,
        stats: TranslationPatchStats {
            requested: requested_count,
            applied: changed_patches.len(),
            unchanged: requested_count - changed_patches.len(),
            catalogs_updated,
        },
        outcomes,
        diagnostics,
    })
}

fn default_max_origins() -> usize {
    DEFAULT_TRANSLATION_CANDIDATE_MAX_ORIGINS
}

fn selected_locales(config: &CatalogArtifactConfig, requested: &[String]) -> Vec<String> {
    let mut locales = if requested.is_empty() {
        config
            .locales
            .iter()
            .filter(|locale| locale.as_str() != config.source_locale)
            .cloned()
            .collect::<Vec<_>>()
    } else {
        requested
            .iter()
            .filter(|locale| config.locales.contains(locale))
            .cloned()
            .collect::<Vec<_>>()
    };
    locales.sort();
    locales.dedup();
    locales
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
    let parsed = parse_catalog(
        ParseCatalogOptions::new(&original, &config.source_locale)
            .with_locale(locale)
            .with_mode(catalog.format.ferrocat_mode()),
    )?;
    let mut messages = BTreeMap::new();
    let mut ambiguous_messages = BTreeSet::new();
    for message in parsed.messages {
        let key = message.key();
        if messages.insert(key.clone(), message).is_some() {
            ambiguous_messages.insert(key);
        }
    }
    let po = catalog_as_po(&original, &config.source_locale, locale, catalog.format)?;
    Ok(LoadedCatalog {
        scope: catalog.path.clone(),
        locale: locale.to_owned(),
        path,
        format: catalog.format,
        original,
        po,
        messages,
        ambiguous_messages,
    })
}

fn catalog_as_po(
    content: &str,
    source_locale: &str,
    locale: &str,
    format: PalamedesCatalogFormat,
) -> PalamedesResult<PoFile> {
    let po = match format {
        PalamedesCatalogFormat::Po => content.to_owned(),
        PalamedesCatalogFormat::Fcl => {
            convert_catalog(
                ConvertCatalogOptions::new(
                    content,
                    source_locale,
                    CatalogMode::IcuFcl,
                    CatalogMode::IcuPo,
                )
                .with_locale(locale),
            )?
            .content
        }
    };
    Ok(ferrocat::parse_po(&po)?)
}

fn build_candidate(
    loaded: &LoadedCatalog,
    key: &CatalogMessageKey,
    message: &CatalogMessage,
    max_origins: usize,
) -> TranslationCandidate {
    let raw = find_po_item(&loaded.po, key);
    let source = project_source(&message.msgid);
    let translation = project_translation(message, &source);
    let review = TranslationReviewState {
        translated: value_is_translated(&translation),
        fuzzy: raw.is_some_and(|item| item.flags.iter().any(|flag| flag == "fuzzy")),
        obsolete: message.obsolete.is_some(),
    };
    let comments = raw.map_or_else(
        || message.comments.clone(),
        |item| item.extracted_comments.iter().cloned().collect(),
    );
    let all_origins = message
        .origin
        .iter()
        .map(|origin| TranslationWorkflowOrigin {
            file: origin.file.clone(),
            scope: origin.scope.clone(),
        })
        .collect::<Vec<_>>();
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
        machine: message.machine.clone().map(MachineMetadata::from),
        fingerprint: String::new(),
    };
    candidate.fingerprint = candidate_fingerprint(&candidate, &all_origins);
    candidate
}

fn project_source(message: &str) -> TranslationValue {
    project_icu_plural(message).unwrap_or_else(|| TranslationValue::Singular {
        value: message.to_owned(),
    })
}

fn project_translation(message: &CatalogMessage, source: &TranslationValue) -> TranslationValue {
    match message.effective_translation() {
        EffectiveTranslationRef::Singular(value) => {
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
        EffectiveTranslationRef::Plural(values) => match &message.translation {
            TranslationShape::Plural { variable, .. } => TranslationValue::Plural {
                variable: variable.clone(),
                plural_kind: TranslationPluralKind::Cardinal,
                offset: 0,
                values: values.clone(),
            },
            TranslationShape::Singular { .. } => TranslationValue::Singular {
                value: String::new(),
            },
        },
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

fn is_translated(message: &CatalogMessage) -> bool {
    match message.effective_translation() {
        EffectiveTranslationRef::Singular(value) => !value.is_empty(),
        EffectiveTranslationRef::Plural(values) => {
            !values.is_empty() && values.values().all(|value| !value.is_empty())
        }
    }
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

fn apply_patch_to_po(po: &mut PoFile, patch: &TranslationPatch) -> PalamedesResult<()> {
    let matches = po
        .items
        .iter()
        .enumerate()
        .filter(|(_, item)| item.msgid == patch.id.message && item.msgctxt == patch.id.context)
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    let [index] = matches.as_slice() else {
        return Err(ferrocat::ApiError::Conflict(format!(
            "catalog mutation identity {:?} with context {:?} is missing or ambiguous",
            patch.id.message, patch.id.context
        ))
        .into());
    };
    let item = &mut po.items[*index];
    let rendered = render_translation_value(&patch.translation)?;
    item.msgstr = MsgStr::Singular(rendered.clone());
    item.msgid_plural = None;
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
    let parsed = parse_icu(&wrapped)?;
    let [IcuNode::Plural { options, .. }] = parsed.nodes.as_slice() else {
        unreachable!("the generated plural wrapper always parses to one plural node");
    };
    Ok(options[0].value.clone())
}

fn render_target_catalog(
    po_content: &str,
    source_locale: &str,
    locale: &str,
    format: PalamedesCatalogFormat,
    po_options: Option<&PoOutputOptions>,
) -> PalamedesResult<String> {
    let target_mode = match format {
        PalamedesCatalogFormat::Po => CatalogMode::IcuPo,
        PalamedesCatalogFormat::Fcl => CatalogMode::IcuFcl,
    };
    Ok(convert_catalog(
        ConvertCatalogOptions::new(po_content, source_locale, CatalogMode::IcuPo, target_mode)
            .with_locale(locale)
            .with_po_serialize_options(po_serialize_options(po_options)),
    )?
    .content)
}

fn atomic_replace_catalog(
    catalog: &PreparedCatalog,
    source_locale: &str,
    po: Option<&PoOutputOptions>,
) -> PalamedesResult<()> {
    let mut temporary =
        tempfile::NamedTempFile::new().map_err(|source| PalamedesError::WriteFile {
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
        .flush()
        .map_err(|source| PalamedesError::WriteFile {
            path: catalog.path.clone(),
            source,
        })?;
    let format = match catalog.format {
        PalamedesCatalogFormat::Po => FerrocatCatalogFileFormat::Po,
        PalamedesCatalogFormat::Fcl => FerrocatCatalogFileFormat::Fcl,
    };
    convert_catalog_file(
        ConvertCatalogFileOptions::new(temporary.path(), &catalog.path, source_locale)
            .with_source_format(format)
            .with_target_format(format)
            .with_locale(&catalog.locale)
            .with_po_serialize_options(po_serialize_options(po)),
    )?;
    Ok(())
}

fn find_po_item<'a>(po: &'a PoFile, key: &CatalogMessageKey) -> Option<&'a PoItem> {
    po.items
        .iter()
        .find(|item| item.msgid == key.msgid && item.msgctxt == key.msgctxt)
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
    }
}

fn diagnostic_sort_key(
    diagnostic: &TranslationWorkflowDiagnostic,
) -> (&str, Option<&TranslationCandidateId>) {
    (&diagnostic.code, diagnostic.id.as_ref())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use ferrocat::{
        convert_catalog, machine_translation_hash, parse_catalog, parse_po, CatalogMode,
        ConvertCatalogOptions, EffectiveTranslationRef, ParseCatalogOptions,
    };

    use super::{
        apply_translation_patches, list_translation_candidates, TranslationCandidate,
        TranslationCandidateId, TranslationCandidateRequest, TranslationMachineProvenance,
        TranslationPatch, TranslationPatchOutcomeStatus, TranslationPatchRequest,
        TranslationPluralKind, TranslationValue,
    };
    use crate::{CatalogArtifactConfig, CatalogConfig, PalamedesCatalogFormat};

    const FIXTURE: &str = include_str!("../fixtures/translation-workflow.de.po");

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
    fn fingerprints_complete_origins_while_returning_the_requested_origin_limit() {
        let fixture = tempfile::tempdir().expect("fixture directory");
        let path = fixture.path().join("messages/de.po");
        write_po_fixture(&path, "de");
        let origins = (1..=10)
            .map(|index| format!("#: src/origin-{index}.tsx#Origin{index}"))
            .collect::<Vec<_>>()
            .join("\n");
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
