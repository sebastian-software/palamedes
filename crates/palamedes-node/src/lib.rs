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
pub fn generate_message_id(message: String, context: Option<String>) -> String {
    palamedes::generate_message_id(&message, context.as_deref())
}

#[napi]
pub fn parse_po_json(source: String) -> Result<String> {
    palamedes::parse_po_json(&source).map_err(to_napi_error)
}

#[napi]
pub fn extract_messages_json(source: String, filename: String) -> Result<String> {
    palamedes::extract_messages_json(&source, &filename).map_err(Error::from_reason)
}
