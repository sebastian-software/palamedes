use std::collections::HashMap;

use napi::bindgen_prelude::Result;
use napi_derive::napi;

use crate::catalog::CatalogUpdateMessage;
use crate::shared::{checked_optional_u32, checked_u32, to_napi_error};

#[napi(object)]
pub struct ExtractedMessageOrigin {
    pub filename: String,
    pub line: u32,
    pub column: Option<u32>,
    pub scope: Option<String>,
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
pub struct ExtractCatalogMessagesRequest {
    pub root_dir: String,
    pub files: Vec<String>,
}

#[napi(object)]
pub struct ExtractCatalogFileFailure {
    pub path: String,
    pub message: String,
}

#[napi(object)]
pub struct ExtractCatalogMessagesResult {
    pub messages: Vec<CatalogUpdateMessage>,
    pub file_count: u32,
    pub failed_files: Vec<ExtractCatalogFileFailure>,
}

impl TryFrom<palamedes::ExtractedMessageRecord> for NativeExtractedMessage {
    type Error = napi::Error;

    fn try_from(value: palamedes::ExtractedMessageRecord) -> Result<Self> {
        Ok(Self {
            message: value.message,
            comment: value.comment,
            context: value.context,
            placeholders: value
                .placeholders
                .map(|placeholders| placeholders.into_iter().collect()),
            origin: ExtractedMessageOrigin {
                filename: value.origin.0,
                line: checked_u32(value.origin.1, "origin.line")?,
                column: checked_optional_u32(value.origin.2, "origin.column")?,
                scope: value.scope,
            },
        })
    }
}

impl From<ExtractCatalogMessagesRequest> for palamedes::ExtractCatalogMessagesRequest {
    fn from(value: ExtractCatalogMessagesRequest) -> Self {
        Self {
            root_dir: value.root_dir,
            files: value.files,
        }
    }
}

impl From<palamedes::CatalogUpdateMessage> for CatalogUpdateMessage {
    fn from(value: palamedes::CatalogUpdateMessage) -> Self {
        Self {
            message: value.message,
            context: value.context,
            placeholders: Some(value.placeholders.into_iter().collect()),
            extracted_comments: value.extracted_comments,
            origins: value.origins.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<palamedes::ExtractCatalogFileFailure> for ExtractCatalogFileFailure {
    fn from(value: palamedes::ExtractCatalogFileFailure) -> Self {
        Self {
            path: value.path,
            message: value.message,
        }
    }
}

impl TryFrom<palamedes::ExtractCatalogMessagesResult> for ExtractCatalogMessagesResult {
    type Error = napi::Error;

    fn try_from(value: palamedes::ExtractCatalogMessagesResult) -> Result<Self> {
        Ok(Self {
            messages: value.messages.into_iter().map(Into::into).collect(),
            file_count: checked_u32(value.file_count, "fileCount")?,
            failed_files: value.failed_files.into_iter().map(Into::into).collect(),
        })
    }
}

#[napi]
#[allow(clippy::needless_pass_by_value)]
/// Extracts source-first messages from a JavaScript or TypeScript module.
///
/// # Errors
///
/// Returns an error when the source cannot be parsed or when extracted origin
/// offsets exceed the Node binding range.
pub fn extract_messages(source: String, filename: String) -> Result<Vec<NativeExtractedMessage>> {
    palamedes::extract_messages(&source, &filename)
        .map_err(to_napi_error)
        .and_then(|messages| {
            messages
                .into_iter()
                .map(NativeExtractedMessage::try_from)
                .collect()
        })
}

#[napi]
#[allow(clippy::needless_pass_by_value)]
/// Extracts and aggregates source-first catalog update messages from files.
///
/// # Errors
///
/// Returns an error when extraction encounters a fatal authoring issue or when
/// result counters exceed the Node binding range.
pub fn extract_catalog_messages_from_files(
    request: ExtractCatalogMessagesRequest,
) -> Result<ExtractCatalogMessagesResult> {
    palamedes::extract_catalog_messages_from_files(request.into())
        .map_err(to_napi_error)
        .and_then(ExtractCatalogMessagesResult::try_from)
}
