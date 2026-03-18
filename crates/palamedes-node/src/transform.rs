use napi::bindgen_prelude::Result;
use napi_derive::napi;

use crate::shared::{checked_u32, to_napi_error};

#[napi(object)]
pub struct NativeTransformOptions {
    pub runtime_module: Option<String>,
    pub runtime_import_name: Option<String>,
    pub strip_non_essential_props: Option<bool>,
    pub strip_message_field: Option<bool>,
}

#[napi(object)]
pub struct NativeTransformEdit {
    pub start: u32,
    pub end: u32,
    pub text: String,
}

#[napi(object)]
pub struct NativeTransformResult {
    pub code: String,
    pub has_changed: bool,
    pub compiled_ids: Vec<String>,
    pub edits: Vec<NativeTransformEdit>,
    pub prepend_text: Option<String>,
}

impl From<NativeTransformOptions> for palamedes::NativeTransformOptions {
    fn from(value: NativeTransformOptions) -> Self {
        Self {
            runtime_module: value.runtime_module,
            runtime_import_name: value.runtime_import_name,
            strip_non_essential_props: value.strip_non_essential_props,
            strip_message_field: value.strip_message_field,
        }
    }
}

impl TryFrom<palamedes::NativeTransformEdit> for NativeTransformEdit {
    type Error = napi::Error;

    fn try_from(value: palamedes::NativeTransformEdit) -> Result<Self> {
        Ok(Self {
            start: checked_u32(value.start, "edits.start")?,
            end: checked_u32(value.end, "edits.end")?,
            text: value.text,
        })
    }
}

impl TryFrom<palamedes::NativeTransformResult> for NativeTransformResult {
    type Error = napi::Error;

    fn try_from(value: palamedes::NativeTransformResult) -> Result<Self> {
        Ok(Self {
            code: value.code,
            has_changed: value.has_changed,
            compiled_ids: value.compiled_ids,
            edits: value
                .edits
                .into_iter()
                .map(NativeTransformEdit::try_from)
                .collect::<Result<Vec<_>>>()?,
            prepend_text: value.prepend_text,
        })
    }
}

#[napi]
#[allow(clippy::needless_pass_by_value)]
/// Transforms Lingui-style macros into Palamedes runtime calls.
///
/// # Errors
///
/// Returns an error when parsing or transformation fails, or when edit offsets
/// exceed the Node binding range.
pub fn transform_macros(
    source: String,
    filename: String,
    options: Option<NativeTransformOptions>,
) -> Result<NativeTransformResult> {
    palamedes::transform_macros(
        &source,
        &filename,
        options.map(palamedes::NativeTransformOptions::from),
    )
    .map_err(to_napi_error)
    .and_then(NativeTransformResult::try_from)
}
