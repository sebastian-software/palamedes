use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use ferrocat::{
    combine_catalogs as ferrocat_combine_catalogs, CatalogCombineInput as FerrocatCombineInput,
    CatalogStorageFormat, CombineCatalogOptions, OrderBy, PluralEncoding,
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

/// File storage format used by catalog merge operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CatalogMergeFormat {
    /// Classic gettext PO catalog files.
    Po,
    /// Ferrocat source-first NDJSON catalog files, exposed as JSON for Palamedes V1.
    Json,
}

/// Strategy used by catalog merge operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CatalogMergeStrategy {
    /// Keep the first input's translator-facing content for duplicate identities.
    UseFirst,
}

/// Request for merging exactly two catalog files and writing the result.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogMergeRequest {
    /// Input catalog file paths in precedence order.
    pub input_paths: Vec<PathBuf>,
    /// Output catalog file path to replace after a successful merge.
    pub output_path: PathBuf,
    /// Optional explicit format. When absent, the format is inferred from file paths.
    pub format: Option<CatalogMergeFormat>,
    /// Source locale used for source-side semantics and validation.
    pub source_locale: String,
    /// Locale of the merged catalog. When `None`, Ferrocat uses the first input locale if present.
    pub locale: Option<String>,
    /// Merge strategy. V1 supports only `useFirst`.
    pub strategy: CatalogMergeStrategy,
}

/// Result returned by catalog merge operations.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogMergeResult {
    /// Output path that was replaced.
    pub output_path: PathBuf,
    /// Format used for the merge.
    pub format: CatalogMergeFormat,
    /// Summary counters for the operation.
    pub stats: CatalogCombineStats,
    /// Non-fatal diagnostics collected during processing.
    pub diagnostics: Vec<CatalogDiagnostic>,
}

/// Combines multiple catalogs into one deterministic catalog.
///
/// # Errors
///
/// Returns an error when inputs are invalid, cannot be parsed, or contain
/// rejected translation conflicts.
pub fn combine_catalogs(request: CatalogCombineRequest) -> PalamedesResult<CatalogCombineResult> {
    combine_catalog_contents(request, CatalogStorageFormat::Po)
}

fn combine_catalog_contents(
    request: CatalogCombineRequest,
    storage_format: CatalogStorageFormat,
) -> PalamedesResult<CatalogCombineResult> {
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
        storage_format,
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

/// Merges exactly two catalog files and atomically replaces the requested output path.
///
/// # Errors
///
/// Returns an error when paths are invalid, inputs cannot be parsed, formats
/// cannot be inferred, or the output file cannot be replaced.
pub fn merge_catalog_files(request: CatalogMergeRequest) -> PalamedesResult<CatalogMergeResult> {
    if request.input_paths.len() != 2 {
        return Err(PalamedesError::InvalidCatalogMergeInputCount {
            count: request.input_paths.len(),
        });
    }

    let format = match request.format {
        Some(format) => format,
        None => infer_merge_format(&request.input_paths, &request.output_path)?,
    };
    let inputs = request
        .input_paths
        .iter()
        .map(|path| {
            fs::read_to_string(path).map_err(|source| PalamedesError::ReadFile {
                path: path.clone(),
                source,
            })
        })
        .collect::<PalamedesResult<Vec<_>>>()?;

    let combine = combine_catalog_contents(
        CatalogCombineRequest {
            inputs: inputs
                .into_iter()
                .zip(request.input_paths.iter())
                .map(|(content, path)| CatalogCombineInput {
                    content,
                    label: Some(path.display().to_string()),
                })
                .collect(),
            source_locale: request.source_locale,
            locale: request.locale,
            conflict_strategy: match request.strategy {
                CatalogMergeStrategy::UseFirst => CatalogCombineConflictStrategy::UseFirst,
            },
            selection: CatalogCombineSelection::All,
            include_obsolete: false,
        },
        format.into(),
    )?;

    let temp_path = temp_output_path(&request.output_path);
    if let Err(source) = fs::write(&temp_path, &combine.content) {
        return Err(PalamedesError::WriteFile {
            path: temp_path,
            source,
        });
    }
    replace_output(&temp_path, &request.output_path)?;

    Ok(CatalogMergeResult {
        output_path: request.output_path,
        format,
        stats: combine.stats,
        diagnostics: combine.diagnostics,
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

impl From<CatalogMergeFormat> for CatalogStorageFormat {
    fn from(value: CatalogMergeFormat) -> Self {
        match value {
            CatalogMergeFormat::Po => Self::Po,
            CatalogMergeFormat::Json => Self::Ndjson,
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

fn infer_merge_format(
    input_paths: &[PathBuf],
    output_path: &Path,
) -> PalamedesResult<CatalogMergeFormat> {
    let mut paths = input_paths.to_vec();
    paths.push(output_path.to_owned());
    let mut formats = paths
        .iter()
        .map(|path| infer_format_from_path(path))
        .collect::<PalamedesResult<Vec<_>>>()?;
    let first = formats
        .pop()
        .expect("format list contains output path plus at least one input");
    if formats.into_iter().all(|format| format == first) {
        Ok(first)
    } else {
        Err(PalamedesError::MixedCatalogMergeFormats)
    }
}

fn infer_format_from_path(path: &Path) -> PalamedesResult<CatalogMergeFormat> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if name.ends_with(".po") {
        return Ok(CatalogMergeFormat::Po);
    }
    if name.ends_with(".json") || name.ends_with(".ndjson") || name.ends_with(".fcat.ndjson") {
        return Ok(CatalogMergeFormat::Json);
    }
    Err(PalamedesError::CouldNotInferCatalogMergeFormat {
        path: path.to_owned(),
    })
}

fn temp_output_path(output_path: &Path) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_nanos());
    let filename = output_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("catalog");
    output_path.with_file_name(format!(".{filename}.{}.{}.tmp", std::process::id(), stamp))
}

fn replace_output(temp_path: &Path, output_path: &Path) -> PalamedesResult<()> {
    match fs::rename(temp_path, output_path) {
        Ok(()) => Ok(()),
        Err(source) => {
            if output_path.exists() {
                fs::remove_file(output_path).map_err(|source| PalamedesError::ReplaceFile {
                    path: output_path.to_owned(),
                    temp_path: {
                        let _ = fs::remove_file(temp_path);
                        temp_path.to_owned()
                    },
                    source,
                })?;
                fs::rename(temp_path, output_path).map_err(|source| {
                    let _ = fs::remove_file(temp_path);
                    PalamedesError::ReplaceFile {
                        path: output_path.to_owned(),
                        temp_path: temp_path.to_owned(),
                        source,
                    }
                })
            } else {
                let _ = fs::remove_file(temp_path);
                Err(PalamedesError::ReplaceFile {
                    path: output_path.to_owned(),
                    temp_path: temp_path.to_owned(),
                    source,
                })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{
        combine_catalogs, merge_catalog_files, CatalogCombineConflictStrategy, CatalogCombineInput,
        CatalogCombineRequest, CatalogCombineSelection, CatalogMergeFormat, CatalogMergeRequest,
        CatalogMergeStrategy,
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

    #[test]
    fn merges_po_files_with_use_first_and_preserves_first_header() {
        let dir = temp_dir("po-use-first");
        let ours = dir.join("ours.po");
        let theirs = dir.join("theirs.po");
        fs::write(
            &ours,
            concat!(
                "msgid \"\"\n",
                "msgstr \"\"\n",
                "\"Language: de\\n\"\n\n",
                "msgid \"Hello\"\n",
                "msgstr \"Hallo\"\n",
            ),
        )
        .expect("write ours");
        fs::write(
            &theirs,
            concat!(
                "msgid \"\"\n",
                "msgstr \"\"\n",
                "\"Language: fr\\n\"\n\n",
                "msgid \"Hello\"\n",
                "msgstr \"Bonjour\"\n\n",
                "msgid \"New\"\n",
                "msgstr \"Neu\"\n",
            ),
        )
        .expect("write theirs");

        let result = merge_catalog_files(CatalogMergeRequest {
            input_paths: vec![ours.clone(), theirs],
            output_path: ours.clone(),
            format: None,
            source_locale: "en".to_owned(),
            locale: Some("de".to_owned()),
            strategy: CatalogMergeStrategy::UseFirst,
        })
        .expect("merge");

        assert_eq!(result.format, CatalogMergeFormat::Po);
        let parsed = ferrocat::parse_po(&fs::read_to_string(&ours).expect("read output"))
            .expect("parse output");
        assert_eq!(
            parsed
                .headers
                .iter()
                .find(|header| header.key == "Language")
                .map(|header| header.value.as_str()),
            Some("de")
        );
        let hello = parsed
            .items
            .iter()
            .find(|item| item.msgid == "Hello")
            .expect("hello");
        assert_eq!(hello.msgstr[0], "Hallo");
        assert!(parsed.items.iter().any(|item| item.msgid == "New"));
    }

    #[test]
    fn merges_po_context_identities_and_skips_second_obsolete_entries() {
        let dir = temp_dir("po-contexts");
        let ours = dir.join("ours.po");
        let theirs = dir.join("theirs.po");
        let output = dir.join("merged.po");
        fs::write(
            &ours,
            concat!(
                "msgid \"Open\"\n",
                "msgstr \"Oeffnen\"\n\n",
                "msgctxt \"\"\n",
                "msgid \"Open\"\n",
                "msgstr \"Leer\"\n",
            ),
        )
        .expect("write ours");
        fs::write(
            &theirs,
            concat!(
                "msgctxt \"menu\"\n",
                "msgid \"Open\"\n",
                "msgstr \"Menue\"\n\n",
                "#~ msgid \"Old\"\n",
                "#~ msgstr \"Alt\"\n",
            ),
        )
        .expect("write theirs");

        merge_catalog_files(CatalogMergeRequest {
            input_paths: vec![ours, theirs],
            output_path: output.clone(),
            format: None,
            source_locale: "en".to_owned(),
            locale: Some("de".to_owned()),
            strategy: CatalogMergeStrategy::UseFirst,
        })
        .expect("merge");

        let parsed = ferrocat::parse_po(&fs::read_to_string(output).expect("read output"))
            .expect("parse output");
        assert!(parsed
            .items
            .iter()
            .any(|item| item.msgid == "Open" && item.msgctxt.is_none()));
        assert!(parsed
            .items
            .iter()
            .any(|item| item.msgid == "Open" && item.msgctxt.as_deref() == Some("")));
        assert!(parsed
            .items
            .iter()
            .any(|item| item.msgid == "Open" && item.msgctxt.as_deref() == Some("menu")));
        assert!(!parsed.items.iter().any(|item| item.msgid == "Old"));
    }

    #[test]
    fn merges_ndjson_files_when_public_format_is_json() {
        let dir = temp_dir("ndjson");
        let ours = dir.join("ours.json");
        let theirs = dir.join("theirs.json");
        let output = dir.join("merged.json");
        fs::write(
            &ours,
            concat!(
                "---\n",
                "format: ferrocat.ndjson.v1\n",
                "source_locale: en\n",
                "locale: de\n",
                "---\n",
                "{\"id\":\"Hello\",\"str\":\"Hallo\"}\n",
            ),
        )
        .expect("write ours");
        fs::write(
            &theirs,
            concat!(
                "---\n",
                "format: ferrocat.ndjson.v1\n",
                "source_locale: en\n",
                "locale: de\n",
                "---\n",
                "{\"id\":\"Hello\",\"str\":\"Servus\"}\n",
                "{\"id\":\"New\",\"str\":\"Neu\",\"ctx\":\"nav\"}\n",
            ),
        )
        .expect("write theirs");

        let result = merge_catalog_files(CatalogMergeRequest {
            input_paths: vec![ours, theirs],
            output_path: output.clone(),
            format: Some(CatalogMergeFormat::Json),
            source_locale: "en".to_owned(),
            locale: Some("de".to_owned()),
            strategy: CatalogMergeStrategy::UseFirst,
        })
        .expect("merge");

        assert_eq!(result.format, CatalogMergeFormat::Json);
        let merged = fs::read_to_string(output).expect("read output");
        assert!(merged.contains("format: ferrocat.ndjson.v1"));
        assert!(merged.contains("\"id\":\"Hello\",\"str\":\"Hallo\""));
        assert!(merged.contains("\"id\":\"New\",\"str\":\"Neu\",\"ctx\":\"nav\""));
        assert!(!merged.contains("Servus"));
    }

    #[test]
    fn invalid_inferred_format_leaves_output_unchanged() {
        let dir = temp_dir("invalid-format");
        let ours = dir.join("ours.txt");
        let theirs = dir.join("theirs.txt");
        let output = dir.join("merged.txt");
        fs::write(&ours, "msgid \"Hello\"\nmsgstr \"Hallo\"\n").expect("write ours");
        fs::write(&theirs, "msgid \"New\"\nmsgstr \"Neu\"\n").expect("write theirs");
        fs::write(&output, "unchanged").expect("write output");

        let error = merge_catalog_files(CatalogMergeRequest {
            input_paths: vec![ours, theirs],
            output_path: output.clone(),
            format: None,
            source_locale: "en".to_owned(),
            locale: Some("de".to_owned()),
            strategy: CatalogMergeStrategy::UseFirst,
        })
        .expect_err("unsupported format");

        assert!(error
            .to_string()
            .contains("Could not infer catalog merge format"));
        assert_eq!(
            fs::read_to_string(output).expect("read output"),
            "unchanged"
        );
    }

    fn temp_dir(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |duration| duration.as_nanos());
        let dir =
            std::env::temp_dir().join(format!("palamedes-{name}-{}-{stamp}", std::process::id()));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }
}
