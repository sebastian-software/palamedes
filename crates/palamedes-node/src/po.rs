use std::collections::HashMap;

use napi::bindgen_prelude::Result;
use napi_derive::napi;

use crate::shared::{checked_u32, to_napi_error};

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

impl From<palamedes::NativeInfo> for NativeInfo {
    fn from(value: palamedes::NativeInfo) -> Self {
        Self {
            palamedes_version: value.palamedes_version.to_owned(),
            ferrocat_version: value.ferrocat_version.to_owned(),
        }
    }
}

impl TryFrom<palamedes::JsPoItem> for ParsedPoItem {
    type Error = napi::Error;

    fn try_from(value: palamedes::JsPoItem) -> Result<Self> {
        Ok(Self {
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
            nplurals: checked_u32(value.nplurals, "item.nplurals")?,
        })
    }
}

impl TryFrom<palamedes::JsPoFile> for ParsedPoFile {
    type Error = napi::Error;

    fn try_from(value: palamedes::JsPoFile) -> Result<Self> {
        Ok(Self {
            comments: value.comments,
            extracted_comments: value.extracted_comments,
            headers: value.headers.into_iter().collect(),
            header_order: value.header_order,
            items: value
                .items
                .into_iter()
                .map(ParsedPoItem::try_from)
                .collect::<Result<Vec<_>>>()?,
        })
    }
}

#[napi]
#[must_use]
/// Returns the version metadata for the loaded native binding.
pub fn get_native_info() -> NativeInfo {
    palamedes::get_native_info().into()
}

#[napi]
#[allow(clippy::needless_pass_by_value)]
/// Parses raw PO source text into the public host-facing PO shape.
///
/// # Errors
///
/// Returns an error when the PO source cannot be parsed or when parsed
/// metadata cannot be represented safely in the Node binding shape.
pub fn parse_po(source: String) -> Result<ParsedPoFile> {
    palamedes::parse_po(&source)
        .map_err(to_napi_error)
        .and_then(ParsedPoFile::try_from)
}
