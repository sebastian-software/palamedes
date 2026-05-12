use ferrocat::{
    combine_catalogs as ferrocat_combine_catalogs, CatalogCombineInput as FerrocatCombineInput,
    CombineCatalogOptions, OrderBy, PluralEncoding,
};
use serde::{Deserialize, Serialize};

use crate::diagnostic::CatalogDiagnostic;
use crate::error::{PalamedesError, PalamedesResult};

/// Request for combining multiple catalog contents into one catalog.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogCombineRequest {
    /// Input catalog contents in precedence order.
    pub inputs: Vec<CatalogCombineInput>,
    /// Source locale used for source-side semantics and validation.
    pub source_locale: String,
    /// Locale of the combined catalog. When `None`, Ferrocat uses the first input locale if present.
    pub locale: Option<String>,
    /// Strategy for resolving conflicting non-empty translations.
    pub conflict_strategy: CatalogCombineConflictStrategy,
    /// Message identity selection rule applied after all inputs are read.
    pub selection: CatalogCombineSelection,
    /// Whether obsolete definitions should participate in the combine operation.
    pub include_obsolete: bool,
}

/// One catalog input for a combine operation.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogCombineInput {
    /// Catalog content to parse and include.
    pub content: String,
    /// Optional human-readable label used in diagnostics.
    pub label: Option<String>,
}

/// Strategy used when multiple catalogs define conflicting translations for one identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CatalogCombineConflictStrategy {
    /// Keep the first translation encountered for each identity.
    UseFirst,
    /// Replace the current translation with the latest definition.
    UseLast,
    /// Return an error when two non-empty translations differ.
    Error,
}

/// Selection rule used after definitions from all inputs have been counted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CatalogCombineSelection {
    /// Keep every message identity.
    All,
    /// Keep identities defined only once.
    Unique,
    /// Keep identities with more than the provided number of definitions.
    MoreThan(usize),
    /// Keep identities with less than the provided number of definitions.
    LessThan(usize),
}

/// Result returned by catalog combine operations.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogCombineResult {
    /// Final catalog content after combining the inputs.
    pub content: String,
    /// Summary counters for the operation.
    pub stats: CatalogCombineStats,
    /// Non-fatal diagnostics collected during processing.
    pub diagnostics: Vec<CatalogDiagnostic>,
}

/// Basic counters describing a catalog combine operation.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogCombineStats {
    /// Number of input catalogs parsed.
    pub inputs: usize,
    /// Total message definitions considered after obsolete filtering.
    pub definitions: usize,
    /// Message identities written to the final catalog.
    pub selected: usize,
    /// Message identities removed by the selection rule.
    pub skipped: usize,
    /// Translation conflicts resolved according to the selected strategy.
    pub conflicts_resolved: usize,
    /// Total messages in the final catalog.
    pub total: usize,
}

/// Combines multiple catalogs into one deterministic catalog.
///
/// # Errors
///
/// Returns an error when inputs are invalid, cannot be parsed, or contain
/// rejected translation conflicts.
pub fn combine_catalogs(request: CatalogCombineRequest) -> PalamedesResult<CatalogCombineResult> {
    let inputs = request
        .inputs
        .iter()
        .map(|input| FerrocatCombineInput {
            content: input.content.as_str(),
            label: input.label.as_deref(),
        })
        .collect::<Vec<_>>();

    let result = ferrocat_combine_catalogs(CombineCatalogOptions {
        inputs: &inputs,
        locale: request.locale.as_deref(),
        source_locale: &request.source_locale,
        plural_encoding: PluralEncoding::Icu,
        conflict_strategy: request.conflict_strategy.into(),
        selection: request.selection.into(),
        order_by: OrderBy::Msgid,
        include_origins: true,
        include_line_numbers: true,
        include_obsolete: request.include_obsolete,
        ..CombineCatalogOptions::default()
    })
    .map_err(PalamedesError::from)?;

    Ok(CatalogCombineResult {
        content: result.content,
        stats: result.stats.into(),
        diagnostics: result
            .diagnostics
            .into_iter()
            .map(CatalogDiagnostic::from)
            .collect(),
    })
}

impl From<CatalogCombineConflictStrategy> for ferrocat::CatalogConflictStrategy {
    fn from(value: CatalogCombineConflictStrategy) -> Self {
        match value {
            CatalogCombineConflictStrategy::UseFirst => Self::UseFirst,
            CatalogCombineConflictStrategy::UseLast => Self::UseLast,
            CatalogCombineConflictStrategy::Error => Self::Error,
        }
    }
}

impl From<CatalogCombineSelection> for ferrocat::CatalogCombineSelection {
    fn from(value: CatalogCombineSelection) -> Self {
        match value {
            CatalogCombineSelection::All => Self::All,
            CatalogCombineSelection::Unique => Self::Unique,
            CatalogCombineSelection::MoreThan(limit) => Self::MoreThan(limit),
            CatalogCombineSelection::LessThan(limit) => Self::LessThan(limit),
        }
    }
}

impl From<ferrocat::CatalogCombineStats> for CatalogCombineStats {
    fn from(value: ferrocat::CatalogCombineStats) -> Self {
        Self {
            inputs: value.inputs,
            definitions: value.definitions,
            selected: value.selected,
            skipped: value.skipped,
            conflicts_resolved: value.conflicts_resolved,
            total: value.total,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        combine_catalogs, CatalogCombineConflictStrategy, CatalogCombineInput,
        CatalogCombineRequest, CatalogCombineSelection,
    };

    #[test]
    fn combines_catalogs_and_reports_resolved_conflicts() {
        let result = combine_catalogs(CatalogCombineRequest {
            inputs: vec![
                CatalogCombineInput {
                    content: "msgid \"Hello\"\nmsgstr \"Hallo\"\n".to_owned(),
                    label: Some("first".to_owned()),
                },
                CatalogCombineInput {
                    content: "msgid \"Hello\"\nmsgstr \"Servus\"\n".to_owned(),
                    label: Some("second".to_owned()),
                },
            ],
            source_locale: "en".to_owned(),
            locale: Some("de".to_owned()),
            conflict_strategy: CatalogCombineConflictStrategy::UseFirst,
            selection: CatalogCombineSelection::All,
            include_obsolete: false,
        })
        .expect("combine");

        assert!(result.content.contains("Hallo"));
        assert_eq!(result.stats.conflicts_resolved, 1);
        assert!(result
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "combine.conflict_resolved"));
    }

    #[test]
    fn supports_unique_selection() {
        let result = combine_catalogs(CatalogCombineRequest {
            inputs: vec![
                CatalogCombineInput {
                    content: "msgid \"Shared\"\nmsgstr \"\"\n\nmsgid \"Only first\"\nmsgstr \"\"\n"
                        .to_owned(),
                    label: None,
                },
                CatalogCombineInput {
                    content: "msgid \"Shared\"\nmsgstr \"\"\n".to_owned(),
                    label: None,
                },
            ],
            source_locale: "en".to_owned(),
            locale: Some("en".to_owned()),
            conflict_strategy: CatalogCombineConflictStrategy::UseFirst,
            selection: CatalogCombineSelection::Unique,
            include_obsolete: false,
        })
        .expect("combine");

        assert!(result.content.contains("Only first"));
        assert!(!result.content.contains("Shared"));
    }
}
