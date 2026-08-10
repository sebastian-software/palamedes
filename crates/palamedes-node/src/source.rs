use napi::bindgen_prelude::Result;
use napi_derive::napi;

use crate::extract::NativeExtractedMessage;
use crate::mdx::NativeMdxOptions;
use crate::shared::{checked_u32, to_napi_error};

#[napi(object)]
pub struct NativeSourceRuleOptions {
    pub placeholder_only: Option<String>,
    pub empty_component_only: Option<String>,
    pub prefer_trans_in_jsx: Option<String>,
}

#[napi(object)]
pub struct NativeSourceAnalysisOptions {
    pub mdx: Option<NativeMdxOptions>,
    pub rules: Option<NativeSourceRuleOptions>,
}

#[napi(object)]
pub struct NativeSourceRange {
    pub start: u32,
    pub end: u32,
    pub line: u32,
    pub column: u32,
}

#[napi(string_enum)]
pub enum NativeSourceDiagnosticSeverity {
    Info,
    Warning,
    Error,
}

#[napi(object)]
pub struct NativeSourceDiagnostic {
    pub code: String,
    pub severity: NativeSourceDiagnosticSeverity,
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
            palamedes::SourceDiagnosticSeverity::Error => NativeSourceDiagnosticSeverity::Error,
            palamedes::SourceDiagnosticSeverity::Warning => NativeSourceDiagnosticSeverity::Warning,
            palamedes::SourceDiagnosticSeverity::Info => NativeSourceDiagnosticSeverity::Info,
        };
        Ok(Self {
            code: value.code,
            severity,
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

fn source_rule_level(
    value: Option<String>,
    field: &str,
) -> Result<Option<palamedes::SourceRuleLevel>> {
    value
        .map(|value| match value.as_str() {
            "off" => Ok(palamedes::SourceRuleLevel::Off),
            "info" => Ok(palamedes::SourceRuleLevel::Info),
            "warning" => Ok(palamedes::SourceRuleLevel::Warning),
            "error" => Ok(palamedes::SourceRuleLevel::Error),
            _ => Err(napi::Error::from_reason(format!(
                "{field} must be one of: off, info, warning, error"
            ))),
        })
        .transpose()
}

impl TryFrom<NativeSourceRuleOptions> for palamedes::SourceRuleOptions {
    type Error = napi::Error;

    fn try_from(value: NativeSourceRuleOptions) -> Result<Self> {
        let defaults = Self::default();
        Ok(Self {
            placeholder_only: source_rule_level(value.placeholder_only, "rules.placeholderOnly")?
                .unwrap_or(defaults.placeholder_only),
            empty_component_only: source_rule_level(
                value.empty_component_only,
                "rules.emptyComponentOnly",
            )?
            .unwrap_or(defaults.empty_component_only),
            prefer_trans_in_jsx: source_rule_level(
                value.prefer_trans_in_jsx,
                "rules.preferTransInJsx",
            )?
            .unwrap_or(defaults.prefer_trans_in_jsx),
        })
    }
}

impl TryFrom<NativeSourceAnalysisOptions> for palamedes::SourceAnalysisOptions {
    type Error = napi::Error;

    fn try_from(value: NativeSourceAnalysisOptions) -> Result<Self> {
        Ok(Self {
            mdx: value.mdx.map(Into::into).unwrap_or_default(),
            rules: value
                .rules
                .map(TryInto::try_into)
                .transpose()?
                .unwrap_or_default(),
        })
    }
}

#[napi(catch_unwind)]
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
    options: Option<NativeSourceAnalysisOptions>,
) -> Result<NativeSourceAnalysisResult> {
    let options = options
        .map(TryInto::try_into)
        .transpose()?
        .unwrap_or_default();
    palamedes::analyze_source_with_options(&source, &filename, &options)
        .map_err(to_napi_error)
        .and_then(NativeSourceAnalysisResult::try_from)
}
