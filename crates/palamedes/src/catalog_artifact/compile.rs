use std::path::PathBuf;

use ferrocat::{
    CompileCatalogArtifactIcuOptions, IcuArgumentKind, IcuDiagnosticSeverity, IcuFormatter,
    IcuFormatterSupport, IcuSyntaxPolicy,
};

use super::types::{
    CatalogArtifactDiagnostic, CatalogArtifactMissingMessage, CatalogArtifactResult,
};

pub(super) fn runtime_icu_options() -> CompileCatalogArtifactIcuOptions {
    CompileCatalogArtifactIcuOptions::new()
        .with_syntax_policy(IcuSyntaxPolicy::RuntimeLiteralApostrophes)
        .with_formatter_support(runtime_icu_formatter_support)
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
