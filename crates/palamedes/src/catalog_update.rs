use std::collections::BTreeMap;
use std::path::PathBuf;

use crate::error::{PalamedesError, PalamedesResult};
use ferrocat::{
    parse_catalog as ferrocat_parse_catalog, update_catalog_file as ferrocat_update_catalog_file,
    CatalogOrigin, CatalogStats, CatalogUpdateInput, CatalogUpdateResult, Diagnostic,
    ObsoleteStrategy, ParseCatalogOptions, ParsedCatalog, PlaceholderCommentMode, PluralEncoding,
    SourceExtractedMessage, UpdateCatalogFileOptions,
};
use serde::{Deserialize, Serialize};

/// Source origin used for catalog updates and parsed catalog messages.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogUpdateOrigin {
    /// Source filename.
    pub file: String,
    /// 1-based source line.
    pub line: u32,
}

/// Source-first extracted message used for catalog updates.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogUpdateMessage {
    /// Source message string.
    pub message: String,
    /// Optional gettext context.
    #[serde(default)]
    pub context: Option<String>,
    /// Extracted comments refreshed into the catalog.
    #[serde(default)]
    pub extracted_comments: Vec<String>,
    /// Source origins attached to the message.
    #[serde(default)]
    pub origins: Vec<CatalogUpdateOrigin>,
}

/// Request for updating a catalog file from source-first messages.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogUpdateRequest {
    /// Target catalog file path.
    pub target_path: String,
    /// Locale of the target catalog.
    pub locale: String,
    /// Source locale used for source translation behavior.
    pub source_locale: String,
    /// Whether obsolete messages should be deleted instead of marked.
    pub clean: bool,
    /// Extracted messages to project into the catalog.
    pub messages: Vec<CatalogUpdateMessage>,
}

/// Request for parsing a catalog file into the public semantic shape.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogParseRequest {
    /// Target catalog file path.
    pub target_path: String,
    /// Locale of the parsed catalog.
    pub locale: String,
    /// Source locale used for parsing semantics.
    pub source_locale: String,
}

/// Result of updating a catalog file.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogUpdateResponse {
    /// Whether the catalog file was created.
    pub created: bool,
    /// Whether the catalog file changed on disk.
    pub updated: bool,
    /// Aggregate update statistics.
    pub stats: CatalogUpdateStats,
    /// Human-readable diagnostics emitted during the update.
    pub diagnostics: Vec<String>,
}

/// Aggregate statistics from a catalog update.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogUpdateStats {
    /// Total message count after the update.
    pub total: usize,
    /// Newly added messages.
    pub added: usize,
    /// Messages whose serialized form changed.
    pub changed: usize,
    /// Messages that stayed unchanged.
    pub unchanged: usize,
    /// Messages newly marked obsolete.
    pub obsolete_marked: usize,
    /// Messages removed because `clean` was enabled.
    pub obsolete_removed: usize,
}

/// Parsed semantic view of a catalog file.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogParseResult {
    /// Parsed locale if present in the catalog headers.
    pub locale: Option<String>,
    /// Parsed header map.
    pub headers: BTreeMap<String, String>,
    /// Parsed catalog messages.
    pub messages: Vec<ParsedCatalogMessage>,
    /// Human-readable diagnostics emitted during parsing.
    pub diagnostics: Vec<String>,
}

/// Parsed semantic catalog message.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedCatalogMessage {
    /// Source message string.
    pub message: String,
    /// Optional gettext context.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
    /// Translator comments.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub comments: Vec<String>,
    /// Source origins attached to the message.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub origins: Vec<CatalogUpdateOrigin>,
    /// Whether the message is obsolete.
    pub obsolete: bool,
}

/// Updates a catalog file using Palamedes' source-first semantics.
///
/// # Errors
///
/// Returns an error when the target file cannot be updated, when Ferrocat
/// rejects the projected messages, or when any extracted message is empty.
pub fn update_catalog_file(
    request: CatalogUpdateRequest,
) -> PalamedesResult<CatalogUpdateResponse> {
    update_catalog_file_source_first(request)
}

/// Parses a catalog file into the public semantic result shape.
///
/// # Errors
///
/// Returns an error when the target file cannot be read or when Ferrocat fails
/// to parse the catalog into its semantic representation.
pub fn parse_catalog(request: &CatalogParseRequest) -> PalamedesResult<CatalogParseResult> {
    let target_path = PathBuf::from(&request.target_path);
    let content =
        std::fs::read_to_string(&target_path).map_err(|source| PalamedesError::ReadFile {
            path: target_path,
            source,
        })?;
    let parsed = ferrocat_parse_catalog(ParseCatalogOptions {
        content: &content,
        locale: Some(&request.locale),
        source_locale: &request.source_locale,
        plural_encoding: PluralEncoding::Icu,
        strict: false,
    })
    .map_err(PalamedesError::from)?;

    Ok(public_parse_result(parsed))
}

fn update_catalog_file_source_first(
    request: CatalogUpdateRequest,
) -> PalamedesResult<CatalogUpdateResponse> {
    let target_path = PathBuf::from(&request.target_path);
    let custom_header_attributes =
        BTreeMap::from([("X-Generator".to_owned(), "palamedes".to_owned())]);
    let input = CatalogUpdateInput::SourceFirst(
        request
            .messages
            .into_iter()
            .map(project_message)
            .collect::<Result<Vec<_>, _>>()?,
    );

    let result = ferrocat_update_catalog_file(UpdateCatalogFileOptions {
        target_path: &target_path,
        locale: Some(&request.locale),
        source_locale: &request.source_locale,
        input,
        plural_encoding: PluralEncoding::Icu,
        obsolete_strategy: if request.clean {
            ObsoleteStrategy::Delete
        } else {
            ObsoleteStrategy::Mark
        },
        overwrite_source_translations: true,
        custom_header_attributes: Some(&custom_header_attributes),
        include_origins: true,
        include_line_numbers: true,
        print_placeholders_in_comments: PlaceholderCommentMode::Enabled { limit: 3 },
        ..UpdateCatalogFileOptions::default()
    })
    .map_err(PalamedesError::from)?;

    Ok(public_update_result(result))
}

fn project_message(message: CatalogUpdateMessage) -> PalamedesResult<SourceExtractedMessage> {
    if message.message.trim().is_empty() {
        return Err(PalamedesError::EmptyCatalogMessage);
    }

    let origins = message
        .origins
        .into_iter()
        .map(|origin| CatalogOrigin {
            file: origin.file,
            line: Some(origin.line),
        })
        .collect::<Vec<_>>();

    Ok(SourceExtractedMessage {
        msgid: message.message,
        msgctxt: message.context,
        comments: message.extracted_comments,
        origin: origins,
        placeholders: BTreeMap::new(),
    })
}

fn public_update_result(result: CatalogUpdateResult) -> CatalogUpdateResponse {
    CatalogUpdateResponse {
        created: result.created,
        updated: result.updated,
        stats: public_stats(&result.stats),
        diagnostics: result
            .diagnostics
            .into_iter()
            .map(|diagnostic| format_diagnostic(&diagnostic))
            .collect(),
    }
}

fn public_parse_result(parsed: ParsedCatalog) -> CatalogParseResult {
    CatalogParseResult {
        locale: parsed.locale,
        headers: parsed.headers,
        messages: parsed
            .messages
            .into_iter()
            .map(|message| ParsedCatalogMessage {
                message: message.msgid,
                context: message.msgctxt,
                comments: message.comments,
                origins: message
                    .origin
                    .into_iter()
                    .map(|origin| CatalogUpdateOrigin {
                        file: origin.file,
                        line: origin.line.unwrap_or_default(),
                    })
                    .collect(),
                obsolete: message.obsolete,
            })
            .collect(),
        diagnostics: parsed
            .diagnostics
            .into_iter()
            .map(|diagnostic| format_diagnostic(&diagnostic))
            .collect(),
    }
}

fn public_stats(stats: &CatalogStats) -> CatalogUpdateStats {
    CatalogUpdateStats {
        total: stats.total,
        added: stats.added,
        changed: stats.changed,
        unchanged: stats.unchanged,
        obsolete_marked: stats.obsolete_marked,
        obsolete_removed: stats.obsolete_removed,
    }
}

fn format_diagnostic(diagnostic: &Diagnostic) -> String {
    format!("{}: {}", diagnostic.code, diagnostic.message)
}

#[cfg(test)]
mod tests {
    use super::{
        update_catalog_file, CatalogUpdateMessage, CatalogUpdateOrigin, CatalogUpdateRequest,
    };
    use crate::parse_po;

    fn temp_file(name: &str) -> String {
        std::env::temp_dir()
            .join(format!(
                "palamedes-catalog-update-{name}-{}.po",
                std::process::id()
            ))
            .to_string_lossy()
            .into_owned()
    }

    #[test]
    fn updates_source_locale_catalogs() {
        let path = temp_file("source");
        let result = update_catalog_file(CatalogUpdateRequest {
            target_path: path.clone(),
            locale: "en".to_owned(),
            source_locale: "en".to_owned(),
            clean: false,
            messages: vec![CatalogUpdateMessage {
                message: "Hello".to_owned(),
                context: None,
                extracted_comments: vec![],
                origins: vec![CatalogUpdateOrigin {
                    file: "src/App.tsx".to_owned(),
                    line: 3,
                }],
            }],
        })
        .expect("update");

        assert!(result.created);

        let po = parse_po(&std::fs::read_to_string(&path).expect("read output")).expect("parse po");
        assert_eq!(po.items.len(), 1);
        assert_eq!(po.items[0].msgid, "Hello");
    }

    #[test]
    fn preserves_non_source_translations_and_marks_obsolete() {
        let path = temp_file("existing");
        std::fs::write(
            &path,
            concat!(
                "msgid \"Hello\"\n",
                "msgstr \"Hallo\"\n\n",
                "msgid \"Old\"\n",
                "msgstr \"Alt\"\n",
            ),
        )
        .expect("write existing");

        update_catalog_file(CatalogUpdateRequest {
            target_path: path.clone(),
            locale: "de".to_owned(),
            source_locale: "en".to_owned(),
            clean: false,
            messages: vec![CatalogUpdateMessage {
                message: "Hello".to_owned(),
                context: None,
                extracted_comments: vec![],
                origins: vec![],
            }],
        })
        .expect("update");

        let output = std::fs::read_to_string(&path).expect("read");
        assert!(output.contains("msgstr \"Hallo\""));
        assert!(output.contains("#~ msgid \"Old\""));
    }

    #[test]
    fn clean_removes_obsolete_entries() {
        let path = temp_file("clean");
        std::fs::write(
            &path,
            concat!(
                "msgid \"Keep\"\n",
                "msgstr \"\"\n\n",
                "msgid \"Old\"\n",
                "msgstr \"\"\n",
            ),
        )
        .expect("write existing");

        update_catalog_file(CatalogUpdateRequest {
            target_path: path.clone(),
            locale: "en".to_owned(),
            source_locale: "en".to_owned(),
            clean: true,
            messages: vec![CatalogUpdateMessage {
                message: "Keep".to_owned(),
                context: None,
                extracted_comments: vec![],
                origins: vec![],
            }],
        })
        .expect("update");

        let output = std::fs::read_to_string(&path).expect("read");
        assert!(!output.contains("Old"));
    }

    #[test]
    fn projects_simple_icu_plurals() {
        let path = temp_file("plural");

        update_catalog_file(CatalogUpdateRequest {
            target_path: path.clone(),
            locale: "en".to_owned(),
            source_locale: "en".to_owned(),
            clean: false,
            messages: vec![CatalogUpdateMessage {
                message: "{count, plural, one {# item} other {# items}}".to_owned(),
                context: None,
                extracted_comments: vec![],
                origins: vec![],
            }],
        })
        .expect("update");

        let output = std::fs::read_to_string(&path).expect("read");
        assert!(output.contains("{count, plural, one {# item} other {# items}}"));
    }
}
