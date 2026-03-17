use std::collections::HashMap;

use napi::bindgen_prelude::{Either, Result};
use napi::Error;
use napi_derive::napi;

fn to_napi_error(error: impl std::fmt::Display) -> Error {
    Error::from_reason(error.to_string())
}

#[napi(object)]
pub struct NativeInfo {
    pub palamedes_version: String,
    pub ferrocat_version: String,
}

#[napi(object)]
pub struct ParsedPoItem {
    pub msgid: String,
    pub msgctxt: Option<String>,
    pub references: Vec<String>,
    pub msgid_plural: Option<String>,
    pub msgstr: Vec<String>,
    pub comments: Vec<String>,
    pub extracted_comments: Vec<String>,
    pub flags: HashMap<String, bool>,
    pub metadata: HashMap<String, String>,
    pub obsolete: bool,
    pub nplurals: u32,
}

#[napi(object)]
pub struct ParsedPoFile {
    pub comments: Vec<String>,
    pub extracted_comments: Vec<String>,
    pub headers: HashMap<String, String>,
    pub header_order: Vec<String>,
    pub items: Vec<ParsedPoItem>,
}

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
pub struct CatalogModuleCatalogConfig {
    pub path: String,
    pub include: Vec<String>,
    pub exclude: Option<Vec<String>>,
}

#[napi(object)]
pub struct CatalogModuleConfig {
    pub root_dir: String,
    pub locales: Vec<String>,
    pub source_locale: String,
    pub fallback_locales: Option<Either<Vec<String>, HashMap<String, Vec<String>>>>,
    pub pseudo_locale: Option<String>,
    pub catalogs: Vec<CatalogModuleCatalogConfig>,
}

#[napi(object)]
pub struct CatalogModuleRequest {
    pub config: CatalogModuleConfig,
    pub resource_path: String,
}

#[napi(object)]
pub struct CatalogModuleMissingTranslation {
    pub message: String,
    pub context: Option<String>,
}

#[napi(object)]
pub struct CatalogModuleCompilationError {
    pub message: String,
    pub context: Option<String>,
}

#[napi(object)]
pub struct CatalogModuleResult {
    pub messages: HashMap<String, String>,
    pub watch_files: Vec<String>,
    pub missing: Vec<CatalogModuleMissingTranslation>,
    pub errors: Vec<CatalogModuleCompilationError>,
    pub resolved_locale_chain: Option<Vec<String>>,
}

#[napi(object)]
pub struct ExtractedMessageOrigin {
    pub filename: String,
    pub line: u32,
    pub column: Option<u32>,
}

#[napi(object)]
pub struct NativeExtractedMessage {
    pub message: String,
    pub comment: Option<String>,
    pub context: Option<String>,
    pub placeholders: Option<HashMap<String, String>>,
    pub origin: ExtractedMessageOrigin,
}

#[napi(object)]
pub struct NativeTransformOptions {
    pub runtime_module: Option<String>,
    pub runtime_import_name: Option<String>,
    pub strip_non_essential_props: Option<bool>,
    pub strip_message_field: Option<bool>,
}

#[napi(object)]
pub struct NativeTransformEdit {
    pub start: u32,
    pub end: u32,
    pub text: String,
}

#[napi(object)]
pub struct NativeTransformResult {
    pub code: String,
    pub has_changed: bool,
    pub edits: Vec<NativeTransformEdit>,
    pub prepend_text: Option<String>,
}

impl From<palamedes::NativeInfo> for NativeInfo {
    fn from(value: palamedes::NativeInfo) -> Self {
        Self {
            palamedes_version: value.palamedes_version.to_owned(),
            ferrocat_version: value.ferrocat_version.to_owned(),
        }
    }
}

impl From<palamedes::JsPoItem> for ParsedPoItem {
    fn from(value: palamedes::JsPoItem) -> Self {
        Self {
            msgid: value.msgid,
            msgctxt: value.msgctxt,
            references: value.references,
            msgid_plural: value.msgid_plural,
            msgstr: value.msgstr,
            comments: value.comments,
            extracted_comments: value.extracted_comments,
            flags: value.flags.into_iter().collect(),
            metadata: value.metadata.into_iter().collect(),
            obsolete: value.obsolete,
            nplurals: value.nplurals as u32,
        }
    }
}

impl From<palamedes::JsPoFile> for ParsedPoFile {
    fn from(value: palamedes::JsPoFile) -> Self {
        Self {
            comments: value.comments,
            extracted_comments: value.extracted_comments,
            headers: value.headers.into_iter().collect(),
            header_order: value.header_order,
            items: value.items.into_iter().map(ParsedPoItem::from).collect(),
        }
    }
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

impl From<CatalogModuleCatalogConfig> for palamedes::CatalogConfig {
    fn from(value: CatalogModuleCatalogConfig) -> Self {
        let _ = value.include;
        let _ = value.exclude;
        Self { path: value.path }
    }
}

impl From<CatalogModuleConfig> for palamedes::CatalogModuleConfig {
    fn from(value: CatalogModuleConfig) -> Self {
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

impl From<CatalogModuleRequest> for palamedes::CatalogModuleRequest {
    fn from(value: CatalogModuleRequest) -> Self {
        Self {
            config: value.config.into(),
            resource_path: value.resource_path,
        }
    }
}

impl From<palamedes::MissingTranslation> for CatalogModuleMissingTranslation {
    fn from(value: palamedes::MissingTranslation) -> Self {
        Self {
            message: value.message,
            context: value.context,
        }
    }
}

impl From<palamedes::CompilationError> for CatalogModuleCompilationError {
    fn from(value: palamedes::CompilationError) -> Self {
        Self {
            message: value.message,
            context: value.context,
        }
    }
}

impl From<palamedes::CatalogModuleResult> for CatalogModuleResult {
    fn from(value: palamedes::CatalogModuleResult) -> Self {
        Self {
            messages: value.messages.into_iter().collect(),
            watch_files: value.watch_files,
            missing: value
                .missing
                .into_iter()
                .map(CatalogModuleMissingTranslation::from)
                .collect(),
            errors: value
                .errors
                .into_iter()
                .map(CatalogModuleCompilationError::from)
                .collect(),
            resolved_locale_chain: value.resolved_locale_chain,
        }
    }
}

impl From<palamedes::ExtractedMessageRecord> for NativeExtractedMessage {
    fn from(value: palamedes::ExtractedMessageRecord) -> Self {
        Self {
            message: value.message,
            comment: value.comment,
            context: value.context,
            placeholders: value
                .placeholders
                .map(|placeholders| placeholders.into_iter().collect()),
            origin: ExtractedMessageOrigin {
                filename: value.origin.0,
                line: value.origin.1 as u32,
                column: value.origin.2.map(|column| column as u32),
            },
        }
    }
}

impl From<NativeTransformOptions> for palamedes::NativeTransformOptions {
    fn from(value: NativeTransformOptions) -> Self {
        Self {
            runtime_module: value.runtime_module,
            runtime_import_name: value.runtime_import_name,
            strip_non_essential_props: value.strip_non_essential_props,
            strip_message_field: value.strip_message_field,
        }
    }
}

impl From<palamedes::NativeTransformEdit> for NativeTransformEdit {
    fn from(value: palamedes::NativeTransformEdit) -> Self {
        Self {
            start: value.start as u32,
            end: value.end as u32,
            text: value.text,
        }
    }
}

impl From<palamedes::NativeTransformResult> for NativeTransformResult {
    fn from(value: palamedes::NativeTransformResult) -> Self {
        Self {
            code: value.code,
            has_changed: value.has_changed,
            edits: value
                .edits
                .into_iter()
                .map(NativeTransformEdit::from)
                .collect(),
            prepend_text: value.prepend_text,
        }
    }
}

#[napi]
pub fn get_native_info() -> NativeInfo {
    palamedes::get_native_info().into()
}

#[napi]
pub fn parse_po(source: String) -> Result<ParsedPoFile> {
    palamedes::parse_po(&source)
        .map(ParsedPoFile::from)
        .map_err(to_napi_error)
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
pub fn get_catalog_module(request: CatalogModuleRequest) -> Result<CatalogModuleResult> {
    palamedes::get_catalog_module(request.into())
        .map(CatalogModuleResult::from)
        .map_err(to_napi_error)
}

#[napi]
pub fn extract_messages(source: String, filename: String) -> Result<Vec<NativeExtractedMessage>> {
    palamedes::extract_messages(&source, &filename)
        .map(|messages| {
            messages
                .into_iter()
                .map(NativeExtractedMessage::from)
                .collect()
        })
        .map_err(to_napi_error)
}

#[napi]
pub fn transform_macros(
    source: String,
    filename: String,
    options: Option<NativeTransformOptions>,
) -> Result<NativeTransformResult> {
    palamedes::transform_macros(
        &source,
        &filename,
        options.map(palamedes::NativeTransformOptions::from),
    )
    .map(NativeTransformResult::from)
    .map_err(to_napi_error)
}
