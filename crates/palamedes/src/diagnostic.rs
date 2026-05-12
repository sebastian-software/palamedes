use serde::{Deserialize, Serialize};

/// Severity level used by Palamedes catalog diagnostics.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CatalogDiagnosticSeverity {
    /// Informational diagnostic.
    Info,
    /// Warning diagnostic.
    Warning,
    /// Error diagnostic.
    Error,
}

/// Source identity attached to catalog diagnostics.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogDiagnosticSourceKey {
    /// Source message string.
    pub message: String,
    /// Optional gettext context.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
}

/// Structured catalog diagnostic emitted by parse/update operations.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogDiagnostic {
    /// Severity for the diagnostic.
    pub severity: CatalogDiagnosticSeverity,
    /// Stable machine-readable diagnostic code.
    pub code: String,
    /// Human-readable explanation of the condition.
    pub message: String,
    /// Source identity associated with the diagnostic, when applicable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_key: Option<CatalogDiagnosticSourceKey>,
}

impl From<ferrocat::DiagnosticSeverity> for CatalogDiagnosticSeverity {
    fn from(value: ferrocat::DiagnosticSeverity) -> Self {
        match value {
            ferrocat::DiagnosticSeverity::Info => Self::Info,
            ferrocat::DiagnosticSeverity::Warning => Self::Warning,
            ferrocat::DiagnosticSeverity::Error => Self::Error,
        }
    }
}

impl From<ferrocat::Diagnostic> for CatalogDiagnostic {
    fn from(value: ferrocat::Diagnostic) -> Self {
        let source_key = value.msgid.map(|message| CatalogDiagnosticSourceKey {
            message,
            context: value.msgctxt,
        });

        Self {
            severity: value.severity.into(),
            code: value.code,
            message: value.message,
            source_key,
        }
    }
}
