use std::collections::BTreeMap;
use std::path::PathBuf;

use ferrocat::{
    compare_icu_messages, validate_icu_formatter_support, CompiledCatalogArtifact,
    CompiledCatalogDiagnostic, CompiledCatalogIdIndex, DiagnosticSeverity, IcuArgumentKind,
    IcuCompatibilityOptions, IcuDiagnosticSeverity, IcuFormatter, IcuFormatterSupport,
};

use crate::runtime_icu::parse_runtime_icu;

use super::types::{
    CatalogArtifactDiagnostic, CatalogArtifactMissingMessage, CatalogArtifactResult,
};

pub(super) fn align_diagnostics_with_runtime_icu_semantics(
    artifact: &mut CompiledCatalogArtifact,
    compiled_id_index: &CompiledCatalogIdIndex,
    requested_locale: &str,
) {
    let runtime_message_locales = runtime_message_locales(artifact, requested_locale);
    let diagnostics = std::mem::take(&mut artifact.diagnostics);
    let mut aligned = Vec::with_capacity(diagnostics.len());
    let mut additional = Vec::new();

    for diagnostic in diagnostics {
        if diagnostic.code == "compile.invalid_icu_message" {
            if let Some(runtime_message) = artifact.messages.get(&diagnostic.key) {
                if parse_runtime_icu(runtime_message).is_some()
                    && push_runtime_icu_compatibility_diagnostics(
                        &diagnostic,
                        runtime_message,
                        &mut additional,
                    )
                {
                    continue;
                }
            }
        }

        aligned.push(diagnostic);
    }

    aligned.extend(additional);
    artifact.diagnostics = aligned;
    push_runtime_icu_formatter_support_diagnostics(
        artifact,
        compiled_id_index,
        &runtime_message_locales,
        requested_locale,
    );
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

fn push_runtime_icu_formatter_support_diagnostics(
    artifact: &mut CompiledCatalogArtifact,
    compiled_id_index: &CompiledCatalogIdIndex,
    runtime_message_locales: &BTreeMap<String, String>,
    requested_locale: &str,
) {
    for (compiled_id, runtime_message) in &artifact.messages {
        let Some(source_key) = compiled_id_index.get(compiled_id) else {
            continue;
        };
        let Some(runtime_icu) = parse_runtime_icu(runtime_message) else {
            continue;
        };

        let report = validate_icu_formatter_support(&runtime_icu, runtime_icu_formatter_support);
        let locale = runtime_message_locales
            .get(compiled_id)
            .map(String::as_str)
            .unwrap_or(requested_locale);

        for icu_diagnostic in report.diagnostics {
            artifact.diagnostics.push(CompiledCatalogDiagnostic {
                severity: runtime_icu_diagnostic_severity(icu_diagnostic.severity),
                code: icu_diagnostic.code,
                message: icu_diagnostic.message,
                key: compiled_id.clone(),
                msgid: source_key.msgid.clone(),
                msgctxt: source_key.msgctxt.clone(),
                locale: locale.to_owned(),
            });
        }
    }
}

fn runtime_message_locales(
    artifact: &CompiledCatalogArtifact,
    requested_locale: &str,
) -> BTreeMap<String, String> {
    artifact
        .missing
        .iter()
        .map(|missing| {
            (
                missing.key.clone(),
                missing
                    .resolved_locale
                    .clone()
                    .unwrap_or_else(|| requested_locale.to_owned()),
            )
        })
        .collect()
}

fn runtime_icu_formatter_support(formatter: &IcuFormatter) -> IcuFormatterSupport {
    match formatter.kind {
        IcuArgumentKind::Number => runtime_icu_style_support(is_supported_runtime_number_style(
            formatter.style.as_deref(),
        )),
        IcuArgumentKind::Date | IcuArgumentKind::Time => runtime_icu_style_support(
            is_supported_runtime_date_time_style(formatter.style.as_deref()),
        ),
        _ => IcuFormatterSupport::UnsupportedKind {
            severity: IcuDiagnosticSeverity::Error,
        },
    }
}

const fn runtime_icu_style_support(supported: bool) -> IcuFormatterSupport {
    if supported {
        IcuFormatterSupport::Supported
    } else {
        IcuFormatterSupport::UnsupportedStyle {
            severity: IcuDiagnosticSeverity::Warning,
        }
    }
}

fn is_supported_runtime_number_style(style: Option<&str>) -> bool {
    let Some(style) = style.map(str::trim).filter(|style| !style.is_empty()) else {
        return true;
    };

    if let Some(skeleton) = style.strip_prefix("::") {
        return matches!(skeleton, "percent" | "integer") || supported_currency_skeleton(skeleton);
    }

    matches!(style, "percent" | "integer")
}

fn supported_currency_skeleton(style: &str) -> bool {
    let Some(currency) = style.strip_prefix("currency/") else {
        return false;
    };

    currency.len() == 3 && currency.bytes().all(|byte| byte.is_ascii_alphabetic())
}

fn is_supported_runtime_date_time_style(style: Option<&str>) -> bool {
    let Some(style) = style.map(str::trim).filter(|style| !style.is_empty()) else {
        return true;
    };

    matches!(style, "short" | "medium" | "long" | "full")
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
