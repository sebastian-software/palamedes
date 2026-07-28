//! The built-in `pmds` commands, one module per namespace.

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use palamedes::parse_po;

use crate::error::CliError;

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

/// Reads a PO file for the two places that need PO-only metadata the
/// format-neutral catalog parser does not expose: fuzzy flags, which `report`
/// counts as untranslated and `catalog convert` refuses outright.
pub fn read_po(path: &Path) -> Result<palamedes::JsPoFile, CliError> {
    let source = fs::read_to_string(path).map_err(|source| CliError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    Ok(parse_po(&source)?)
}
