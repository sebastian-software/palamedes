use napi::bindgen_prelude::Result;
use napi_derive::napi;

use crate::shared::to_napi_error;

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

impl From<palamedes::NativeTransformEdit> for NativeTransformEdit {
    fn from(value: palamedes::NativeTransformEdit) -> Self {
        Self {
            start: value.start as u32,
            end: value.end as u32,
            text: value.text,
        }
    }
}

impl From<palamedes::NativeTransformResult> for NativeTransformResult {
    fn from(value: palamedes::NativeTransformResult) -> Self {
        Self {
            code: value.code,
            has_changed: value.has_changed,
            compiled_ids: value.compiled_ids,
            edits: value
                .edits
                .into_iter()
                .map(NativeTransformEdit::from)
                .collect(),
            prepend_text: value.prepend_text,
        }
    }
}

#[napi]
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
    .map(NativeTransformResult::from)
    .map_err(to_napi_error)
}
