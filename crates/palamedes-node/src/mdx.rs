use napi::bindgen_prelude::Result;
use napi_derive::napi;

use crate::extract::NativeExtractedMessage;
use crate::shared::checked_u32;
use crate::transform::NativeTransformSourceMap;

#[napi(string_enum)]
pub enum NativeMdxFramework {
    React,
    Solid,
}

#[napi(object)]
pub struct NativeMdxOptions {
    pub framework: Option<NativeMdxFramework>,
    pub translatable_attributes: Option<Vec<String>>,
    pub front_matter_fields: Option<Vec<String>>,
    pub trans_module: Option<String>,
    pub runtime_module: Option<String>,
    pub ignore_directive: Option<String>,
}

#[napi(object)]
pub struct NativeMdxSourceRange {
    pub start: u32,
    pub end: u32,
    pub line: u32,
    pub column: u32,
}

#[napi(object)]
pub struct NativeMdxDiagnostic {
    pub code: String,
    pub message: String,
    pub primary: NativeMdxSourceRange,
    pub related: Option<NativeMdxSourceRange>,
}

#[napi(object)]
pub struct NativeMdxAnalysisResult {
    pub messages: Vec<NativeExtractedMessage>,
    pub diagnostics: Vec<NativeMdxDiagnostic>,
    pub code: Option<String>,
    pub compiled_ids: Vec<String>,
    pub map: Option<NativeTransformSourceMap>,
}

impl From<NativeMdxFramework> for palamedes::MdxFramework {
    fn from(value: NativeMdxFramework) -> Self {
        match value {
            NativeMdxFramework::React => Self::React,
            NativeMdxFramework::Solid => Self::Solid,
        }
    }
}

impl From<NativeMdxOptions> for palamedes::MdxOptions {
    fn from(value: NativeMdxOptions) -> Self {
        let defaults = palamedes::MdxOptions::default();
        Self {
            framework: value
                .framework
                .map(Into::into)
                .unwrap_or(defaults.framework),
            translatable_attributes: value
                .translatable_attributes
                .unwrap_or(defaults.translatable_attributes),
            front_matter_fields: value
                .front_matter_fields
                .unwrap_or(defaults.front_matter_fields),
            trans_module: value.trans_module,
            runtime_module: value.runtime_module,
            ignore_directive: value.ignore_directive.unwrap_or(defaults.ignore_directive),
        }
    }
}

impl TryFrom<palamedes::MdxSourceRange> for NativeMdxSourceRange {
    type Error = napi::Error;

    fn try_from(value: palamedes::MdxSourceRange) -> Result<Self> {
        Ok(Self {
            start: checked_u32(value.start, "mdxRange.start")?,
            end: checked_u32(value.end, "mdxRange.end")?,
            line: checked_u32(value.line, "mdxRange.line")?,
            column: checked_u32(value.column, "mdxRange.column")?,
        })
    }
}

impl TryFrom<palamedes::MdxDiagnosticRecord> for NativeMdxDiagnostic {
    type Error = napi::Error;

    fn try_from(value: palamedes::MdxDiagnosticRecord) -> Result<Self> {
        Ok(Self {
            code: value.code,
            message: value.message,
            primary: NativeMdxSourceRange::try_from(value.primary)?,
            related: value
                .related
                .map(NativeMdxSourceRange::try_from)
                .transpose()?,
        })
    }
}

impl TryFrom<palamedes::MdxAnalysisResult> for NativeMdxAnalysisResult {
    type Error = napi::Error;

    fn try_from(value: palamedes::MdxAnalysisResult) -> Result<Self> {
        Ok(Self {
            messages: value
                .messages
                .into_iter()
                .map(NativeExtractedMessage::try_from)
                .collect::<Result<Vec<_>>>()?,
            diagnostics: value
                .diagnostics
                .into_iter()
                .map(NativeMdxDiagnostic::try_from)
                .collect::<Result<Vec<_>>>()?,
            code: value.code,
            compiled_ids: value.compiled_ids,
            map: value.map.map(NativeTransformSourceMap::from),
        })
    }
}

#[napi]
#[allow(clippy::needless_pass_by_value)]
/// Analyze and compile an MDX module through the native semantic pipeline.
///
/// # Errors
///
/// Returns an error only when source ranges exceed the Node binding range.
pub fn analyze_mdx(
    source: String,
    filename: String,
    options: Option<NativeMdxOptions>,
) -> Result<NativeMdxAnalysisResult> {
    NativeMdxAnalysisResult::try_from(palamedes::analyze_mdx(
        &source,
        &filename,
        options.map(Into::into).unwrap_or_default(),
    ))
}
