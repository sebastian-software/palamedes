use napi::bindgen_prelude::Result;
use napi_derive::napi;

use crate::catalog::{
    TranslationCandidateId, TranslationValue, TranslationWorkflowDiagnostic,
    TranslationWorkflowOrigin,
};

#[napi(object)]
pub struct TranslationReferenceEntry {
    pub id: TranslationCandidateId,
    pub translation: TranslationValue,
    pub origins: Option<Vec<TranslationWorkflowOrigin>>,
}

#[napi(object)]
pub struct TranslationReferenceRequest {
    pub references: Vec<TranslationReferenceEntry>,
    pub targets: Vec<TranslationCandidateId>,
    pub max_references: Option<u32>,
    pub max_origins: Option<u32>,
}

#[napi(object)]
pub struct TranslationReferenceMatch {
    pub id: TranslationCandidateId,
    pub translation: TranslationValue,
    pub origins: Vec<TranslationWorkflowOrigin>,
    pub match_kind: String,
    pub reason: String,
}

#[napi(object)]
pub struct TranslationReferenceMatches {
    pub id: TranslationCandidateId,
    pub references: Vec<TranslationReferenceMatch>,
}

#[napi(object)]
pub struct TranslationReferenceResult {
    pub matches: Vec<TranslationReferenceMatches>,
    pub diagnostics: Vec<TranslationWorkflowDiagnostic>,
}

#[napi(catch_unwind)]
/// Returns bounded exact reference hints from caller-selected candidate facts.
///
/// # Errors
///
/// Returns an error when an input translation value has an invalid variant shape.
pub fn find_translation_references(
    request: TranslationReferenceRequest,
) -> Result<TranslationReferenceResult> {
    let request = palamedes::TranslationReferenceRequest {
        references: request
            .references
            .into_iter()
            .map(|entry| {
                Ok(palamedes::TranslationReferenceEntry {
                    id: entry.id.into(),
                    translation: entry.translation.try_into()?,
                    origins: entry
                        .origins
                        .unwrap_or_default()
                        .into_iter()
                        .map(|origin| palamedes::TranslationWorkflowOrigin {
                            file: origin.file,
                            scope: origin.scope,
                        })
                        .collect(),
                })
            })
            .collect::<Result<_>>()?,
        targets: request.targets.into_iter().map(Into::into).collect(),
        max_references: request
            .max_references
            .map_or(palamedes::DEFAULT_TRANSLATION_REFERENCE_LIMIT, |limit| {
                limit as usize
            }),
        max_origins: request.max_origins.map_or(
            palamedes::DEFAULT_TRANSLATION_CANDIDATE_MAX_ORIGINS,
            |limit| limit as usize,
        ),
    };
    let result = palamedes::find_translation_references(&request);
    Ok(TranslationReferenceResult {
        matches: result
            .matches
            .into_iter()
            .map(|matches| TranslationReferenceMatches {
                id: matches.id.into(),
                references: matches
                    .references
                    .into_iter()
                    .map(|reference| TranslationReferenceMatch {
                        id: reference.id.into(),
                        translation: reference.translation.into(),
                        origins: reference.origins.into_iter().map(Into::into).collect(),
                        match_kind: reference.match_kind,
                        reason: reference.reason,
                    })
                    .collect(),
            })
            .collect(),
        diagnostics: result.diagnostics.into_iter().map(Into::into).collect(),
    })
}
