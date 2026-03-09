use std::collections::BTreeMap;

use pofile::{parse_po, PoFile, PoItem};
use serde::Serialize;

pub const POFILE_GIT_REV: &str = "61ab31494e46b937f99b0578d21fe7b32f9ad91f";

#[derive(Debug, Serialize)]
pub struct NativeInfo {
    #[serde(rename = "palamedesVersion")]
    pub palamedes_version: &'static str,
    #[serde(rename = "pofileGitRev")]
    pub pofile_git_rev: &'static str,
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
        pofile_git_rev: POFILE_GIT_REV,
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
    use super::{generate_message_id, get_native_info, parse_po_json, POFILE_GIT_REV};

    #[test]
    fn generates_message_ids_via_pofile() {
        assert_eq!(generate_message_id("Hello", None), "GF-NsyJx");
    }

    #[test]
    fn exposes_native_info() {
        let info = get_native_info();
        assert_eq!(info.pofile_git_rev, POFILE_GIT_REV);
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
