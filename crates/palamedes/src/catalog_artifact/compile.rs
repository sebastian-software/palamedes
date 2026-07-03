use std::path::PathBuf;

use ferrocat::{
    pseudolocalize_compiled_catalog_artifact, CompileCatalogArtifactIcuOptions,
    CompiledCatalogPseudolocalizationOptions, IcuArgumentKind, IcuDiagnosticSeverity, IcuFormatter,
    IcuFormatterSupport, IcuPseudolocalizationOptions, IcuSyntaxPolicy,
};

use crate::error::{PalamedesError, PalamedesResult};

use super::types::{
    CatalogArtifactDiagnostic, CatalogArtifactMissingMessage, CatalogArtifactResult,
};

pub(super) fn runtime_icu_options() -> CompileCatalogArtifactIcuOptions {
    CompileCatalogArtifactIcuOptions::new()
        .with_syntax_policy(IcuSyntaxPolicy::RuntimeLiteralApostrophes)
        .with_formatter_support(runtime_icu_formatter_support)
}

pub(super) fn build_artifact_result(
    artifact: ferrocat::CompiledCatalogArtifact,
    watch_files: Vec<PathBuf>,
    fallback_chain: Vec<String>,
    pseudo_locale: Option<&str>,
    locale: &str,
) -> PalamedesResult<CatalogArtifactResult> {
    let artifact = if pseudo_locale == Some(locale) {
        let options = CompiledCatalogPseudolocalizationOptions::new()
            .with_icu_options(IcuPseudolocalizationOptions::new())
            .with_syntax_policy(IcuSyntaxPolicy::RuntimeLiteralApostrophes);
        pseudolocalize_compiled_catalog_artifact(&artifact, &options)
            .map_err(PalamedesError::PseudolocalizeCatalogArtifact)?
    } else {
        artifact
    };

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
