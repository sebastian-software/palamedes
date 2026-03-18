#![allow(clippy::type_complexity)]
// `napi-rs` needs the public union shape directly on this binding module.

use std::collections::HashMap;

use napi::bindgen_prelude::{Either, Result};
use napi_derive::napi;

use crate::shared::to_napi_error;

#[napi(object)]
pub struct CatalogOrigin {
    pub file: String,
    pub line: u32,
}

#[napi(object)]
pub struct CatalogUpdateMessage {
    pub message: String,
    pub context: Option<String>,
    pub extracted_comments: Vec<String>,
    pub origins: Vec<CatalogOrigin>,
}

#[napi(object)]
pub struct CatalogUpdateRequest {
    pub target_path: String,
    pub locale: String,
    pub source_locale: String,
    pub clean: bool,
    pub messages: Vec<CatalogUpdateMessage>,
}

#[napi(object)]
pub struct CatalogUpdateStats {
    pub total: u32,
    pub added: u32,
    pub changed: u32,
    pub unchanged: u32,
    pub obsolete_marked: u32,
    pub obsolete_removed: u32,
}

#[napi(object)]
pub struct CatalogUpdateResult {
    pub created: bool,
    pub updated: bool,
    pub stats: CatalogUpdateStats,
    pub diagnostics: Vec<String>,
}

#[napi(object)]
pub struct CatalogParseRequest {
    pub target_path: String,
    pub locale: String,
    pub source_locale: String,
}

#[napi(object)]
pub struct ParsedCatalogMessage {
    pub message: String,
    pub context: Option<String>,
    pub comments: Vec<String>,
    pub origins: Vec<CatalogOrigin>,
    pub obsolete: bool,
}

#[napi(object)]
pub struct CatalogParseResult {
    pub locale: Option<String>,
    pub headers: HashMap<String, String>,
    pub messages: Vec<ParsedCatalogMessage>,
    pub diagnostics: Vec<String>,
}

#[napi(object)]
pub struct CatalogArtifactCatalogConfig {
    pub path: String,
    pub include: Vec<String>,
    pub exclude: Option<Vec<String>>,
}

#[napi(object)]
pub struct CatalogArtifactConfig {
    pub root_dir: String,
    pub locales: Vec<String>,
    pub source_locale: String,
    pub fallback_locales: Option<Either<Vec<String>, HashMap<String, Vec<String>>>>,
    pub pseudo_locale: Option<String>,
    pub catalogs: Vec<CatalogArtifactCatalogConfig>,
}

#[napi(object)]
pub struct CatalogArtifactRequest {
    pub config: CatalogArtifactConfig,
    pub resource_path: String,
}

#[napi(object)]
pub struct CatalogArtifactSelectedRequest {
    pub config: CatalogArtifactConfig,
    pub resource_path: String,
    pub compiled_ids: Vec<String>,
}

#[napi(object)]
pub struct CatalogArtifactSourceKey {
    pub message: String,
    pub context: Option<String>,
}

#[napi(string_enum)]
pub enum CatalogArtifactDiagnosticSeverity {
    Info,
    Warning,
    Error,
}

#[napi(object)]
pub struct CatalogArtifactMissingMessage {
    pub compiled_id: String,
    pub source_key: CatalogArtifactSourceKey,
    pub requested_locale: String,
    pub resolved_locale: Option<String>,
}

#[napi(object)]
pub struct CatalogArtifactDiagnostic {
    pub severity: CatalogArtifactDiagnosticSeverity,
    pub code: String,
    pub message: String,
    pub compiled_id: String,
    pub source_key: CatalogArtifactSourceKey,
    pub locale: String,
}

#[napi(object)]
pub struct CatalogArtifactResult {
    pub messages: HashMap<String, String>,
    pub watch_files: Vec<String>,
    pub missing: Vec<CatalogArtifactMissingMessage>,
    pub diagnostics: Vec<CatalogArtifactDiagnostic>,
    pub resolved_locale_chain: Option<Vec<String>>,
}

impl From<CatalogOrigin> for palamedes::CatalogUpdateOrigin {
    fn from(value: CatalogOrigin) -> Self {
        Self {
            file: value.file,
            line: value.line,
        }
    }
}

impl From<CatalogUpdateMessage> for palamedes::CatalogUpdateMessage {
    fn from(value: CatalogUpdateMessage) -> Self {
        Self {
            message: value.message,
            context: value.context,
            extracted_comments: value.extracted_comments,
            origins: value
                .origins
                .into_iter()
                .map(palamedes::CatalogUpdateOrigin::from)
                .collect(),
        }
    }
}

impl From<CatalogUpdateRequest> for palamedes::CatalogUpdateRequest {
    fn from(value: CatalogUpdateRequest) -> Self {
        Self {
            target_path: value.target_path,
            locale: value.locale,
            source_locale: value.source_locale,
            clean: value.clean,
            messages: value
                .messages
                .into_iter()
                .map(palamedes::CatalogUpdateMessage::from)
                .collect(),
        }
    }
}

impl From<palamedes::CatalogUpdateOrigin> for CatalogOrigin {
    fn from(value: palamedes::CatalogUpdateOrigin) -> Self {
        Self {
            file: value.file,
            line: value.line,
        }
    }
}

impl From<palamedes::CatalogUpdateStats> for CatalogUpdateStats {
    fn from(value: palamedes::CatalogUpdateStats) -> Self {
        Self {
            total: value.total as u32,
            added: value.added as u32,
            changed: value.changed as u32,
            unchanged: value.unchanged as u32,
            obsolete_marked: value.obsolete_marked as u32,
            obsolete_removed: value.obsolete_removed as u32,
        }
    }
}

impl From<palamedes::CatalogUpdateResponse> for CatalogUpdateResult {
    fn from(value: palamedes::CatalogUpdateResponse) -> Self {
        Self {
            created: value.created,
            updated: value.updated,
            stats: value.stats.into(),
            diagnostics: value.diagnostics,
        }
    }
}

impl From<CatalogParseRequest> for palamedes::CatalogParseRequest {
    fn from(value: CatalogParseRequest) -> Self {
        Self {
            target_path: value.target_path,
            locale: value.locale,
            source_locale: value.source_locale,
        }
    }
}

impl From<palamedes::ParsedCatalogMessage> for ParsedCatalogMessage {
    fn from(value: palamedes::ParsedCatalogMessage) -> Self {
        Self {
            message: value.message,
            context: value.context,
            comments: value.comments,
            origins: value.origins.into_iter().map(CatalogOrigin::from).collect(),
            obsolete: value.obsolete,
        }
    }
}

impl From<palamedes::CatalogParseResult> for CatalogParseResult {
    fn from(value: palamedes::CatalogParseResult) -> Self {
        Self {
            locale: value.locale,
            headers: value.headers.into_iter().collect(),
            messages: value
                .messages
                .into_iter()
                .map(ParsedCatalogMessage::from)
                .collect(),
            diagnostics: value.diagnostics,
        }
    }
}

impl From<CatalogArtifactCatalogConfig> for palamedes::CatalogConfig {
    fn from(value: CatalogArtifactCatalogConfig) -> Self {
        let _ = value.include;
        let _ = value.exclude;
        Self { path: value.path }
    }
}

impl From<CatalogArtifactConfig> for palamedes::CatalogArtifactConfig {
    fn from(value: CatalogArtifactConfig) -> Self {
        let fallback_locales = value.fallback_locales.map(|fallbacks| match fallbacks {
            Either::A(shared) => palamedes::FallbackLocales::Shared(shared),
            Either::B(per_locale) => {
                palamedes::FallbackLocales::PerLocale(per_locale.into_iter().collect())
            }
        });

        Self {
            root_dir: value.root_dir,
            locales: value.locales,
            source_locale: value.source_locale,
            fallback_locales,
            pseudo_locale: value.pseudo_locale,
            catalogs: value
                .catalogs
                .into_iter()
                .map(palamedes::CatalogConfig::from)
                .collect(),
        }
    }
}

impl From<CatalogArtifactRequest> for palamedes::CatalogArtifactRequest {
    fn from(value: CatalogArtifactRequest) -> Self {
        Self {
            config: value.config.into(),
            resource_path: value.resource_path,
        }
    }
}

impl From<CatalogArtifactSelectedRequest> for palamedes::CatalogArtifactSelectedRequest {
    fn from(value: CatalogArtifactSelectedRequest) -> Self {
        Self {
            config: value.config.into(),
            resource_path: value.resource_path,
            compiled_ids: value.compiled_ids,
        }
    }
}

impl From<palamedes::CatalogArtifactSourceKey> for CatalogArtifactSourceKey {
    fn from(value: palamedes::CatalogArtifactSourceKey) -> Self {
        Self {
            message: value.message,
            context: value.context,
        }
    }
}

impl From<palamedes::CatalogArtifactDiagnosticSeverity> for CatalogArtifactDiagnosticSeverity {
    fn from(value: palamedes::CatalogArtifactDiagnosticSeverity) -> Self {
        match value {
            palamedes::CatalogArtifactDiagnosticSeverity::Info => Self::Info,
            palamedes::CatalogArtifactDiagnosticSeverity::Warning => Self::Warning,
            palamedes::CatalogArtifactDiagnosticSeverity::Error => Self::Error,
        }
    }
}

impl From<palamedes::CatalogArtifactMissingMessage> for CatalogArtifactMissingMessage {
    fn from(value: palamedes::CatalogArtifactMissingMessage) -> Self {
        Self {
            compiled_id: value.compiled_id,
            source_key: value.source_key.into(),
            requested_locale: value.requested_locale,
            resolved_locale: value.resolved_locale,
        }
    }
}

impl From<palamedes::CatalogArtifactDiagnostic> for CatalogArtifactDiagnostic {
    fn from(value: palamedes::CatalogArtifactDiagnostic) -> Self {
        Self {
            severity: value.severity.into(),
            code: value.code,
            message: value.message,
            compiled_id: value.compiled_id,
            source_key: value.source_key.into(),
            locale: value.locale,
        }
    }
}

impl From<palamedes::CatalogArtifactResult> for CatalogArtifactResult {
    fn from(value: palamedes::CatalogArtifactResult) -> Self {
        Self {
            messages: value.messages.into_iter().collect(),
            watch_files: value.watch_files,
            missing: value
                .missing
                .into_iter()
                .map(CatalogArtifactMissingMessage::from)
                .collect(),
            diagnostics: value
                .diagnostics
                .into_iter()
                .map(CatalogArtifactDiagnostic::from)
                .collect(),
            resolved_locale_chain: value.resolved_locale_chain,
        }
    }
}

#[napi]
pub fn update_catalog_file(request: CatalogUpdateRequest) -> Result<CatalogUpdateResult> {
    palamedes::update_catalog_file(request.into())
        .map(CatalogUpdateResult::from)
        .map_err(to_napi_error)
}

#[napi]
pub fn parse_catalog(request: CatalogParseRequest) -> Result<CatalogParseResult> {
    palamedes::parse_catalog(request.into())
        .map(CatalogParseResult::from)
        .map_err(to_napi_error)
}

#[napi]
pub fn compile_catalog_artifact(request: CatalogArtifactRequest) -> Result<CatalogArtifactResult> {
    palamedes::compile_catalog_artifact(request.into())
        .map(CatalogArtifactResult::from)
        .map_err(to_napi_error)
}

#[napi]
pub fn compile_catalog_artifact_selected(
    request: CatalogArtifactSelectedRequest,
) -> Result<CatalogArtifactResult> {
    palamedes::compile_catalog_artifact_selected(request.into())
        .map(CatalogArtifactResult::from)
        .map_err(to_napi_error)
}
