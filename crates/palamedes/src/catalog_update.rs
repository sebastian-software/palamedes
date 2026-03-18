use std::collections::BTreeMap;
use std::path::PathBuf;

use ferrocat::{
    parse_catalog as ferrocat_parse_catalog, update_catalog_file as ferrocat_update_catalog_file,
    CatalogOrigin, CatalogStats, CatalogUpdateInput, CatalogUpdateResult, Diagnostic,
    ObsoleteStrategy, ParseCatalogOptions, ParsedCatalog, PlaceholderCommentMode, PluralEncoding,
    SourceExtractedMessage, UpdateCatalogFileOptions,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogUpdateOrigin {
    pub file: String,
    pub line: u32,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogUpdateMessage {
    pub message: String,
    #[serde(default)]
    pub context: Option<String>,
    #[serde(default)]
    pub extracted_comments: Vec<String>,
    #[serde(default)]
    pub origins: Vec<CatalogUpdateOrigin>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogUpdateRequest {
    pub target_path: String,
    pub locale: String,
    pub source_locale: String,
    pub clean: bool,
    pub messages: Vec<CatalogUpdateMessage>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogParseRequest {
    pub target_path: String,
    pub locale: String,
    pub source_locale: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogUpdateResponse {
    pub created: bool,
    pub updated: bool,
    pub stats: CatalogUpdateStats,
    pub diagnostics: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogUpdateStats {
    pub total: usize,
    pub added: usize,
    pub changed: usize,
    pub unchanged: usize,
    pub obsolete_marked: usize,
    pub obsolete_removed: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogParseResult {
    pub locale: Option<String>,
    pub headers: BTreeMap<String, String>,
    pub messages: Vec<ParsedCatalogMessage>,
    pub diagnostics: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedCatalogMessage {
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub comments: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub origins: Vec<CatalogUpdateOrigin>,
    pub obsolete: bool,
}

pub fn update_catalog_file(request: CatalogUpdateRequest) -> Result<CatalogUpdateResponse, String> {
    update_catalog_file_source_first(request)
}

pub fn parse_catalog(request: CatalogParseRequest) -> Result<CatalogParseResult, String> {
    let content = std::fs::read_to_string(&request.target_path)
        .map_err(|error| format!("Failed to read {}: {error}", request.target_path))?;
    let parsed = ferrocat_parse_catalog(ParseCatalogOptions {
        content: &content,
        locale: Some(&request.locale),
        source_locale: &request.source_locale,
        plural_encoding: PluralEncoding::Icu,
        strict: false,
    })
    .map_err(|error| error.to_string())?;

    Ok(public_parse_result(parsed))
}

fn update_catalog_file_source_first(
    request: CatalogUpdateRequest,
) -> Result<CatalogUpdateResponse, String> {
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
    .map_err(|error| error.to_string())?;

    Ok(public_update_result(result))
}

fn project_message(message: CatalogUpdateMessage) -> Result<SourceExtractedMessage, String> {
    if message.message.trim().is_empty() {
        return Err("Catalog messages must not be empty".to_owned());
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
        stats: public_stats(result.stats),
        diagnostics: result
            .diagnostics
            .into_iter()
            .map(format_diagnostic)
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
            .map(format_diagnostic)
            .collect(),
    }
}

fn public_stats(stats: CatalogStats) -> CatalogUpdateStats {
    CatalogUpdateStats {
        total: stats.total,
        added: stats.added,
        changed: stats.changed,
        unchanged: stats.unchanged,
        obsolete_marked: stats.obsolete_marked,
        obsolete_removed: stats.obsolete_removed,
    }
}

fn format_diagnostic(diagnostic: Diagnostic) -> String {
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
