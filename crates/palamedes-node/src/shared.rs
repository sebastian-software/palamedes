use std::any::Any;
use std::panic::{catch_unwind, AssertUnwindSafe};

use napi::bindgen_prelude::{Result, ToNapiValue, TypeName};
use napi::{Env, Error, Status, Task};

/// One owned unit of blocking native work scheduled through napi-rs' libuv pool.
///
/// Inputs and outputs contain no JavaScript handles: they can move to a worker
/// thread safely, while conversion back to JavaScript stays in `resolve` on the
/// owning Node thread. A task owns exactly one operation and cannot be retried.
pub struct BlockingTask<Input, Output> {
    input: Option<Input>,
    operation: &'static str,
    compute: fn(Input) -> Result<Output>,
}

impl<Input, Output> BlockingTask<Input, Output> {
    pub(super) fn new(
        operation: &'static str,
        input: Input,
        compute: fn(Input) -> Result<Output>,
    ) -> Self {
        Self {
            input: Some(input),
            operation,
            compute,
        }
    }
}

impl<Input, Output> Task for BlockingTask<Input, Output>
where
    Input: Send + Sized + 'static,
    Output: Send + Sized + ToNapiValue + TypeName + 'static,
{
    type Output = Output;
    type JsValue = Output;

    fn compute(&mut self) -> Result<Self::Output> {
        let input = self.input.take().ok_or_else(|| {
            Error::new(
                Status::GenericFailure,
                format!("{} task was executed more than once", self.operation),
            )
        })?;
        catch_blocking_panic(self.operation, || (self.compute)(input))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

pub(super) fn catch_blocking_panic<T>(
    operation: &str,
    compute: impl FnOnce() -> Result<T>,
) -> Result<T> {
    catch_unwind(AssertUnwindSafe(compute)).unwrap_or_else(|payload| {
        Err(Error::new(
            Status::GenericFailure,
            format!(
                "Palamedes async operation `{operation}` panicked: {}",
                panic_payload_message(payload.as_ref())
            ),
        ))
    })
}

fn panic_payload_message(payload: &(dyn Any + Send)) -> &str {
    payload
        .downcast_ref::<&str>()
        .copied()
        .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
        .unwrap_or("non-string panic payload")
}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocking_task_turns_panics_into_napi_errors() {
        let error = catch_blocking_panic::<()>("fixture", || panic!("fixture panic"))
            .expect_err("panic must become an error");

        assert_eq!(error.status, Status::GenericFailure);
        assert!(error.reason.contains("fixture panic"));
    }
}
