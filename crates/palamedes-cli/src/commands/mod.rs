//! The built-in `pmds` commands, one module per namespace.

use std::collections::BTreeSet;

pub mod audit;
pub mod catalog;
pub mod extract;
pub mod report;
#[cfg(test)]
mod test_support;
pub mod version;

/// Splits and de-duplicates `--locale` values, which may be repeated, comma
/// separated, or both. Shared by `audit` and `report`, which accept the same
/// flag shape.
pub fn normalize_locale_list(values: &[String]) -> Vec<String> {
    values
        .iter()
        .flat_map(|value| value.split(','))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}
