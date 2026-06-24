use std::path::PathBuf;

use ferrocat::{
    combine_catalog_files as ferrocat_combine_catalog_files,
    combine_catalogs as ferrocat_combine_catalogs, CatalogCombineInput as FerrocatCombineInput,
    CatalogMode, CombineCatalogFilesOptions, CombineCatalogOptions, OrderBy,
};

use crate::error::{PalamedesError, PalamedesResult};

pub use ferrocat::{
    CatalogCombineResult, CatalogCombineSelection, CatalogCombineStats, CatalogConflictStrategy,
    CatalogFileCombineResult, CatalogFileFormat,
};

/// Request for combining multiple catalog contents into one catalog.
#[derive(Debug)]
pub struct CatalogCombineRequest {
    /// Input catalog contents in precedence order.
    pub inputs: Vec<CatalogCombineInput>,
    /// Source locale used for source-side semantics and validation.
    pub source_locale: String,
    /// Locale of the combined catalog. When `None`, Ferrocat uses the first input locale if present.
    pub locale: Option<String>,
    /// Strategy for resolving conflicting non-empty translations.
    pub conflict_strategy: CatalogConflictStrategy,
    /// Message identity selection rule applied after all inputs are read.
    pub selection: CatalogCombineSelection,
    /// Whether obsolete definitions should participate in the combine operation.
    pub include_obsolete: bool,
}

/// One catalog input for a combine operation.
#[derive(Debug)]
pub struct CatalogCombineInput {
    /// Catalog content to parse and include.
    pub content: String,
    /// Optional human-readable label used in diagnostics.
    pub label: Option<String>,
}

/// Request for combining exactly two catalog files and writing the result.
#[derive(Debug)]
pub struct CatalogFileCombineRequest {
    /// Input catalog file paths in precedence order.
    pub input_paths: Vec<PathBuf>,
    /// Output catalog file path to replace after a successful combine.
    pub output_path: PathBuf,
    /// Optional explicit format. When absent, the format is inferred from file paths.
    pub format: Option<CatalogFileFormat>,
    /// Source locale used for source-side semantics and validation.
    pub source_locale: String,
    /// Locale of the combined catalog. When `None`, Ferrocat uses the first input locale if present.
    pub locale: Option<String>,
    /// Strategy for resolving conflicting non-empty translations.
    pub conflict_strategy: CatalogConflictStrategy,
}

/// Combines multiple catalogs into one deterministic catalog.
///
/// # Errors
///
/// Returns an error when inputs are invalid, cannot be parsed, or contain
/// rejected translation conflicts.
pub fn combine_catalogs(request: CatalogCombineRequest) -> PalamedesResult<CatalogCombineResult> {
    combine_catalog_contents(request, CatalogMode::IcuPo)
}

fn combine_catalog_contents(
    request: CatalogCombineRequest,
    mode: CatalogMode,
) -> PalamedesResult<CatalogCombineResult> {
    let inputs = request
        .inputs
        .iter()
        .map(|input| FerrocatCombineInput {
            content: input.content.as_str(),
            label: input.label.as_deref(),
        })
        .collect::<Vec<_>>();

    let mut options = CombineCatalogOptions::new(&inputs, &request.source_locale);
    options.locale = request.locale.as_deref();
    options.mode = mode;
    options.conflict_strategy = request.conflict_strategy;
    options.selection = request.selection;
    options.order_by = OrderBy::Msgid;
    options.include_origins = true;
    options.include_line_numbers = true;
    options.include_obsolete = request.include_obsolete;

    ferrocat_combine_catalogs(options).map_err(PalamedesError::from)
}

/// Combines exactly two catalog files and atomically replaces the requested output path.
///
/// # Errors
///
/// Returns an error from Ferrocat when paths are invalid, inputs cannot be
/// parsed, formats cannot be inferred or do not match, or the output file
/// cannot be replaced.
pub fn combine_catalog_files(
    request: CatalogFileCombineRequest,
) -> PalamedesResult<CatalogFileCombineResult> {
    if request.input_paths.len() != 2 {
        return Err(PalamedesError::InvalidCatalogFileCombineInputCount {
            count: request.input_paths.len(),
        });
    }

    let mut options = CombineCatalogFilesOptions::new(
        &request.input_paths,
        &request.output_path,
        &request.source_locale,
    );
    options.format = request.format;
    options.locale = request.locale.as_deref();
    options.conflict_strategy = request.conflict_strategy;
    options.selection = ferrocat::CatalogCombineSelection::All;
    options.order_by = OrderBy::Msgid;
    options.include_origins = true;
    options.include_line_numbers = true;
    options.include_obsolete = false;

    ferrocat_combine_catalog_files(options).map_err(PalamedesError::from)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{
        combine_catalog_files, combine_catalogs, CatalogCombineInput, CatalogCombineRequest,
        CatalogCombineSelection, CatalogConflictStrategy, CatalogFileCombineRequest,
        CatalogFileFormat,
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
            conflict_strategy: CatalogConflictStrategy::UseFirst,
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
            conflict_strategy: CatalogConflictStrategy::UseFirst,
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

        let result = combine_catalog_files(CatalogFileCombineRequest {
            input_paths: vec![ours.clone(), theirs],
            output_path: ours.clone(),
            format: None,
            source_locale: "en".to_owned(),
            locale: Some("de".to_owned()),
            conflict_strategy: CatalogConflictStrategy::UseFirst,
        })
        .expect("merge");

        assert_eq!(result.format, CatalogFileFormat::Po);
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

        combine_catalog_files(CatalogFileCombineRequest {
            input_paths: vec![ours, theirs],
            output_path: output.clone(),
            format: None,
            source_locale: "en".to_owned(),
            locale: Some("de".to_owned()),
            conflict_strategy: CatalogConflictStrategy::UseFirst,
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
    fn combines_ndjson_files_with_ndjson_format() {
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

        let result = combine_catalog_files(CatalogFileCombineRequest {
            input_paths: vec![ours, theirs],
            output_path: output.clone(),
            format: Some(CatalogFileFormat::Ndjson),
            source_locale: "en".to_owned(),
            locale: Some("de".to_owned()),
            conflict_strategy: CatalogConflictStrategy::UseFirst,
        })
        .expect("merge");

        assert_eq!(result.format, CatalogFileFormat::Ndjson);
        let merged = fs::read_to_string(output).expect("read output");
        assert!(merged.contains("format: ferrocat.ndjson.v1"));
        assert!(merged.contains("\"id\":\"Hello\",\"str\":\"Hallo\""));
        assert!(merged.contains("\"id\":\"New\",\"str\":\"Neu\",\"ctx\":\"nav\""));
        assert!(!merged.contains("Servus"));
    }

    #[test]
    fn mixed_inferred_formats_leave_output_unchanged() {
        let dir = temp_dir("mixed-format");
        let ours = dir.join("ours.po");
        let theirs = dir.join("theirs.ndjson");
        let output = dir.join("merged.po");
        fs::write(&ours, "msgid \"Hello\"\nmsgstr \"Hallo\"\n").expect("write ours");
        fs::write(
            &theirs,
            concat!(
                "---\n",
                "format: ferrocat.ndjson.v1\n",
                "source_locale: en\n",
                "locale: de\n",
                "---\n",
                "{\"id\":\"New\",\"str\":\"Neu\"}\n",
            ),
        )
        .expect("write theirs");
        fs::write(&output, "unchanged").expect("write output");

        let error = combine_catalog_files(CatalogFileCombineRequest {
            input_paths: vec![ours, theirs],
            output_path: output.clone(),
            format: None,
            source_locale: "en".to_owned(),
            locale: Some("de".to_owned()),
            conflict_strategy: CatalogConflictStrategy::UseFirst,
        })
        .expect_err("mixed formats");

        assert!(error.to_string().contains("uses"));
        assert_eq!(
            fs::read_to_string(output).expect("read output"),
            "unchanged"
        );
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

        let error = combine_catalog_files(CatalogFileCombineRequest {
            input_paths: vec![ours, theirs],
            output_path: output.clone(),
            format: None,
            source_locale: "en".to_owned(),
            locale: Some("de".to_owned()),
            conflict_strategy: CatalogConflictStrategy::UseFirst,
        })
        .expect_err("unsupported format");

        assert!(error
            .to_string()
            .contains("could not infer catalog file format"));
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
