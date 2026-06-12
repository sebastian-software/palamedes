use std::path::PathBuf;

use ferrocat::{
    compare_icu_messages, parse_icu, CompiledCatalogArtifact, CompiledCatalogDiagnostic,
    DiagnosticSeverity, IcuCompatibilityOptions, IcuDiagnosticSeverity,
};

use super::types::{
    CatalogArtifactDiagnostic, CatalogArtifactMissingMessage, CatalogArtifactResult,
};

pub(super) fn align_diagnostics_with_runtime_icu_semantics(artifact: &mut CompiledCatalogArtifact) {
    let diagnostics = std::mem::take(&mut artifact.diagnostics);
    let mut aligned = Vec::with_capacity(diagnostics.len());
    let mut additional = Vec::new();

    for diagnostic in diagnostics {
        if diagnostic.code == "compile.invalid_icu_message" {
            if let Some(runtime_message) = artifact.messages.get(&diagnostic.key) {
                if parse_runtime_icu(runtime_message).is_some() {
                    if push_runtime_icu_compatibility_diagnostics(
                        &diagnostic,
                        runtime_message,
                        &mut additional,
                    ) {
                        continue;
                    }
                }
            }
        }

        aligned.push(diagnostic);
    }

    aligned.extend(additional);
    artifact.diagnostics = aligned;
}

pub(super) fn build_artifact_result(
    mut artifact: ferrocat::CompiledCatalogArtifact,
    watch_files: Vec<PathBuf>,
    fallback_chain: Vec<String>,
    pseudo_locale: Option<&str>,
    locale: &str,
) -> CatalogArtifactResult {
    if pseudo_locale == Some(locale) {
        for value in artifact.messages.values_mut() {
            *value = pseudolocalize_message(value);
        }
    }

    CatalogArtifactResult {
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
    }
}

fn push_runtime_icu_compatibility_diagnostics(
    diagnostic: &CompiledCatalogDiagnostic,
    runtime_message: &str,
    diagnostics: &mut Vec<CompiledCatalogDiagnostic>,
) -> bool {
    let Some(source_icu) = parse_runtime_icu(&diagnostic.msgid) else {
        return false;
    };
    let Some(runtime_icu) = parse_runtime_icu(runtime_message) else {
        return false;
    };

    let report = compare_icu_messages(
        &source_icu,
        &runtime_icu,
        &IcuCompatibilityOptions::default(),
    );
    for icu_diagnostic in report.diagnostics {
        diagnostics.push(CompiledCatalogDiagnostic {
            severity: runtime_icu_diagnostic_severity(icu_diagnostic.severity),
            code: icu_diagnostic.code,
            message: icu_diagnostic.message,
            key: diagnostic.key.clone(),
            msgid: diagnostic.msgid.clone(),
            msgctxt: diagnostic.msgctxt.clone(),
            locale: diagnostic.locale.clone(),
        });
    }

    true
}

fn parse_runtime_icu(message: &str) -> Option<ferrocat::IcuMessage> {
    parse_icu(&runtime_icu_validation_view(message)).ok()
}

fn runtime_icu_validation_view(message: &str) -> String {
    message.replace('\'', "''")
}

const fn runtime_icu_diagnostic_severity(severity: IcuDiagnosticSeverity) -> DiagnosticSeverity {
    match severity {
        IcuDiagnosticSeverity::Info => DiagnosticSeverity::Info,
        IcuDiagnosticSeverity::Warning => DiagnosticSeverity::Warning,
        IcuDiagnosticSeverity::Error => DiagnosticSeverity::Error,
    }
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
