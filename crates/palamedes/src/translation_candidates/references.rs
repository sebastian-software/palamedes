//! Exact reference hints over a caller-selected snapshot of translation facts.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::{
    TranslationCandidate, TranslationCandidateId, TranslationValue, TranslationWorkflowDiagnostic,
    TranslationWorkflowOrigin, compare_runtime_icu, diagnostic_sort_key, render_translation_value,
    validate_patch_translation, workflow_diagnostic,
};

/// Default maximum reference hints for one target.
pub const DEFAULT_TRANSLATION_REFERENCE_LIMIT: usize = 5;
/// Hard maximum reference hints for one target.
pub const MAX_TRANSLATION_REFERENCE_LIMIT: usize = 20;

/// One reference explicitly selected as eligible by the caller.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationReferenceEntry {
    /// Catalog, target locale, source message, and disambiguating context.
    pub id: TranslationCandidateId,
    /// Existing translated value in the candidate/patch representation.
    pub translation: TranslationValue,
    /// Caller-supplied source origins, sorted and bounded in each response.
    #[serde(default)]
    pub origins: Vec<TranslationWorkflowOrigin>,
}

impl From<&TranslationCandidate> for TranslationReferenceEntry {
    fn from(candidate: &TranslationCandidate) -> Self {
        Self {
            id: candidate.id.clone(),
            translation: candidate.translation.clone(),
            origins: candidate.origins.clone(),
        }
    }
}

/// Batch exact-match lookup; input references define the eligible pool.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationReferenceRequest {
    /// Explicitly eligible reference facts; Core does not discover or assess quality.
    pub references: Vec<TranslationReferenceEntry>,
    /// Candidate identities to match, in response order.
    pub targets: Vec<TranslationCandidateId>,
    /// Maximum hints per target, clamped to [`MAX_TRANSLATION_REFERENCE_LIMIT`].
    #[serde(default = "default_limit")]
    pub max_references: usize,
    /// Maximum origins per returned hint.
    #[serde(default = "super::default_max_origins")]
    pub max_origins: usize,
}

fn default_limit() -> usize {
    DEFAULT_TRANSLATION_REFERENCE_LIMIT
}

/// One structurally compatible exact reference; never an automatic replacement.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationReferenceMatch {
    /// Reference identity, including its source message, context, locale, and catalog.
    pub id: TranslationCandidateId,
    /// Compatible existing target text.
    pub translation: TranslationValue,
    /// Sorted, deduplicated, bounded source origins.
    pub origins: Vec<TranslationWorkflowOrigin>,
    /// Stable match kind; currently always `exact`.
    pub match_kind: String,
    /// Explanation of the exact matching contract, without a quality score.
    pub reason: String,
}

/// One result for each target, including targets without reference hints.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationReferenceMatches {
    /// Original target identity.
    pub id: TranslationCandidateId,
    /// Exact references ordered by their catalog/message identities.
    pub references: Vec<TranslationReferenceMatch>,
}

/// Batch hints and reference-pool validation diagnostics.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationReferenceResult {
    /// Results in target request order.
    pub matches: Vec<TranslationReferenceMatches>,
    /// Invalid or duplicate references excluded while building the index.
    pub diagnostics: Vec<TranslationWorkflowDiagnostic>,
}

type ReferenceKey = (String, Option<String>, String);

/// Reusable caller-owned snapshot. Rebuild it when the eligible catalog facts change.
#[derive(Debug)]
pub struct TranslationReferenceIndex {
    entries: BTreeMap<ReferenceKey, Vec<TranslationReferenceEntry>>,
    diagnostics: Vec<TranslationWorkflowDiagnostic>,
}

impl TranslationReferenceIndex {
    /// Indexes the selected facts once, validating native ICU compatibility.
    ///
    /// Duplicate identities and invalid or empty targets are excluded. Fuzzy,
    /// machine, and human-review policy remains entirely with the caller.
    #[must_use]
    pub fn new(references: &[TranslationReferenceEntry]) -> Self {
        let mut counts = BTreeMap::<TranslationCandidateId, usize>::new();
        for reference in references {
            *counts.entry(reference.id.clone()).or_default() += 1;
        }
        let mut diagnostics = counts.iter().filter(|(_, count)| **count > 1).map(|(id, _)| {
            workflow_diagnostic("translation.duplicate_reference", "Reference pool contains duplicate identities; select one unambiguous snapshot per catalog entry.", Some(id.clone()))
        }).collect::<Vec<_>>();
        let mut entries = BTreeMap::<ReferenceKey, Vec<TranslationReferenceEntry>>::new();
        for reference in references {
            if counts[&reference.id] > 1 {
                continue;
            }
            if let Err(message) = validate_patch_translation(&reference.translation) {
                diagnostics.push(workflow_diagnostic(
                    "translation.empty_reference",
                    message,
                    Some(reference.id.clone()),
                ));
                continue;
            }
            let compatibility = render_translation_value(&reference.translation)
                .map_err(|error| error.to_string())
                .and_then(|translation| {
                    compare_runtime_icu(&reference.id.message, &translation)
                        .map_err(|error| error.to_string())
                });
            match compatibility {
                Ok(findings) => {
                    let errors = findings
                        .into_iter()
                        .filter(|finding| {
                            finding.severity == ferrocat_icu::IcuDiagnosticSeverity::Error
                        })
                        .collect::<Vec<_>>();
                    if !errors.is_empty() {
                        diagnostics.extend(errors.into_iter().map(|finding| {
                            workflow_diagnostic(
                                finding.code.as_ref(),
                                finding.message,
                                Some(reference.id.clone()),
                            )
                        }));
                        continue;
                    }
                }
                Err(error) => {
                    diagnostics.push(workflow_diagnostic(
                        "translation.invalid_icu",
                        format!("Reference source or target is not valid ICU: {error}"),
                        Some(reference.id.clone()),
                    ));
                    continue;
                }
            }
            let mut reference = reference.clone();
            reference.origins.sort();
            reference.origins.dedup();
            entries
                .entry(reference_key(&reference.id))
                .or_default()
                .push(reference);
        }
        for bucket in entries.values_mut() {
            bucket.sort_by(|left, right| left.id.cmp(&right.id));
        }
        diagnostics
            .sort_by(|left, right| diagnostic_sort_key(left).cmp(&diagnostic_sort_key(right)));
        Self {
            entries,
            diagnostics,
        }
    }

    /// Looks up one exact source/context/locale bucket without rescanning the pool.
    /// The target's own identity is excluded; zero limits return no hints.
    #[must_use]
    pub fn references_for(
        &self,
        target: &TranslationCandidateId,
        max_references: usize,
        max_origins: usize,
    ) -> Vec<TranslationReferenceMatch> {
        self.entries
            .get(&reference_key(target))
            .into_iter()
            .flatten()
            .filter(|reference| reference.id != *target)
            .take(max_references.min(MAX_TRANSLATION_REFERENCE_LIMIT))
            .map(|reference| TranslationReferenceMatch {
                id: reference.id.clone(),
                translation: reference.translation.clone(),
                origins: reference
                    .origins
                    .iter()
                    .take(max_origins)
                    .cloned()
                    .collect(),
                match_kind: "exact".to_owned(),
                reason: "Source message, context, and target locale match exactly.".to_owned(),
            })
            .collect()
    }

    /// Deterministic diagnostics produced once while constructing this snapshot.
    #[must_use]
    pub fn diagnostics(&self) -> &[TranslationWorkflowDiagnostic] {
        &self.diagnostics
    }
}

fn reference_key(id: &TranslationCandidateId) -> ReferenceKey {
    (id.message.clone(), id.context.clone(), id.locale.clone())
}

/// Builds one index for the whole batch and returns bounded exact hints.
#[must_use]
pub fn find_translation_references(
    request: &TranslationReferenceRequest,
) -> TranslationReferenceResult {
    let index = TranslationReferenceIndex::new(&request.references);
    TranslationReferenceResult {
        matches: request
            .targets
            .iter()
            .map(|target| TranslationReferenceMatches {
                id: target.clone(),
                references: index.references_for(
                    target,
                    request.max_references,
                    request.max_origins,
                ),
            })
            .collect(),
        diagnostics: index.diagnostics,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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

    fn entry(
        catalog: &str,
        locale: &str,
        message: &str,
        context: Option<&str>,
        value: &str,
    ) -> TranslationReferenceEntry {
        TranslationReferenceEntry {
            id: id(catalog, locale, message, context),
            translation: TranslationValue::Singular {
                value: value.to_owned(),
            },
            origins: vec![
                TranslationWorkflowOrigin {
                    file: "src/z.tsx".to_owned(),
                    scope: None,
                },
                TranslationWorkflowOrigin {
                    file: "src/a.tsx".to_owned(),
                    scope: Some("View".to_owned()),
                },
                TranslationWorkflowOrigin {
                    file: "src/a.tsx".to_owned(),
                    scope: Some("View".to_owned()),
                },
            ],
        }
    }

    #[test]
    fn exact_references_project_selected_translated_po_and_fcl_facts_equally() {
        use super::super::{TranslationCandidateRequest, list_translation_candidates};
        use crate::{CatalogArtifactConfig, CatalogConfig, PalamedesCatalogFormat};
        use ferrocat::{CatalogMode, ConvertCatalogOptions, convert_catalog};
        use std::fs;

        let fixture = tempfile::tempdir().unwrap();
        let messages = [
            ("Open", Some("verb"), "Öffnen"),
            ("Open", Some("noun"), "Öffnung"),
            ("保存 {name}", None, "{name} speichern"),
            ("Hello {name}, {name}", None, "Hallo {name}, {name}"),
            (
                "{count, plural, one {# file} other {# files}}",
                None,
                "{count, plural, one {# Datei} other {# Dateien}}",
            ),
        ];
        let mut po = "msgid \"\"\nmsgstr \"Language: de\\n\"\n\n".to_owned();
        for (message, context, translation) in messages {
            po.push_str("#: src/view.tsx:12\n");
            if let Some(context) = context {
                po.push_str(&format!(
                    "msgctxt {}\n",
                    serde_json::to_string(context).unwrap()
                ));
            }
            po.push_str(&format!(
                "msgid {}\nmsgstr {}\n\n",
                serde_json::to_string(message).unwrap(),
                serde_json::to_string(translation).unwrap()
            ));
        }
        let fcl = convert_catalog(
            ConvertCatalogOptions::new(&po, "en", CatalogMode::IcuPo, CatalogMode::IcuFcl)
                .with_locale("de"),
        )
        .unwrap()
        .content;
        fs::create_dir_all(fixture.path().join("references")).unwrap();
        fs::write(fixture.path().join("references/de.po"), &po).unwrap();
        fs::write(fixture.path().join("references/de.fcl"), fcl).unwrap();
        let mut projections = Vec::new();
        for format in [PalamedesCatalogFormat::Po, PalamedesCatalogFormat::Fcl] {
            let config = CatalogArtifactConfig {
                root_dir: fixture.path().to_string_lossy().into_owned(),
                locales: vec!["en".to_owned(), "de".to_owned()],
                source_locale: "en".to_owned(),
                fallback_locales: None,
                pseudo_locale: None,
                catalogs: vec![CatalogConfig {
                    path: "references/{locale}".to_owned(),
                    format,
                }],
            };
            let mut request = TranslationCandidateRequest {
                config,
                locales: vec!["de".to_owned()],
                targets: Vec::new(),
                max_origins: 8,
            };
            assert!(
                list_translation_candidates(&request)
                    .unwrap()
                    .candidates
                    .is_empty(),
                "default enumeration only supplies missing translations"
            );
            request.targets = messages
                .iter()
                .map(|(message, context, _)| id("references/{locale}", "de", message, *context))
                .collect();
            let facts = list_translation_candidates(&request).unwrap();
            assert!(facts.diagnostics.is_empty(), "{:?}", facts.diagnostics);
            assert_eq!(facts.candidates.len(), messages.len());
            // Eligibility is caller-selected: omit the noun even though it is translated.
            let pool = facts
                .candidates
                .iter()
                .filter(|candidate| candidate.id.context.as_deref() != Some("noun"))
                .map(TranslationReferenceEntry::from)
                .collect::<Vec<_>>();
            let targets = messages
                .iter()
                .map(|(message, context, _)| id("current/{locale}", "de", message, *context))
                .collect();
            let result = find_translation_references(&TranslationReferenceRequest {
                references: pool,
                targets,
                max_references: 5,
                max_origins: 8,
            });
            assert!(result.diagnostics.is_empty(), "{:?}", result.diagnostics);
            assert_eq!(
                result
                    .matches
                    .iter()
                    .map(|result| result.references.len())
                    .collect::<Vec<_>>(),
                [1, 0, 1, 1, 1]
            );
            projections.push(serde_json::to_value(result).unwrap());
        }
        assert_eq!(projections[0], projections[1]);
    }

    #[test]
    fn exact_references_bound_batch_results_and_reject_ambiguous_pool_facts() {
        let target = id("current", "de", "Cancel", None);
        let mut references = (0..25)
            .rev()
            .map(|n| {
                entry(
                    &format!("catalog-{n:02}"),
                    "de",
                    "Cancel",
                    None,
                    "Abbrechen",
                )
            })
            .collect::<Vec<_>>();
        references.push(entry("duplicate", "de", "Cancel", None, "Abbrechen"));
        references.push(entry("duplicate", "de", "Cancel", None, "Stornieren"));
        references.push(entry("empty", "de", "Cancel", None, ""));
        let result = find_translation_references(&TranslationReferenceRequest {
            references,
            targets: vec![target.clone(), id("current", "de", "cancel", None)],
            max_references: usize::MAX,
            max_origins: 0,
        });
        assert_eq!(result.matches[0].id, target);
        assert_eq!(
            result.matches[0].references.len(),
            MAX_TRANSLATION_REFERENCE_LIMIT
        );
        assert_eq!(result.matches[0].references[0].id.catalog, "catalog-00");
        assert!(
            result.matches[0]
                .references
                .iter()
                .all(|reference| reference.origins.is_empty())
        );
        assert!(
            result.matches[1].references.is_empty(),
            "no case folding or fuzzy matching"
        );
        assert_eq!(result.diagnostics.len(), 2);
        assert!(
            result
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "translation.duplicate_reference")
        );
        assert!(
            result
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "translation.empty_reference")
        );
    }

    #[test]
    fn exact_references_keep_context_locale_and_deterministic_bounds() {
        let mut pool = vec![
            entry("zeta", "de", "Open", Some("verb"), "Öffnen"),
            entry("alpha", "de", "Open", Some("verb"), "Aufmachen"),
            entry("alpha", "fr", "Open", Some("verb"), "Ouvrir"),
            entry("noun", "de", "Open", Some("noun"), "Öffnung"),
            entry("cjk", "de", "保存 {name}", None, "{name} speichern"),
        ];
        let index = TranslationReferenceIndex::new(&pool);
        pool.clear(); // An index is a reusable snapshot, not a live catalog view.
        let target = id("current", "de", "Open", Some("verb"));
        let first = index.references_for(&target, 1, 1);
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].id.catalog, "alpha");
        assert_eq!(first[0].origins.len(), 1);
        assert_eq!(first[0].origins[0].file, "src/a.tsx");
        assert_eq!(first[0].match_kind, "exact");
        assert!(first[0].reason.contains("context"));
        assert_eq!(index.references_for(&target, 2, 8).len(), 2);
        assert!(
            index
                .references_for(&id("current", "de", "Open", None), 5, 8)
                .is_empty()
        );
        assert_eq!(
            index
                .references_for(&id("current", "fr", "Open", Some("verb")), 5, 8)
                .len(),
            1
        );
        assert_eq!(
            index
                .references_for(&id("alpha", "de", "Open", Some("verb")), 5, 8)
                .len(),
            1
        );
        assert_eq!(
            index
                .references_for(&id("current", "de", "保存 {name}", None), 5, 8)
                .len(),
            1
        );
        assert!(index.references_for(&target, 0, 8).is_empty());
    }

    #[test]
    fn exact_references_exclude_incompatible_repeated_arguments_and_choices() {
        let plural = "{count, plural, one {# file} other {# files}}";
        let pool = vec![
            entry("missing", "de", "Hello {name}", None, "Hallo"),
            entry(
                "repeated",
                "de",
                "Hello {name}, {name}",
                None,
                "Hallo {name}",
            ),
            entry(
                "wrong-choice",
                "de",
                plural,
                None,
                "{count, select, one {Datei} other {Dateien}}",
            ),
            entry(
                "valid-choice",
                "de",
                plural,
                None,
                "{count, plural, one {# Datei} few {# Dateien} other {# Dateien}}",
            ),
        ];
        let index = TranslationReferenceIndex::new(&pool);
        assert!(
            index
                .references_for(&id("current", "de", "Hello {name}", None), 5, 8)
                .is_empty()
        );
        assert!(
            index
                .references_for(&id("current", "de", "Hello {name}, {name}", None), 5, 8)
                .is_empty()
        );
        let choices = index.references_for(&id("current", "de", plural, None), 5, 8);
        assert_eq!(choices.len(), 1);
        assert_eq!(choices[0].id.catalog, "valid-choice");
        assert!(
            index
                .diagnostics()
                .iter()
                .any(|diagnostic| diagnostic.code == "icu.argument_occurrence_mismatch")
        );
    }
}
