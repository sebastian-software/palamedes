use napi::bindgen_prelude::Result;
use napi_derive::napi;

use crate::extract::NativeExtractedMessage;
use crate::mdx::NativeMdxOptions;
use crate::shared::{checked_u32, to_napi_error};

#[napi(object)]
pub struct NativeSourceRange {
    pub start: u32,
    pub end: u32,
    pub line: u32,
    pub column: u32,
}

#[napi(object)]
pub struct NativeSourceDiagnostic {
    pub code: String,
    pub severity: String,
    pub file: String,
    pub primary: NativeSourceRange,
    pub message: String,
    pub help: String,
    pub related: Option<NativeSourceRange>,
}

#[napi(object)]
pub struct NativeSourceAnalysisResult {
    pub messages: Vec<NativeExtractedMessage>,
    pub diagnostics: Vec<NativeSourceDiagnostic>,
}

impl TryFrom<palamedes::SourceRange> for NativeSourceRange {
    type Error = napi::Error;

    fn try_from(value: palamedes::SourceRange) -> Result<Self> {
        Ok(Self {
            start: checked_u32(value.start, "sourceRange.start")?,
            end: checked_u32(value.end, "sourceRange.end")?,
            line: checked_u32(value.line, "sourceRange.line")?,
            column: checked_u32(value.column, "sourceRange.column")?,
        })
    }
}

impl TryFrom<palamedes::SourceDiagnostic> for NativeSourceDiagnostic {
    type Error = napi::Error;

    fn try_from(value: palamedes::SourceDiagnostic) -> Result<Self> {
        let severity = match value.severity {
            palamedes::SourceDiagnosticSeverity::Error => "error",
            palamedes::SourceDiagnosticSeverity::Warning => "warning",
            palamedes::SourceDiagnosticSeverity::Info => "info",
        };
        Ok(Self {
            code: value.code,
            severity: severity.to_owned(),
            file: value.file,
            primary: NativeSourceRange::try_from(value.primary)?,
            message: value.message,
            help: value.help,
            related: value.related.map(NativeSourceRange::try_from).transpose()?,
        })
    }
}

impl TryFrom<palamedes::SourceAnalysisResult> for NativeSourceAnalysisResult {
    type Error = napi::Error;

    fn try_from(value: palamedes::SourceAnalysisResult) -> Result<Self> {
        Ok(Self {
            messages: value
                .messages
                .into_iter()
                .map(NativeExtractedMessage::try_from)
                .collect::<Result<Vec<_>>>()?,
            diagnostics: value
                .diagnostics
                .into_iter()
                .map(NativeSourceDiagnostic::try_from)
                .collect::<Result<Vec<_>>>()?,
        })
    }
}

#[napi]
#[allow(clippy::needless_pass_by_value)]
/// Analyze source-first messages and authoring diagnostics in one native pass.
///
/// # Errors
///
/// Returns an error for fatal parsing or authoring failures, or when source
/// ranges exceed the Node binding range.
pub fn analyze_source(
    source: String,
    filename: String,
    mdx: Option<NativeMdxOptions>,
) -> Result<NativeSourceAnalysisResult> {
    let mdx = mdx.map(Into::into).unwrap_or_default();
    palamedes::analyze_source_with_mdx_options(&source, &filename, &mdx)
        .map_err(to_napi_error)
        .and_then(NativeSourceAnalysisResult::try_from)
}
