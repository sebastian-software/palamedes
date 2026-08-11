use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use ferrocat::{
    merge_catalogs_three_way as ferrocat_merge_catalogs_three_way,
    CatalogCombineInput as FerrocatCombineInput, MergeCatalogsThreeWayOptions, OrderBy,
};

use crate::catalog_combine::{
    CatalogCombineInput, CatalogCombineResult, CatalogConflictStrategy, CatalogFileCombineResult,
};
use crate::catalog_update::{po_serialize_options, PoOutputOptions};
use crate::error::{PalamedesError, PalamedesResult};
use crate::PalamedesCatalogFormat;

pub use ferrocat::CatalogMergeSide;

/// Stable Ferrocat diagnostic code for a modify/delete conflict resolved by policy.
pub const CATALOG_MODIFY_DELETE_RESOLVED: &str =
    ferrocat::po::diagnostic_codes::combine::MODIFY_DELETE_RESOLVED;

/// Explicit ancestor/ours/theirs request for an in-memory catalog merge.
#[derive(Debug)]
pub struct CatalogThreeWayMergeRequest {
    /// Common ancestor catalog.
    pub ancestor: CatalogCombineInput,
    /// Current-side catalog. This side wins with [`CatalogConflictStrategy::UseFirst`].
    pub ours: CatalogCombineInput,
    /// Incoming-side catalog. This side wins with [`CatalogConflictStrategy::UseLast`].
    pub theirs: CatalogCombineInput,
    /// Catalog format used to parse and render all three roles.
    pub format: PalamedesCatalogFormat,
    /// Source locale used for source-side semantics and validation.
    pub source_locale: String,
    /// Locale of the merged catalog.
    pub locale: Option<String>,
    /// Strategy for resolving translation and modify/delete conflicts.
    pub conflict_strategy: CatalogConflictStrategy,
    /// Optional PO-specific output controls.
    pub po: Option<PoOutputOptions>,
}

/// Explicit ancestor/ours/theirs request for an atomic file merge.
#[derive(Debug)]
pub struct CatalogFileThreeWayMergeRequest {
    /// Common ancestor catalog path.
    pub ancestor_path: PathBuf,
    /// Current-side catalog path. This side wins with `use-first`.
    pub ours_path: PathBuf,
    /// Incoming-side catalog path. This side wins with `use-last`.
    pub theirs_path: PathBuf,
    /// Output path replaced only after parsing and merging succeed.
    pub output_path: PathBuf,
    /// Optional explicit format. When absent, it is inferred from every path.
    pub format: Option<PalamedesCatalogFormat>,
    /// Source locale used for source-side semantics and validation.
    pub source_locale: String,
    /// Locale of the merged catalog.
    pub locale: Option<String>,
    /// Strategy for resolving translation and modify/delete conflicts.
    pub conflict_strategy: CatalogConflictStrategy,
    /// Optional PO-specific output controls.
    pub po: Option<PoOutputOptions>,
}

/// Merges an ancestor and two current catalogs with deletion-aware semantics.
///
/// Message identity is the source message plus optional gettext context. An
/// entry deleted from both sides stays deleted. A one-sided deletion also wins
/// when the other side still matches the ancestor. Modify/delete and
/// independently modified translation conflicts follow `conflict_strategy`.
/// Ferrocat owns entry selection, conflict resolution, metadata ownership, and
/// rendering. Palamedes only adapts its owned request types to that API.
///
/// # Examples
///
/// ```rust
/// use palamedes::{
///     merge_catalogs_three_way, CatalogCombineInput, CatalogConflictStrategy,
///     CatalogThreeWayMergeRequest, PalamedesCatalogFormat,
/// };
///
/// let input = |content: &str, label: &str| CatalogCombineInput {
///     content: content.to_owned(),
///     label: Some(label.to_owned()),
/// };
/// let result = merge_catalogs_three_way(CatalogThreeWayMergeRequest {
///     ancestor: input("msgid \"Removed\"\nmsgstr \"Alt\"\n", "base"),
///     ours: input("", "ours"),
///     theirs: input("", "theirs"),
///     format: PalamedesCatalogFormat::Po,
///     source_locale: "en".to_owned(),
///     locale: Some("de".to_owned()),
///     conflict_strategy: CatalogConflictStrategy::UseFirst,
///     po: None,
/// })?;
/// assert!(!result.content.contains("Removed"));
/// # Ok::<(), palamedes::PalamedesError>(())
/// ```
///
/// # Errors
///
/// Returns an error when a catalog cannot be parsed or rendered, when the
/// roles use incompatible content, or when `error` rejects a translation or
/// modify/delete conflict.
pub fn merge_catalogs_three_way(
    request: CatalogThreeWayMergeRequest,
) -> PalamedesResult<CatalogCombineResult> {
    let mode = request.format.ferrocat_mode();
    let ancestor = FerrocatCombineInput {
        content: &request.ancestor.content,
        label: request.ancestor.label.as_deref().or(Some("ancestor")),
    };
    let ours = FerrocatCombineInput {
        content: &request.ours.content,
        label: request.ours.label.as_deref().or(Some("ours")),
    };
    let theirs = FerrocatCombineInput {
        content: &request.theirs.content,
        label: request.theirs.label.as_deref().or(Some("theirs")),
    };
    let mut options =
        MergeCatalogsThreeWayOptions::new(ancestor, ours, theirs, &request.source_locale)
            .with_mode(mode)
            .with_conflict_strategy(request.conflict_strategy)
            .with_order_by(OrderBy::Msgid)
            .with_include_origins(true)
            .with_po_serialize_options(po_serialize_options(request.po.as_ref()));
    if let Some(locale) = request.locale.as_deref() {
        options = options.with_locale(locale);
    }

    ferrocat_merge_catalogs_three_way(options).map_err(PalamedesError::from)
}

/// Merges three catalog files and atomically replaces the output on success.
///
/// Every input is read and parsed before the output path is touched. This also
/// holds when the output path aliases `ours_path`, as it does for Git drivers.
///
/// # Errors
///
/// Returns an error when paths cannot be read, formats disagree, parsing or
/// merging fails, or the final atomic replacement cannot be completed.
pub fn merge_catalog_files_three_way(
    request: CatalogFileThreeWayMergeRequest,
) -> PalamedesResult<CatalogFileCombineResult> {
    let format = match request.format {
        Some(format) => format,
        None => infer_file_format(&[
            &request.ancestor_path,
            &request.ours_path,
            &request.theirs_path,
            &request.output_path,
        ])?,
    };
    let ancestor = read_catalog(&request.ancestor_path)?;
    let ours = read_catalog(&request.ours_path)?;
    let theirs = read_catalog(&request.theirs_path)?;
    let result = merge_catalogs_three_way(CatalogThreeWayMergeRequest {
        ancestor: CatalogCombineInput {
            content: ancestor,
            label: Some(request.ancestor_path.display().to_string()),
        },
        ours: CatalogCombineInput {
            content: ours,
            label: Some(request.ours_path.display().to_string()),
        },
        theirs: CatalogCombineInput {
            content: theirs,
            label: Some(request.theirs_path.display().to_string()),
        },
        format,
        source_locale: request.source_locale,
        locale: request.locale,
        conflict_strategy: request.conflict_strategy,
        po: request.po,
    })?;
    atomic_replace(&request.output_path, result.content.as_bytes())?;

    Ok(CatalogFileCombineResult {
        output_path: request.output_path,
        format,
        stats: result.stats,
        diagnostics: result.diagnostics,
    })
}

fn infer_file_format(paths: &[&Path]) -> PalamedesResult<PalamedesCatalogFormat> {
    let mut inferred = None;
    for path in paths {
        let format = path
            .extension()
            .and_then(|extension| extension.to_str())
            .and_then(PalamedesCatalogFormat::from_extension)
            .ok_or_else(|| PalamedesError::UnsupportedCatalogFileFormat {
                format: path.display().to_string(),
            })?;
        if let Some(expected) = inferred {
            if expected != format {
                return Err(PalamedesError::from(ferrocat::ApiError::InvalidArguments(
                    format!(
                        "catalog path `{}` uses {format:?}, but the merge uses {expected:?}",
                        path.display()
                    ),
                )));
            }
        } else {
            inferred = Some(format);
        }
    }
    inferred.ok_or(PalamedesError::InvalidCatalogFileCombineInputCount { count: 0 })
}

fn read_catalog(path: &Path) -> PalamedesResult<String> {
    fs::read_to_string(path).map_err(|source| PalamedesError::ReadFile {
        path: path.to_path_buf(),
        source,
    })
}

fn atomic_replace(path: &Path, content: &[u8]) -> PalamedesResult<()> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|source| PalamedesError::WriteFile {
            path: path.to_path_buf(),
            source,
        })?;
    temporary
        .write_all(content)
        .and_then(|()| temporary.flush())
        .map_err(|source| PalamedesError::WriteFile {
            path: path.to_path_buf(),
            source,
        })?;
    temporary
        .persist(path)
        .map_err(|error| PalamedesError::WriteFile {
            path: path.to_path_buf(),
            source: error.error,
        })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::{
        merge_catalog_files_three_way, merge_catalogs_three_way, CatalogFileThreeWayMergeRequest,
        CatalogThreeWayMergeRequest, CATALOG_MODIFY_DELETE_RESOLVED,
    };
    use crate::{
        CatalogCombineInput, CatalogConflictStrategy, CatalogMergeSide, PalamedesCatalogFormat,
        PalamedesError,
    };

    #[test]
    fn preserves_deletions_and_keeps_entries_new_on_either_side() {
        let result = merge_po(
            concat!(
                "msgid \"Deleted by both\"\nmsgstr \"Alt\"\n\n",
                "msgid \"Deleted by theirs\"\nmsgstr \"Alt\"\n",
            ),
            concat!(
                "msgid \"Deleted by theirs\"\nmsgstr \"Alt\"\n\n",
                "msgid \"New ours\"\nmsgstr \"Unser\"\n",
            ),
            "msgid \"New theirs\"\nmsgstr \"Ihr\"\n",
            CatalogConflictStrategy::UseFirst,
        )
        .expect("three-way merge");

        assert!(!result.content.contains("Deleted by both"));
        assert!(!result.content.contains("Deleted by theirs"));
        assert!(result.content.contains("New ours"));
        assert!(result.content.contains("New theirs"));
    }

    #[test]
    fn unchanged_side_does_not_conflict_with_a_changed_translation() {
        let result = merge_po(
            "msgid \"Hello\"\nmsgstr \"Alt\"\n",
            "msgid \"Hello\"\nmsgstr \"Alt\"\n",
            "msgid \"Hello\"\nmsgstr \"Neu\"\n",
            CatalogConflictStrategy::Error,
        )
        .expect("one-sided change");

        assert!(result.content.contains("msgstr \"Neu\""));
        assert_eq!(result.stats.conflicts_resolved, 0);
    }

    #[test]
    fn modify_delete_conflicts_follow_the_selected_side() {
        let base = "msgid \"Hello\"\nmsgstr \"Alt\"\n";
        let ours = "msgid \"Hello\"\nmsgstr \"Neu\"\n";

        let use_first =
            merge_po(base, ours, "", CatalogConflictStrategy::UseFirst).expect("use first");
        assert!(use_first.content.contains("msgstr \"Neu\""));
        assert!(use_first
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == CATALOG_MODIFY_DELETE_RESOLVED));

        let use_last =
            merge_po(base, ours, "", CatalogConflictStrategy::UseLast).expect("use last");
        assert!(!use_last.content.contains("msgid \"Hello\""));

        let error =
            merge_po(base, ours, "", CatalogConflictStrategy::Error).expect_err("error strategy");
        assert!(matches!(
            error,
            PalamedesError::CatalogApi(ferrocat::ApiError::ModifyDeleteConflict {
                modified_side: CatalogMergeSide::Ours,
                deleted_side: CatalogMergeSide::Theirs,
                ..
            })
        ));
    }

    #[test]
    fn fcl_uses_the_same_deletion_semantics() {
        let result = merge_catalogs_three_way(CatalogThreeWayMergeRequest {
            ancestor: input("%FCL1\tsource=en\tlocale=de\nRemoved\t\tAlt\n", "base"),
            ours: input("%FCL1\tsource=en\tlocale=de\nNew ours\t\tUnser\n", "ours"),
            theirs: input("%FCL1\tsource=en\tlocale=de\nNew theirs\t\tIhr\n", "theirs"),
            format: PalamedesCatalogFormat::Fcl,
            source_locale: "en".to_owned(),
            locale: Some("de".to_owned()),
            conflict_strategy: CatalogConflictStrategy::UseFirst,
            po: None,
        })
        .expect("FCL three-way merge");

        assert!(!result.content.contains("Removed"));
        assert!(result.content.contains("New ours\t\tUnser"));
        assert!(result.content.contains("New theirs\t\tIhr"));
    }

    #[test]
    fn po_three_way_output_honors_requested_line_breaks() {
        let long = "A deliberately long translated catalog value that should remain on one line when PO folding is disabled.";
        let content = format!("msgid \"Long\"\nmsgstr \"{long}\"\n");
        let result = merge_catalogs_three_way(CatalogThreeWayMergeRequest {
            ancestor: input(&content, "base"),
            ours: input(&content, "ours"),
            theirs: input(&content, "theirs"),
            format: PalamedesCatalogFormat::Po,
            source_locale: "en".to_owned(),
            locale: Some("de".to_owned()),
            conflict_strategy: CatalogConflictStrategy::UseFirst,
            po: Some(crate::PoOutputOptions {
                line_breaks: crate::PoLineBreaks::Off,
            }),
        })
        .expect("unfolded merge");

        assert!(result
            .content
            .lines()
            .any(|line| line == format!("msgstr \"{long}\"")));
    }

    #[test]
    fn file_parse_failure_leaves_existing_output_unchanged() {
        let fixture = tempfile::tempdir().expect("fixture");
        let base = fixture.path().join("base.po");
        let ours = fixture.path().join("ours.po");
        let theirs = fixture.path().join("theirs.po");
        let output = fixture.path().join("merged.po");
        fs::write(&base, "msgid \"Hello\"\nmsgstr \"Alt\"\n").expect("base");
        fs::write(&ours, "invalid").expect("ours");
        fs::write(&theirs, "").expect("theirs");
        fs::write(&output, "unchanged").expect("output");

        merge_catalog_files_three_way(CatalogFileThreeWayMergeRequest {
            ancestor_path: base,
            ours_path: ours,
            theirs_path: theirs,
            output_path: output.clone(),
            format: Some(PalamedesCatalogFormat::Po),
            source_locale: "en".to_owned(),
            locale: Some("de".to_owned()),
            conflict_strategy: CatalogConflictStrategy::UseFirst,
            po: None,
        })
        .expect_err("invalid PO");

        assert_eq!(
            fs::read_to_string(output).expect("read output"),
            "unchanged"
        );
    }

    #[test]
    fn file_merge_conflict_leaves_existing_output_unchanged() {
        let fixture = tempfile::tempdir().expect("fixture");
        let base = fixture.path().join("base.po");
        let ours = fixture.path().join("ours.po");
        let theirs = fixture.path().join("theirs.po");
        let output = fixture.path().join("merged.po");
        fs::write(&base, "msgid \"Hello\"\nmsgstr \"Alt\"\n").expect("base");
        fs::write(&ours, "msgid \"Hello\"\nmsgstr \"Unser\"\n").expect("ours");
        fs::write(&theirs, "msgid \"Hello\"\nmsgstr \"Ihr\"\n").expect("theirs");
        fs::write(&output, "unchanged").expect("output");

        merge_catalog_files_three_way(CatalogFileThreeWayMergeRequest {
            ancestor_path: base,
            ours_path: ours,
            theirs_path: theirs,
            output_path: output.clone(),
            format: Some(PalamedesCatalogFormat::Po),
            source_locale: "en".to_owned(),
            locale: Some("de".to_owned()),
            conflict_strategy: CatalogConflictStrategy::Error,
            po: None,
        })
        .expect_err("translation conflict");

        assert_eq!(
            fs::read_to_string(output).expect("read output"),
            "unchanged"
        );
    }

    fn merge_po(
        ancestor: &str,
        ours: &str,
        theirs: &str,
        conflict_strategy: CatalogConflictStrategy,
    ) -> crate::PalamedesResult<crate::CatalogCombineResult> {
        merge_catalogs_three_way(CatalogThreeWayMergeRequest {
            ancestor: input(ancestor, "base"),
            ours: input(ours, "ours"),
            theirs: input(theirs, "theirs"),
            format: PalamedesCatalogFormat::Po,
            source_locale: "en".to_owned(),
            locale: Some("de".to_owned()),
            conflict_strategy,
            po: None,
        })
    }

    fn input(content: &str, label: &str) -> CatalogCombineInput {
        CatalogCombineInput {
            content: content.to_owned(),
            label: Some(label.to_owned()),
        }
    }
}
