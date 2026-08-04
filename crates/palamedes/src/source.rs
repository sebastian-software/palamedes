use serde::{Deserialize, Serialize};

use crate::extract::ExtractedMessageRecord;
use crate::mdx::MdxOptions;

/// Diagnostic code for messages made only of runtime placeholders.
pub const SOURCE_DIAGNOSTIC_CODE_NO_PLACEHOLDER_ONLY_MESSAGE: &str =
    "pmds/no-placeholder-only-message";
/// Diagnostic code for messages made only of one empty component placeholder.
pub const SOURCE_DIAGNOSTIC_CODE_NO_EMPTY_COMPONENT_ONLY_MESSAGE: &str =
    "pmds/no-empty-component-only-message";
/// Diagnostic code for JSX render positions where `<Trans>` may be clearer.
pub const SOURCE_DIAGNOSTIC_CODE_PREFER_TRANS_IN_JSX: &str = "pmds/prefer-trans-in-jsx";
/// All diagnostic codes emitted by built-in source-authoring rules.
pub const SOURCE_DIAGNOSTIC_CODES: &[&str] = &[
    SOURCE_DIAGNOSTIC_CODE_NO_PLACEHOLDER_ONLY_MESSAGE,
    SOURCE_DIAGNOSTIC_CODE_NO_EMPTY_COMPONENT_ONLY_MESSAGE,
    SOURCE_DIAGNOSTIC_CODE_PREFER_TRANS_IN_JSX,
];

/// Source range with an exact UTF-8 byte span and one-based start location.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRange {
    /// Inclusive start byte.
    pub start: usize,
    /// Exclusive end byte.
    pub end: usize,
    /// One-based source line.
    pub line: usize,
    /// One-based Unicode scalar column.
    pub column: usize,
}

/// Severity assigned to a source-authoring diagnostic.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SourceDiagnosticSeverity {
    /// Authoring error that should normally fail CI.
    Error,
    /// Suspicious authoring that should normally be reviewed.
    Warning,
    /// Informational authoring guidance.
    Info,
}

/// Configurable level for one source-authoring rule.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SourceRuleLevel {
    /// Do not run the rule.
    Off,
    /// Emit an informational diagnostic.
    Info,
    /// Emit a warning diagnostic.
    Warning,
    /// Emit an error diagnostic.
    Error,
}

impl SourceRuleLevel {
    pub(crate) fn severity(self) -> Option<SourceDiagnosticSeverity> {
        match self {
            Self::Off => None,
            Self::Info => Some(SourceDiagnosticSeverity::Info),
            Self::Warning => Some(SourceDiagnosticSeverity::Warning),
            Self::Error => Some(SourceDiagnosticSeverity::Error),
        }
    }
}

/// Levels for the built-in source-authoring rules.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SourceRuleOptions {
    /// Diagnose messages whose authored content consists only of values.
    pub placeholder_only: SourceRuleLevel,
    /// Diagnose messages containing only one empty component placeholder.
    pub empty_component_only: SourceRuleLevel,
    /// Suggest JSX-native `<Trans>` authoring in directly renderable positions.
    pub prefer_trans_in_jsx: SourceRuleLevel,
}

impl Default for SourceRuleOptions {
    fn default() -> Self {
        Self {
            placeholder_only: SourceRuleLevel::Warning,
            empty_component_only: SourceRuleLevel::Off,
            prefer_trans_in_jsx: SourceRuleLevel::Info,
        }
    }
}

impl SourceRuleOptions {
    pub(crate) fn disabled() -> Self {
        Self {
            placeholder_only: SourceRuleLevel::Off,
            empty_component_only: SourceRuleLevel::Off,
            prefer_trans_in_jsx: SourceRuleLevel::Off,
        }
    }
}

/// Options controlling source analysis and built-in diagnostics.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SourceAnalysisOptions {
    /// MDX extraction and compilation semantics.
    pub mdx: MdxOptions,
    /// Built-in source-authoring rule levels.
    pub rules: SourceRuleOptions,
}

/// Structured diagnostic produced while analyzing an authored source file.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceDiagnostic {
    /// Stable machine-readable diagnostic code.
    pub code: String,
    /// Configured diagnostic severity.
    pub severity: SourceDiagnosticSeverity,
    /// Source filename supplied to the analyzer.
    pub file: String,
    /// Primary source location.
    pub primary: SourceRange,
    /// Human-readable explanation of the finding.
    pub message: String,
    /// Actionable guidance for resolving the finding.
    pub help: String,
    /// Related source location, such as the opening side of a mismatch.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub related: Option<SourceRange>,
}

/// Messages and non-fatal diagnostics produced by one source analysis.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceAnalysisResult {
    /// Source-first messages extracted from the analyzed file.
    pub messages: Vec<ExtractedMessageRecord>,
    /// Source-authoring diagnostics in deterministic source order.
    pub diagnostics: Vec<SourceDiagnostic>,
}

/// Source text and structured result produced by one cached file analysis.
#[derive(Debug)]
pub struct SourceFileAnalysisResult {
    /// Exact source text used for both analysis and caller-side suppressions.
    pub source: String,
    /// Messages and diagnostics derived from `source`.
    pub analysis: SourceAnalysisResult,
}

/// Byte-offset to source-location index shared by source analyzers.
pub(crate) struct SourceLocator<'a> {
    source: &'a str,
    line_starts: Vec<usize>,
}

impl<'a> SourceLocator<'a> {
    pub(crate) fn new(source: &'a str) -> Self {
        let mut line_starts = vec![0];
        for (index, &byte) in source.as_bytes().iter().enumerate() {
            if byte == b'\n' {
                line_starts.push(index + 1);
            }
        }
        Self {
            source,
            line_starts,
        }
    }

    pub(crate) fn location(&self, offset: usize) -> (usize, usize) {
        let offset = offset.min(self.source.len());
        let line_index = match self.line_starts.binary_search(&offset) {
            Ok(index) => index,
            Err(index) => index.saturating_sub(1),
        };
        let line_start = self.line_starts[line_index];
        let column = self.source[line_start..offset].chars().count() + 1;
        (line_index + 1, column)
    }

    pub(crate) fn line(&self, offset: usize) -> usize {
        self.location(offset).0
    }

    pub(crate) fn range(&self, start: usize, end: usize) -> SourceRange {
        let (line, column) = self.location(start);
        SourceRange {
            start,
            end,
            line,
            column,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::SourceLocator;

    #[test]
    fn source_locations_use_unicode_scalar_columns() {
        let locator = SourceLocator::new("a😀b\nc");
        assert_eq!(locator.location("a😀".len()), (1, 3));
        assert_eq!(locator.location("a😀b\n".len()), (2, 1));
    }
}
