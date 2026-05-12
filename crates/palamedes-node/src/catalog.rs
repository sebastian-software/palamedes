use std::collections::HashMap;

use napi::bindgen_prelude::{Either, Result};
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
    pub placeholders: Option<HashMap<String, Vec<String>>>,
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

#[napi(string_enum)]
pub enum CatalogDiagnosticSeverity {
    Info,
    Warning,
    Error,
}

#[napi(object)]
pub struct CatalogDiagnosticSourceKey {
    pub message: String,
    pub context: Option<String>,
}

#[napi(object)]
pub struct CatalogAuditCheckOptions {
    pub completeness: Option<bool>,
    pub extra_messages: Option<bool>,
    pub icu_syntax: Option<bool>,
    pub icu_compatibility: Option<bool>,
    pub semantic_metadata: Option<bool>,
    pub fuzzy_flags: Option<bool>,
    pub obsolete_entries: Option<bool>,
}

#[napi(object)]
pub struct CatalogAuditRequest {
    pub config: crate::catalog_config::CatalogArtifactConfig,
    pub locales: Option<Vec<String>>,
    pub checks: Option<CatalogAuditCheckOptions>,
    pub metadata: Option<Vec<MessageMetadataInput>>,
}

#[napi(object)]
pub struct CatalogAuditSummary {
    pub source_messages: u32,
    pub target_locales: u32,
    pub diagnostics: u32,
    pub errors: u32,
    pub warnings: u32,
    pub infos: u32,
}

#[napi(object)]
pub struct CatalogAuditDiagnostic {
    pub severity: CatalogDiagnosticSeverity,
    pub code: String,
    pub message: String,
    pub catalog_path: String,
    pub locale: Option<String>,
    pub source_key: Option<CatalogDiagnosticSourceKey>,
    pub name: Option<String>,
}

#[napi(object)]
pub struct CatalogAuditResult {
    pub summary: CatalogAuditSummary,
    pub diagnostics: Vec<CatalogAuditDiagnostic>,
}

#[napi(object)]
pub struct MessageMetadataInput {
    pub msgid: String,
    pub msgctxt: Option<String>,
    pub description: Option<String>,
    pub origin: Vec<MessageOriginMetadata>,
    pub args: Option<HashMap<String, Either<MessageArgumentKind, MessageArgumentMetadata>>>,
    pub tags: Option<Vec<String>>,
    pub selectors: Option<HashMap<String, MessageSelectorMetadata>>,
}

#[napi(object)]
pub struct MessageOriginMetadata {
    pub file: Option<String>,
    pub line: Option<u32>,
    pub component: Option<String>,
    pub route: Option<String>,
}

#[napi(string_enum)]
pub enum MessageArgumentKind {
    String,
    Number,
    Date,
    Time,
    Datetime,
    Boolean,
    Enum,
    List,
    Duration,
    RelativeTime,
    Name,
    Unknown,
}

#[napi(object)]
pub struct MessageArgumentMetadata {
    pub kind: MessageArgumentKind,
    pub role: Option<String>,
    pub values: Vec<String>,
    pub format: Option<MessageArgumentFormatMetadata>,
}

#[napi(object)]
pub struct MessageArgumentFormatMetadata {
    pub style: Option<String>,
    pub style_kind: Option<MessageFormatStyleKind>,
}

#[napi(string_enum)]
pub enum MessageFormatStyleKind {
    None,
    Predefined,
    Skeleton,
    Pattern,
}

#[napi(object)]
pub struct MessageSelectorMetadata {
    pub kind: MessageSelectorKind,
    pub cases: Vec<String>,
    pub offset: Option<u32>,
}

#[napi(string_enum)]
pub enum MessageSelectorKind {
    Select,
    Plural,
    Selectordinal,
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
            placeholders: value.placeholders.unwrap_or_default().into_iter().collect(),
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

impl From<CatalogAuditCheckOptions> for palamedes::CatalogAuditCheckOptions {
    fn from(value: CatalogAuditCheckOptions) -> Self {
        Self {
            completeness: value.completeness,
            extra_messages: value.extra_messages,
            icu_syntax: value.icu_syntax,
            icu_compatibility: value.icu_compatibility,
            semantic_metadata: value.semantic_metadata,
            fuzzy_flags: value.fuzzy_flags,
            obsolete_entries: value.obsolete_entries,
        }
    }
}

impl From<CatalogAuditRequest> for palamedes::CatalogAuditRequest {
    fn from(value: CatalogAuditRequest) -> Self {
        Self {
            config: value.config.into(),
            locales: value.locales.unwrap_or_default(),
            checks: value.checks.map_or_else(
                palamedes::CatalogAuditCheckOptions::default,
                palamedes::CatalogAuditCheckOptions::from,
            ),
            metadata: value
                .metadata
                .unwrap_or_default()
                .into_iter()
                .map(palamedes::MessageMetadataInput::from)
                .collect(),
        }
    }
}

impl TryFrom<palamedes::CatalogAuditSummary> for CatalogAuditSummary {
    type Error = napi::Error;

    fn try_from(value: palamedes::CatalogAuditSummary) -> Result<Self> {
        Ok(Self {
            source_messages: checked_u32(value.source_messages, "summary.sourceMessages")?,
            target_locales: checked_u32(value.target_locales, "summary.targetLocales")?,
            diagnostics: checked_u32(value.diagnostics, "summary.diagnostics")?,
            errors: checked_u32(value.errors, "summary.errors")?,
            warnings: checked_u32(value.warnings, "summary.warnings")?,
            infos: checked_u32(value.infos, "summary.infos")?,
        })
    }
}

impl From<palamedes::CatalogDiagnosticSeverity> for CatalogDiagnosticSeverity {
    fn from(value: palamedes::CatalogDiagnosticSeverity) -> Self {
        match value {
            palamedes::CatalogDiagnosticSeverity::Info => Self::Info,
            palamedes::CatalogDiagnosticSeverity::Warning => Self::Warning,
            palamedes::CatalogDiagnosticSeverity::Error => Self::Error,
        }
    }
}

impl From<palamedes::CatalogDiagnosticSourceKey> for CatalogDiagnosticSourceKey {
    fn from(value: palamedes::CatalogDiagnosticSourceKey) -> Self {
        Self {
            message: value.message,
            context: value.context,
        }
    }
}

impl From<palamedes::CatalogAuditDiagnostic> for CatalogAuditDiagnostic {
    fn from(value: palamedes::CatalogAuditDiagnostic) -> Self {
        Self {
            severity: value.severity.into(),
            code: value.code,
            message: value.message,
            catalog_path: value.catalog_path,
            locale: value.locale,
            source_key: value.source_key.map(CatalogDiagnosticSourceKey::from),
            name: value.name,
        }
    }
}

impl TryFrom<palamedes::CatalogAuditResult> for CatalogAuditResult {
    type Error = napi::Error;

    fn try_from(value: palamedes::CatalogAuditResult) -> Result<Self> {
        Ok(Self {
            summary: value.summary.try_into()?,
            diagnostics: value
                .diagnostics
                .into_iter()
                .map(CatalogAuditDiagnostic::from)
                .collect(),
        })
    }
}

impl From<MessageMetadataInput> for palamedes::MessageMetadataInput {
    fn from(value: MessageMetadataInput) -> Self {
        Self {
            msgid: value.msgid,
            msgctxt: value.msgctxt,
            description: value.description,
            origin: value
                .origin
                .into_iter()
                .map(palamedes::MessageOriginMetadata::from)
                .collect(),
            args: value.args.map(|args| {
                args.into_iter()
                    .map(|(name, argument)| {
                        let argument = match argument {
                            Either::A(kind) => {
                                palamedes::MessageArgumentMetadataInput::Kind(kind.into())
                            }
                            Either::B(metadata) => {
                                palamedes::MessageArgumentMetadataInput::Details(metadata.into())
                            }
                        };
                        (name, argument)
                    })
                    .collect()
            }),
            tags: value.tags,
            selectors: value.selectors.map(|selectors| {
                selectors
                    .into_iter()
                    .map(|(name, selector)| (name, selector.into()))
                    .collect()
            }),
        }
    }
}

impl From<MessageOriginMetadata> for palamedes::MessageOriginMetadata {
    fn from(value: MessageOriginMetadata) -> Self {
        Self {
            file: value.file,
            line: value.line,
            component: value.component,
            route: value.route,
        }
    }
}

impl From<MessageArgumentKind> for palamedes::MessageArgumentKind {
    fn from(value: MessageArgumentKind) -> Self {
        match value {
            MessageArgumentKind::String => Self::String,
            MessageArgumentKind::Number => Self::Number,
            MessageArgumentKind::Date => Self::Date,
            MessageArgumentKind::Time => Self::Time,
            MessageArgumentKind::Datetime => Self::Datetime,
            MessageArgumentKind::Boolean => Self::Boolean,
            MessageArgumentKind::Enum => Self::Enum,
            MessageArgumentKind::List => Self::List,
            MessageArgumentKind::Duration => Self::Duration,
            MessageArgumentKind::RelativeTime => Self::RelativeTime,
            MessageArgumentKind::Name => Self::Name,
            MessageArgumentKind::Unknown => Self::Unknown,
        }
    }
}

impl From<MessageArgumentMetadata> for palamedes::MessageArgumentMetadata {
    fn from(value: MessageArgumentMetadata) -> Self {
        Self {
            kind: value.kind.into(),
            role: value.role,
            values: value.values,
            format: value
                .format
                .map(palamedes::MessageArgumentFormatMetadata::from),
        }
    }
}

impl From<MessageArgumentFormatMetadata> for palamedes::MessageArgumentFormatMetadata {
    fn from(value: MessageArgumentFormatMetadata) -> Self {
        Self {
            style: value.style,
            style_kind: value
                .style_kind
                .map(palamedes::MessageFormatStyleKind::from),
        }
    }
}

impl From<MessageFormatStyleKind> for palamedes::MessageFormatStyleKind {
    fn from(value: MessageFormatStyleKind) -> Self {
        match value {
            MessageFormatStyleKind::None => Self::None,
            MessageFormatStyleKind::Predefined => Self::Predefined,
            MessageFormatStyleKind::Skeleton => Self::Skeleton,
            MessageFormatStyleKind::Pattern => Self::Pattern,
        }
    }
}

impl From<MessageSelectorMetadata> for palamedes::MessageSelectorMetadata {
    fn from(value: MessageSelectorMetadata) -> Self {
        Self {
            kind: value.kind.into(),
            cases: value.cases,
            offset: value.offset,
        }
    }
}

impl From<MessageSelectorKind> for palamedes::MessageSelectorKind {
    fn from(value: MessageSelectorKind) -> Self {
        match value {
            MessageSelectorKind::Select => Self::Select,
            MessageSelectorKind::Plural => Self::Plural,
            MessageSelectorKind::Selectordinal => Self::SelectOrdinal,
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
/// Audits configured catalogs with Ferrocat catalog QA checks.
///
/// # Errors
///
/// Returns an error when a catalog file cannot be read or parsed, when the
/// audit options are invalid, or when audit counters cannot be represented
/// safely in the Node binding shape.
pub fn audit_catalogs(request: CatalogAuditRequest) -> Result<CatalogAuditResult> {
    palamedes::audit_catalogs(request.into())
        .map_err(to_napi_error)
        .and_then(CatalogAuditResult::try_from)
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
