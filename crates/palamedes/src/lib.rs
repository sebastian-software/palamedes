use std::collections::BTreeMap;

mod catalog_module;
mod catalog_update;
mod extract;
mod transform;

use ferrocat::{parse_po as ferrocat_parse_po, MsgStr, PoFile, PoItem};
use serde::Serialize;

pub use catalog_module::{
    compile_catalog_artifact, compile_catalog_artifact_selected, CatalogArtifactConfig,
    CatalogArtifactDiagnostic, CatalogArtifactDiagnosticSeverity, CatalogArtifactMissingMessage,
    CatalogArtifactRequest, CatalogArtifactResult, CatalogArtifactSelectedRequest,
    CatalogArtifactSourceKey, CatalogConfig, FallbackLocales,
};
pub use catalog_update::{
    parse_catalog, update_catalog_file, CatalogParseRequest, CatalogParseResult,
    CatalogUpdateMessage, CatalogUpdateOrigin, CatalogUpdateRequest, CatalogUpdateResponse,
    CatalogUpdateStats, ParsedCatalogMessage,
};
pub use extract::{extract_messages, ExtractedMessageRecord};
pub use transform::{
    transform_macros, NativeTransformEdit, NativeTransformOptions, NativeTransformResult,
};

pub const FERROCAT_VERSION: &str = "0.8.0";

#[derive(Debug, Serialize)]
pub struct NativeInfo {
    #[serde(rename = "palamedesVersion")]
    pub palamedes_version: &'static str,
    #[serde(rename = "ferrocatVersion")]
    pub ferrocat_version: &'static str,
}

#[derive(Debug, Serialize)]
pub struct JsPoFile {
    pub comments: Vec<String>,
    #[serde(rename = "extractedComments")]
    pub extracted_comments: Vec<String>,
    pub headers: BTreeMap<String, String>,
    #[serde(rename = "headerOrder")]
    pub header_order: Vec<String>,
    pub items: Vec<JsPoItem>,
}

#[derive(Debug, Serialize)]
pub struct JsPoItem {
    pub msgid: String,
    pub msgctxt: Option<String>,
    pub references: Vec<String>,
    #[serde(rename = "msgidPlural")]
    pub msgid_plural: Option<String>,
    pub msgstr: Vec<String>,
    pub comments: Vec<String>,
    #[serde(rename = "extractedComments")]
    pub extracted_comments: Vec<String>,
    pub flags: BTreeMap<String, bool>,
    pub metadata: BTreeMap<String, String>,
    pub obsolete: bool,
    pub nplurals: usize,
}

impl From<PoFile> for JsPoFile {
    fn from(value: PoFile) -> Self {
        let mut headers = BTreeMap::new();
        let mut header_order = Vec::with_capacity(value.headers.len());
        for header in value.headers {
            header_order.push(header.key.clone());
            headers.insert(header.key, header.value);
        }

        Self {
            comments: value.comments,
            extracted_comments: value.extracted_comments,
            headers,
            header_order,
            items: value.items.into_iter().map(JsPoItem::from).collect(),
        }
    }
}

impl From<PoItem> for JsPoItem {
    fn from(value: PoItem) -> Self {
        let flags = value
            .flags
            .into_iter()
            .map(|flag| (flag, true))
            .collect::<BTreeMap<_, _>>();
        let metadata = value.metadata.into_iter().collect::<BTreeMap<_, _>>();
        let msgstr = match value.msgstr {
            MsgStr::None => Vec::new(),
            MsgStr::Singular(value) => vec![value],
            MsgStr::Plural(values) => values,
        };

        Self {
            msgid: value.msgid,
            msgctxt: value.msgctxt,
            references: value.references,
            msgid_plural: value.msgid_plural,
            msgstr,
            comments: value.comments,
            extracted_comments: value.extracted_comments,
            flags,
            metadata,
            obsolete: value.obsolete,
            nplurals: value.nplurals,
        }
    }
}

#[must_use]
pub fn get_native_info() -> NativeInfo {
    NativeInfo {
        palamedes_version: env!("CARGO_PKG_VERSION"),
        ferrocat_version: FERROCAT_VERSION,
    }
}

pub fn parse_po(source: &str) -> Result<JsPoFile, String> {
    let po = ferrocat_parse_po(source).map_err(|error| error.to_string())?;
    Ok(JsPoFile::from(po))
}

#[cfg(test)]
mod tests {
    use super::{get_native_info, parse_po, FERROCAT_VERSION};
    use ferrocat::compiled_key;

    #[test]
    fn exposes_native_info() {
        let info = get_native_info();
        assert_eq!(info.ferrocat_version, FERROCAT_VERSION);
        assert_eq!(info.palamedes_version, env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn generates_internal_lookup_keys_via_ferrocat_v1() {
        assert_eq!(compiled_key("Hello", None), "mCRI2NMFS5Y");
    }

    #[test]
    fn parses_po() {
        let po = parse_po(
            r#"msgid ""
msgstr ""
"Language: de\n"

msgid "Hello"
msgstr "Hallo"
"#,
        )
        .expect("PO should parse");

        assert_eq!(po.headers.get("Language").map(String::as_str), Some("de"));
        assert_eq!(po.items[0].msgid, "Hello");
    }
}
