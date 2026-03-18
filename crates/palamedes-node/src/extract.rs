use std::collections::HashMap;

use napi::bindgen_prelude::Result;
use napi_derive::napi;

use crate::shared::{checked_optional_u32, checked_u32, to_napi_error};

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
            },
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
