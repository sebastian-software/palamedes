use napi::{bindgen_prelude::Result, Error};

pub(super) fn to_napi_error(error: impl std::fmt::Display) -> Error {
    Error::from_reason(error.to_string())
}

pub(super) fn checked_u32(value: usize, field: &str) -> Result<u32> {
    u32::try_from(value).map_err(|_| {
        Error::from_reason(format!(
            "Value for `{field}` exceeds the supported u32 range at the Node binding boundary"
        ))
    })
}

pub(super) fn checked_optional_u32(value: Option<usize>, field: &str) -> Result<Option<u32>> {
    value.map(|value| checked_u32(value, field)).transpose()
}
