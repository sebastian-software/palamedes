//! Typed macro arguments and validated decimal counts.

use std::fmt::{self, Display};
use std::str::FromStr;

/// A validated plain decimal count that preserves visible fractional zeros.
///
/// Use `"1.0".parse::<PluralNumber>()?` when CLDR must distinguish 1.0 from 1.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PluralNumber(String);

/// A value is not a supported plain decimal plural operand.
#[derive(Debug, thiserror::Error)]
#[error("invalid plural number: {value}")]
pub struct ParsePluralNumberError {
    value: String,
}

impl FromStr for PluralNumber {
    type Err = ParsePluralNumberError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        crate::plural::Number::parse(value)
            .map(|_| Self(value.to_owned()))
            .ok_or_else(|| ParsePluralNumberError {
                value: value.to_owned(),
            })
    }
}

impl Display for PluralNumber {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

mod sealed {
    use super::{Display, PluralNumber};

    pub trait Argument<const NUMERIC: bool> {}
    impl<T: Display + ?Sized> Argument<false> for T {}
    impl<T: Argument<true> + ?Sized> Argument<true> for &T {}
    impl<T: Argument<true> + ?Sized> Argument<true> for &mut T {}

    macro_rules! numeric {
        ($($ty:ty),+ $(,)?) => { $(impl Argument<true> for $ty {})+ };
    }
    numeric!(
        u8,
        u16,
        u32,
        u64,
        u128,
        usize,
        i8,
        i16,
        i32,
        i64,
        i128,
        isize,
        f32,
        f64,
        PluralNumber
    );
}

/// Internal bound selected from a message's generated argument signature.
#[doc(hidden)]
pub trait MacroArgument<const NUMERIC: bool>: Display + sealed::Argument<NUMERIC> {}
impl<T: Display + sealed::Argument<NUMERIC> + ?Sized, const NUMERIC: bool> MacroArgument<NUMERIC>
    for T
{
}

/// Internal formatting boundary: a plural argument must have a numeric type.
#[doc(hidden)]
pub fn format_argument<const NUMERIC: bool, T: MacroArgument<NUMERIC> + ?Sized>(
    value: &T,
) -> String {
    format!("{value}")
}
