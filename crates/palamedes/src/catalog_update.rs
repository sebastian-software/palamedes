use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::diagnostic::CatalogDiagnostic;
use crate::error::{PalamedesError, PalamedesResult};
use ferrocat::{
    parse_catalog as ferrocat_parse_catalog, update_catalog_file as ferrocat_update_catalog_file,
    CatalogOrigin, CatalogStats, CatalogUpdateInput, CatalogUpdateResult, EffectiveTranslationRef,
    ObsoleteStrategy, ParseCatalogOptions, ParsedCatalog, PlaceholderCommentMode, RenderOptions,
    SourceExtractedMessage, UpdateCatalogFileOptions, UpdateCatalogOptions,
};
use ferrocat::{AiProvenance as FerrocatAiProvenance, MachineMetadata as FerrocatMachineMetadata};
use serde::{Deserialize, Serialize};

/// Source origin used for catalog updates and parsed catalog messages.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogUpdateOrigin {
    /// Source filename.
    pub file: String,
    /// 1-based source line.
    pub line: u32,
    /// Optional stable source scope, such as a component or function name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
}

/// Source origin stored in parsed catalogs.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogOriginMetadata {
    /// Source filename.
    pub file: String,
    /// Optional stable source scope, such as a component or function name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
}

/// Source-first extracted message used for catalog updates.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogUpdateMessage {
    /// Source message string.
    pub message: String,
    /// Optional gettext context.
    #[serde(default)]
    pub context: Option<String>,
    /// Placeholder hints keyed by placeholder name.
    #[serde(default)]
    pub placeholders: BTreeMap<String, Vec<String>>,
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
    /// Whether obsolete messages should be deleted immediately, including undated entries.
    #[serde(default)]
    pub force_clean: bool,
    /// Catalog storage format.
    #[serde(default)]
    pub format: super::catalog_artifact::PalamedesCatalogFormat,
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
    /// Catalog storage format.
    #[serde(default)]
    pub format: super::catalog_artifact::PalamedesCatalogFormat,
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
    /// Diagnostics emitted during the update.
    pub diagnostics: Vec<CatalogDiagnostic>,
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
    /// Diagnostics emitted during parsing.
    pub diagnostics: Vec<CatalogDiagnostic>,
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
    pub origins: Vec<CatalogOriginMetadata>,
    /// Whether the message is obsolete.
    pub obsolete: bool,
    /// Whether the effective translation is non-empty.
    pub translated: bool,
    /// Machine-translation provenance for the current translation, when present.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub machine: Option<MachineMetadata>,
}

/// Machine metadata attached to one translated catalog entry.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineMetadata {
    /// Integrity lock for the current translation payload.
    pub lock: String,
    /// Optional AI provenance for machine-managed content.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ai: Option<AiProvenance>,
}

/// AI provenance for machine-managed content.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProvenance {
    /// Model identifier used to produce the translation.
    pub model: String,
    /// Optional model confidence in the 0..1 interval.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f32>,
}

impl From<FerrocatMachineMetadata> for MachineMetadata {
    fn from(value: FerrocatMachineMetadata) -> Self {
        Self {
            lock: value.lock,
            ai: value.ai.map(AiProvenance::from),
        }
    }
}

impl From<FerrocatAiProvenance> for AiProvenance {
    fn from(value: FerrocatAiProvenance) -> Self {
        Self {
            model: value.model,
            confidence: value.confidence,
        }
    }
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
    let options = ParseCatalogOptions::new(&content, &request.source_locale)
        .with_locale(&request.locale)
        .with_mode(request.format.ferrocat_mode());

    let parsed = ferrocat_parse_catalog(options).map_err(PalamedesError::from)?;

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

    let now = current_iso_date();
    let obsolete_strategy = if request.force_clean {
        ObsoleteStrategy::Delete
    } else if request.clean {
        ObsoleteStrategy::DropObsoleteBefore(clean_cutoff_date(&now))
    } else {
        ObsoleteStrategy::Mark
    };

    let mut render = RenderOptions::default()
        .with_include_origins(true)
        .with_placeholder_comments(PlaceholderCommentMode::Enabled { limit: 3 });
    if request.format == super::catalog_artifact::PalamedesCatalogFormat::Po {
        render = render.with_custom_header_attributes(&custom_header_attributes);
    }
    let update_options = UpdateCatalogOptions::new(&request.source_locale, input)
        .with_locale(&request.locale)
        .with_mode(request.format.ferrocat_mode())
        .with_obsolete_strategy(obsolete_strategy)
        .with_overwrite_source_translations(true)
        .with_render(render)
        .with_now(&now);
    let options = UpdateCatalogFileOptions::new(
        &target_path,
        &request.source_locale,
        Vec::<SourceExtractedMessage>::new(),
    )
    .with_options(update_options);

    let result = ferrocat_update_catalog_file(options).map_err(PalamedesError::from)?;

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
            scope: origin.scope,
        })
        .collect::<Vec<_>>();

    Ok(SourceExtractedMessage {
        msgid: message.message,
        msgctxt: message.context,
        comments: message.extracted_comments,
        origin: origins,
        placeholders: message.placeholders,
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
            .map(CatalogDiagnostic::from)
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
            .map(|message| {
                let translated = is_effectively_translated(message.effective_translation());
                ParsedCatalogMessage {
                    message: message.msgid,
                    context: message.msgctxt,
                    comments: message.comments,
                    origins: message
                        .origin
                        .into_iter()
                        .map(|origin| CatalogOriginMetadata {
                            file: origin.file,
                            scope: origin.scope,
                        })
                        .collect(),
                    obsolete: message.obsolete.is_some(),
                    translated,
                    machine: message.machine.map(MachineMetadata::from),
                }
            })
            .collect(),
        diagnostics: parsed
            .diagnostics
            .into_iter()
            .map(CatalogDiagnostic::from)
            .collect(),
    }
}

fn is_effectively_translated(translation: EffectiveTranslationRef<'_>) -> bool {
    match translation {
        EffectiveTranslationRef::Singular(value) => !value.is_empty(),
        EffectiveTranslationRef::Plural(values) => values.values().any(|value| !value.is_empty()),
    }
}

fn current_iso_date() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let days = i64::try_from(seconds / 86_400).unwrap_or(i64::MAX);
    iso_date_from_unix_days(days)
}

fn clean_cutoff_date(today: &str) -> String {
    let Some(days) = unix_days_from_iso_date(today) else {
        return today.to_owned();
    };
    iso_date_from_unix_days(days - 30)
}

fn iso_date_from_unix_days(days: i64) -> String {
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}")
}

fn unix_days_from_iso_date(value: &str) -> Option<i64> {
    let mut parts = value.split('-');
    let year = parts.next()?.parse::<i32>().ok()?;
    let month = parts.next()?.parse::<u32>().ok()?;
    let day = parts.next()?.parse::<u32>().ok()?;
    (parts.next().is_none() && (1..=12).contains(&month) && (1..=31).contains(&day))
        .then(|| days_from_civil(year, month, day))
}

fn civil_from_days(days: i64) -> (i32, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if month <= 2 { 1 } else { 0 };
    (
        i32::try_from(year).unwrap_or(i32::MAX),
        u32::try_from(month).unwrap_or(1),
        u32::try_from(day).unwrap_or(1),
    )
}

fn days_from_civil(year: i32, month: u32, day: u32) -> i64 {
    let year = i64::from(year) - i64::from(month <= 2);
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = year - era * 400;
    let month = i64::from(month);
    let day = i64::from(day);
    let doy = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
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

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::{
        parse_catalog, update_catalog_file, CatalogParseRequest, CatalogUpdateMessage,
        CatalogUpdateOrigin, CatalogUpdateRequest,
    };
    use crate::parse_po;
    use ferrocat::{machine_translation_hash, EffectiveTranslationRef};

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
            force_clean: false,
            format: crate::PalamedesCatalogFormat::Po,
            messages: vec![CatalogUpdateMessage {
                message: "Hello".to_owned(),
                context: None,
                placeholders: BTreeMap::new(),
                extracted_comments: vec![],
                origins: vec![CatalogUpdateOrigin {
                    file: "src/App.tsx".to_owned(),
                    line: 3,
                    scope: None,
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
            force_clean: false,
            format: crate::PalamedesCatalogFormat::Po,
            messages: vec![CatalogUpdateMessage {
                message: "Hello".to_owned(),
                context: None,
                placeholders: BTreeMap::new(),
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
    fn parse_catalog_exposes_machine_metadata() {
        let path = temp_file("machine-translation-parse");
        let hash = machine_translation_hash(EffectiveTranslationRef::Singular("Hallo"));
        std::fs::write(
            &path,
            format!(
                "#@ lock: {hash}\n\
                 #@ ai: openai/gpt-5.5-high:0.95\n\
                 msgid \"Hello\"\n\
                 msgstr \"Hallo\"\n"
            ),
        )
        .expect("write existing");

        let parsed = parse_catalog(&CatalogParseRequest {
            target_path: path,
            locale: "de".to_owned(),
            source_locale: "en".to_owned(),
            format: crate::PalamedesCatalogFormat::Po,
        })
        .expect("parse catalog");

        let metadata = parsed.messages[0]
            .machine
            .as_ref()
            .expect("machine metadata");
        assert_eq!(metadata.lock, hash);
        let ai = metadata.ai.as_ref().expect("ai provenance");
        assert_eq!(ai.model, "openai/gpt-5.5-high");
        assert_eq!(ai.confidence, Some(0.95));
    }

    #[test]
    fn preserves_valid_machine_translation_metadata() {
        let path = temp_file("machine-translation-preserve");
        let hash = machine_translation_hash(EffectiveTranslationRef::Singular("Hallo"));
        std::fs::write(
            &path,
            format!(
                "#@ lock: {hash}\n\
                 #@ ai: openai/gpt-5.5-high:0.95\n\
                 msgid \"Hello\"\n\
                 msgstr \"Hallo\"\n"
            ),
        )
        .expect("write existing");

        update_catalog_file(CatalogUpdateRequest {
            target_path: path.clone(),
            locale: "de".to_owned(),
            source_locale: "en".to_owned(),
            clean: false,
            force_clean: false,
            format: crate::PalamedesCatalogFormat::Po,
            messages: vec![CatalogUpdateMessage {
                message: "Hello".to_owned(),
                context: None,
                placeholders: BTreeMap::new(),
                extracted_comments: vec![],
                origins: vec![],
            }],
        })
        .expect("update");

        let output = std::fs::read_to_string(&path).expect("read");
        assert!(output.contains("#@ lock: "));
        assert!(output.contains("#@ ai: openai/gpt-5.5-high:0.95"));
    }

    #[test]
    fn clean_keeps_undated_obsolete_entries() {
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
            force_clean: false,
            format: crate::PalamedesCatalogFormat::Po,
            messages: vec![CatalogUpdateMessage {
                message: "Keep".to_owned(),
                context: None,
                placeholders: BTreeMap::new(),
                extracted_comments: vec![],
                origins: vec![],
            }],
        })
        .expect("update");

        let output = std::fs::read_to_string(&path).expect("read");
        assert!(output.contains("Old"));
    }

    #[test]
    fn force_clean_removes_undated_obsolete_entries() {
        let path = temp_file("force-clean");
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
            clean: false,
            force_clean: true,
            format: crate::PalamedesCatalogFormat::Po,
            messages: vec![CatalogUpdateMessage {
                message: "Keep".to_owned(),
                context: None,
                placeholders: BTreeMap::new(),
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
            force_clean: false,
            format: crate::PalamedesCatalogFormat::Po,
            messages: vec![CatalogUpdateMessage {
                message: "{count, plural, one {# item} other {# items}}".to_owned(),
                context: None,
                placeholders: BTreeMap::new(),
                extracted_comments: vec![],
                origins: vec![],
            }],
        })
        .expect("update");

        let output = std::fs::read_to_string(&path).expect("read");
        assert!(output.contains("{count, plural, one {# item} other {# items}}"));
    }

    #[test]
    fn forwards_extracted_placeholders_to_ferrocat_update() {
        let path = temp_file("placeholders");

        update_catalog_file(CatalogUpdateRequest {
            target_path: path.clone(),
            locale: "en".to_owned(),
            source_locale: "en".to_owned(),
            clean: false,
            force_clean: false,
            format: crate::PalamedesCatalogFormat::Po,
            messages: vec![CatalogUpdateMessage {
                message: "Hello {0}".to_owned(),
                context: None,
                placeholders: BTreeMap::from([("0".to_owned(), vec!["user.name".to_owned()])]),
                extracted_comments: vec![],
                origins: vec![],
            }],
        })
        .expect("update");

        let output = std::fs::read_to_string(&path).expect("read");
        assert!(output.contains("#. placeholder {0}: user.name"));
    }
}
