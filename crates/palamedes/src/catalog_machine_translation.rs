use serde::{Deserialize, Serialize};

use crate::catalog_artifact::resolve_catalog_path;
use crate::catalog_audit::{load_audit_catalogs, target_locales};
use crate::{CatalogArtifactConfig, PalamedesResult};

/// Request for read-only inspection of stored machine-translation claims.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogMachineTranslationInspectionRequest {
    /// Configuration used to resolve PO/FCL files, including the source catalog.
    pub config: CatalogArtifactConfig,
    /// Target locales. Empty selects all configured non-source locales.
    #[serde(default)]
    pub locales: Vec<String>,
}

/// Machine-metadata integrity counters and details for configured catalogs.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogMachineTranslationInspectionResult {
    /// One section per configured catalog and selected target locale.
    pub catalogs: Vec<CatalogMachineTranslationInspection>,
}

/// Ferrocat's metadata integrity review for one target catalog.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogMachineTranslationInspection {
    /// Configured catalog path pattern.
    pub catalog: String,
    /// Resolved target file path.
    pub target_path: String,
    /// Target locale represented by this section.
    pub locale: String,
    /// Native counters and active-entry details, with unchanged Ferrocat semantics.
    pub machine_translation: ferrocat::CatalogMachineTranslationReview,
}

/// Inspects machine metadata without rewriting catalogs or clearing stale claims.
///
/// This delegates classification, canonical payloads, and versioned hashes to
/// Ferrocat. Integrity does not establish authorship or linguistic quality.
/// Malformed metadata discarded by the parser may appear absent rather than
/// invalid; this API does not strengthen Ferrocat's detection guarantees.
/// Obsolete entries are excluded by Ferrocat's review semantics.
///
/// # Errors
///
/// Returns an error when files cannot be read or parsed, the source catalog is
/// missing, or a requested target locale is unavailable.
pub fn inspect_catalog_machine_translations(
    request: CatalogMachineTranslationInspectionRequest,
) -> PalamedesResult<CatalogMachineTranslationInspectionResult> {
    let locales = target_locales(&request.config, &request.locales);
    let locale_refs = locales.iter().map(String::as_str).collect::<Vec<_>>();
    let mut options =
        ferrocat::CatalogReviewOptions::new(&request.config.source_locale).with_details(true);
    options.locales = &locale_refs;
    let mut catalogs = Vec::new();

    for catalog in &request.config.catalogs {
        let loaded = load_audit_catalogs(&request.config, catalog, &locales)?;
        let state = loaded
            .iter()
            .map(|entry| &entry.catalog)
            .collect::<Vec<_>>();
        // Inspect the same snapshot on both sides: only the native current-state
        // machine review is exposed, without inventing a previous-state baseline.
        let report = ferrocat::review_catalogs(&state, &state, &options)?;
        for locale in report.locales {
            catalogs.push(CatalogMachineTranslationInspection {
                catalog: catalog.path.clone(),
                target_path: resolve_catalog_path(&request.config, catalog, &locale.locale)
                    .to_string_lossy()
                    .into_owned(),
                locale: locale.locale,
                machine_translation: locale.machine_translation,
            });
        }
    }
    Ok(CatalogMachineTranslationInspectionResult { catalogs })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inspection_preserves_raw_claims_and_native_active_entry_semantics() {
        let root = tempfile::tempdir().expect("fixture");
        std::fs::write(
            root.path().join("en.po"),
            "msgid \"Hello\"\nmsgstr \"Hello\"\n",
        )
        .expect("source");
        let lock = ferrocat::machine_translation_hash(ferrocat::EffectiveTranslationRef::Singular(
            "Hallo",
        ));
        let target = format!(
            "#@ lock: {lock}\nmsgctxt \"home\"\nmsgid \"Hello\"\nmsgstr \"Hallo\"\n\n\
             #@ lock: {lock}\nmsgctxt \"menu\"\nmsgid \"Hello\"\nmsgstr \"Edited\"\n\n\
             msgid \"Extra\"\nmsgstr \"Extra\"\n\n\
             #~ msgid \"Obsolete\"\n#~ msgstr \"Old\"\n"
        );
        std::fs::write(root.path().join("de.po"), &target).expect("target");
        let request = |locales: &[&str]| {
            serde_json::from_value(serde_json::json!({
                "config": { "rootDir": root.path(), "sourceLocale": "en", "locales": ["en", "de"],
                    "catalogs": [{"path": "{locale}", "include": []}] },
                "locales": locales,
            }))
            .expect("request")
        };
        let inspected = inspect_catalog_machine_translations(request(&[])).expect("inspect");
        let review = &inspected.catalogs[0].machine_translation;
        assert_eq!(
            (review.current, review.stale, review.absent, review.invalid),
            (1, 1, 1, 0)
        );
        assert_eq!(review.details.len(), 3);
        assert_eq!(
            std::fs::read_to_string(root.path().join("de.po")).expect("unchanged"),
            target
        );
        assert!(
            inspect_catalog_machine_translations(request(&["en"]))
                .expect("source-only")
                .catalogs
                .is_empty()
        );
        assert!(inspect_catalog_machine_translations(request(&["fr"])).is_err());
        std::fs::remove_file(root.path().join("de.po")).expect("remove target");
        assert!(inspect_catalog_machine_translations(request(&[])).is_err());
        std::fs::write(root.path().join("de.po"), &target).expect("restore target");
        std::fs::remove_file(root.path().join("en.po")).expect("remove source");
        assert!(inspect_catalog_machine_translations(request(&[])).is_err());
    }

    #[test]
    fn inspection_keeps_native_duplicate_and_malformed_metadata_errors() {
        let root = tempfile::tempdir().expect("fixture");
        std::fs::write(
            root.path().join("en.po"),
            "msgid \"Hello\"\nmsgstr \"Hello\"\n",
        )
        .expect("source");
        for target in [
            "msgid \"Hello\"\nmsgstr \"A\"\n\nmsgid \"Hello\"\nmsgstr \"B\"\n",
            "#@ ai: fixture/model\nmsgid \"Hello\"\nmsgstr \"Hallo\"\n",
        ] {
            std::fs::write(root.path().join("de.po"), target).expect("target");
            let request = serde_json::from_value(serde_json::json!({
                "config": {"rootDir": root.path(), "sourceLocale": "en", "locales": ["en", "de"],
                    "catalogs": [{"path": "{locale}", "include": []}]}
            }))
            .expect("request");
            assert!(inspect_catalog_machine_translations(request).is_err());
            assert_eq!(
                std::fs::read_to_string(root.path().join("de.po")).expect("unchanged"),
                target
            );
        }
    }
}
