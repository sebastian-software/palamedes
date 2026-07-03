use std::collections::BTreeMap;

use ferrocat::{
    CatalogMode as FerrocatCatalogMode, DiagnosticSeverity as FerrocatDiagnosticSeverity,
};
use serde::{Deserialize, Deserializer, Serialize};

/// Request for compiling a full catalog artifact.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogArtifactRequest {
    /// Catalog configuration used to resolve files and locales.
    pub config: CatalogArtifactConfig,
    /// Requested catalog resource path.
    pub resource_path: String,
}

/// Host-facing catalog compilation configuration.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogArtifactConfig {
    /// Absolute or workspace-relative root directory.
    pub root_dir: String,
    /// Supported locales for this catalog set.
    pub locales: Vec<String>,
    /// Source locale used for fallback and extraction semantics.
    pub source_locale: String,
    /// Optional fallback locale policy.
    pub fallback_locales: Option<FallbackLocales>,
    /// Optional pseudo-locale identifier.
    pub pseudo_locale: Option<String>,
    /// Configured catalog locations.
    pub catalogs: Vec<CatalogConfig>,
}

/// Request for compiling a selected subset of runtime IDs.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogArtifactSelectedRequest {
    /// Catalog configuration used to resolve files and locales.
    pub config: CatalogArtifactConfig,
    /// Requested catalog resource path.
    pub resource_path: String,
    /// Runtime IDs to include in the compiled artifact.
    pub compiled_ids: Vec<String>,
}

/// Fallback locale configuration.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum FallbackLocales {
    /// Shared fallback chain applied to every locale.
    Shared(Vec<String>),
    /// Locale-specific fallback chains keyed by locale code.
    PerLocale(BTreeMap<String, Vec<String>>),
}

/// Single catalog path configuration entry.
#[derive(Debug, Deserialize)]
pub struct CatalogConfig {
    /// Catalog path pattern, usually containing `{locale}`.
    pub path: String,
    /// Storage format for configured catalogs.
    #[serde(default)]
    pub format: PalamedesCatalogFormat,
}

/// Palamedes catalog storage format.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PalamedesCatalogFormat {
    /// gettext PO catalogs.
    #[default]
    Po,
    /// Ferrocat Catalog Lines catalogs.
    Fcl,
}

impl<'de> Deserialize<'de> for PalamedesCatalogFormat {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        match value.as_str() {
            "po" => Ok(Self::Po),
            "fcl" => Ok(Self::Fcl),
            "ndjson" => Err(serde::de::Error::custom(
                "format: ndjson is no longer supported; use format: fcl for Ferrocat Catalog Lines",
            )),
            other => Err(serde::de::Error::custom(format!(
                "unsupported catalog format `{other}`; expected `po` or `fcl`"
            ))),
        }
    }
}

impl PalamedesCatalogFormat {
    /// Returns the file extension used for this storage format.
    pub const fn extension(self) -> &'static str {
        match self {
            Self::Po => "po",
            Self::Fcl => "fcl",
        }
    }

    /// Returns the Ferrocat catalog mode used by Palamedes for this format.
    pub const fn ferrocat_mode(self) -> FerrocatCatalogMode {
        match self {
            Self::Po => FerrocatCatalogMode::IcuPo,
            Self::Fcl => FerrocatCatalogMode::IcuFcl,
        }
    }
}

/// Host-neutral compiled catalog artifact.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogArtifactResult {
    /// Compiled runtime message map keyed by runtime ID.
    pub messages: BTreeMap<String, String>,
    /// Files that should be watched for invalidation.
    pub watch_files: Vec<String>,
    /// Missing translations detected during compilation.
    pub missing: Vec<CatalogArtifactMissingMessage>,
    /// Non-fatal diagnostics emitted during compilation.
    pub diagnostics: Vec<CatalogArtifactDiagnostic>,
    /// Resolved locale chain used to build the artifact.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_locale_chain: Option<Vec<String>>,
}

/// Source identity for a catalog message.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogArtifactSourceKey {
    /// Source message string.
    pub message: String,
    /// Optional gettext context.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
}

/// Severity level for compilation diagnostics.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CatalogArtifactDiagnosticSeverity {
    /// Informational diagnostic.
    Info,
    /// Warning diagnostic.
    Warning,
    /// Error diagnostic.
    Error,
}

/// Missing-message entry reported by catalog compilation.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogArtifactMissingMessage {
    /// Runtime ID derived from the source identity.
    pub compiled_id: String,
    /// Source identity for the missing message.
    pub source_key: CatalogArtifactSourceKey,
    /// Locale originally requested by the host.
    pub requested_locale: String,
    /// Locale that ultimately resolved the message, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_locale: Option<String>,
}

/// Diagnostic emitted while compiling a catalog artifact.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogArtifactDiagnostic {
    /// Severity level.
    pub severity: CatalogArtifactDiagnosticSeverity,
    /// Stable diagnostic code.
    pub code: String,
    /// Human-readable diagnostic message.
    pub message: String,
    /// Runtime ID derived from the source identity.
    pub compiled_id: String,
    /// Source identity associated with the diagnostic.
    pub source_key: CatalogArtifactSourceKey,
    /// Locale associated with the diagnostic.
    pub locale: String,
}

impl CatalogArtifactSourceKey {
    pub(crate) fn new(message: String, context: Option<String>) -> Self {
        Self { message, context }
    }
}

impl From<ferrocat::CompiledCatalogMissingMessage> for CatalogArtifactMissingMessage {
    fn from(value: ferrocat::CompiledCatalogMissingMessage) -> Self {
        Self {
            compiled_id: value.key,
            source_key: CatalogArtifactSourceKey::new(
                value.source_key.msgid,
                value.source_key.msgctxt,
            ),
            requested_locale: value.requested_locale,
            resolved_locale: value.resolved_locale,
        }
    }
}

impl From<FerrocatDiagnosticSeverity> for CatalogArtifactDiagnosticSeverity {
    fn from(value: FerrocatDiagnosticSeverity) -> Self {
        match value {
            FerrocatDiagnosticSeverity::Info => Self::Info,
            FerrocatDiagnosticSeverity::Warning => Self::Warning,
            FerrocatDiagnosticSeverity::Error => Self::Error,
        }
    }
}

impl From<ferrocat::CompiledCatalogDiagnostic> for CatalogArtifactDiagnostic {
    fn from(value: ferrocat::CompiledCatalogDiagnostic) -> Self {
        Self {
            severity: value.severity.into(),
            code: value.code.to_string(),
            message: value.message,
            compiled_id: value.key,
            source_key: CatalogArtifactSourceKey::new(value.msgid, value.msgctxt),
            locale: value.locale,
        }
    }
}
