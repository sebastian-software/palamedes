use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::diagnostic::CatalogDiagnostic;
use crate::error::{PalamedesError, PalamedesResult};
use ferrocat::{
    parse_catalog as ferrocat_parse_catalog, update_catalog_file as ferrocat_update_catalog_file,
    ApiError, CatalogOrigin, CatalogStats, CatalogUpdateInput, CatalogUpdateResult,
    EffectiveTranslationRef, ObsoleteStrategy, ParseCatalogOptions, ParsedCatalog,
    PlaceholderCommentMode, RenderOptions, SerializeOptions, SourceExtractedMessage,
    UpdateCatalogFileOptions, UpdateCatalogOptions,
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

/// Automatic line folding applied when serializing PO string literals.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PoLineBreaks {
    /// Preserve Ferrocat's default automatic width folding.
    #[default]
    Auto,
    /// Disable automatic width folding while preserving embedded newlines.
    Off,
}

/// Generic output controls for PO catalogs.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PoOutputOptions {
    /// Automatic line-folding behavior.
    #[serde(default)]
    pub line_breaks: PoLineBreaks,
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
    /// Optional PO-specific output controls.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub po: Option<PoOutputOptions>,
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
    mut request: CatalogUpdateRequest,
) -> PalamedesResult<CatalogUpdateResponse> {
    let target_path = PathBuf::from(&request.target_path);
    if target_path.as_os_str().is_empty() {
        return Err(PalamedesError::from(ApiError::InvalidArguments(
            "target_path must not be empty".to_owned(),
        )));
    }
    validate_po_options(request.format, request.po.as_ref())?;
    preserve_existing_po_apostrophe_identities(&mut request, &target_path)?;
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
    let is_po = request.format == super::catalog_artifact::PalamedesCatalogFormat::Po;
    if is_po {
        render = render
            .with_custom_header_attributes(&custom_header_attributes)
            .with_po_serialize_options(po_serialize_options(request.po.as_ref()));
    }
    let update_options = UpdateCatalogOptions::new(&request.source_locale, input)
        .with_locale(&request.locale)
        .with_mode(request.format.ferrocat_mode())
        .with_obsolete_strategy(obsolete_strategy)
        .with_overwrite_source_translations(true)
        .with_render(render)
        .with_now(&now);
    /*
     * Catalog files are repository-owned, regenerable artifacts, so the write
     * skips Ferrocat's per-file durability barriers (File::sync_all is
     * F_FULLFSYNC on macOS and was the dominant fixed cost of the write phase
     * there). The rename stays atomic; after a crash the worst case is an old
     * or missing catalog that the next extract rewrites.
     */
    let file_options = UpdateCatalogFileOptions::new(
        &target_path,
        &request.source_locale,
        CatalogUpdateInput::default(),
    )
    .with_options(update_options)
    .with_durability(ferrocat::WriteDurability::Rename);
    let result = ferrocat_update_catalog_file(file_options).map_err(PalamedesError::from)?;

    Ok(public_update_result(result))
}

/// Keeps a translated PO entry attached when an extractor upgrade only changes
/// the apostrophe spelling of its identity.
///
/// Ferrocat deliberately treats `(msgid, msgctxt)` as exact identity. The
/// compatibility policy here is therefore applied before projection, at the
/// Palamedes integration boundary: an extracted message reuses one existing
/// spelling only when both canonicalize to the same runtime-literal ICU text.
/// Exact identities win, and ambiguous candidates are left alone rather than
/// silently merging distinct catalog entries.
fn preserve_existing_po_apostrophe_identities(
    request: &mut CatalogUpdateRequest,
    target_path: &Path,
) -> PalamedesResult<()> {
    if request.format != super::catalog_artifact::PalamedesCatalogFormat::Po {
        return Ok(());
    }
    if !request
        .messages
        .iter()
        .any(|message| message.message.contains('\''))
    {
        return Ok(());
    }

    let content = match std::fs::read_to_string(target_path) {
        Ok(content) => content,
        Err(source) if source.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(source) => {
            return Err(PalamedesError::ReadFile {
                path: target_path.to_path_buf(),
                source,
            });
        }
    };
    if content.is_empty() || request.messages.is_empty() {
        return Ok(());
    }

    let parsed = ferrocat_parse_catalog(
        ParseCatalogOptions::new(&content, &request.source_locale)
            .with_locale(&request.locale)
            .with_mode(request.format.ferrocat_mode()),
    )
    .map_err(PalamedesError::from)?;
    let existing = parsed
        .messages
        .into_iter()
        .map(|message| (message.msgid, message.msgctxt))
        .collect::<Vec<_>>();
    let extracted_identities = request
        .messages
        .iter()
        .map(|message| (message.message.clone(), message.context.clone()))
        .collect::<BTreeSet<_>>();

    let mut proposed = Vec::new();
    for (message_index, message) in request.messages.iter().enumerate() {
        let exact = existing
            .iter()
            .any(|identity| identity.0 == message.message && identity.1 == message.context);
        if exact {
            continue;
        }

        let candidates = existing
            .iter()
            .enumerate()
            .filter(|(_, identity)| {
                identity.1 == message.context
                    && !extracted_identities.contains(identity)
                    && apostrophe_canonical_equivalent(&identity.0, &message.message)
            })
            .map(|(index, _)| index)
            .collect::<Vec<_>>();
        if let [existing_index] = candidates.as_slice() {
            proposed.push((message_index, *existing_index));
        }
    }

    let mut candidate_inputs = BTreeMap::<usize, BTreeSet<(String, Option<String>)>>::new();
    for (message_index, existing_index) in &proposed {
        let message = &request.messages[*message_index];
        candidate_inputs
            .entry(*existing_index)
            .or_default()
            .insert((message.message.clone(), message.context.clone()));
    }
    for (message_index, existing_index) in proposed {
        if candidate_inputs
            .get(&existing_index)
            .is_some_and(|identities| identities.len() == 1)
        {
            request.messages[message_index]
                .message
                .clone_from(&existing[existing_index].0);
        }
    }

    Ok(())
}

fn apostrophe_canonical_equivalent(left: &str, right: &str) -> bool {
    if left == right || (!left.contains('\'') && !right.contains('\'')) {
        return false;
    }

    ferrocat::canonicalize_icu_with_policy(
        left,
        ferrocat::IcuSyntaxPolicy::RuntimeLiteralApostrophes,
    ) == ferrocat::canonicalize_icu_with_policy(
        right,
        ferrocat::IcuSyntaxPolicy::RuntimeLiteralApostrophes,
    )
}

fn validate_po_options(
    format: super::catalog_artifact::PalamedesCatalogFormat,
    options: Option<&PoOutputOptions>,
) -> PalamedesResult<()> {
    if options.is_some() && format != super::catalog_artifact::PalamedesCatalogFormat::Po {
        return Err(PalamedesError::from(ApiError::InvalidArguments(
            "po output options can only be used with PO catalogs".to_owned(),
        )));
    }
    Ok(())
}

pub(crate) fn po_serialize_options(options: Option<&PoOutputOptions>) -> SerializeOptions {
    match options.map(|options| options.line_breaks) {
        Some(PoLineBreaks::Off) => SerializeOptions::default().with_fold_length(0),
        None | Some(PoLineBreaks::Auto) => SerializeOptions::default(),
    }
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
        CatalogUpdateOrigin, CatalogUpdateRequest, PoLineBreaks, PoOutputOptions,
    };
    use crate::parse_po;
    use ferrocat::{machine_translation_hash, EffectiveTranslationRef};

    fn temp_file(name: &str) -> String {
        temp_file_with_extension(name, "po")
    }

    fn temp_file_with_extension(name: &str, extension: &str) -> String {
        std::env::temp_dir()
            .join(format!(
                "palamedes-catalog-update-{name}-{}.{}",
                std::process::id(),
                extension
            ))
            .to_string_lossy()
            .into_owned()
    }

    fn message(text: &str, context: Option<&str>, origin: &str) -> CatalogUpdateMessage {
        CatalogUpdateMessage {
            message: text.to_owned(),
            context: context.map(str::to_owned),
            placeholders: BTreeMap::new(),
            extracted_comments: vec![],
            origins: vec![CatalogUpdateOrigin {
                file: origin.to_owned(),
                line: 1,
                scope: None,
            }],
        }
    }

    fn update_po(
        path: &str,
        messages: Vec<CatalogUpdateMessage>,
        po: Option<PoOutputOptions>,
    ) -> super::CatalogUpdateResponse {
        update_catalog_file(CatalogUpdateRequest {
            target_path: path.to_owned(),
            locale: "en".to_owned(),
            source_locale: "en".to_owned(),
            clean: false,
            force_clean: false,
            format: crate::PalamedesCatalogFormat::Po,
            po,
            messages,
        })
        .expect("update")
    }

    #[test]
    fn po_line_breaks_off_keeps_long_single_line_values_on_one_physical_line() {
        let path = temp_file("line-breaks-off");
        let long = "A deliberately long source message and translation value that exceeds Ferrocat's default eighty-column fold length by a comfortable margin.";

        update_po(
            &path,
            vec![message(long, None, "src/App.tsx")],
            Some(PoOutputOptions {
                line_breaks: PoLineBreaks::Off,
            }),
        );

        let output = std::fs::read_to_string(&path).expect("read output");
        assert!(output
            .lines()
            .any(|line| line == format!("msgid \"{long}\"")));
        assert!(output
            .lines()
            .any(|line| line == format!("msgstr \"{long}\"")));
    }

    #[test]
    fn po_line_breaks_off_preserves_embedded_newlines_as_valid_multiline_po() {
        let path = temp_file("embedded-newlines");
        let text = "First line\nSecond line";

        update_po(
            &path,
            vec![message(text, None, "src/App.tsx")],
            Some(PoOutputOptions {
                line_breaks: PoLineBreaks::Off,
            }),
        );

        let output = std::fs::read_to_string(&path).expect("read output");
        assert!(output.contains("msgid \"First line\\n\"\n\"Second line\""));
        let parsed = parse_po(&output).expect("parse output");
        assert_eq!(parsed.items[0].msgid, text);
        assert_eq!(
            parsed.items[0].msgstr.first().map(String::as_str),
            Some(text)
        );
    }

    #[test]
    fn resorts_the_complete_catalog_by_message_then_context() {
        let path = temp_file("collated-order");
        std::fs::write(
            &path,
            concat!(
                "msgid \"Zebra\"\nmsgstr \"Zebra\"\n\n",
                "msgid \"Uber\"\nmsgstr \"Uber\"\n",
            ),
        )
        .expect("write existing");
        let messages = vec![
            message("Zebra", None, "src/Zebra.tsx"),
            message("über", None, "src/Umlaut.tsx"),
            message("Uber", None, "src/Uber.tsx"),
            message("éclair", None, "src/EclairAccent.tsx"),
            message("eclair", None, "src/Eclair.tsx"),
            message("Apple", None, "src/AppleUpper.tsx"),
            message("apple", Some("z"), "src/AppleZ.tsx"),
            message("apple", Some("a"), "src/AppleA.tsx"),
            message("Álgebra", None, "src/Algebra.tsx"),
            message("!Alert", None, "src/Alert.tsx"),
        ];

        update_po(&path, messages, None);

        let output = std::fs::read_to_string(&path).expect("read output");
        let parsed = parse_po(&output).expect("parse output");
        let identities = parsed
            .items
            .iter()
            .map(|item| (item.msgid.as_str(), item.msgctxt.as_deref()))
            .collect::<Vec<_>>();
        assert_eq!(
            identities,
            vec![
                ("!Alert", None),
                ("Álgebra", None),
                ("apple", Some("a")),
                ("apple", Some("z")),
                ("Apple", None),
                ("eclair", None),
                ("éclair", None),
                ("Uber", None),
                ("über", None),
                ("Zebra", None),
            ]
        );
    }

    #[test]
    fn delegates_fcl_catalog_ordering_to_ferrocat() {
        let path = temp_file_with_extension("fcl-collated-order", "fcl");
        update_catalog_file(CatalogUpdateRequest {
            target_path: path.clone(),
            locale: "en".to_owned(),
            source_locale: "en".to_owned(),
            clean: false,
            force_clean: false,
            format: crate::PalamedesCatalogFormat::Fcl,
            po: None,
            messages: ["Zebra", "über", "Uber", "Apple", "apple", "Álgebra"]
                .into_iter()
                .map(|text| message(text, None, "src/App.tsx"))
                .collect(),
        })
        .expect("update FCL");

        let output = std::fs::read_to_string(&path).expect("read FCL output");
        assert!(
            output.starts_with("%FCL1\tsource=en\tlocale=en\torder=collated\n"),
            "{output}"
        );
        let parsed = parse_catalog(&CatalogParseRequest {
            target_path: path,
            locale: "en".to_owned(),
            source_locale: "en".to_owned(),
            format: crate::PalamedesCatalogFormat::Fcl,
        })
        .expect("parse FCL output");
        assert_eq!(
            parsed
                .messages
                .iter()
                .map(|message| message.message.as_str())
                .collect::<Vec<_>>(),
            vec!["Álgebra", "apple", "Apple", "Uber", "über", "Zebra"]
        );
    }

    #[test]
    fn compares_missing_context_as_an_empty_string() {
        let path = temp_file("collated-context-empty");
        update_po(
            &path,
            vec![
                message("Same", Some(""), "src/Empty.tsx"),
                message("Same", None, "src/Missing.tsx"),
                message("Same", Some("z"), "src/Z.tsx"),
            ],
            None,
        );

        let parsed =
            parse_po(&std::fs::read_to_string(&path).expect("read output")).expect("parse output");
        assert_eq!(parsed.items[0].msgctxt, None);
        assert_eq!(parsed.items[1].msgctxt.as_deref(), Some(""));
        assert_eq!(parsed.items[2].msgctxt.as_deref(), Some("z"));
    }

    /// Message identity decides the order, not where a message was extracted
    /// from.
    #[test]
    fn ignores_source_origins_when_ordering() {
        let path = temp_file("origin-irrelevant");
        update_po(
            &path,
            vec![
                message("First message", None, "src/z.tsx"),
                message("Second message", None, "src/a.tsx"),
            ],
            None,
        );

        let parsed =
            parse_po(&std::fs::read_to_string(&path).expect("read output")).expect("parse output");
        assert_eq!(parsed.items[0].msgid, "First message");
        assert_eq!(parsed.items[1].msgid, "Second message");
    }

    #[test]
    fn explicit_default_po_options_keep_default_output_byte_for_byte() {
        let default_path = temp_file("default-output");
        let explicit_path = temp_file("explicit-default-output");
        let messages = vec![message(
            "A long value that Ferrocat folds in its default mode because it is longer than the normal output width.",
            None,
            "src/App.tsx",
        )];

        update_po(&default_path, messages.clone(), None);
        update_po(&explicit_path, messages, Some(PoOutputOptions::default()));

        assert_eq!(
            std::fs::read_to_string(default_path).expect("read default"),
            std::fs::read_to_string(explicit_path).expect("read explicit default")
        );
    }

    #[test]
    fn rejects_po_options_for_fcl_catalogs() {
        let path = temp_file("invalid-po-options");
        let invalid_fcl = update_catalog_file(CatalogUpdateRequest {
            target_path: path,
            locale: "en".to_owned(),
            source_locale: "en".to_owned(),
            clean: false,
            force_clean: false,
            format: crate::PalamedesCatalogFormat::Fcl,
            po: Some(PoOutputOptions::default()),
            messages: vec![],
        })
        .expect_err("reject PO options for FCL");
        assert!(invalid_fcl.to_string().contains("only be used with PO"));
    }

    /*
     * The acceptance criteria in #479 ask for a comparison against real Lingui
     * 6 output. Lingui delegates PO serialization to `pofile` and orders with
     * `new Intl.Collator("en-US")` over message and then context, so this
     * fixture is the entry region of a catalog produced by exactly that
     * combination. Header parity is explicitly out of scope, so the header is
     * not part of the comparison.
     */
    const LINGUI_GOLDEN_ENTRIES: &str = r#"msgid "!Alert"
msgstr "!Alert"

msgid "\"Quoted\""
msgstr "\"Quoted\""

msgid "(Parens)"
msgstr "(Parens)"

msgid "A deliberately long source message and translation value that exceeds the default eighty column fold length by a comfortable margin."
msgstr "A deliberately long source message and translation value that exceeds the default eighty column fold length by a comfortable margin."

msgid "Álgebra"
msgstr "Álgebra"

msgctxt "a"
msgid "apple"
msgstr "apple"

msgctxt "z"
msgid "apple"
msgstr "apple"

msgid "Apple"
msgstr "Apple"

msgid "client's booking"
msgstr "client's booking"

msgid "co-op"
msgstr "co-op"

msgid "coop"
msgstr "coop"

msgid "don't stop"
msgstr "don't stop"

msgid "eclair"
msgstr "eclair"

msgid "éclair"
msgstr "éclair"

msgid "Item 10"
msgstr "Item 10"

msgid "Item 2"
msgstr "Item 2"

msgid "l'été"
msgstr "l'été"

msgid "MiXeD CaSe"
msgstr "MiXeD CaSe"

msgid "naïve"
msgstr "naïve"

msgid "résumé"
msgstr "résumé"

msgid "Uber"
msgstr "Uber"

msgid "über"
msgstr "über"

msgid "Zebra"
msgstr "Zebra""#;

    #[test]
    fn collated_unfolded_output_matches_lingui_golden_entries() {
        let path = temp_file("lingui-golden");
        let long = "A deliberately long source message and translation value that exceeds the default eighty column fold length by a comfortable margin.";
        let corpus: Vec<(&str, Option<&str>)> = vec![
            ("Zebra", None),
            ("über", None),
            ("Uber", None),
            ("éclair", None),
            ("eclair", None),
            ("Apple", None),
            ("apple", Some("z")),
            ("apple", Some("a")),
            ("Álgebra", None),
            ("!Alert", None),
            ("\"Quoted\"", None),
            ("(Parens)", None),
            ("Item 10", None),
            ("Item 2", None),
            ("co-op", None),
            ("coop", None),
            ("don't stop", None),
            ("client's booking", None),
            ("l'été", None),
            ("naïve", None),
            ("résumé", None),
            ("MiXeD CaSe", None),
            (long, None),
        ];

        update_po(
            &path,
            corpus
                .iter()
                .map(|(text, context)| message(text, *context, "src/App.tsx"))
                .collect(),
            Some(PoOutputOptions {
                line_breaks: PoLineBreaks::Off,
            }),
        );

        let output = std::fs::read_to_string(&path).expect("read output");
        let entries = strip_po_header_and_references(&output);
        assert_eq!(entries, LINGUI_GOLDEN_ENTRIES);
    }

    /*
     * Ferrocat puts the first chunk of a multiline value on the keyword line,
     * while `pofile` and GNU gettext open with an empty string and continue on
     * the following lines. Both parse identically, but the spelling differs, so
     * messages containing newlines still produce a mechanical diff when a
     * catalog moves between the two tool chains. Pinned here so the divergence
     * is a recorded fact rather than a surprise.
     */
    #[test]
    fn multiline_values_diverge_from_pofile_spelling() {
        let path = temp_file("multiline-divergence");
        update_po(
            &path,
            vec![message("First line\nSecond line", None, "src/App.tsx")],
            Some(PoOutputOptions {
                line_breaks: PoLineBreaks::Off,
            }),
        );

        let output = std::fs::read_to_string(&path).expect("read output");
        assert!(output.contains("msgid \"First line\\n\"\n\"Second line\""));
        // What `pofile` would have written instead:
        assert!(!output.contains("msgid \"\"\n\"First line\\n\"\n\"Second line\""));
    }

    /// Drops the PO header block and `#:` reference comments so a comparison
    /// covers ordering and folding, which is what #479 is about.
    fn strip_po_header_and_references(output: &str) -> String {
        output
            .split("\n\n")
            .skip(1)
            .map(|block| {
                block
                    .lines()
                    .filter(|line| !line.starts_with("#:"))
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .collect::<Vec<_>>()
            .join("\n\n")
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
            po: None,
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
            po: None,
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
    fn preserves_po_translator_comments_and_flags_while_refreshing_source_metadata() {
        let path = temp_file("po-metadata");
        std::fs::write(
            &path,
            concat!(
                "# translator note\n",
                "#. stale extractor note\n",
                "#: src/Old.tsx\n",
                "#, fuzzy, no-wrap\n",
                "msgctxt \"button\"\n",
                "msgid \"Hello\"\n",
                "msgstr \"Hallo (alt)\"\n",
            ),
        )
        .expect("write existing");

        let request = || CatalogUpdateRequest {
            target_path: path.clone(),
            locale: "de".to_owned(),
            source_locale: "en".to_owned(),
            clean: false,
            force_clean: false,
            format: crate::PalamedesCatalogFormat::Po,
            po: None,
            messages: vec![CatalogUpdateMessage {
                message: "Hello".to_owned(),
                context: Some("button".to_owned()),
                placeholders: BTreeMap::new(),
                extracted_comments: vec!["fresh extractor note".to_owned()],
                origins: vec![CatalogUpdateOrigin {
                    file: "src/New.tsx".to_owned(),
                    line: 9,
                    scope: None,
                }],
            }],
        };
        update_catalog_file(request()).expect("update");

        let output = std::fs::read_to_string(&path).expect("read output");
        let po = parse_po(&output).expect("parse output");
        let item = &po.items[0];
        assert_eq!(item.msgstr.first().map(String::as_str), Some("Hallo (alt)"));
        assert_eq!(item.comments.as_slice(), ["translator note"]);
        assert_eq!(
            item.flags,
            BTreeMap::from([("fuzzy".to_owned(), true), ("no-wrap".to_owned(), true)])
        );
        assert_eq!(item.extracted_comments.as_slice(), ["fresh extractor note"]);
        assert_eq!(item.references.as_slice(), ["src/New.tsx"]);

        let repeated = update_catalog_file(request()).expect("repeat update");
        assert!(!repeated.updated);
        assert_eq!(
            std::fs::read_to_string(&path).expect("read repeated output"),
            output
        );
    }

    // Opaque metadata belongs to individual message identities and must not
    // leak to neighboring entries when Ferrocat updates the complete catalog.
    #[test]
    fn preserves_metadata_when_only_one_item_of_many_carries_it() {
        let path = temp_file("po-metadata-sparse");
        std::fs::write(
            &path,
            concat!(
                "msgid \"First\"\n",
                "msgstr \"Erste\"\n",
                "\n",
                "# translator note\n",
                "#, fuzzy\n",
                "msgid \"Second\"\n",
                "msgstr \"Zweite\"\n",
                "\n",
                "msgid \"Third\"\n",
                "msgstr \"Dritte\"\n",
            ),
        )
        .expect("write existing");

        let message = |text: &str| CatalogUpdateMessage {
            message: text.to_owned(),
            context: None,
            placeholders: BTreeMap::new(),
            extracted_comments: Vec::new(),
            origins: vec![CatalogUpdateOrigin {
                file: "src/App.tsx".to_owned(),
                line: 1,
                scope: None,
            }],
        };

        update_catalog_file(CatalogUpdateRequest {
            target_path: path.clone(),
            locale: "de".to_owned(),
            source_locale: "en".to_owned(),
            clean: false,
            force_clean: false,
            format: crate::PalamedesCatalogFormat::Po,
            po: None,
            messages: vec![message("First"), message("Second"), message("Third")],
        })
        .expect("update");

        let output = std::fs::read_to_string(&path).expect("read output");
        let po = parse_po(&output).expect("parse output");
        let second = po
            .items
            .iter()
            .find(|item| item.msgid == "Second")
            .expect("second item");
        assert_eq!(second.comments.as_slice(), ["translator note"]);
        assert_eq!(second.flags, BTreeMap::from([("fuzzy".to_owned(), true)]));

        for msgid in ["First", "Third"] {
            let item = po
                .items
                .iter()
                .find(|item| item.msgid == msgid)
                .expect("item");
            assert!(item.comments.as_slice().is_empty());
            assert!(item.flags.is_empty());
        }
    }

    // Catalogs without opaque metadata still receive refreshed extractor-owned
    // comments and source references while keeping existing translations.
    #[test]
    fn refreshes_source_metadata_for_catalogs_without_preserved_metadata() {
        let path = temp_file("po-no-metadata");
        std::fs::write(
            &path,
            concat!(
                "#: src/Old.tsx\n",
                "msgid \"Hello\"\n",
                "msgstr \"Hallo\"\n",
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
            po: None,
            messages: vec![CatalogUpdateMessage {
                message: "Hello".to_owned(),
                context: None,
                placeholders: BTreeMap::new(),
                extracted_comments: Vec::new(),
                origins: vec![CatalogUpdateOrigin {
                    file: "src/New.tsx".to_owned(),
                    line: 4,
                    scope: None,
                }],
            }],
        })
        .expect("update");

        let output = std::fs::read_to_string(&path).expect("read output");
        let po = parse_po(&output).expect("parse output");
        let item = &po.items[0];
        assert_eq!(item.msgstr.first().map(String::as_str), Some("Hallo"));
        assert_eq!(item.references.as_slice(), ["src/New.tsx"]);
        assert!(item.comments.as_slice().is_empty());
    }

    #[test]
    fn keeps_po_metadata_separate_when_marking_messages_obsolete() {
        let path = temp_file("obsolete-po-metadata");
        std::fs::write(
            &path,
            concat!(
                "# translator note\n",
                "#. source note\n",
                "#, fuzzy\n",
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
            po: None,
            messages: vec![],
        })
        .expect("update");

        let output = std::fs::read_to_string(&path).expect("read output");
        let po = parse_po(&output).expect("parse output");
        let item = &po.items[0];
        assert!(item.obsolete);
        assert_eq!(item.comments.as_slice(), ["translator note"]);
        assert_eq!(item.extracted_comments.as_slice(), ["source note"]);
        assert_eq!(item.flags, BTreeMap::from([("fuzzy".to_owned(), true)]));
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
            po: None,
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
            po: None,
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
            po: None,
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
    fn force_clean_preserves_lingui_apostrophe_translations_and_metadata() {
        let path = temp_file("lingui-apostrophe-migration");
        let lock = machine_translation_hash(EffectiveTranslationRef::Singular("nicht aufhören"));
        let fixture =
            include_str!("../fixtures/lingui-apostrophes.de.po").replace("{{DONT_LOCK}}", &lock);
        std::fs::write(&path, fixture).expect("write Lingui fixture");

        let request = || CatalogUpdateRequest {
            target_path: path.clone(),
            locale: "de".to_owned(),
            source_locale: "en".to_owned(),
            clean: false,
            force_clean: true,
            format: crate::PalamedesCatalogFormat::Po,
            po: None,
            messages: vec![
                message("don''t stop", None, "src/App.tsx"),
                message("client''s booking", Some("booking"), "src/Client.tsx"),
                message("l''été", None, "src/Summer.tsx"),
            ],
        };

        let migrated = update_catalog_file(request()).expect("migrate Lingui catalog");
        assert_eq!(migrated.stats.total, 3);
        assert_eq!(migrated.stats.added, 0);
        assert_eq!(migrated.stats.obsolete_removed, 0);

        let output = std::fs::read_to_string(&path).expect("read migrated output");
        let po = parse_po(&output).expect("parse migrated output");
        assert_eq!(po.items.len(), 3);
        let dont = po
            .items
            .iter()
            .find(|item| item.msgid == "don't stop")
            .expect("natural-apostrophe identity survives");
        assert_eq!(
            dont.msgstr.first().map(String::as_str),
            Some("nicht aufhören")
        );
        assert_eq!(dont.comments.as_slice(), ["Keep the contraction informal."]);
        assert_eq!(
            dont.flags,
            BTreeMap::from([("fuzzy".to_owned(), true), ("no-wrap".to_owned(), true)])
        );
        assert!(output.contains(&format!("#@ lock: {lock}")));
        assert!(output.contains("#@ ai: openai/gpt-5.5-high:0.95"));

        let clients = po
            .items
            .iter()
            .find(|item| item.msgid == "client's booking")
            .expect("possessive identity survives");
        assert_eq!(clients.msgctxt.as_deref(), Some("booking"));
        assert_eq!(
            clients.msgstr.first().map(String::as_str),
            Some("Buchung des Kunden")
        );
        let summer = po
            .items
            .iter()
            .find(|item| item.msgid == "l'été")
            .expect("Unicode apostrophe identity survives");
        assert_eq!(
            summer.msgstr.first().map(String::as_str),
            Some("der Sommer")
        );

        let repeated = update_catalog_file(request()).expect("repeat migration");
        assert!(!repeated.updated);
        assert_eq!(
            std::fs::read_to_string(&path).expect("read repeated output"),
            output
        );
    }

    #[test]
    fn force_clean_reuses_palamedes_1_9_canonical_identity_for_new_raw_source() {
        let path = temp_file("palamedes-1-9-apostrophe-migration");
        let lock = machine_translation_hash(EffectiveTranslationRef::Singular("nicht aufhören"));
        std::fs::write(
            &path,
            format!(
                "# Existing translator note\n\
                 #, fuzzy\n\
                 #@ lock: {lock}\n\
                 #@ ai: openai/gpt-5.5-high:0.95\n\
                 msgid \"don''t stop\"\n\
                 msgstr \"nicht aufhören\"\n"
            ),
        )
        .expect("write Palamedes 1.9 catalog");

        let request = || CatalogUpdateRequest {
            target_path: path.clone(),
            locale: "de".to_owned(),
            source_locale: "en".to_owned(),
            clean: false,
            force_clean: true,
            format: crate::PalamedesCatalogFormat::Po,
            po: None,
            messages: vec![message("don't stop", None, "src/App.tsx")],
        };
        let migrated = update_catalog_file(request()).expect("reuse canonical identity");
        assert_eq!(migrated.stats.added, 0);
        assert_eq!(migrated.stats.obsolete_removed, 0);

        let output = std::fs::read_to_string(&path).expect("read migrated output");
        let po = parse_po(&output).expect("parse migrated output");
        assert_eq!(po.items.len(), 1);
        assert_eq!(po.items[0].msgid, "don''t stop");
        assert_eq!(
            po.items[0].msgstr.first().map(String::as_str),
            Some("nicht aufhören")
        );
        assert_eq!(
            po.items[0].comments.as_slice(),
            ["Existing translator note"]
        );
        assert_eq!(
            po.items[0].flags,
            BTreeMap::from([("fuzzy".to_owned(), true)])
        );
        assert!(output.contains(&format!("#@ lock: {lock}")));
        assert!(output.contains("#@ ai: openai/gpt-5.5-high:0.95"));

        let repeated = update_catalog_file(request()).expect("repeat canonical reuse");
        assert!(!repeated.updated);
        assert_eq!(
            std::fs::read_to_string(path).expect("read repeated output"),
            output
        );
    }

    #[test]
    fn exact_apostrophe_identity_wins_without_merging_an_equivalent_entry() {
        let path = temp_file("apostrophe-exact-wins");
        std::fs::write(
            &path,
            concat!(
                "msgid \"don't\"\n",
                "msgstr \"exact translation\"\n\n",
                "msgid \"don''t\"\n",
                "msgstr \"canonical translation\"\n",
            ),
        )
        .expect("write existing catalog");

        let result = update_catalog_file(CatalogUpdateRequest {
            target_path: path.clone(),
            locale: "de".to_owned(),
            source_locale: "en".to_owned(),
            clean: false,
            force_clean: true,
            format: crate::PalamedesCatalogFormat::Po,
            po: None,
            messages: vec![message("don't", None, "src/App.tsx")],
        })
        .expect("update exact identity");

        let po =
            parse_po(&std::fs::read_to_string(path).expect("read output")).expect("parse output");
        assert_eq!(po.items.len(), 1);
        assert_eq!(po.items[0].msgid, "don't");
        assert_eq!(
            po.items[0].msgstr.first().map(String::as_str),
            Some("exact translation")
        );
        assert_eq!(result.stats.obsolete_removed, 1);
    }

    #[test]
    fn apostrophe_migration_never_crosses_context_and_deduplicates_identical_inputs() {
        let context_path = temp_file("apostrophe-context-separated");
        std::fs::write(
            &context_path,
            concat!(
                "msgctxt \"menu\"\n",
                "msgid \"don't\"\n",
                "msgstr \"menu translation\"\n",
            ),
        )
        .expect("write contextual catalog");
        update_catalog_file(CatalogUpdateRequest {
            target_path: context_path.clone(),
            locale: "de".to_owned(),
            source_locale: "en".to_owned(),
            clean: false,
            force_clean: true,
            format: crate::PalamedesCatalogFormat::Po,
            po: None,
            messages: vec![message("don''t", Some("dialog"), "src/App.tsx")],
        })
        .expect("update separate context");
        let context_po =
            parse_po(&std::fs::read_to_string(context_path).expect("read contextual output"))
                .expect("parse contextual output");
        assert_eq!(context_po.items.len(), 1);
        assert_eq!(context_po.items[0].msgctxt.as_deref(), Some("dialog"));
        assert!(context_po.items[0].msgstr.iter().all(String::is_empty));

        let collision_path = temp_file("apostrophe-duplicate-input");
        std::fs::write(
            &collision_path,
            "msgid \"don't\"\nmsgstr \"duplicate-safe translation\"\n",
        )
        .expect("write duplicate-input catalog");
        update_catalog_file(CatalogUpdateRequest {
            target_path: collision_path.clone(),
            locale: "de".to_owned(),
            source_locale: "en".to_owned(),
            clean: false,
            force_clean: true,
            format: crate::PalamedesCatalogFormat::Po,
            po: None,
            messages: vec![
                message("don''t", None, "src/One.tsx"),
                message("don''t", None, "src/Two.tsx"),
            ],
        })
        .expect("update duplicate inputs");
        let collision_po =
            parse_po(&std::fs::read_to_string(collision_path).expect("read collision output"))
                .expect("parse collision output");
        assert_eq!(collision_po.items.len(), 1);
        assert_eq!(collision_po.items[0].msgid, "don't");
        assert_eq!(
            collision_po.items[0].msgstr.first().map(String::as_str),
            Some("duplicate-safe translation")
        );
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
            po: None,
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
    fn projects_plural_messages_with_numeric_hyphenated_text() {
        let path = temp_file("plural-text");
        let message =
            "{count, plural, one {# queue detail 00042-now} other {# queue details 00042-now}}";

        update_catalog_file(CatalogUpdateRequest {
            target_path: path.clone(),
            locale: "en".to_owned(),
            source_locale: "en".to_owned(),
            clean: false,
            force_clean: false,
            format: crate::PalamedesCatalogFormat::Po,
            po: None,
            messages: vec![CatalogUpdateMessage {
                message: message.to_owned(),
                context: None,
                placeholders: BTreeMap::new(),
                extracted_comments: vec![],
                origins: vec![],
            }],
        })
        .expect("update");

        let po = parse_po(&std::fs::read_to_string(&path).expect("read output")).expect("parse po");
        assert_eq!(po.items.len(), 1);
        assert_eq!(po.items[0].msgid, message);
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
            po: None,
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
