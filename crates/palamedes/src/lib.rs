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
mod catalog_audit;
mod catalog_combine;
mod catalog_update;
mod descriptor;
mod diagnostic;
mod error;
mod extract;
mod jsx_entities;
mod jsx_message;
mod message_metadata;
#[cfg(test)]
mod test_support;
mod transform;
mod translation_scope;

use ferrocat::{parse_po as ferrocat_parse_po, MsgStr, PoFile, PoItem};
use serde::Serialize;

pub use catalog_artifact::{
    compile_catalog_artifact, compile_catalog_artifact_selected, CatalogArtifactConfig,
    CatalogArtifactDiagnostic, CatalogArtifactDiagnosticSeverity, CatalogArtifactMissingMessage,
    CatalogArtifactRequest, CatalogArtifactResult, CatalogArtifactSelectedRequest,
    CatalogArtifactSourceKey, CatalogConfig, FallbackLocales, PalamedesCatalogFormat,
};
pub use catalog_audit::{
    audit_catalogs, CatalogAuditCheckOptions, CatalogAuditDiagnostic, CatalogAuditRequest,
    CatalogAuditResult, CatalogAuditSummary,
};
pub use catalog_combine::{
    combine_catalog_files, combine_catalogs, CatalogCombineInput, CatalogCombineRequest,
    CatalogCombineResult, CatalogCombineSelection, CatalogCombineStats, CatalogConflictStrategy,
    CatalogFileCombineRequest, CatalogFileCombineResult, CatalogFileFormat,
};
pub use catalog_update::{
    parse_catalog, update_catalog_file, AiProvenance, CatalogOriginMetadata, CatalogParseRequest,
    CatalogParseResult, CatalogUpdateMessage, CatalogUpdateOrigin, CatalogUpdateRequest,
    CatalogUpdateResponse, CatalogUpdateStats, MachineMetadata, ParsedCatalogMessage,
};
pub use diagnostic::{CatalogDiagnostic, CatalogDiagnosticSeverity, CatalogDiagnosticSourceKey};
pub use error::{PalamedesError, PalamedesResult};
pub use extract::{
    extract_catalog_messages_from_files, extract_messages, ExtractCatalogFileFailure,
    ExtractCatalogMessagesRequest, ExtractCatalogMessagesResult, ExtractedMessageRecord,
};
pub use message_metadata::{
    derive_message_metadata, normalize_message_metadata, validate_message_metadata,
    MessageArgumentFormatMetadata, MessageArgumentKind, MessageArgumentMetadata,
    MessageArgumentMetadataInput, MessageFormatStyleKind, MessageMetadata,
    MessageMetadataDiagnostic, MessageMetadataInput, MessageMetadataValidationReport,
    MessageOriginMetadata, MessageSelectorKind, MessageSelectorMetadata,
};
pub use transform::{
    transform_macros, NativeTransformEdit, NativeTransformOptions, NativeTransformResult,
    NativeTransformSourceMap,
};

/// Published `ferrocat` version used by the Rust core.
pub const FERROCAT_VERSION: &str = "2.2.0";

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
            references: value.references.into(),
            msgid_plural: value.msgid_plural,
            msgstr,
            comments: value.comments.into(),
            extracted_comments: value.extracted_comments.into(),
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
    fn ferrocat_version_matches_declared_dependency() {
        let manifest = include_str!("../Cargo.toml");
        let declared = dependency_version(manifest, "ferrocat")
            .expect("ferrocat dependency should be declared");

        assert_eq!(FERROCAT_VERSION, declared.trim_start_matches('='));
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

    #[test]
    fn parses_po_machine_translation_metadata() {
        let po = parse_po(
            r#"#@ ferrocat-mt model=openai/gpt-5.5-high confidence=95 hash=abc
msgid "Hello"
msgstr "Hallo"
"#,
        )
        .expect("PO should parse");

        assert_eq!(
            po.items[0].metadata.get("ferrocat-mt").map(String::as_str),
            Some("model=openai/gpt-5.5-high confidence=95 hash=abc")
        );
    }

    fn dependency_version<'a>(manifest: &'a str, name: &str) -> Option<&'a str> {
        let mut in_dependencies = false;
        for line in manifest.lines().map(str::trim) {
            if line.starts_with('[') {
                in_dependencies = line == "[dependencies]";
                continue;
            }
            if !in_dependencies || line.starts_with('#') {
                continue;
            }

            let Some((key, value)) = line.split_once('=') else {
                continue;
            };
            if key.trim() == name {
                return dependency_value_version(value.trim());
            }
        }
        None
    }

    fn dependency_value_version(value: &str) -> Option<&str> {
        if let Some(value) = value.strip_prefix('"') {
            return value.split('"').next();
        }

        value
            .trim_start_matches('{')
            .trim_end_matches('}')
            .split(',')
            .find_map(|entry| {
                let (key, value) = entry.split_once('=')?;
                if key.trim() == "version" {
                    value.trim().strip_prefix('"')?.split('"').next()
                } else {
                    None
                }
            })
    }
}
