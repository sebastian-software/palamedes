//! Locale rules and exact decimal operands for compiled plural instructions.

use std::collections::{BTreeMap, BTreeSet};

use fixed_decimal::Decimal;
use icu_locale_core::Locale;
use icu_plurals::{PluralCategory, PluralRules};

use crate::{Error, Instruction, PluralKind};

/// Checked fixed-point arithmetic avoids rounding integer counts through f64.
/// Scale is retained because CLDR distinguishes, for example, 1 from 1.0.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Number {
    coefficient: i128,
    scale: u8,
}

impl Number {
    pub fn parse(value: &str) -> Option<Self> {
        let (sign, unsigned) = match value.strip_prefix('-') {
            Some(unsigned) => ("-", unsigned),
            None => ("", value.strip_prefix('+').unwrap_or(value)),
        };
        let (integer, fraction) = match unsigned.split_once('.') {
            Some((integer, fraction)) if !fraction.is_empty() => (integer, fraction),
            Some(_) => return None,
            None => (unsigned, ""),
        };
        if integer.is_empty()
            || !integer
                .bytes()
                .chain(fraction.bytes())
                .all(|byte| byte.is_ascii_digit())
            || fraction.len() > 18
        {
            return None;
        }
        Some(Self {
            coefficient: format!("{sign}{integer}{fraction}").parse().ok()?,
            scale: u8::try_from(fraction.len()).ok()?,
        })
    }

    pub fn subtract(self, offset: u32) -> Option<Self> {
        let offset = i128::from(offset).checked_mul(10_i128.pow(u32::from(self.scale)))?;
        Some(Self {
            coefficient: self.coefficient.checked_sub(offset)?,
            ..self
        })
    }

    pub fn decimal(self) -> Decimal {
        let mut decimal = Decimal::from(self.coefficient);
        decimal.multiply_pow10(-i16::from(self.scale));
        decimal
    }

    pub fn identity(mut self) -> (i128, u8) {
        while self.scale > 0 && self.coefficient % 10 == 0 {
            self.coefficient /= 10;
            self.scale -= 1;
        }
        (self.coefficient, self.scale)
    }
}

#[derive(Debug, Default)]
pub(crate) struct Rules {
    cardinal: Option<PluralRules>,
    ordinal: Option<PluralRules>,
}

impl Rules {
    pub fn new(locale: &str, kinds: &BTreeSet<PluralKind>) -> Result<Self, Error> {
        let mut rules = Self::default();
        if kinds.is_empty() {
            return Ok(rules);
        }
        let error = |details: String| Error::PluralRules {
            locale: locale.into(),
            details,
        };
        let locale: Locale = locale.parse().map_err(|cause| error(format!("{cause}")))?;
        if kinds.contains(&PluralKind::Cardinal) {
            rules.cardinal = Some(
                PluralRules::try_new_cardinal(locale.clone().into())
                    .map_err(|cause| error(cause.to_string()))?,
            );
        }
        if kinds.contains(&PluralKind::Ordinal) {
            rules.ordinal = Some(
                PluralRules::try_new_ordinal(locale.into())
                    .map_err(|cause| error(cause.to_string()))?,
            );
        }
        Ok(rules)
    }

    pub fn category(&self, kind: PluralKind, number: Number) -> &'static str {
        let rules = match kind {
            PluralKind::Cardinal => &self.cardinal,
            PluralKind::Ordinal => &self.ordinal,
        }
        .as_ref()
        .expect("rules initialized for every validated plural instruction");
        match rules.category_for(&number.decimal()) {
            PluralCategory::Zero => "zero",
            PluralCategory::One => "one",
            PluralCategory::Two => "two",
            PluralCategory::Few => "few",
            PluralCategory::Many => "many",
            PluralCategory::Other => "other",
        }
    }
}

pub(crate) fn validate_options(options: &BTreeMap<String, Vec<Instruction>>) -> Result<(), Error> {
    if !options.contains_key("other") {
        return Err(Error::Incompatible(
            "plural requires an other branch".into(),
        ));
    }
    let mut exact = BTreeSet::new();
    for selector in options.keys() {
        if let Some(value) = selector.strip_prefix('=') {
            let number = Number::parse(value).ok_or_else(|| {
                Error::Incompatible(format!("invalid exact plural selector: {selector}"))
            })?;
            if !exact.insert(number.identity()) {
                return Err(Error::Incompatible(format!(
                    "duplicate numeric plural selector: {selector}"
                )));
            }
        } else if PluralCategory::get_for_cldr_string(selector).is_none() {
            return Err(Error::Incompatible(format!(
                "unknown plural category: {selector}"
            )));
        }
    }
    Ok(())
}
