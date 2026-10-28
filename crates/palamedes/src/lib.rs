#![warn(missing_docs, rustdoc::broken_intra_doc_links)]
//! Rust core for Palamedes: extraction, catalogs, ICU handling, and the
//! macro transform behind the `pmds` CLI and the `@palamedes/core-node`
//! Node binding.
//!
//! Only the [`sdk`] module is a public API covered by SemVer. It holds the
//! compiler entry points that `palamedes-build` uses. Every other item is
//! hidden from these docs: it is toolchain-internal for the CLI, the Node
//! binding, and the plugin host, and can change in any release.
//!
//! Applications use `palamedes-build` in `build.rs` and `palamedes-i18n` at
//! runtime instead of depending on this crate directly.

use std::collections::BTreeMap;

mod catalog_artifact;
mod catalog_audit;
mod catalog_combine;
mod catalog_convert;
mod catalog_coverage;
mod catalog_machine_translation;
mod catalog_module;
mod catalog_three_way;
mod catalog_update;
mod choice;
mod component;
mod descriptor;
mod diagnostic;
mod error;
mod extract;
mod extract_cache;
mod icu_compatibility;
mod icu_text;
mod jsx_entities;
mod jsx_message;
mod mdx;
mod message_metadata;
mod placeholder_name;
mod runtime_macro_manifest;
mod runtime_message;
pub mod sdk;
mod source;
mod source_macros;
mod source_message;
mod svelte;
mod target_text;
#[cfg(test)]
mod test_support;
mod transform;
mod translation_candidates;
mod translation_scope;
mod vue;

use ferrocat::{MsgStr, PoFile, PoItem, parse_po as ferrocat_parse_po};
use serde::Serialize;

#[doc(hidden)]
pub use catalog_artifact::{
    CatalogArtifactConfig, CatalogArtifactDiagnostic, CatalogArtifactDiagnosticSeverity,
    CatalogArtifactMissingMessage, CatalogArtifactRequest, CatalogArtifactResult,
    CatalogArtifactSelectedRequest, CatalogArtifactSourceKey, CatalogCompilationCache,
    CatalogConfig, FallbackLocales, PalamedesCatalogFormat, compile_catalog_artifact,
    compile_catalog_artifact_selected, compile_catalog_artifact_selected_cached,
    compile_catalog_artifact_selected_cached_without_waiting, parse_catalog_for_compile,
    resolve_catalog_file_path,
};
#[doc(hidden)]
pub use catalog_audit::{
    CatalogAuditCheckOptions, CatalogAuditDiagnostic, CatalogAuditRequest, CatalogAuditResult,
    CatalogAuditSummary, audit_catalogs,
};
#[doc(hidden)]
pub use catalog_combine::{
    CatalogCombineInput, CatalogCombineRequest, CatalogCombineResult, CatalogCombineSelection,
    CatalogCombineStats, CatalogConflictStrategy, CatalogFileCombineRequest,
    CatalogFileCombineResult, combine_catalog_files, combine_catalogs,
};
#[doc(hidden)]
pub use catalog_convert::{
    CatalogFileConvertRequest, CatalogFileConvertResult, convert_catalog_file,
};
#[doc(hidden)]
pub use catalog_coverage::{
    CatalogCoverageRequest, CatalogCoverageResult, CatalogLocaleCoverageResult,
    measure_catalog_coverage,
};
#[doc(hidden)]
pub use catalog_machine_translation::{
    CatalogMachineTranslationInspection, CatalogMachineTranslationInspectionRequest,
    CatalogMachineTranslationInspectionResult, inspect_catalog_machine_translations,
};
#[doc(hidden)]
pub use catalog_module::render_catalog_module;
#[doc(hidden)]
pub use catalog_three_way::{
    CATALOG_MODIFY_DELETE_RESOLVED, CatalogFileThreeWayMergeRequest, CatalogMergeSide,
    CatalogThreeWayMergeRequest, merge_catalog_files_three_way, merge_catalogs_three_way,
};
#[doc(hidden)]
pub use catalog_update::{
    AiProvenance, CatalogOriginMetadata, CatalogParseRequest, CatalogParseResult,
    CatalogUpdateMessage, CatalogUpdateOrigin, CatalogUpdatePreview, CatalogUpdateRequest,
    CatalogUpdateResponse, CatalogUpdateStats, MachineMetadata, ParsedCatalogMessage, PoLineBreaks,
    PoOutputOptions, parse_catalog, preview_catalog_file_update, update_catalog_file,
};
#[doc(hidden)]
pub use diagnostic::{CatalogDiagnostic, CatalogDiagnosticSeverity, CatalogDiagnosticSourceKey};
#[doc(hidden)]
pub use error::{PalamedesError, PalamedesResult};
#[doc(hidden)]
pub use extract::{
    ExtractCatalogFileFailure, ExtractCatalogMessagesOptions, ExtractCatalogMessagesRequest,
    ExtractCatalogMessagesResult, ExtractedMessageRecord, SourceFileAnalysisRequest,
    analyze_source, analyze_source_file_cached, analyze_source_files_cached,
    analyze_source_with_mdx_options, analyze_source_with_options, extract_catalog_messages_cached,
    extract_catalog_messages_from_files, extract_catalog_messages_from_files_with_options,
    extract_messages, extract_messages_with_mdx_options,
};
#[doc(hidden)]
pub use extract_cache::{ExtractCache, default_cache_path};
#[doc(hidden)]
pub use ferrocat::{CatalogMachineTranslationReview, CatalogMachineTranslationStatus};
#[doc(hidden)]
pub use icu_text::compiled_message_key;
#[doc(hidden)]
pub use mdx::{
    MdxAnalysisResult, MdxDiagnosticRecord, MdxFramework, MdxOptions, analyze_mdx,
    extract_mdx_messages,
};
#[doc(hidden)]
pub use message_metadata::{
    MessageArgumentFormatMetadata, MessageArgumentKind, MessageArgumentMetadata,
    MessageArgumentMetadataInput, MessageFormatStyleKind, MessageMetadata,
    MessageMetadataDiagnostic, MessageMetadataInput, MessageMetadataValidationReport,
    MessageOriginMetadata, MessageSelectorKind, MessageSelectorMetadata, derive_message_metadata,
    normalize_message_metadata, validate_message_metadata,
};
#[doc(hidden)]
pub use runtime_macro_manifest::{
    RUNTIME_MACRO_MANIFEST_VERSION, RuntimeMacroChoice, RuntimeMacroDescriptor,
    RuntimeMacroManifest, RuntimeMacroTemplate, collect_runtime_macro_manifest,
};
#[doc(hidden)]
pub use runtime_message::{
    RuntimeCompiledMessage, RuntimeCompiledMessages, RuntimeMessageChoiceKind,
    RuntimeMessageFormat, RuntimeMessageNode, compile_runtime_catalog_messages,
};
#[doc(hidden)]
pub use source::{
    SOURCE_DIAGNOSTIC_CODE_NO_EMPTY_COMPONENT_ONLY_MESSAGE,
    SOURCE_DIAGNOSTIC_CODE_NO_PLACEHOLDER_ONLY_MESSAGE, SOURCE_DIAGNOSTIC_CODE_PREFER_TRANS_IN_JSX,
    SOURCE_DIAGNOSTIC_CODES, SourceAnalysisOptions, SourceAnalysisResult, SourceComment,
    SourceCommentKind, SourceDiagnostic, SourceDiagnosticSeverity, SourceFileAnalysisResult,
    SourceRange, SourceRuleLevel, SourceRuleOptions,
};
#[doc(hidden)]
pub use target_text::{
    TargetTextCheckOptions, TargetTextSpan, TranslationTargetText, TranslationTargetTextDiagnostic,
    TranslationTargetTextRequest, TranslationTargetTextResult, check_translation_targets,
};
#[doc(hidden)]
pub use transform::{
    NativeTransformEdit, NativeTransformOptions, NativeTransformResult, NativeTransformSourceMap,
    ServerFunctionTransformOptions, transform_macros,
};
#[cfg(feature = "test-support")]
#[doc(hidden)]
pub use translation_candidates::apply_translation_patches_with_injected_write_failure;
#[doc(hidden)]
pub use translation_candidates::{
    DEFAULT_TRANSLATION_CANDIDATE_MAX_ORIGINS, TranslationCandidate, TranslationCandidateId,
    TranslationCandidateRequest, TranslationCandidateResult, TranslationMachineProvenance,
    TranslationPatch, TranslationPatchOutcome, TranslationPatchOutcomeStatus,
    TranslationPatchRequest, TranslationPatchResult, TranslationPatchStats, TranslationPluralKind,
    TranslationReviewState, TranslationValue, TranslationWorkflowDiagnostic,
    TranslationWorkflowOrigin, apply_translation_patches, list_translation_candidates,
};

/// `ferrocat` version that Cargo.lock pins for the native builds.
///
/// The manifest uses a caret requirement, so another Cargo graph can link a
/// newer compatible version.
#[doc(hidden)]
pub const FERROCAT_VERSION: &str = "3.4.2";

/// Version metadata for the loaded native core.
#[doc(hidden)]
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
#[doc(hidden)]
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
#[doc(hidden)]
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
#[doc(hidden)]
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
#[doc(hidden)]
pub fn parse_po(source: &str) -> PalamedesResult<JsPoFile> {
    let po = ferrocat_parse_po(source)?;
    Ok(JsPoFile::from(po))
}

#[cfg(test)]
mod tests {
    use super::{FERROCAT_VERSION, get_native_info, parse_po};
    use ferrocat::compiled_key;

    #[test]
    fn exposes_native_info() {
        let info = get_native_info();
        assert_eq!(info.ferrocat_version, FERROCAT_VERSION);
        assert_eq!(info.palamedes_version, env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn ferrocat_version_matches_declared_dependency() {
        let manifest = include_str!("../../../Cargo.toml");
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
