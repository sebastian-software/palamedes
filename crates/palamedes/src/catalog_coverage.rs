use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use ferrocat::{parse_catalog_for_review, CatalogCoverageOptions, NormalizedParsedCatalog};
use ferrocat_po::measure_catalog_coverage as ferrocat_measure_catalog_coverage;
use serde::Serialize;

use crate::catalog_artifact::{resolve_catalog_path, CatalogArtifactConfig, CatalogConfig};
use crate::error::{PalamedesError, PalamedesResult};

/// Request for measuring configured catalog coverage.
#[derive(Debug)]
pub struct CatalogCoverageRequest {
    /// Catalog configuration used to resolve files and formats.
    pub config: CatalogArtifactConfig,
    /// Locales to report. The source locale may be included explicitly.
    pub locales: Vec<String>,
}

/// Aggregate catalog coverage result.
#[derive(Debug, Serialize)]
pub struct CatalogCoverageResult {
    /// Per-locale coverage in deterministic locale order.
    pub locales: Vec<CatalogLocaleCoverageResult>,
}

/// Product-facing coverage counters for one locale.
#[derive(Debug, Serialize)]
pub struct CatalogLocaleCoverageResult {
    /// Locale represented by these counters.
    pub locale: String,
    /// Active source messages expected for the locale.
    pub total: usize,
    /// Expected messages with complete, non-fuzzy translations.
    pub translated: usize,
    /// Expected messages that still need translator attention.
    pub missing: usize,
    /// Expected messages carrying a fuzzy review marker.
    pub fuzzy: usize,
    /// Completion as a `0.0..=100.0` percentage.
    pub percent: f64,
}

#[derive(Debug)]
struct MutableLocaleCoverage {
    locale: String,
    total: usize,
    translated: usize,
    missing: usize,
    fuzzy: usize,
}

/// Measures completeness for configured catalogs through Ferrocat's
/// review-aware coverage classifier.
///
/// Missing target files count every active source message as incomplete.
/// Fuzzy markers in PO and FCL are classified identically.
///
/// # Errors
///
/// Returns an error when a source catalog or an existing target catalog cannot
/// be read, parsed, or normalized.
pub fn measure_catalog_coverage(
    request: CatalogCoverageRequest,
) -> PalamedesResult<CatalogCoverageResult> {
    let mut coverage = request
        .locales
        .iter()
        .map(|locale| {
            (
                locale.clone(),
                MutableLocaleCoverage {
                    locale: locale.clone(),
                    total: 0,
                    translated: 0,
                    missing: 0,
                    fuzzy: 0,
                },
            )
        })
        .collect::<BTreeMap<_, _>>();

    for catalog_config in &request.config.catalogs {
        let source_path = resolve_catalog_path(
            &request.config,
            catalog_config,
            &request.config.source_locale,
        );
        let source_catalog = load_catalog(
            &source_path,
            &request.config.source_locale,
            &request.config.source_locale,
            catalog_config,
        )?;
        let source_messages = source_catalog
            .parsed_catalog()
            .messages
            .iter()
            .filter(|message| message.obsolete.is_none())
            .count();

        for locale in &request.locales {
            let Some(locale_coverage) = coverage.get_mut(locale) else {
                continue;
            };
            locale_coverage.total += source_messages;

            if locale == &request.config.source_locale {
                locale_coverage.translated += source_messages;
                continue;
            }

            let target_path = resolve_catalog_path(&request.config, catalog_config, locale);
            if !target_path.exists() {
                locale_coverage.missing += source_messages;
                continue;
            }
            let target_catalog = load_catalog(
                &target_path,
                &request.config.source_locale,
                locale,
                catalog_config,
            )?;
            let report = ferrocat_measure_catalog_coverage(
                &[&source_catalog, &target_catalog],
                &CatalogCoverageOptions::new(&request.config.source_locale),
            )
            .map_err(PalamedesError::from)?;
            let target = report
                .locales
                .iter()
                .find(|entry| entry.locale == *locale)
                .ok_or_else(|| {
                    ferrocat::ApiError::InvalidArguments(format!(
                        "measure_catalog_coverage did not return requested locale {locale:?}"
                    ))
                })
                .map_err(PalamedesError::from)?;
            locale_coverage.translated += target.translated;
            locale_coverage.missing += target.incomplete();
            locale_coverage.fuzzy += target.fuzzy();
        }
    }

    Ok(CatalogCoverageResult {
        locales: coverage
            .into_values()
            .map(|locale| CatalogLocaleCoverageResult {
                percent: if locale.total == 0 {
                    100.0
                } else {
                    (locale.translated as f64 / locale.total as f64) * 100.0
                },
                locale: locale.locale,
                total: locale.total,
                translated: locale.translated,
                missing: locale.missing,
                fuzzy: locale.fuzzy,
            })
            .collect(),
    })
}

fn load_catalog(
    path: &Path,
    source_locale: &str,
    locale: &str,
    catalog: &CatalogConfig,
) -> PalamedesResult<NormalizedParsedCatalog> {
    let content = fs::read_to_string(path).map_err(|source| PalamedesError::ReadFile {
        path: path.to_path_buf(),
        source,
    })?;
    parse_catalog_for_review(
        ferrocat::ParseCatalogOptions::new(&content, source_locale)
            .with_locale(locale)
            .with_mode(catalog.format.ferrocat_mode()),
    )
    .map_err(|source| PalamedesError::ParseCatalog {
        path: path.to_path_buf(),
        source,
    })
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{measure_catalog_coverage, CatalogCoverageRequest};
    use crate::{CatalogArtifactConfig, CatalogConfig, PalamedesCatalogFormat};

    #[test]
    fn classifies_fcl_fuzzy_and_missing_catalogs_as_incomplete() {
        let fixture = create_fixture_dir("catalog-coverage");
        let locale_dir = fixture.join("locales");
        fs::create_dir_all(&locale_dir).expect("locale dir");
        fs::write(
            locale_dir.join("en.fcl"),
            "%FCL1\tsource=en\nHello\t\tHello\n",
        )
        .expect("write source");
        fs::write(
            locale_dir.join("de.fcl"),
            "%FCL1\tsource=en\nHello\t\tHallo\tf=fuzzy\n",
        )
        .expect("write target");

        let result = measure_catalog_coverage(CatalogCoverageRequest {
            config: CatalogArtifactConfig {
                root_dir: fixture.to_string_lossy().into_owned(),
                locales: vec!["en".to_owned(), "de".to_owned(), "fr".to_owned()],
                source_locale: "en".to_owned(),
                fallback_locales: None,
                pseudo_locale: None,
                catalogs: vec![CatalogConfig {
                    path: "locales/{locale}".to_owned(),
                    format: PalamedesCatalogFormat::Fcl,
                }],
            },
            locales: vec!["de".to_owned(), "fr".to_owned()],
        })
        .expect("coverage");

        assert_eq!(result.locales[0].locale, "de");
        assert_eq!(result.locales[0].translated, 0);
        assert_eq!(result.locales[0].missing, 1);
        assert_eq!(result.locales[0].fuzzy, 1);
        assert_eq!(result.locales[1].locale, "fr");
        assert_eq!(result.locales[1].missing, 1);
        assert_eq!(result.locales[1].fuzzy, 0);
    }

    fn create_fixture_dir(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("palamedes-{label}-{}-{unique}", std::process::id()));
        fs::create_dir_all(&path).expect("fixture dir");
        path
    }
}
