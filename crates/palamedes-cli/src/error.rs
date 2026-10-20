//! The single error type every command reports failures through.

use std::path::PathBuf;

use thiserror::Error;

use crate::config::ConfigError;

/// Exit status used when `extract --check` finds catalog drift.
pub const CATALOG_DRIFT_EXIT_CODE: u8 = 3;
/// Exit status used when `lint` completes analysis but its requested threshold fails.
pub const LINT_VERDICT_EXIT_CODE: u8 = 4;
/// Exit status used when `audit` completes but its requested threshold fails.
pub const AUDIT_VERDICT_EXIT_CODE: u8 = 5;
/// Exit status used when `report` completes but a completeness threshold fails.
pub const REPORT_VERDICT_EXIT_CODE: u8 = 6;

#[derive(Debug, Error)]
pub enum CliError {
    #[error("Could not compile Rust language catalogs: {message}")]
    CatalogCompilation { message: String },
    #[error("Could not compile JavaScript catalog modules: {message}")]
    JsCatalogCompilation { message: String },
    #[error(transparent)]
    Config(#[from] ConfigError),
    #[error(transparent)]
    Core(#[from] palamedes::PalamedesError),
    #[error("I/O error for {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("Could not serialize JSON output: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Could not determine the current directory: {0}")]
    CurrentDir(#[source] std::io::Error),
    #[error("Catalog merge requires exactly two input files, received {0}.")]
    InvalidMergeInputCount(usize),
    #[error(
        "Could not infer catalog merge format from logical --path `{path}` or merge paths ({paths}). Git supplies extensionless temporary files for %O, %A, and %B; pass --format po or --format fcl."
    )]
    MergeFormatInference { path: PathBuf, paths: String },
    #[error("Catalog convert requires either an input file or --config.")]
    MissingConvertInput,
    #[error("Catalog convert --output can only be used with a single input file.")]
    InvalidConvertOutput,
    #[error("Catalog convert --to=fcl only supports PO source catalogs.")]
    UnsupportedConvertSource,
    #[error("Invalid --fail-if-below value. Expected a percent from 0 to 100.")]
    InvalidThreshold,
    #[error("Catalog audit failed (errors: {errors}).")]
    AuditFailedOnError { errors: usize },
    #[error("Catalog audit failed (errors: {errors}, warnings: {warnings}).")]
    AuditFailedOnWarning { errors: usize, warnings: usize },
    #[error(
        "Catalog audit failed (errors: {errors}, warnings: {warnings}, info diagnostics: {infos})."
    )]
    AuditFailedOnInfo {
        errors: usize,
        warnings: usize,
        infos: usize,
    },
    #[error("Catalog completeness below {threshold} for {locales}.")]
    CompletenessBelowThreshold { threshold: String, locales: String },
    #[error("Extraction failed (source files: {failures}); catalogs were not updated.")]
    ExtractionFailed { failures: usize },
    #[error(
        "Catalog '{catalog}' matched no source files (include: {include}); catalogs were not updated. Fix the include patterns or omit --fail-on-empty-catalog to keep warning-only behavior."
    )]
    EmptyCatalogSources { catalog: String, include: String },
    #[error("Catalog extraction check found drift (catalog files: {catalogs}).")]
    CatalogDrift { catalogs: usize },
    #[error("{message}")]
    ExtractionCheckFailed { message: String },
    #[error("Source lint failed (error diagnostics: {errors}).")]
    LintFailedOnError { errors: usize },
    #[error("Source lint failed (errors: {errors}, warnings: {warnings}).")]
    LintFailedOnWarning { errors: usize, warnings: usize },
    #[error("Source lint could not analyze source files (count: {failures}).")]
    LintAnalysisFailed { failures: usize },
    #[error("Could not build glob pattern {pattern}: {source}")]
    GlobPattern {
        pattern: String,
        #[source]
        source: globset::Error,
    },
    /// A catalog pattern the source walker refuses, which is a config problem
    /// and not a walk failure: an exclude anchored above the walk root, or a
    /// pattern containing `..`.
    #[error("Could not use {pattern} for source discovery: {source}")]
    DiscoveryPattern {
        pattern: String,
        #[source]
        source: ferralk::ferralk_glob::PatternError,
    },
    #[error("Could not discover source files: {0}")]
    Discovery(#[from] ferralk::WalkError),
    #[error("Could not watch source files: {0}")]
    Watch(#[from] notify::Error),
}

impl CliError {
    /// Human output only; Display remains stable for structured diagnostics.
    pub fn localized(&self) -> String {
        match self {
            Self::CatalogCompilation { message } => tr!(
                "Could not compile Rust language catalogs: {source}",
                source = message
            ),
            Self::JsCatalogCompilation { message } => tr!(
                "Could not compile JavaScript catalog modules: {source}",
                source = message
            ),
            Self::Config(error) => error.localized(),
            Self::Io { path, source } => tr!(
                "I/O error for {path}: {source}",
                path = path.display(),
                source = source
            ),
            Self::Json(source) => tr!("Could not serialize JSON output: {source}", source = source),
            Self::CurrentDir(source) => tr!(
                "Could not determine the current directory: {source}",
                source = source
            ),
            Self::InvalidMergeInputCount(count) => tr!(
                "Catalog merge requires exactly two input files, received {count}.",
                count = count
            ),
            Self::MissingConvertInput => {
                tr!("Catalog convert requires either an input file or --config.").to_owned()
            }
            Self::InvalidConvertOutput => {
                tr!("Catalog convert --output can only be used with a single input file.")
                    .to_owned()
            }
            Self::UnsupportedConvertSource => {
                tr!("Catalog convert --to=fcl only supports PO source catalogs.").to_owned()
            }
            Self::InvalidThreshold => {
                tr!("Invalid --fail-if-below value. Expected a percent from 0 to 100.").to_owned()
            }
            Self::AuditFailedOnError { errors } => tr!(
                "Catalog audit failed with {errors, plural, one {# error} other {# errors}}.",
                errors = errors
            ),
            Self::AuditFailedOnWarning { errors, warnings } => tr!(
                "Catalog audit failed with {errors, plural, one {# error} other {# errors}} and {warnings, plural, one {# warning} other {# warnings}}.",
                errors = errors,
                warnings = warnings
            ),
            Self::AuditFailedOnInfo {
                errors,
                warnings,
                infos,
            } => tr!(
                "Catalog audit failed with {errors, plural, one {# error} other {# errors}}, {warnings, plural, one {# warning} other {# warnings}}, and {infos, plural, one {# info message} other {# info messages}}.",
                errors = errors,
                infos = infos,
                warnings = warnings
            ),
            Self::CompletenessBelowThreshold { threshold, locales } => tr!(
                "Catalog completeness below {threshold} for {locales}.",
                locales = locales,
                threshold = threshold
            ),
            Self::ExtractionFailed { failures } => tr!(
                "Extraction failed for {failures, plural, one {# source file} other {# source files}}; catalogs were not updated.",
                failures = failures
            ),
            Self::CatalogDrift { catalogs } => tr!(
                "Catalog extraction check found drift in {catalogs, plural, one {# catalog file} other {# catalog files}}.",
                catalogs = catalogs
            ),
            Self::LintFailedOnError { errors } => tr!(
                "Source lint failed with {errors, plural, one {# error diagnostic} other {# error diagnostics}}.",
                errors = errors
            ),
            Self::LintFailedOnWarning { errors, warnings } => tr!(
                "Source lint failed with {errors, plural, one {# error} other {# errors}} and {warnings, plural, one {# warning} other {# warnings}}.",
                errors = errors,
                warnings = warnings
            ),
            Self::LintAnalysisFailed { failures } => tr!(
                "Source lint could not analyze {failures, plural, one {# source file} other {# source files}}.",
                failures = failures
            ),
            Self::GlobPattern { pattern, source } => tr!(
                "Could not build glob pattern {pattern}: {source}",
                pattern = pattern,
                source = source
            ),
            Self::DiscoveryPattern { pattern, source } => tr!(
                "Could not use {pattern} for source discovery: {source}",
                pattern = pattern,
                source = source
            ),
            Self::Discovery(source) => {
                tr!("Could not discover source files: {source}", source = source)
            }
            Self::Watch(source) => tr!("Could not watch source files: {source}", source = source),
            Self::ExtractionCheckFailed { message } => tr!(
                "Catalog extraction check failed: {message}",
                message = message
            ),
            Self::MergeFormatInference { path, paths } => tr!(
                "Could not infer catalog merge format from logical --path `{path}` or merge paths ({paths}). Git supplies extensionless temporary files for %O, %A, and %B; pass --format po or --format fcl.",
                path = path.display(),
                paths = paths
            ),
            Self::EmptyCatalogSources { catalog, include } => tr!(
                "Catalog {catalog} matched no source files (include: {include}); catalogs were not updated. Fix the include patterns or omit --fail-on-empty-catalog to keep warning-only behavior.",
                catalog = format!("'{catalog}'"),
                include = include
            ),
            // Core, OS, third-party, and already-rendered check diagnostics retain
            // their original technical detail, codes, and source snippets.
            Self::Core(error) => error.to_string(),
        }
    }

    /// Process status for this failure.
    pub fn exit_code(&self) -> u8 {
        match self {
            Self::CatalogDrift { .. } => CATALOG_DRIFT_EXIT_CODE,
            Self::LintFailedOnError { .. }
            | Self::LintFailedOnWarning { .. }
            | Self::LintAnalysisFailed { .. } => LINT_VERDICT_EXIT_CODE,
            Self::AuditFailedOnError { .. }
            | Self::AuditFailedOnWarning { .. }
            | Self::AuditFailedOnInfo { .. } => AUDIT_VERDICT_EXIT_CODE,
            Self::CompletenessBelowThreshold { .. } => REPORT_VERDICT_EXIT_CODE,
            _ => 1,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        AUDIT_VERDICT_EXIT_CODE, CATALOG_DRIFT_EXIT_CODE, CliError, LINT_VERDICT_EXIT_CODE,
        REPORT_VERDICT_EXIT_CODE,
    };

    #[test]
    fn completed_command_verdicts_keep_their_dedicated_exit_codes() {
        assert_eq!(
            CliError::CatalogDrift { catalogs: 1 }.exit_code(),
            CATALOG_DRIFT_EXIT_CODE
        );
        assert_eq!(
            CliError::LintFailedOnError { errors: 1 }.exit_code(),
            LINT_VERDICT_EXIT_CODE
        );
        assert_eq!(
            CliError::AuditFailedOnError { errors: 1 }.exit_code(),
            AUDIT_VERDICT_EXIT_CODE
        );
        assert_eq!(
            CliError::AuditFailedOnWarning {
                errors: 0,
                warnings: 1,
            }
            .exit_code(),
            AUDIT_VERDICT_EXIT_CODE
        );
        assert_eq!(
            CliError::AuditFailedOnInfo {
                errors: 0,
                warnings: 0,
                infos: 1,
            }
            .exit_code(),
            AUDIT_VERDICT_EXIT_CODE
        );
        assert_eq!(
            CliError::CompletenessBelowThreshold {
                threshold: "95%".to_owned(),
                locales: "de (50%)".to_owned(),
            }
            .exit_code(),
            REPORT_VERDICT_EXIT_CODE
        );
    }
}
