use std::collections::HashMap;

use napi::bindgen_prelude::Result;
use napi_derive::napi;

use crate::shared::to_napi_error;

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
