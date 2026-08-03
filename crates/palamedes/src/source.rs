use serde::{Deserialize, Serialize};

use crate::extract::ExtractedMessageRecord;

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
