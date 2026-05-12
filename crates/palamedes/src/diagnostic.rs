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

impl From<ferrocat::DiagnosticSeverity> for CatalogDiagnosticSeverity {
    fn from(value: ferrocat::DiagnosticSeverity) -> Self {
        match value {
            ferrocat::DiagnosticSeverity::Info => Self::Info,
            ferrocat::DiagnosticSeverity::Warning => Self::Warning,
            ferrocat::DiagnosticSeverity::Error => Self::Error,
        }
    }
}
