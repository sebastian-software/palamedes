#![warn(missing_docs, rustdoc::broken_intra_doc_links)]
//! Rust core for Palamedes.
//!
//! ```rust
//! let po = palamedes::parse_po(
//!     r#"msgid ""
//! msgstr ""
//! "Language: en\n"
//!
//! msgid "Hello"
//! msgstr "Hello"
//! "#,
//! )
//! .expect("PO source should parse");
//!
//! assert_eq!(po.items[0].msgid, "Hello");
//! ```

use std::collections::BTreeMap;

mod catalog_artifact;
mod catalog_update;
mod error;
mod extract;
mod transform;

use ferrocat::{parse_po as ferrocat_parse_po, MsgStr, PoFile, PoItem};
use serde::Serialize;

pub use catalog_artifact::{
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
pub use error::{PalamedesError, PalamedesResult};
pub use extract::{extract_messages, ExtractedMessageRecord};
pub use transform::{
    transform_macros, NativeTransformEdit, NativeTransformOptions, NativeTransformResult,
};

/// Published `ferrocat` version used by the Rust core.
pub const FERROCAT_VERSION: &str = "0.8.0";

/// Version metadata for the loaded native core.
#[derive(Debug, Serialize)]
pub struct NativeInfo {
    /// Current Palamedes crate version.
    #[serde(rename = "palamedesVersion")]
    pub palamedes_version: &'static str,
    /// Current linked `ferrocat` version.
    #[serde(rename = "ferrocatVersion")]
    pub ferrocat_version: &'static str,
}

/// JSON-serializable PO file representation used by host bindings.
#[derive(Debug, Serialize)]
pub struct JsPoFile {
    /// File-level translator comments.
    pub comments: Vec<String>,
    /// File-level extracted comments.
    #[serde(rename = "extractedComments")]
    pub extracted_comments: Vec<String>,
    /// Parsed header map.
    pub headers: BTreeMap<String, String>,
    /// Original header ordering.
    #[serde(rename = "headerOrder")]
    pub header_order: Vec<String>,
    /// Catalog items in source order.
    pub items: Vec<JsPoItem>,
}

/// JSON-serializable PO message representation used by host bindings.
#[derive(Debug, Serialize)]
pub struct JsPoItem {
    /// Source gettext identifier.
    pub msgid: String,
    /// Optional gettext context.
    pub msgctxt: Option<String>,
    /// Source references such as file locations.
    pub references: Vec<String>,
    /// Optional plural source identifier.
    #[serde(rename = "msgidPlural")]
    pub msgid_plural: Option<String>,
    /// Translation slots in plural order.
    pub msgstr: Vec<String>,
    /// Translator comments.
    pub comments: Vec<String>,
    /// Extracted comments.
    #[serde(rename = "extractedComments")]
    pub extracted_comments: Vec<String>,
    /// Boolean flags keyed by flag name.
    pub flags: BTreeMap<String, bool>,
    /// Additional metadata entries.
    pub metadata: BTreeMap<String, String>,
    /// Whether the message is obsolete.
    pub obsolete: bool,
    /// Number of plural forms expected for the locale.
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

/// Returns runtime version information for the core.
#[must_use]
pub fn get_native_info() -> NativeInfo {
    NativeInfo {
        palamedes_version: env!("CARGO_PKG_VERSION"),
        ferrocat_version: FERROCAT_VERSION,
    }
}

/// Parses a PO file into a JSON-serializable representation for host bindings.
///
/// # Errors
///
/// Returns an error when the provided PO source cannot be parsed by Ferrocat.
pub fn parse_po(source: &str) -> PalamedesResult<JsPoFile> {
    let po = ferrocat_parse_po(source)?;
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
