use std::path::PathBuf;

use crate::error::PalamedesResult;

use super::types::{
    CatalogArtifactDiagnostic, CatalogArtifactMissingMessage, CatalogArtifactResult,
};

pub(super) fn build_artifact_result(
    mut artifact: ferrocat::CompiledCatalogArtifact,
    watch_files: Vec<PathBuf>,
    fallback_chain: Vec<String>,
    pseudo_locale: Option<&str>,
    locale: &str,
) -> PalamedesResult<CatalogArtifactResult> {
    if pseudo_locale == Some(locale) {
        for value in artifact.messages.values_mut() {
            *value = pseudolocalize_message(value);
        }
    }

    Ok(CatalogArtifactResult {
        messages: artifact.messages,
        watch_files: watch_files
            .into_iter()
            .map(|file| file.to_string_lossy().into_owned())
            .collect(),
        missing: artifact
            .missing
            .into_iter()
            .map(CatalogArtifactMissingMessage::from)
            .collect(),
        diagnostics: artifact
            .diagnostics
            .into_iter()
            .map(CatalogArtifactDiagnostic::from)
            .collect(),
        resolved_locale_chain: Some(fallback_chain),
    })
}

fn pseudolocalize_message(message: &str) -> String {
    message
        .chars()
        .map(|ch| match ch {
            'a' => 'á',
            'b' => 'ƀ',
            'c' => 'ç',
            'd' => 'ď',
            'e' => 'ē',
            'f' => 'ƒ',
            'g' => 'ğ',
            'h' => 'ħ',
            'i' => 'ī',
            'j' => 'ĵ',
            'k' => 'ķ',
            'l' => 'ľ',
            'm' => 'ɱ',
            'n' => 'ń',
            'o' => 'ō',
            'p' => 'ƥ',
            'q' => 'ʠ',
            'r' => 'ř',
            's' => 'ş',
            't' => 'ŧ',
            'u' => 'ū',
            'v' => 'ṽ',
            'w' => 'ŵ',
            'x' => 'ẋ',
            'y' => 'ŷ',
            'z' => 'ž',
            'A' => 'Å',
            'B' => 'ß',
            'C' => 'Ç',
            'D' => 'Đ',
            'E' => 'Ē',
            'F' => 'Ƒ',
            'G' => 'Ğ',
            'H' => 'Ħ',
            'I' => 'Ī',
            'J' => 'Ĵ',
            'K' => 'Ķ',
            'L' => 'Ŀ',
            'M' => 'Ṁ',
            'N' => 'Ń',
            'O' => 'Ø',
            'P' => 'Ƥ',
            'Q' => 'Ǫ',
            'R' => 'Ř',
            'S' => 'Š',
            'T' => 'Ŧ',
            'U' => 'Ū',
            'V' => 'Ṽ',
            'W' => 'Ŵ',
            'X' => 'Ẋ',
            'Y' => 'Ŷ',
            'Z' => 'Ž',
            other => other,
        })
        .collect()
}
