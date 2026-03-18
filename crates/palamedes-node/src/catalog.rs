use std::collections::HashMap;

use napi::bindgen_prelude::Result;
use napi_derive::napi;

use crate::catalog_config::{CatalogArtifactRequest, CatalogArtifactSelectedRequest};
use crate::shared::{checked_u32, to_napi_error};

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

impl TryFrom<palamedes::CatalogUpdateStats> for CatalogUpdateStats {
    type Error = napi::Error;

    fn try_from(value: palamedes::CatalogUpdateStats) -> Result<Self> {
        Ok(Self {
            total: checked_u32(value.total, "stats.total")?,
            added: checked_u32(value.added, "stats.added")?,
            changed: checked_u32(value.changed, "stats.changed")?,
            unchanged: checked_u32(value.unchanged, "stats.unchanged")?,
            obsolete_marked: checked_u32(value.obsolete_marked, "stats.obsoleteMarked")?,
            obsolete_removed: checked_u32(value.obsolete_removed, "stats.obsoleteRemoved")?,
        })
    }
}

impl TryFrom<palamedes::CatalogUpdateResponse> for CatalogUpdateResult {
    type Error = napi::Error;

    fn try_from(value: palamedes::CatalogUpdateResponse) -> Result<Self> {
        Ok(Self {
            created: value.created,
            updated: value.updated,
            stats: value.stats.try_into()?,
            diagnostics: value.diagnostics,
        })
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
#[allow(clippy::needless_pass_by_value)]
/// Updates a PO catalog file from source-first extracted messages.
///
/// # Errors
///
/// Returns an error when the Rust core update fails or when update statistics
/// cannot be represented safely in the Node binding shape.
pub fn update_catalog_file(request: CatalogUpdateRequest) -> Result<CatalogUpdateResult> {
    palamedes::update_catalog_file(request.into())
        .map_err(to_napi_error)
        .and_then(CatalogUpdateResult::try_from)
}

#[napi]
#[allow(clippy::needless_pass_by_value)]
/// Parses a PO catalog file into the public semantic catalog shape.
///
/// # Errors
///
/// Returns an error when the file cannot be read or when Ferrocat rejects the
/// catalog contents.
pub fn parse_catalog(request: CatalogParseRequest) -> Result<CatalogParseResult> {
    let request = request.into();
    palamedes::parse_catalog(&request)
        .map(CatalogParseResult::from)
        .map_err(to_napi_error)
}

#[napi]
#[allow(clippy::needless_pass_by_value)]
/// Compiles a full host-neutral catalog artifact for a requested locale.
///
/// # Errors
///
/// Returns an error when config resolution, catalog loading, or artifact
/// compilation fails.
pub fn compile_catalog_artifact(request: CatalogArtifactRequest) -> Result<CatalogArtifactResult> {
    let request = request.into();
    palamedes::compile_catalog_artifact(&request)
        .map(CatalogArtifactResult::from)
        .map_err(to_napi_error)
}

#[napi]
#[allow(clippy::needless_pass_by_value)]
/// Compiles a selected subset of runtime IDs for a requested locale.
///
/// # Errors
///
/// Returns an error when config resolution, catalog loading, or artifact
/// compilation fails.
pub fn compile_catalog_artifact_selected(
    request: CatalogArtifactSelectedRequest,
) -> Result<CatalogArtifactResult> {
    let request = request.into();
    palamedes::compile_catalog_artifact_selected(&request)
        .map(CatalogArtifactResult::from)
        .map_err(to_napi_error)
}
