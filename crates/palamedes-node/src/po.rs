use std::collections::HashMap;

use napi::bindgen_prelude::Result;
use napi_derive::napi;

use crate::shared::to_napi_error;

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
