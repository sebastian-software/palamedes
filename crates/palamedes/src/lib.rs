use std::collections::BTreeMap;

mod extract;
mod transform;

use pofile::{parse_po, PoFile, PoItem};
use serde::Serialize;

pub use extract::extract_messages_json;
pub use transform::transform_macros_json;

pub const POFILE_VERSION: &str = "5.0.0-beta.0";

#[derive(Debug, Serialize)]
pub struct NativeInfo {
    #[serde(rename = "palamedesVersion")]
    pub palamedes_version: &'static str,
    #[serde(rename = "pofileVersion")]
    pub pofile_version: &'static str,
}

#[derive(Debug, Serialize)]
struct JsPoFile {
    comments: Vec<String>,
    #[serde(rename = "extractedComments")]
    extracted_comments: Vec<String>,
    headers: BTreeMap<String, String>,
    #[serde(rename = "headerOrder")]
    header_order: Vec<String>,
    items: Vec<JsPoItem>,
}

#[derive(Debug, Serialize)]
struct JsPoItem {
    msgid: String,
    msgctxt: Option<String>,
    references: Vec<String>,
    #[serde(rename = "msgidPlural")]
    msgid_plural: Option<String>,
    msgstr: Vec<String>,
    comments: Vec<String>,
    #[serde(rename = "extractedComments")]
    extracted_comments: Vec<String>,
    flags: BTreeMap<String, bool>,
    metadata: BTreeMap<String, String>,
    obsolete: bool,
    nplurals: usize,
}

impl From<PoFile> for JsPoFile {
    fn from(value: PoFile) -> Self {
        Self {
            comments: value.comments,
            extracted_comments: value.extracted_comments,
            headers: value.headers,
            header_order: value.header_order,
            items: value.items.into_iter().map(JsPoItem::from).collect(),
        }
    }
}

impl From<PoItem> for JsPoItem {
    fn from(value: PoItem) -> Self {
        Self {
            msgid: value.msgid,
            msgctxt: value.msgctxt,
            references: value.references,
            msgid_plural: value.msgid_plural,
            msgstr: value.msgstr,
            comments: value.comments,
            extracted_comments: value.extracted_comments,
            flags: value.flags,
            metadata: value.metadata,
            obsolete: value.obsolete,
            nplurals: value.nplurals,
        }
    }
}

#[must_use]
pub fn get_native_info() -> NativeInfo {
    NativeInfo {
        palamedes_version: env!("CARGO_PKG_VERSION"),
        pofile_version: POFILE_VERSION,
    }
}

pub fn get_native_info_json() -> Result<String, serde_json::Error> {
    serde_json::to_string(&get_native_info())
}

#[must_use]
pub fn generate_message_id(message: &str, context: Option<&str>) -> String {
    pofile::generate_message_id(message, context)
}

pub fn parse_po_json(source: &str) -> Result<String, serde_json::Error> {
    let po = parse_po(source);
    serde_json::to_string(&JsPoFile::from(po))
}

#[cfg(test)]
mod tests {
    use super::{generate_message_id, get_native_info, parse_po_json, POFILE_VERSION};

    #[test]
    fn generates_message_ids_via_pofile() {
        assert_eq!(generate_message_id("Hello", None), "GF-NsyJx");
    }

    #[test]
    fn exposes_native_info() {
        let info = get_native_info();
        assert_eq!(info.pofile_version, POFILE_VERSION);
        assert_eq!(info.palamedes_version, env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn parses_po_to_json() {
        let json = parse_po_json(
            r#"msgid ""
msgstr ""
"Language: de\n"

msgid "Hello"
msgstr "Hallo"
"#,
        )
        .expect("PO should serialize to JSON");

        assert!(json.contains(r#""Language":"de""#));
        assert!(json.contains(r#""msgid":"Hello""#));
    }
}
