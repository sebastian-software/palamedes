use std::path::PathBuf;

use ferrocat::{ConvertCatalogFileOptions, OrderBy};

use crate::error::{PalamedesError, PalamedesResult};
use crate::PalamedesCatalogFormat;

/// Request for converting one catalog file into another storage format.
#[derive(Debug)]
pub struct CatalogFileConvertRequest {
    /// Input catalog path.
    pub input_path: PathBuf,
    /// Output catalog path to replace atomically.
    pub output_path: PathBuf,
    /// Explicit source storage format.
    pub source_format: PalamedesCatalogFormat,
    /// Explicit target storage format.
    pub target_format: PalamedesCatalogFormat,
    /// Source locale used for catalog semantics and validation.
    pub source_locale: String,
    /// Optional expected catalog locale.
    pub locale: Option<String>,
}

/// Result returned by a catalog file conversion.
#[derive(Debug)]
pub struct CatalogFileConvertResult {
    /// Output path replaced by the operation.
    pub output_path: PathBuf,
    /// Number of converted messages, including obsolete entries.
    pub message_count: usize,
    /// Non-fatal diagnostics collected during conversion.
    pub diagnostics: Vec<ferrocat::Diagnostic>,
}

/// Converts a catalog file through Ferrocat's format-aware, atomic conversion
/// boundary.
///
/// Review metadata such as fuzzy flags and translator comments is preserved
/// when both formats can represent it.
///
/// # Errors
///
/// Returns an error when the input cannot be read or parsed, the requested
/// formats are incompatible, or the output cannot be replaced atomically.
pub fn convert_catalog_file(
    request: CatalogFileConvertRequest,
) -> PalamedesResult<CatalogFileConvertResult> {
    let mut options = ConvertCatalogFileOptions::new(
        &request.input_path,
        &request.output_path,
        &request.source_locale,
    )
    .with_source_format(request.source_format.into())
    .with_target_format(request.target_format.into())
    .with_order_by(OrderBy::Msgid);
    if let Some(locale) = request.locale.as_deref() {
        options = options.with_locale(locale);
    }

    let result = ferrocat::convert_catalog_file(options).map_err(PalamedesError::from)?;
    Ok(CatalogFileConvertResult {
        output_path: result.output_path,
        message_count: result.message_count,
        diagnostics: result.diagnostics,
    })
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{convert_catalog_file, CatalogFileConvertRequest};
    use crate::PalamedesCatalogFormat;

    #[test]
    fn converts_po_to_fcl_and_preserves_review_metadata() {
        let fixture = create_fixture_dir("catalog-convert");
        let input = fixture.join("de.po");
        let output = fixture.join("de.fcl");
        fs::write(
            &input,
            concat!(
                "msgid \"\"\n",
                "msgstr \"\"\n",
                "\"Language: de\\n\"\n\n",
                "# Translator note\n",
                "#, fuzzy\n",
                "msgid \"Hello\"\n",
                "msgstr \"Hallo\"\n",
            ),
        )
        .expect("write PO");

        let result = convert_catalog_file(CatalogFileConvertRequest {
            input_path: input,
            output_path: output.clone(),
            source_format: PalamedesCatalogFormat::Po,
            target_format: PalamedesCatalogFormat::Fcl,
            source_locale: "en".to_owned(),
            locale: Some("de".to_owned()),
        })
        .expect("convert");

        let converted = fs::read_to_string(&output).expect("read FCL");
        assert_eq!(result.message_count, 1);
        assert!(converted.starts_with("%FCL1"));
        assert!(converted.contains("tc=Translator note"));
        assert!(converted.contains("f=fuzzy"));
        assert!(converted.contains("Hallo"));
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
