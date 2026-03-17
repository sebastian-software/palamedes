use napi::bindgen_prelude::Result;
use napi::Error;
use napi_derive::napi;

fn to_napi_error(error: impl std::error::Error) -> Error {
    Error::from_reason(error.to_string())
}

#[napi]
pub fn get_native_info_json() -> Result<String> {
    palamedes::get_native_info_json().map_err(to_napi_error)
}

#[napi]
pub fn parse_po_json(source: String) -> Result<String> {
    palamedes::parse_po_json(&source).map_err(Error::from_reason)
}

#[napi]
pub fn update_catalog_file_json(request_json: String) -> Result<String> {
    palamedes::update_catalog_file_json(&request_json).map_err(Error::from_reason)
}

#[napi]
pub fn parse_catalog_json(request_json: String) -> Result<String> {
    palamedes::parse_catalog_json(&request_json).map_err(Error::from_reason)
}

#[napi]
pub fn get_catalog_module_json(request_json: String) -> Result<String> {
    palamedes::get_catalog_module_json(&request_json).map_err(Error::from_reason)
}

#[napi]
pub fn extract_messages_json(source: String, filename: String) -> Result<String> {
    palamedes::extract_messages_json(&source, &filename).map_err(Error::from_reason)
}

#[napi]
pub fn transform_macros_json(
    source: String,
    filename: String,
    options_json: Option<String>,
) -> Result<String> {
    palamedes::transform_macros_json(&source, &filename, options_json.as_deref())
        .map_err(Error::from_reason)
}
