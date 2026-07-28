//! The single error type every command reports failures through.

use std::path::PathBuf;

use thiserror::Error;

use crate::config::ConfigError;

#[derive(Debug, Error)]
pub enum CliError {
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
    #[error("Catalog convert requires either an input file or --config.")]
    MissingConvertInput,
    #[error("Catalog convert --output can only be used with a single input file.")]
    InvalidConvertOutput,
    #[error("Catalog convert --to=fcl only supports PO source catalogs.")]
    UnsupportedConvertSource,
    #[error("Catalog convert refused {path} because fuzzy PO entries are not supported for FCL conversion.")]
    FuzzyCatalogInput { path: PathBuf },
    #[error("Invalid --fail-if-below value. Expected a percent from 0 to 100.")]
    InvalidThreshold,
    #[error("Catalog audit failed with {errors} error(s).")]
    AuditFailedOnError { errors: usize },
    #[error("Catalog audit failed with {errors} error(s) and {warnings} warning(s).")]
    AuditFailedOnWarning { errors: usize, warnings: usize },
    #[error("Catalog completeness below {threshold} for {locales}.")]
    CompletenessBelowThreshold { threshold: String, locales: String },
    #[error("Extraction failed for {failures} source file(s); catalogs were not updated.")]
    ExtractionFailed { failures: usize },
    #[error("Could not build glob pattern {pattern}: {source}")]
    GlobPattern {
        pattern: String,
        #[source]
        source: globset::Error,
    },
    #[error("Could not watch source files: {0}")]
    Watch(#[from] notify::Error),
}
