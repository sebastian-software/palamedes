//! `pmds extract` — read source files, update catalogs.

pub(crate) mod cache;
pub(crate) mod sources;
impl ExtractOptions {
    pub(crate) fn telemetry_config(&self) -> Option<&std::path::Path> {
        self.config.as_deref()
    }
}

#[cfg(test)]
mod test_support;
mod watch;

use std::collections::{BTreeMap, HashMap, HashSet};
use std::ffi::{OsStr, OsString};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use clap::Args;
use palamedes::{
    CatalogUpdateMessage, CatalogUpdateRequestRef, ContainedDir, ContainedFsError,
    ContainedNewFileMode, ContainedWriteDurability, DirFilenameEquivalence, ExtractCache,
    ExtractCatalogFileFailure, FileIdentity, SourceFileAnalysisRequest,
    collect_runtime_macro_manifest, extract_catalog_messages_cached,
    preview_catalog_update_from_content_ref, split_relative_catalog_path,
};
use serde::Serialize;
use unicode_normalization::UnicodeNormalization;

use crate::command::{Command, Context, VersionedJson, render_json};
use crate::config::{ConfigCatalog, LoadedConfig};
use crate::error::CliError;
use cache::{load_extract_cache, persist_extract_cache};
use sources::{collect_source_files, sort_and_dedupe_paths};
use watch::run_watch_mode;

/// Prefix the benchmark harness looks for when `PALAMEDES_TIMING_JSON=1`
/// turns on the machine-readable timing line.
const TIMING_MARKER: &str = "__PALAMEDES_TIMINGS__";

/// Version of the `pmds extract --check --json` document shape (`schemaVersion`).
const EXTRACT_CHECK_JSON_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Args)]
pub struct ExtractOptions {
    #[arg(help = tr!("Path to a Palamedes config file."))]
    #[arg(short, long)]
    config: Option<PathBuf>,
    #[arg(help = tr!("Watch for file changes."))]
    #[arg(short, long)]
    watch: bool,
    #[arg(help = tr!("Verify that extraction would leave every configured catalog unchanged."))]
    #[arg(long, conflicts_with = "watch")]
    check: bool,
    #[arg(help = tr!("Print the extraction check as one JSON document."))]
    #[arg(long, requires = "check")]
    json: bool,
    #[arg(help = tr!("Fail before updating catalogs when any catalog matches no source files."))]
    #[arg(long)]
    fail_on_empty_catalog: bool,
    #[arg(help = tr!("Remove obsolete messages whose obsolete-since marker is older than the 30-day grace period; undated entries are kept (use --force-clean to remove everything immediately)."))]
    #[arg(long)]
    clean: bool,
    #[arg(help = tr!("Remove obsolete messages immediately, including entries without obsolete-since."))]
    #[arg(long)]
    force_clean: bool,
    #[arg(help = tr!("Worker threads for the parallel extraction pass. Overrides `extract-threads` in the config file; 1 forces serial extraction."))]
    #[arg(long, value_name = "COUNT")]
    threads: Option<usize>,
    #[arg(help = tr!("Ignore and do not write the extraction cache."))]
    #[arg(long)]
    no_cache: bool,
    #[arg(help = tr!("Also write the runtime macro manifest for code that runs without a bundler, relative to the config file."))]
    #[arg(long, value_name = "PATH")]
    runtime_manifest: Option<PathBuf>,
    #[arg(help = tr!("Show verbose output."))]
    #[arg(short, long)]
    verbose: bool,
}

impl Command for ExtractOptions {
    type Output = ExtractOutput;

    fn run(&self, context: &Context) -> Result<Self::Output, CliError> {
        let result = self.run_configured(context);
        if self.check {
            return match result {
                Ok(output) => Ok(output),
                Err(error) => Ok(ExtractOutput::Check(ExtractCheckReport::error(
                    error.to_string(),
                ))),
            };
        }
        result
    }

    fn render(&self, output: &Self::Output) -> Result<(), CliError> {
        let ExtractOutput::Check(report) = output else {
            return Ok(());
        };
        if self.json {
            return render_json(&VersionedJson::new(
                EXTRACT_CHECK_JSON_SCHEMA_VERSION,
                report,
            ));
        }
        report.render_human();
        Ok(())
    }

    fn verdict(&self, output: &Self::Output) -> Result<(), CliError> {
        let ExtractOutput::Check(report) = output else {
            return Ok(());
        };
        match report.status {
            ExtractCheckStatus::Clean => Ok(()),
            ExtractCheckStatus::Drift => Err(CliError::CatalogDrift {
                catalogs: report.catalogs.len(),
            }),
            ExtractCheckStatus::Error => Err(CliError::ExtractionCheckFailed {
                message: report
                    .error
                    .as_ref()
                    .map(|error| error.message.clone())
                    .unwrap_or_else(|| "Catalog extraction check failed.".to_owned()),
            }),
        }
    }
}

impl ExtractOptions {
    fn run_configured(&self, context: &Context) -> Result<ExtractOutput, CliError> {
        let config = context.load_config(self.config.as_deref())?;
        if self.verbose {
            eprintln!(
                "{}",
                tr!(
                    "Config loaded from {path}",
                    path = config.config_path.display()
                )
            );
        }

        if self.watch {
            run_watch_mode(&config, self)?;
            Ok(ExtractOutput::Completed)
        } else {
            run_extraction(&config, self)
        }
    }
}

#[derive(Debug)]
pub enum ExtractOutput {
    Completed,
    Check(ExtractCheckReport),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum ExtractCheckStatus {
    Clean,
    Drift,
    Error,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractCheckReport {
    status: ExtractCheckStatus,
    catalogs: Vec<CatalogDrift>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<ExtractCheckError>,
}

impl ExtractCheckReport {
    fn from_catalogs(mut catalogs: Vec<CatalogDrift>) -> Self {
        catalogs.sort();
        Self {
            status: if catalogs.is_empty() {
                ExtractCheckStatus::Clean
            } else {
                ExtractCheckStatus::Drift
            },
            catalogs,
            error: None,
        }
    }

    fn error(message: String) -> Self {
        Self {
            status: ExtractCheckStatus::Error,
            catalogs: Vec::new(),
            error: Some(ExtractCheckError { message }),
        }
    }

    fn render_human(&self) {
        match self.status {
            ExtractCheckStatus::Clean => println!("{}", tr!("✓ Catalogs are up to date.")),
            ExtractCheckStatus::Drift => {
                println!("{}", tr!("Catalog drift detected:"));
                for catalog in &self.catalogs {
                    println!("  {} {}", catalog.change.human_verb(), catalog.path);
                }
            }
            ExtractCheckStatus::Error => {}
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExtractCheckError {
    message: String,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
struct CatalogDrift {
    path: String,
    change: CatalogChangeKind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
enum CatalogChangeKind {
    Created,
    Modified,
}

impl CatalogChangeKind {
    fn human_verb(self) -> &'static str {
        match self {
            Self::Created => tr!("create"),
            Self::Modified => tr!("modify"),
        }
    }
}

#[derive(Debug)]
struct CatalogExtractionResult {
    messages: Vec<CatalogUpdateMessage>,
    files: Vec<PathBuf>,
    failed_files: Vec<ExtractCatalogFileFailure>,
    glob_ms: u128,
    extract_ms: u128,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TimingReport {
    engine: &'static str,
    total_ms: u128,
    glob_ms: u128,
    extract_ms: u128,
    write_ms: u128,
    total_messages: usize,
    total_files: usize,
}

fn run_extraction(
    config: &LoadedConfig,
    options: &ExtractOptions,
) -> Result<ExtractOutput, CliError> {
    let mut cache = load_extract_cache(config, options.no_cache);
    let result = run_extraction_with_cache(config, options, &mut cache);
    persist_extract_cache(config, &mut cache);
    result
}

fn run_extraction_with_cache(
    config: &LoadedConfig,
    options: &ExtractOptions,
    cache: &mut ExtractCache,
) -> Result<ExtractOutput, CliError> {
    let started_at = Instant::now();
    let mut total_glob_ms = 0;
    let mut total_extract_ms = 0;
    let mut total_messages = 0;
    // Failures from overlapping catalogs must be reported and counted once,
    // not once per catalog that matched the file.
    let mut unique_failures = BTreeMap::<String, String>::new();
    let mut results = Vec::with_capacity(config.catalogs.len());

    for catalog in &config.catalogs {
        let result = extract_from_catalog(catalog, config, options, cache)?;
        total_glob_ms += result.glob_ms;
        total_extract_ms += result.extract_ms;
        total_messages += result.messages.len();
        for failure in &result.failed_files {
            unique_failures
                .entry(failure.path.clone())
                .or_insert_with(|| failure.message.clone());
        }
        results.push(result);
    }

    /*
     * Catalogs may match overlapping file sets; count each source file once.
     * Every per-catalog list arrives sorted and deduped from
     * collect_source_files, so the common single-catalog configuration needs
     * no second pass at all.
     */
    let unique_files: Vec<&Path> = if results.len() == 1 {
        results[0].files.iter().map(PathBuf::as_path).collect()
    } else {
        let mut merged: Vec<&Path> = results
            .iter()
            .flat_map(|result| result.files.iter().map(PathBuf::as_path))
            .collect();
        sort_and_dedupe_paths(&mut merged);
        merged
    };
    let total_files = unique_files.len();

    for (path, message) in &unique_failures {
        eprintln!(
            "{}",
            tr!(
                "Warning: Failed to extract from {path}: {message}",
                message = message,
                path = path
            )
        );
    }
    let total_failed_files = unique_failures.len();

    /*
     * Retention runs once over every catalog's files. Doing it per catalog would
     * make each catalog evict the entries belonging to its siblings, so a
     * multi-catalog project would re-extract almost everything on every run.
     */
    cache.retain_paths(
        &unique_files
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .iter()
            .map(String::as_str)
            .collect(),
    );

    if total_failed_files > 0 {
        return Err(CliError::ExtractionFailed {
            failures: total_failed_files,
        });
    }

    let write_started_at = Instant::now();
    let mut write_jobs = Vec::with_capacity(config.catalogs.len() * config.locales.len());
    for (catalog, result) in config.catalogs.iter().zip(&results) {
        for locale in &config.locales {
            write_jobs.push((catalog, &result.messages, locale.as_str()));
        }
    }
    let operation = if options.check {
        CatalogOperation::Preview
    } else {
        CatalogOperation::Write
    };
    let drift = process_catalogs(&write_jobs, config, options, operation)?;
    if let Some(manifest_path) = &options.runtime_manifest {
        write_runtime_manifest(config, manifest_path, &unique_files, options.check)?;
    }
    let total_write_ms = write_started_at.elapsed().as_millis();

    if options.check {
        return Ok(ExtractOutput::Check(ExtractCheckReport::from_catalogs(
            drift,
        )));
    }

    let total_ms = started_at.elapsed().as_millis();
    println!(
        "{}",
        tr!(
            "✓ Extracted {messages, plural, one {# message} other {# messages}} from {files, plural, one {# file} other {# files}} ({milliseconds}ms)",
            files = total_files,
            messages = total_messages,
            milliseconds = total_ms
        )
    );

    if std::env::var("PALAMEDES_TIMING_JSON").ok().as_deref() == Some("1") {
        let report = TimingReport {
            engine: "ferrocat",
            total_ms,
            glob_ms: total_glob_ms,
            extract_ms: total_extract_ms,
            write_ms: total_write_ms,
            total_messages,
            total_files,
        };
        println!("{TIMING_MARKER}{}", serde_json::to_string(&report)?);
    }

    Ok(ExtractOutput::Completed)
}

/// Writes the runtime macro manifest (ADR-006), or verifies it under `--check`.
fn write_runtime_manifest(
    config: &LoadedConfig,
    manifest_path: &Path,
    files: &[&Path],
    check: bool,
) -> Result<(), CliError> {
    let requests = files
        .iter()
        .map(|path| SourceFileAnalysisRequest {
            path: path.to_string_lossy().into_owned(),
            filename: path
                .strip_prefix(&config.root_dir)
                .unwrap_or(path)
                .to_string_lossy()
                .replace('\\', "/"),
        })
        .collect::<Vec<_>>();
    let manifest = collect_runtime_macro_manifest(&requests)?;
    let contents = format!("{}\n", serde_json::to_string_pretty(&manifest)?);
    let target = config.root_dir.join(manifest_path);
    let current = fs::read_to_string(&target).ok();
    if current.as_deref() == Some(contents.as_str()) {
        return Ok(());
    }
    if check {
        return Err(CliError::ExtractionCheckFailed {
            message: tr!(
                "The runtime macro manifest {path} is out of date. Run pmds extract without --check.",
                path = manifest_path.display()
            ),
        });
    }
    let write_target = match fs::symlink_metadata(&target) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            let resolved = fs::canonicalize(&target).map_err(|source| CliError::Io {
                path: target.clone(),
                source,
            })?;
            let resolved_metadata = fs::metadata(&resolved).map_err(|source| CliError::Io {
                path: resolved.clone(),
                source,
            })?;
            if !resolved_metadata.is_file() {
                return Err(CliError::Io {
                    path: target,
                    source: std::io::Error::new(
                        std::io::ErrorKind::InvalidInput,
                        "runtime manifest symlink target must be a regular file",
                    ),
                });
            }
            resolved
        }
        _ => target.clone(),
    };
    if let Some(parent) = write_target.parent() {
        fs::create_dir_all(parent).map_err(|source| CliError::Io {
            path: parent.to_path_buf(),
            source,
        })?;
    }
    palamedes::atomic_write_file(&write_target, contents.as_bytes()).map_err(|source| {
        CliError::Io {
            path: target.clone(),
            source,
        }
    })
}

fn extract_from_catalog(
    catalog: &ConfigCatalog,
    config: &LoadedConfig,
    options: &ExtractOptions,
    cache: &mut ExtractCache,
) -> Result<CatalogExtractionResult, CliError> {
    let verbose = options.verbose;
    let glob_started_at = Instant::now();
    let files = collect_source_files(catalog, config)?;
    let glob_ms = glob_started_at.elapsed().as_millis();

    if verbose {
        eprintln!(
            "{}",
            tr!(
                "Found {files, plural, one {# file} other {# files}} to extract from",
                files = files.len()
            )
        );
    }

    if files.is_empty() {
        if options.fail_on_empty_catalog {
            return Err(CliError::EmptyCatalogSources {
                catalog: catalog.path.clone(),
                include: catalog.include.join(", "),
            });
        }
        eprintln!(
            "{}",
            tr!(
                "Warning: catalog {catalog} matched no source files (include: {include}); projecting an empty catalog.",
                catalog = format!("'{}'", catalog.path),
                include = catalog.include.join(", ")
            )
        );
    }

    let extract_started_at = Instant::now();
    let result = extract_catalog_messages_cached(
        palamedes::ExtractCatalogMessagesRequest {
            root_dir: config.source_reference_root.to_string_lossy().into_owned(),
            files: files
                .iter()
                .map(|path| path.to_string_lossy().into_owned())
                .collect(),
            // --threads wins over the config file; both fall back to the core default.
            max_threads: options.threads.or(config.extract_threads),
        },
        config.analysis_options(),
        cache,
    )?;
    let extract_ms = extract_started_at.elapsed().as_millis();

    // Failures are reported by the caller, which sees every catalog and can
    // therefore report a file shared by overlapping catalogs exactly once.
    Ok(CatalogExtractionResult {
        messages: result.messages,
        files,
        failed_files: result.failed_files,
        glob_ms,
        extract_ms,
    })
}

/*
 * Each (catalog, locale) projection is independent work against a distinct
 * target file, so writes and previews run concurrently. That overlaps the
 * CPU-bound parse/merge/serialize work in ferrocat across locales and — for
 * writes on macOS — the per-file durability stalls that dominate the write
 * phase for small catalogs.
 *
 * Outcomes are collected per job and reported in job order afterwards, so
 * verbose output and the first error stay deterministic regardless of how the
 * work was scheduled. Unlike the former serial loop, later writes are still
 * attempted when an earlier one fails; the first failure in job order is the
 * one returned.
 */
#[derive(Clone, Copy)]
enum CatalogOperation {
    Write,
    Preview,
}

struct CatalogJobOutcome {
    lines: Vec<String>,
    drift: Option<CatalogDrift>,
}

fn process_catalogs(
    write_jobs: &[(&ConfigCatalog, &Vec<CatalogUpdateMessage>, &str)],
    config: &LoadedConfig,
    options: &ExtractOptions,
    operation: CatalogOperation,
) -> Result<Vec<CatalogDrift>, CliError> {
    let allow_mutating_probe = matches!(operation, CatalogOperation::Write);
    reject_colliding_extract_targets(write_jobs, config, allow_mutating_probe)?;

    let worker_count = write_jobs.len().min(
        std::thread::available_parallelism()
            .map(std::num::NonZeroUsize::get)
            .unwrap_or(1),
    );

    let mut outcomes: Vec<Option<Result<CatalogJobOutcome, CliError>>> = Vec::new();
    outcomes.resize_with(write_jobs.len(), || None);

    if worker_count <= 1 {
        for (outcome, (catalog, messages, locale)) in outcomes.iter_mut().zip(write_jobs) {
            *outcome = Some(process_catalog(
                catalog, locale, messages, config, options, operation,
            ));
        }
    } else {
        let collected = std::thread::scope(|scope| {
            let handles = (0..worker_count)
                .map(|worker| {
                    scope.spawn(move || {
                        write_jobs
                            .iter()
                            .enumerate()
                            .skip(worker)
                            .step_by(worker_count)
                            .map(|(index, (catalog, messages, locale))| {
                                (
                                    index,
                                    process_catalog(
                                        catalog, locale, messages, config, options, operation,
                                    ),
                                )
                            })
                            .collect::<Vec<_>>()
                    })
                })
                .collect::<Vec<_>>();
            handles
                .into_iter()
                .flat_map(|handle| handle.join().expect("catalog write worker panicked"))
                .collect::<Vec<_>>()
        });
        for (index, outcome) in collected {
            outcomes[index] = Some(outcome);
        }
    }

    let mut drift = Vec::new();
    for outcome in outcomes {
        let outcome = outcome.expect("every catalog job produces an outcome")?;
        for line in outcome.lines {
            eprintln!("{line}");
        }
        if let Some(catalog) = outcome.drift {
            drift.push(catalog);
        }
    }
    Ok(drift)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum ExtractTargetAnchor {
    Identity(FileIdentity),
    Root,
}

fn is_default_ignorable_code_point(ch: char) -> bool {
    matches!(
        ch,
        '\u{00ad}'
            | '\u{034f}'
            | '\u{061c}'
            | '\u{115f}'..='\u{1160}'
            | '\u{17b4}'..='\u{17b5}'
            | '\u{180b}'..='\u{180f}'
            | '\u{200b}'..='\u{200f}'
            | '\u{202a}'..='\u{202e}'
            | '\u{2060}'..='\u{206f}'
            | '\u{3164}'
            | '\u{fe00}'..='\u{fe0f}'
            | '\u{feff}'
            | '\u{ffa0}'
            | '\u{fff0}'..='\u{fff8}'
            | '\u{1bca0}'..='\u{1bca3}'
            | '\u{1d173}'..='\u{1d17a}'
            | '\u{e0000}'..='\u{e0fff}'
    )
}

fn unicode_full_casefold_nfd(text: &str, strip_default_ignorables: bool) -> String {
    let mut folded = String::with_capacity(text.len());
    for ch in text.nfd() {
        if strip_default_ignorables && is_default_ignorable_code_point(ch) {
            continue;
        }
        match ch {
            // Cherokee case folding maps to uppercase (U+13A0..=U+13F5).
            '\u{13a0}'..='\u{13f5}' => folded.push(ch),
            '\u{13f8}'..='\u{13fd}' => {
                folded.push(char::from_u32((ch as u32) - 8).unwrap_or(ch));
            }
            '\u{ab70}'..='\u{abbf}' => {
                folded.push(char::from_u32(0x13a0 + ((ch as u32) - 0xab70)).unwrap_or(ch));
            }
            // Complete Unicode CaseFolding (C + F) delta from `char::to_lowercase()`
            // after NFD decomposition (for example `ß`/`ẞ` -> `ss`, `ﬁ` -> `fi`,
            // `ς` -> `σ`, `µ` -> `μ`, matching APFS and Linux `FS_CASEFOLD_FL`).
            '\u{00b5}' => folded.push('\u{03bc}'),
            '\u{00df}' | '\u{1e9e}' => folded.push_str("ss"),
            '\u{0149}' => folded.push_str("\u{02bc}n"),
            '\u{017f}' => folded.push('s'),
            '\u{0345}' => folded.push('\u{03b9}'),
            '\u{03c2}' => folded.push('\u{03c3}'),
            '\u{03d0}' => folded.push('\u{03b2}'),
            '\u{03d1}' => folded.push('\u{03b8}'),
            '\u{03d5}' => folded.push('\u{03c6}'),
            '\u{03d6}' => folded.push('\u{03c0}'),
            '\u{03f0}' => folded.push('\u{03ba}'),
            '\u{03f1}' => folded.push('\u{03c1}'),
            '\u{03f5}' => folded.push('\u{03b5}'),
            '\u{0587}' => folded.push_str("\u{0565}\u{0582}"),
            '\u{1c80}' => folded.push('\u{0432}'),
            '\u{1c81}' => folded.push('\u{0434}'),
            '\u{1c82}' => folded.push('\u{043e}'),
            '\u{1c83}' => folded.push('\u{0441}'),
            '\u{1c84}' | '\u{1c85}' => folded.push('\u{0442}'),
            '\u{1c86}' => folded.push('\u{044a}'),
            '\u{1c87}' => folded.push('\u{0463}'),
            '\u{1c88}' => folded.push('\u{a64b}'),
            '\u{1e9a}' => folded.push_str("a\u{02be}"),
            '\u{fb00}' => folded.push_str("ff"),
            '\u{fb01}' => folded.push_str("fi"),
            '\u{fb02}' => folded.push_str("fl"),
            '\u{fb03}' => folded.push_str("ffi"),
            '\u{fb04}' => folded.push_str("ffl"),
            '\u{fb05}' | '\u{fb06}' => folded.push_str("st"),
            '\u{fb13}' => folded.push_str("\u{0574}\u{0576}"),
            '\u{fb14}' => folded.push_str("\u{0574}\u{0565}"),
            '\u{fb15}' => folded.push_str("\u{0574}\u{056b}"),
            '\u{fb16}' => folded.push_str("\u{057e}\u{0576}"),
            '\u{fb17}' => folded.push_str("\u{0574}\u{056d}"),
            other => {
                for lower in other.to_lowercase() {
                    folded.push(lower);
                }
            }
        }
    }
    folded.nfd().collect()
}

#[cfg(windows)]
fn ntfs_casefold(text: &str) -> String {
    #[link(name = "ntdll")]
    unsafe extern "system" {
        fn RtlUpcaseUnicodeChar(source_character: u16) -> u16;
    }

    let upcased: Vec<u16> = text
        .encode_utf16()
        .map(|unit| {
            // SAFETY: `RtlUpcaseUnicodeChar` is a pure code-unit table lookup.
            unsafe { RtlUpcaseUnicodeChar(unit) }
        })
        .collect();
    String::from_utf16_lossy(&upcased)
}

#[cfg(not(windows))]
fn ntfs_casefold(text: &str) -> String {
    // NTFS `$UpCase` is a 65,536-entry UTF-16 code-unit table: supplementary
    // plane characters (> U+FFFF, encoded as surrogate pairs) are untouched,
    // multi-character expansions such as `ß` -> `SS` stay distinct, `σ` and `ς`
    // both map to `Σ`, and dotless `ı` (U+0131) does not fold to `I`.
    let mut folded = String::with_capacity(text.len());
    for ch in text.chars() {
        if (ch as u32) > 0xFFFF || ch == '\u{0131}' {
            folded.push(ch);
            continue;
        }
        let mut upper = ch.to_uppercase();
        if let Some(first) = upper.next()
            && upper.next().is_none()
            && (first as u32) <= 0xFFFF
        {
            folded.push(first);
        } else {
            folded.push(ch);
        }
    }
    folded
}

/// Frozen Unicode 3.2.0 non-Hangul canonical-decomposition ranges used by
/// macOS HFS+ (Apple TN1150). Apple's excluded ranges (`U+2000..=U+2FFF`,
/// `U+F900..=U+FAFF`, `U+2F800..=U+2FA1F`) and post-3.2 canonical
/// decompositions (for example Balinese `U+1B06`) are absent so HFS+ leaves
/// them undecomposed.
const HFS_PLUS_DECOMPOSABLE_RUNS: &[(u32, u32)] = &[
    (0x00C0, 0x00C5),
    (0x00C7, 0x00CF),
    (0x00D1, 0x00D6),
    (0x00D9, 0x00DD),
    (0x00E0, 0x00E5),
    (0x00E7, 0x00EF),
    (0x00F1, 0x00F6),
    (0x00F9, 0x00FD),
    (0x00FF, 0x010F),
    (0x0112, 0x0125),
    (0x0128, 0x0130),
    (0x0134, 0x0137),
    (0x0139, 0x013E),
    (0x0143, 0x0148),
    (0x014C, 0x0151),
    (0x0154, 0x0165),
    (0x0168, 0x017E),
    (0x01A0, 0x01A1),
    (0x01AF, 0x01B0),
    (0x01CD, 0x01DC),
    (0x01DE, 0x01E3),
    (0x01E6, 0x01F0),
    (0x01F4, 0x01F5),
    (0x01F8, 0x021B),
    (0x021E, 0x021F),
    (0x0226, 0x0233),
    (0x0340, 0x0341),
    (0x0343, 0x0344),
    (0x0374, 0x0374),
    (0x037E, 0x037E),
    (0x0385, 0x038A),
    (0x038C, 0x038C),
    (0x038E, 0x0390),
    (0x03AA, 0x03B0),
    (0x03CA, 0x03CE),
    (0x03D3, 0x03D4),
    (0x0400, 0x0401),
    (0x0403, 0x0403),
    (0x0407, 0x0407),
    (0x040C, 0x040E),
    (0x0419, 0x0419),
    (0x0439, 0x0439),
    (0x0450, 0x0451),
    (0x0453, 0x0453),
    (0x0457, 0x0457),
    (0x045C, 0x045E),
    (0x0476, 0x0477),
    (0x04C1, 0x04C2),
    (0x04D0, 0x04D3),
    (0x04D6, 0x04D7),
    (0x04DA, 0x04DF),
    (0x04E2, 0x04E7),
    (0x04EA, 0x04F5),
    (0x04F8, 0x04F9),
    (0x0622, 0x0626),
    (0x06C0, 0x06C0),
    (0x06C2, 0x06C2),
    (0x06D3, 0x06D3),
    (0x0929, 0x0929),
    (0x0931, 0x0931),
    (0x0934, 0x0934),
    (0x0958, 0x095F),
    (0x09CB, 0x09CC),
    (0x09DC, 0x09DD),
    (0x09DF, 0x09DF),
    (0x0A33, 0x0A33),
    (0x0A36, 0x0A36),
    (0x0A59, 0x0A5B),
    (0x0A5E, 0x0A5E),
    (0x0B48, 0x0B48),
    (0x0B4B, 0x0B4C),
    (0x0B5C, 0x0B5D),
    (0x0B94, 0x0B94),
    (0x0BCA, 0x0BCC),
    (0x0C48, 0x0C48),
    (0x0CC0, 0x0CC0),
    (0x0CC7, 0x0CC8),
    (0x0CCA, 0x0CCB),
    (0x0D4A, 0x0D4C),
    (0x0DDA, 0x0DDA),
    (0x0DDC, 0x0DDE),
    (0x0F43, 0x0F43),
    (0x0F4D, 0x0F4D),
    (0x0F52, 0x0F52),
    (0x0F57, 0x0F57),
    (0x0F5C, 0x0F5C),
    (0x0F69, 0x0F69),
    (0x0F73, 0x0F73),
    (0x0F75, 0x0F76),
    (0x0F78, 0x0F78),
    (0x0F81, 0x0F81),
    (0x0F93, 0x0F93),
    (0x0F9D, 0x0F9D),
    (0x0FA2, 0x0FA2),
    (0x0FA7, 0x0FA7),
    (0x0FAC, 0x0FAC),
    (0x0FB9, 0x0FB9),
    (0x1026, 0x1026),
    (0x1E00, 0x1E99),
    (0x1E9B, 0x1E9B),
    (0x1EA0, 0x1EF9),
    (0x1F00, 0x1F15),
    (0x1F18, 0x1F1D),
    (0x1F20, 0x1F45),
    (0x1F48, 0x1F4D),
    (0x1F50, 0x1F57),
    (0x1F59, 0x1F59),
    (0x1F5B, 0x1F5B),
    (0x1F5D, 0x1F5D),
    (0x1F5F, 0x1F7D),
    (0x1F80, 0x1FB4),
    (0x1FB6, 0x1FBC),
    (0x1FBE, 0x1FBE),
    (0x1FC1, 0x1FC4),
    (0x1FC6, 0x1FD3),
    (0x1FD6, 0x1FDB),
    (0x1FDD, 0x1FEF),
    (0x1FF2, 0x1FF4),
    (0x1FF6, 0x1FFD),
    (0x304C, 0x304C),
    (0x304E, 0x304E),
    (0x3050, 0x3050),
    (0x3052, 0x3052),
    (0x3054, 0x3054),
    (0x3056, 0x3056),
    (0x3058, 0x3058),
    (0x305A, 0x305A),
    (0x305C, 0x305C),
    (0x305E, 0x305E),
    (0x3060, 0x3060),
    (0x3062, 0x3062),
    (0x3065, 0x3065),
    (0x3067, 0x3067),
    (0x3069, 0x3069),
    (0x3070, 0x3071),
    (0x3073, 0x3074),
    (0x3076, 0x3077),
    (0x3079, 0x307A),
    (0x307C, 0x307D),
    (0x3094, 0x3094),
    (0x309E, 0x309E),
    (0x30AC, 0x30AC),
    (0x30AE, 0x30AE),
    (0x30B0, 0x30B0),
    (0x30B2, 0x30B2),
    (0x30B4, 0x30B4),
    (0x30B6, 0x30B6),
    (0x30B8, 0x30B8),
    (0x30BA, 0x30BA),
    (0x30BC, 0x30BC),
    (0x30BE, 0x30BE),
    (0x30C0, 0x30C0),
    (0x30C2, 0x30C2),
    (0x30C5, 0x30C5),
    (0x30C7, 0x30C7),
    (0x30C9, 0x30C9),
    (0x30D0, 0x30D1),
    (0x30D3, 0x30D4),
    (0x30D6, 0x30D7),
    (0x30D9, 0x30DA),
    (0x30DC, 0x30DD),
    (0x30F4, 0x30F4),
    (0x30F7, 0x30FA),
    (0x30FE, 0x30FE),
    (0xFB1D, 0xFB1D),
    (0xFB1F, 0xFB1F),
    (0xFB2A, 0xFB36),
    (0xFB38, 0xFB3C),
    (0xFB3E, 0xFB3E),
    (0xFB40, 0xFB41),
    (0xFB43, 0xFB44),
    (0xFB46, 0xFB4E),
    (0x1D15E, 0x1D164),
    (0x1D1BB, 0x1D1C0),
];

/// Frozen Unicode 3.2.0 non-zero Canonical Combining Class table for HFS+
/// canonical ordering.
const HFS_PLUS_CCC_RUNS: &[(u32, u32, u8)] = &[
    (0x0300, 0x0314, 230),
    (0x0315, 0x0315, 232),
    (0x0316, 0x0319, 220),
    (0x031A, 0x031A, 232),
    (0x031B, 0x031B, 216),
    (0x031C, 0x0320, 220),
    (0x0321, 0x0322, 202),
    (0x0323, 0x0326, 220),
    (0x0327, 0x0328, 202),
    (0x0329, 0x0333, 220),
    (0x0334, 0x0338, 1),
    (0x0339, 0x033C, 220),
    (0x033D, 0x0344, 230),
    (0x0345, 0x0345, 240),
    (0x0346, 0x0346, 230),
    (0x0347, 0x0349, 220),
    (0x034A, 0x034C, 230),
    (0x034D, 0x034E, 220),
    (0x0360, 0x0361, 234),
    (0x0362, 0x0362, 233),
    (0x0363, 0x036F, 230),
    (0x0483, 0x0486, 230),
    (0x0591, 0x0591, 220),
    (0x0592, 0x0595, 230),
    (0x0596, 0x0596, 220),
    (0x0597, 0x0599, 230),
    (0x059A, 0x059A, 222),
    (0x059B, 0x059B, 220),
    (0x059C, 0x05A1, 230),
    (0x05A3, 0x05A7, 220),
    (0x05A8, 0x05A9, 230),
    (0x05AA, 0x05AA, 220),
    (0x05AB, 0x05AC, 230),
    (0x05AD, 0x05AD, 222),
    (0x05AE, 0x05AE, 228),
    (0x05AF, 0x05AF, 230),
    (0x05B0, 0x05B0, 10),
    (0x05B1, 0x05B1, 11),
    (0x05B2, 0x05B2, 12),
    (0x05B3, 0x05B3, 13),
    (0x05B4, 0x05B4, 14),
    (0x05B5, 0x05B5, 15),
    (0x05B6, 0x05B6, 16),
    (0x05B7, 0x05B7, 17),
    (0x05B8, 0x05B8, 18),
    (0x05B9, 0x05B9, 19),
    (0x05BB, 0x05BB, 20),
    (0x05BC, 0x05BC, 21),
    (0x05BD, 0x05BD, 22),
    (0x05BF, 0x05BF, 23),
    (0x05C1, 0x05C1, 24),
    (0x05C2, 0x05C2, 25),
    (0x05C4, 0x05C4, 230),
    (0x064B, 0x064B, 27),
    (0x064C, 0x064C, 28),
    (0x064D, 0x064D, 29),
    (0x064E, 0x064E, 30),
    (0x064F, 0x064F, 31),
    (0x0650, 0x0650, 32),
    (0x0651, 0x0651, 33),
    (0x0652, 0x0652, 34),
    (0x0653, 0x0654, 230),
    (0x0655, 0x0655, 220),
    (0x0670, 0x0670, 35),
    (0x06D6, 0x06DC, 230),
    (0x06DF, 0x06E2, 230),
    (0x06E3, 0x06E3, 220),
    (0x06E4, 0x06E4, 230),
    (0x06E7, 0x06E8, 230),
    (0x06EA, 0x06EA, 220),
    (0x06EB, 0x06EC, 230),
    (0x06ED, 0x06ED, 220),
    (0x0711, 0x0711, 36),
    (0x0730, 0x0730, 230),
    (0x0731, 0x0731, 220),
    (0x0732, 0x0733, 230),
    (0x0734, 0x0734, 220),
    (0x0735, 0x0736, 230),
    (0x0737, 0x0739, 220),
    (0x073A, 0x073A, 230),
    (0x073B, 0x073C, 220),
    (0x073D, 0x073D, 230),
    (0x073E, 0x073E, 220),
    (0x073F, 0x0741, 230),
    (0x0742, 0x0742, 220),
    (0x0743, 0x0743, 230),
    (0x0744, 0x0744, 220),
    (0x0745, 0x0745, 230),
    (0x0746, 0x0746, 220),
    (0x0747, 0x0747, 230),
    (0x0748, 0x0748, 220),
    (0x0749, 0x074A, 230),
    (0x093C, 0x093C, 7),
    (0x094D, 0x094D, 9),
    (0x0951, 0x0951, 230),
    (0x0952, 0x0952, 220),
    (0x0953, 0x0954, 230),
    (0x09BC, 0x09BC, 7),
    (0x09CD, 0x09CD, 9),
    (0x0A3C, 0x0A3C, 7),
    (0x0A4D, 0x0A4D, 9),
    (0x0ABC, 0x0ABC, 7),
    (0x0ACD, 0x0ACD, 9),
    (0x0B3C, 0x0B3C, 7),
    (0x0B4D, 0x0B4D, 9),
    (0x0BCD, 0x0BCD, 9),
    (0x0C4D, 0x0C4D, 9),
    (0x0C55, 0x0C55, 84),
    (0x0C56, 0x0C56, 91),
    (0x0CCD, 0x0CCD, 9),
    (0x0D4D, 0x0D4D, 9),
    (0x0DCA, 0x0DCA, 9),
    (0x0E38, 0x0E39, 103),
    (0x0E3A, 0x0E3A, 9),
    (0x0E48, 0x0E4B, 107),
    (0x0EB8, 0x0EB9, 118),
    (0x0EC8, 0x0ECB, 122),
    (0x0F18, 0x0F19, 220),
    (0x0F35, 0x0F35, 220),
    (0x0F37, 0x0F37, 220),
    (0x0F39, 0x0F39, 216),
    (0x0F71, 0x0F71, 129),
    (0x0F72, 0x0F72, 130),
    (0x0F74, 0x0F74, 132),
    (0x0F7A, 0x0F7D, 130),
    (0x0F80, 0x0F80, 130),
    (0x0F82, 0x0F83, 230),
    (0x0F84, 0x0F84, 9),
    (0x0F86, 0x0F87, 230),
    (0x0FC6, 0x0FC6, 220),
    (0x1037, 0x1037, 7),
    (0x1039, 0x1039, 9),
    (0x1714, 0x1714, 9),
    (0x1734, 0x1734, 9),
    (0x17D2, 0x17D2, 9),
    (0x18A9, 0x18A9, 228),
    (0x20D0, 0x20D1, 230),
    (0x20D2, 0x20D3, 1),
    (0x20D4, 0x20D7, 230),
    (0x20D8, 0x20DA, 1),
    (0x20DB, 0x20DC, 230),
    (0x20E1, 0x20E1, 230),
    (0x20E5, 0x20E6, 1),
    (0x20E7, 0x20E7, 230),
    (0x20E8, 0x20E8, 220),
    (0x20E9, 0x20E9, 230),
    (0x20EA, 0x20EA, 1),
    (0x302A, 0x302A, 218),
    (0x302B, 0x302B, 228),
    (0x302C, 0x302C, 232),
    (0x302D, 0x302D, 222),
    (0x302E, 0x302F, 224),
    (0x3099, 0x309A, 8),
    (0xFB1E, 0xFB1E, 26),
    (0xFE20, 0xFE23, 230),
    (0x1D165, 0x1D166, 216),
    (0x1D167, 0x1D169, 1),
    (0x1D16D, 0x1D16D, 226),
    (0x1D16E, 0x1D172, 216),
    (0x1D17B, 0x1D182, 220),
    (0x1D185, 0x1D189, 230),
    (0x1D18A, 0x1D18B, 220),
    (0x1D1AA, 0x1D1AD, 230),
];

fn is_hfs_plus_decomposable(ch: char) -> bool {
    let cp = u32::from(ch);
    if (0xAC00..=0xD7A3).contains(&cp) {
        return true;
    }
    HFS_PLUS_DECOMPOSABLE_RUNS
        .binary_search_by(|&(start, end)| {
            if cp < start {
                std::cmp::Ordering::Greater
            } else if cp > end {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Equal
            }
        })
        .is_ok()
}

fn hfs_plus_ccc(ch: char) -> u8 {
    let cp = u32::from(ch);
    HFS_PLUS_CCC_RUNS
        .binary_search_by(|&(start, end, _)| {
            if cp < start {
                std::cmp::Ordering::Greater
            } else if cp > end {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Equal
            }
        })
        .map_or(0, |index| HFS_PLUS_CCC_RUNS[index].2)
}

fn hfs_plus_nfd(text: &str) -> String {
    let mut chars = Vec::with_capacity(text.len());
    for ch in text.chars() {
        if is_hfs_plus_decomposable(ch) {
            let mut single = [0_u8; 4];
            chars.extend(ch.encode_utf8(&mut single).nfd());
        } else {
            chars.push(ch);
        }
    }
    let mut idx = 0usize;
    while idx < chars.len() {
        if hfs_plus_ccc(chars[idx]) == 0 {
            idx += 1;
            continue;
        }
        let start = idx;
        while idx < chars.len() && hfs_plus_ccc(chars[idx]) != 0 {
            idx += 1;
        }
        chars[start..idx].sort_by_key(|&ch| hfs_plus_ccc(ch));
    }
    chars.into_iter().collect()
}

fn is_hfs_plus_ignorable(ch: char) -> bool {
    matches!(
        ch,
        '\u{200C}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{206A}'..='\u{206F}' | '\u{FEFF}'
    )
}

/// Frozen Unicode 3.2 post-NFD 1-to-1 lowercase table used by macOS HFS+
/// (`FastUnicodeCompare` / Apple TN1150). Characters added or given lowercase
/// pairs after Unicode 3.2 (for example `ẞ` U+1E9E, Georgian Mtavruli, and
/// Cherokee lowercase) are intentionally absent so they remain distinct on HFS+.
const HFS_PLUS_LOWERCASE_RUNS: &[(u32, u32, u32, i32)] = &[
    (0x0041, 0x005A, 1, 32),
    (0x00C6, 0x00C6, 1, 32),
    (0x00D0, 0x00D0, 1, 32),
    (0x00D8, 0x00D8, 1, 32),
    (0x00DE, 0x00DE, 1, 32),
    (0x0110, 0x0110, 1, 1),
    (0x0126, 0x0126, 1, 1),
    (0x0132, 0x0132, 1, 1),
    (0x013F, 0x0141, 2, 1),
    (0x014A, 0x014A, 1, 1),
    (0x0152, 0x0152, 1, 1),
    (0x0166, 0x0166, 1, 1),
    (0x0181, 0x0181, 1, 210),
    (0x0182, 0x0184, 2, 1),
    (0x0186, 0x0186, 1, 206),
    (0x0187, 0x0187, 1, 1),
    (0x0189, 0x018A, 1, 205),
    (0x018B, 0x018B, 1, 1),
    (0x018E, 0x018E, 1, 79),
    (0x018F, 0x018F, 1, 202),
    (0x0190, 0x0190, 1, 203),
    (0x0191, 0x0191, 1, 1),
    (0x0193, 0x0193, 1, 205),
    (0x0194, 0x0194, 1, 207),
    (0x0196, 0x0196, 1, 211),
    (0x0197, 0x0197, 1, 209),
    (0x0198, 0x0198, 1, 1),
    (0x019C, 0x019C, 1, 211),
    (0x019D, 0x019D, 1, 213),
    (0x019F, 0x019F, 1, 214),
    (0x01A2, 0x01A4, 2, 1),
    (0x01A6, 0x01A6, 1, 218),
    (0x01A7, 0x01A7, 1, 1),
    (0x01A9, 0x01A9, 1, 218),
    (0x01AC, 0x01AC, 1, 1),
    (0x01AE, 0x01AE, 1, 218),
    (0x01B1, 0x01B2, 1, 217),
    (0x01B3, 0x01B5, 2, 1),
    (0x01B7, 0x01B7, 1, 219),
    (0x01B8, 0x01B8, 1, 1),
    (0x01BC, 0x01BC, 1, 1),
    (0x01C4, 0x01C4, 1, 2),
    (0x01C5, 0x01C5, 1, 1),
    (0x01C7, 0x01C7, 1, 2),
    (0x01C8, 0x01C8, 1, 1),
    (0x01CA, 0x01CA, 1, 2),
    (0x01CB, 0x01CB, 1, 1),
    (0x01E4, 0x01E4, 1, 1),
    (0x01F1, 0x01F1, 1, 2),
    (0x01F2, 0x01F2, 1, 1),
    (0x01F6, 0x01F6, 1, -97),
    (0x01F7, 0x01F7, 1, -56),
    (0x021C, 0x021C, 1, 1),
    (0x0220, 0x0220, 1, -130),
    (0x0222, 0x0224, 2, 1),
    (0x0391, 0x03A1, 1, 32),
    (0x03A3, 0x03A9, 1, 32),
    (0x03D8, 0x03EE, 2, 1),
    (0x03F4, 0x03F4, 1, -60),
    (0x0402, 0x0404, 2, 80),
    (0x0405, 0x0406, 1, 80),
    (0x0408, 0x040B, 1, 80),
    (0x040F, 0x040F, 1, 80),
    (0x0410, 0x0418, 1, 32),
    (0x041A, 0x042F, 1, 32),
    (0x0460, 0x0474, 2, 1),
    (0x0478, 0x0480, 2, 1),
    (0x048A, 0x04BE, 2, 1),
    (0x04C3, 0x04CD, 2, 1),
    (0x04D4, 0x04D4, 1, 1),
    (0x04D8, 0x04D8, 1, 1),
    (0x04E0, 0x04E0, 1, 1),
    (0x04E8, 0x04E8, 1, 1),
    (0x0500, 0x050E, 2, 1),
    (0x0531, 0x0556, 1, 48),
    (0x2126, 0x2126, 1, -7517),
    (0x212A, 0x212A, 1, -8383),
    (0x212B, 0x212B, 1, -8262),
    (0x2160, 0x216F, 1, 16),
    (0x24B6, 0x24CF, 1, 26),
    (0xFF21, 0xFF3A, 1, 32),
];

fn hfs_plus_lowercase(ch: char) -> char {
    let cp = ch as u32;
    if cp > 0xFFFF {
        return ch;
    }
    let idx = HFS_PLUS_LOWERCASE_RUNS.partition_point(|&(_, end, _, _)| end < cp);
    if let Some(&(start, end, step, delta)) = HFS_PLUS_LOWERCASE_RUNS.get(idx)
        && cp >= start
        && cp <= end
        && (cp - start).is_multiple_of(step)
    {
        #[allow(clippy::cast_possible_wrap, clippy::cast_sign_loss)]
        let mapped = (cp as i32 + delta) as u32;
        if let Some(lower) = char::from_u32(mapped) {
            return lower;
        }
    }
    ch
}

fn hfs_plus_casefold_nfd(text: &str) -> String {
    // HFS+ case-insensitive comparison applies HFS+ NFD (with TN1150
    // exclusions), strips its Unicode 3.2 ignorable code points, and applies
    // the frozen Unicode 3.2 1-to-1 lowercase table (so `straße` != `strasse`,
    // `ẞ` != `ß`, and `U+F900` != `U+8C48`, unlike APFS).
    let decomposed = hfs_plus_nfd(text);
    let mut folded = String::with_capacity(decomposed.len());
    for ch in decomposed.chars() {
        if is_hfs_plus_ignorable(ch) {
            continue;
        }
        folded.push(hfs_plus_lowercase(ch));
    }
    folded
}

fn fold_os_segment(segment: &std::ffi::OsStr, equivalence: DirFilenameEquivalence) -> OsString {
    if equivalence == DirFilenameEquivalence::Exact {
        return segment.to_os_string();
    }
    segment.to_str().map_or_else(
        || segment.to_os_string(),
        |text| {
            let normalized = match equivalence {
                DirFilenameEquivalence::Exact => text.to_owned(),
                DirFilenameEquivalence::UnicodeNfd => text.nfd().collect(),
                DirFilenameEquivalence::UnicodeHfsPlus => hfs_plus_nfd(text),
                DirFilenameEquivalence::CaseInsensitiveNtfs => {
                    ntfs_casefold(text.trim_end_matches(['.', ' ']))
                }
                DirFilenameEquivalence::CaseInsensitiveVfat
                | DirFilenameEquivalence::CaseInsensitiveExfat => {
                    ntfs_casefold(text.trim_end_matches('.'))
                }
                DirFilenameEquivalence::CaseInsensitiveUnicodeNfd => {
                    unicode_full_casefold_nfd(text, false)
                }
                DirFilenameEquivalence::CaseInsensitiveHfsPlus => hfs_plus_casefold_nfd(text),
                DirFilenameEquivalence::CaseInsensitiveUnicodeNfdicf => {
                    unicode_full_casefold_nfd(text, true)
                }
            };
            OsString::from(normalized)
        },
    )
}

fn fold_os_segment_for_bucket(
    segment: &std::ffi::OsStr,
    equivalence: DirFilenameEquivalence,
    equivalence_confirmed: bool,
) -> OsString {
    if equivalence_confirmed {
        return fold_os_segment(segment, equivalence);
    }
    // When the directory's policy is unknown (for example, an unqueriable mount
    // that could be VFAT, SMB, NTFS, APFS, or ext4-casefold), also strip
    // trailing dots/spaces in the bucket key so potential aliases such as
    // `locales` and `locales.` always land in the same bucket for live probing.
    segment.to_str().map_or_else(
        || segment.to_os_string(),
        |text| {
            OsString::from(unicode_full_casefold_nfd(
                text.trim_end_matches(['.', ' ']),
                true,
            ))
        },
    )
}

fn resolve_directory_equivalence(
    dir: &ContainedDir,
    identity: Option<FileIdentity>,
    cache: &mut HashMap<FileIdentity, (DirFilenameEquivalence, bool)>,
) -> (DirFilenameEquivalence, bool) {
    if let Some(id) = identity
        && let Some(&cached) = cache.get(&id)
    {
        return cached;
    }
    // Keep directory traversal strictly read-only: when a directory's own
    // filename-equivalence policy cannot be queried (for example, a
    // search-only directory on ext4/NTFS where casefolding is per-directory),
    // never inherit a parent's confirmed policy. Bucket under the broadest
    // equivalence (`confirmed = false`) and defer any live probe until two
    // candidate paths actually collide in the same bucket.
    let resolved = dir.filename_equivalence().map_or(
        (DirFilenameEquivalence::CaseInsensitiveUnicodeNfdicf, false),
        |eq| (eq, true),
    );
    if let Some(id) = identity {
        cache.insert(id, resolved);
    }
    resolved
}

fn segment_pair_collides_on_dir(
    anchor_dir: &ContainedDir,
    equivalence: DirFilenameEquivalence,
    equivalence_confirmed: bool,
    allow_mutating_probe: bool,
    left: &OsStr,
    right: &OsStr,
) -> bool {
    if left == right {
        return true;
    }
    let is_ascii_ci = matches!(
        equivalence,
        DirFilenameEquivalence::CaseInsensitiveNtfs
            | DirFilenameEquivalence::CaseInsensitiveVfat
            | DirFilenameEquivalence::CaseInsensitiveExfat
            | DirFilenameEquivalence::CaseInsensitiveUnicodeNfd
            | DirFilenameEquivalence::CaseInsensitiveHfsPlus
            | DirFilenameEquivalence::CaseInsensitiveUnicodeNfdicf
    );
    // Keep trailing-dot / trailing-space trimming in `fold_os_segment` so
    // candidate aliases land in the same lookup bucket, but only take the
    // immediate ASCII case-insensitive fast path when the raw names match
    // without trimming: our Windows contained writer uses `NtCreateFile`
    // (which can create distinct `assets` and `assets.` entries), and Linux
    // exFAT supports `keep_last_dots`. Pairs matching only after trimming fall
    // through to the live filesystem probe below.
    if equivalence_confirmed
        && is_ascii_ci
        && let (Some(l_str), Some(r_str)) = (left.to_str(), right.to_str())
        && l_str.is_ascii()
        && r_str.is_ascii()
        && l_str.eq_ignore_ascii_case(r_str)
    {
        return true;
    }
    // When equivalence is unconfirmed (for example, a read-only share or
    // search-only directory where filesystem metadata queries are unsupported)
    // or names are non-ASCII, consult actual entry identities (and, for write
    // operations, a live directory probe) before reporting a collision. If
    // probing cannot disprove equivalence (`None`), fail closed rather than
    // guessing from the host OS default.
    let probed = if allow_mutating_probe {
        anchor_dir.probe_names_equivalent(left, right)
    } else {
        anchor_dir.probe_existing_names_equivalent(left, right)
    };
    probed != Some(false)
}

#[cfg(test)]
fn segments_collide_on_dir(
    anchor_dir: &ContainedDir,
    equivalence: DirFilenameEquivalence,
    equivalence_confirmed: bool,
    left_remaining: &[OsString],
    left_file: &OsStr,
    right_remaining: &[OsString],
    right_file: &OsStr,
) -> bool {
    if left_remaining.len() != right_remaining.len() {
        return false;
    }
    let left_full: Vec<OsString> = left_remaining
        .iter()
        .cloned()
        .chain(std::iter::once(left_file.to_os_string()))
        .collect();
    let right_full: Vec<OsString> = right_remaining
        .iter()
        .cloned()
        .chain(std::iter::once(right_file.to_os_string()))
        .collect();
    left_full
        .iter()
        .zip(right_full.iter())
        .all(|(left, right)| {
            segment_pair_collides_on_dir(
                anchor_dir,
                equivalence,
                equivalence_confirmed,
                true,
                left,
                right,
            )
        })
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct NtfsShortNameCandidate {
    prefix: String,
    hash_prefix: Option<String>,
    digits_len: usize,
    ext: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct NtfsLongNameDerived {
    base: String,
    ext: String,
    has_non_ascii: bool,
}

const fn is_valid_8dot3_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric()
        || matches!(
            ch,
            '!' | '#'
                | '$'
                | '%'
                | '&'
                | '\''
                | '('
                | ')'
                | '-'
                | '@'
                | '^'
                | '_'
                | '`'
                | '{'
                | '}'
                | '~'
        )
}

fn is_valid_8dot3_name(name: &str) -> bool {
    if name.is_empty() || name.starts_with(['.', ' ']) || name.ends_with(['.', ' ']) {
        return false;
    }
    let mut parts = name.split('.');
    let Some(stem) = parts.next() else {
        return false;
    };
    let ext = parts.next().unwrap_or("");
    if parts.next().is_some() {
        return false;
    }
    if stem.is_empty() || stem.len() > 8 || ext.len() > 3 {
        return false;
    }
    stem.chars().all(is_valid_8dot3_char) && ext.chars().all(is_valid_8dot3_char)
}

fn parse_ntfs_short_name(segment: &OsStr) -> Option<NtfsShortNameCandidate> {
    let text = segment.to_str()?;
    if !is_valid_8dot3_name(text) {
        return None;
    }
    let (stem_raw, ext_raw) = text.split_once('.').unwrap_or((text, ""));
    let (prefix_raw, digits) = stem_raw.rsplit_once('~')?;
    if prefix_raw.is_empty()
        || digits.is_empty()
        || !digits.bytes().all(|byte| byte.is_ascii_digit())
        || !digits.bytes().any(|byte| byte != b'0')
    {
        return None;
    }
    let prefix = prefix_raw.to_ascii_uppercase();
    let ext = ext_raw.to_ascii_uppercase();
    let hash_prefix = if prefix.len() >= 5
        && prefix[prefix.len() - 4..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        Some(prefix[..prefix.len() - 4].to_owned())
    } else {
        None
    };
    Some(NtfsShortNameCandidate {
        prefix,
        hash_prefix,
        digits_len: digits.len(),
        ext,
    })
}

fn sanitize_8dot3_component(input: &str, max_len: usize) -> (String, bool) {
    let mut out = String::new();
    let mut has_non_ascii = false;
    for ch in input.chars() {
        if out.len() >= max_len {
            break;
        }
        if ch == ' ' || ch == '.' {
            continue;
        }
        if !ch.is_ascii() {
            has_non_ascii = true;
            out.push('_');
        } else if is_valid_8dot3_char(ch) {
            out.push(ch.to_ascii_uppercase());
        } else {
            out.push('_');
        }
    }
    (out, has_non_ascii)
}

fn parse_vfat_tailless_short_name(segment: &OsStr) -> Option<(String, String)> {
    let text = segment.to_str()?;
    if !is_valid_8dot3_name(text) {
        return None;
    }
    let (stem_raw, ext_raw) = text.split_once('.').unwrap_or((text, ""));
    Some((stem_raw.to_ascii_uppercase(), ext_raw.to_ascii_uppercase()))
}

fn parse_ntfs_long_name(segment: &OsStr) -> Option<NtfsLongNameDerived> {
    let Some(text) = segment.to_str() else {
        return Some(NtfsLongNameDerived {
            base: String::new(),
            ext: String::new(),
            has_non_ascii: true,
        });
    };
    if is_valid_8dot3_name(text) {
        return None;
    }
    let trimmed = text.trim_start_matches(['.', ' ']);
    let (stem_raw, ext_raw) = trimmed.rsplit_once('.').unwrap_or((trimmed, ""));
    // Keep up to 8 sanitized stem characters: standard tilde aliases use up to
    // 6 (`&base[..base.len().min(7 - digits_len)]`), while Linux VFAT mounted
    // with `nonumtail` uses up to 8 characters without `~1` (for example
    // `messages-long.po` -> `MESSAGES.PO`).
    let (base, base_non_ascii) = sanitize_8dot3_component(stem_raw, 8);
    let (ext, ext_non_ascii) = sanitize_8dot3_component(ext_raw, 3);
    Some(NtfsLongNameDerived {
        base,
        ext,
        has_non_ascii: base_non_ascii || ext_non_ascii || !text.is_ascii(),
    })
}

fn ntfs_long_matches_short(long: &NtfsLongNameDerived, short: &NtfsShortNameCandidate) -> bool {
    if long.has_non_ascii {
        return long.ext == short.ext || long.ext.contains('_');
    }
    if long.ext != short.ext {
        return false;
    }
    let max_prefix = 8usize.saturating_sub(1 + short.digits_len);
    let expected = &long.base[..long.base.len().min(max_prefix)];
    if !expected.is_empty() && short.prefix == expected {
        return true;
    }
    if let Some(ref hash_prefix) = short.hash_prefix
        && long.base.starts_with(hash_prefix.as_str())
    {
        return true;
    }
    false
}

const fn can_have_ntfs_short_names(
    equivalence: DirFilenameEquivalence,
    equivalence_confirmed: bool,
) -> bool {
    matches!(
        equivalence,
        DirFilenameEquivalence::CaseInsensitiveNtfs | DirFilenameEquivalence::CaseInsensitiveVfat
    ) || !equivalence_confirmed
}

const fn can_have_vfat_tailless_short_names(
    equivalence: DirFilenameEquivalence,
    equivalence_confirmed: bool,
) -> bool {
    // Only VFAT (`nonumtail`) or an unrecognized mount can synthesize tail-less
    // 8.3 aliases like `MESSAGES.PO` for `messages-long.po`; NTFS always uses a
    // `~N` numeric tail.
    matches!(equivalence, DirFilenameEquivalence::CaseInsensitiveVfat) || !equivalence_confirmed
}

fn dir_generates_ntfs_short_names(
    dir: &ContainedDir,
    identity: Option<FileIdentity>,
    allow_mutating_probe: bool,
    cache: &mut HashMap<FileIdentity, bool>,
) -> bool {
    if let Some(id) = identity
        && let Some(&cached) = cache.get(&id)
    {
        return cached;
    }
    let generates = if allow_mutating_probe {
        // Probe whether this volume actually synthesizes 8.3 short aliases
        // inside a brand-new empty private staging directory (unaffected by
        // any pre-existing entries in `dir`). `Some(false)` proves 8.3 names
        // are disabled; `Some(true)` or `None` fails closed.
        dir.probe_8dot3_short_names_enabled() != Some(false)
    } else {
        true
    };
    if let Some(id) = identity {
        cache.insert(id, generates);
    }
    generates
}

fn dir_generates_vfat_tailless_short_names(
    dir: &ContainedDir,
    identity: Option<FileIdentity>,
    allow_mutating_probe: bool,
    cache: &mut HashMap<FileIdentity, bool>,
) -> bool {
    if let Some(id) = identity
        && let Some(&cached) = cache.get(&id)
    {
        return cached;
    }
    let generates = if allow_mutating_probe {
        // Probe whether this volume synthesizes tail-less 8.3 aliases (Linux
        // VFAT `nonumtail`: `palamedes-83-probe.txt` -> `PALAMEDE.TXT`).
        // `Some(false)` proves `nonumtail` is not active; `Some(true)` or
        // `None` fails closed.
        dir.probe_8dot3_tailless_short_names_enabled() != Some(false)
    } else {
        true
    };
    if let Some(id) = identity {
        cache.insert(id, generates);
    }
    generates
}

struct TargetSegment {
    raw: OsString,
    folded: OsString,
    eq: DirFilenameEquivalence,
    eq_confirmed: bool,
    dir_idx: usize,
    parent_id: Option<FileIdentity>,
    settled_by_identity: bool,
}

#[derive(Default)]
struct TargetPrefixNode<'a> {
    file_scope: Option<&'a str>,
    dir_scope: Option<&'a str>,
    child_nodes: Vec<(OsString, Self)>,
    by_folded: HashMap<OsString, Vec<usize>>,
    // Linear-time indexes mapping NTFS/VFAT 8.3 short/long patterns to child_nodes indices.
    ntfs_long_prefixes: HashMap<(String, String, usize), Vec<usize>>,
    ntfs_long_hash_prefixes: HashMap<(String, String), Vec<usize>>,
    ntfs_non_ascii_long_by_ext: HashMap<String, Vec<usize>>,
    ntfs_any_non_ascii_ext_long: Vec<usize>,
    ntfs_short_by_ext: HashMap<String, Vec<(NtfsShortNameCandidate, usize)>>,
    // Linear-time indexes for VFAT `nonumtail` tail-less 8.3 aliases (e.g. `messages-long.po` <-> `MESSAGES.PO`).
    vfat_long_tailless: HashMap<(String, String), Vec<usize>>,
    vfat_tailless_short: HashMap<(String, String), Vec<usize>>,
    vfat_tailless_short_by_ext: HashMap<String, Vec<usize>>,
}

impl<'a> TargetPrefixNode<'a> {
    fn matching_ntfs_short_name_children(&self, raw: &OsStr) -> Vec<usize> {
        let mut matches = Vec::new();
        let mut seen = HashSet::new();
        let mut push_unique = |idx: usize| {
            if seen.insert(idx) {
                matches.push(idx);
            }
        };
        if let Some(short) = parse_ntfs_short_name(raw) {
            if let Some(indices) = self.ntfs_long_prefixes.get(&(
                short.ext.clone(),
                short.prefix.clone(),
                short.digits_len,
            )) {
                for &idx in indices {
                    push_unique(idx);
                }
            }
            if let Some(ref hash_prefix) = short.hash_prefix
                && let Some(indices) = self
                    .ntfs_long_hash_prefixes
                    .get(&(short.ext.clone(), hash_prefix.clone()))
            {
                for &idx in indices {
                    push_unique(idx);
                }
            }
            if let Some(indices) = self.ntfs_non_ascii_long_by_ext.get(&short.ext) {
                for &idx in indices {
                    push_unique(idx);
                }
            }
            for &idx in &self.ntfs_any_non_ascii_ext_long {
                push_unique(idx);
            }
            return matches;
        }

        if let Some(long) = parse_ntfs_long_name(raw) {
            if long.has_non_ascii && long.ext.contains('_') {
                for entries in self.ntfs_short_by_ext.values() {
                    for &(_, idx) in entries {
                        push_unique(idx);
                    }
                }
            } else if let Some(entries) = self.ntfs_short_by_ext.get(&long.ext) {
                for (short, idx) in entries {
                    if ntfs_long_matches_short(&long, short) {
                        push_unique(*idx);
                    }
                }
            }
        }
        matches
    }

    fn matching_vfat_tailless_short_name_children(&self, raw: &OsStr) -> Vec<usize> {
        let mut matches = Vec::new();
        let mut seen = HashSet::new();
        let mut push_unique = |idx: usize| {
            if seen.insert(idx) {
                matches.push(idx);
            }
        };
        if let Some((stem, ext)) = parse_vfat_tailless_short_name(raw) {
            if let Some(indices) = self.vfat_long_tailless.get(&(ext.clone(), stem)) {
                for &idx in indices {
                    push_unique(idx);
                }
            }
            if let Some(indices) = self.ntfs_non_ascii_long_by_ext.get(&ext) {
                for &idx in indices {
                    push_unique(idx);
                }
            }
            for &idx in &self.ntfs_any_non_ascii_ext_long {
                push_unique(idx);
            }
            return matches;
        }

        if let Some(long) = parse_ntfs_long_name(raw) {
            if long.has_non_ascii {
                if long.ext.contains('_') {
                    for indices in self.vfat_tailless_short_by_ext.values() {
                        for &idx in indices {
                            push_unique(idx);
                        }
                    }
                } else if let Some(indices) = self.vfat_tailless_short_by_ext.get(&long.ext) {
                    for &idx in indices {
                        push_unique(idx);
                    }
                }
            } else if !long.base.is_empty()
                && let Some(indices) = self.vfat_tailless_short.get(&(long.ext, long.base))
            {
                for &idx in indices {
                    push_unique(idx);
                }
            }
        }
        matches
    }

    /// Indexes a newly allocated `child_idx` in the NTFS/VFAT 8.3 lookup tables.
    ///
    /// Because callers allocate a fresh index per distinct child node and each
    /// loop iteration generates a unique key, appending directly is O(1) per
    /// bucket without scanning earlier siblings.
    fn record_ntfs_short_name_child(&mut self, raw: &OsStr, child_idx: usize) {
        if let Some((stem, ext)) = parse_vfat_tailless_short_name(raw) {
            self.vfat_tailless_short
                .entry((ext.clone(), stem))
                .or_default()
                .push(child_idx);
            self.vfat_tailless_short_by_ext
                .entry(ext)
                .or_default()
                .push(child_idx);
            if let Some(short) = parse_ntfs_short_name(raw) {
                self.ntfs_short_by_ext
                    .entry(short.ext.clone())
                    .or_default()
                    .push((short, child_idx));
            }
            return;
        }
        if let Some(long) = parse_ntfs_long_name(raw) {
            if long.has_non_ascii && long.ext.contains('_') {
                self.ntfs_any_non_ascii_ext_long.push(child_idx);
            }
            if long.has_non_ascii {
                self.ntfs_non_ascii_long_by_ext
                    .entry(long.ext)
                    .or_default()
                    .push(child_idx);
            } else {
                if !long.base.is_empty() {
                    self.vfat_long_tailless
                        .entry((long.ext.clone(), long.base.clone()))
                        .or_default()
                        .push(child_idx);
                }
                for digits_len in 1..=6 {
                    let prefix_len = long.base.len().min(7 - digits_len);
                    if prefix_len > 0 {
                        self.ntfs_long_prefixes
                            .entry((
                                long.ext.clone(),
                                long.base[..prefix_len].to_owned(),
                                digits_len,
                            ))
                            .or_default()
                            .push(child_idx);
                    }
                }
                let max_hash = long.base.len().min(2);
                for len in 1..=max_hash {
                    self.ntfs_long_hash_prefixes
                        .entry((long.ext.clone(), long.base[..len].to_owned()))
                        .or_default()
                        .push(child_idx);
                }
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn check_path_conflicts_readonly(
        &self,
        segments: &[TargetSegment],
        segment_dirs: &[ContainedDir],
        scope: &str,
        catalog_path: &Path,
        allow_mutating_probe: bool,
        short_name_cache: &mut HashMap<FileIdentity, bool>,
        tailless_short_name_cache: &mut HashMap<FileIdentity, bool>,
    ) -> Result<(), CliError> {
        let Some((seg, rest)) = segments.split_first() else {
            return Ok(());
        };
        let is_leaf = rest.is_empty();
        let parent_dir = &segment_dirs[seg.dir_idx];

        let mut matched_children: Vec<usize> = Vec::new();
        if let Some(bucket) = self.by_folded.get(&seg.folded) {
            for &child_idx in bucket {
                if segment_pair_collides_on_dir(
                    parent_dir,
                    seg.eq,
                    seg.eq_confirmed,
                    allow_mutating_probe,
                    &self.child_nodes[child_idx].0,
                    &seg.raw,
                ) {
                    matched_children.push(child_idx);
                }
            }
        }

        if !seg.settled_by_identity && can_have_ntfs_short_names(seg.eq, seg.eq_confirmed) {
            let alias_indices = self.matching_ntfs_short_name_children(&seg.raw);
            if !alias_indices.is_empty()
                && dir_generates_ntfs_short_names(
                    parent_dir,
                    seg.parent_id,
                    allow_mutating_probe,
                    short_name_cache,
                )
            {
                for child_idx in alias_indices {
                    if !matched_children.contains(&child_idx) {
                        matched_children.push(child_idx);
                    }
                }
            }
        }

        if !seg.settled_by_identity && can_have_vfat_tailless_short_names(seg.eq, seg.eq_confirmed)
        {
            let alias_indices = self.matching_vfat_tailless_short_name_children(&seg.raw);
            if !alias_indices.is_empty()
                && dir_generates_vfat_tailless_short_names(
                    parent_dir,
                    seg.parent_id,
                    allow_mutating_probe,
                    tailless_short_name_cache,
                )
            {
                for child_idx in alias_indices {
                    if !matched_children.contains(&child_idx) {
                        matched_children.push(child_idx);
                    }
                }
            }
        }

        for child_idx in matched_children {
            let child = &self.child_nodes[child_idx].1;
            if is_leaf {
                if let Some(first_scope) = child.file_scope {
                    return Err(CliError::Io {
                        path: catalog_path.to_path_buf(),
                        source: std::io::Error::new(
                            std::io::ErrorKind::AlreadyExists,
                            format!(
                                "multiple catalog scopes ({first_scope:?} and {scope:?}) resolve to the same target file",
                            ),
                        ),
                    });
                }
                if let Some(dir_scope) = child.dir_scope {
                    return Err(CliError::Io {
                        path: catalog_path.to_path_buf(),
                        source: std::io::Error::new(
                            std::io::ErrorKind::AlreadyExists,
                            format!(
                                "catalog scope {scope:?} writes a file where {dir_scope:?} requires a parent directory",
                            ),
                        ),
                    });
                }
            } else {
                if let Some(file_scope) = child.file_scope {
                    return Err(CliError::Io {
                        path: catalog_path.to_path_buf(),
                        source: std::io::Error::new(
                            std::io::ErrorKind::AlreadyExists,
                            format!(
                                "catalog scope {scope:?} requires a parent directory where {file_scope:?} writes a catalog file",
                            ),
                        ),
                    });
                }
                child.check_path_conflicts_readonly(
                    rest,
                    segment_dirs,
                    scope,
                    catalog_path,
                    allow_mutating_probe,
                    short_name_cache,
                    tailless_short_name_cache,
                )?;
            }
        }
        Ok(())
    }

    fn record_write_path(
        &mut self,
        segments: &[TargetSegment],
        segment_dirs: &[ContainedDir],
        scope: &'a str,
        allow_mutating_probe: bool,
    ) {
        let mut node = self;
        for (idx, seg) in segments.iter().enumerate() {
            let is_leaf = idx + 1 == segments.len();
            let parent_dir = &segment_dirs[seg.dir_idx];
            let existing_idx = node.by_folded.get(&seg.folded).and_then(|bucket| {
                bucket.iter().copied().find(|&child_idx| {
                    segment_pair_collides_on_dir(
                        parent_dir,
                        seg.eq,
                        seg.eq_confirmed,
                        allow_mutating_probe,
                        &node.child_nodes[child_idx].0,
                        &seg.raw,
                    )
                })
            });
            let child_idx = if let Some(existing_idx) = existing_idx {
                existing_idx
            } else {
                let new_idx = node.child_nodes.len();
                node.child_nodes
                    .push((seg.raw.clone(), TargetPrefixNode::default()));
                node.by_folded
                    .entry(seg.folded.clone())
                    .or_default()
                    .push(new_idx);
                if !seg.settled_by_identity && can_have_ntfs_short_names(seg.eq, seg.eq_confirmed) {
                    node.record_ntfs_short_name_child(&seg.raw, new_idx);
                }
                new_idx
            };
            node = &mut node.child_nodes[child_idx].1;
            if is_leaf {
                node.file_scope = Some(scope);
            } else {
                node.dir_scope.get_or_insert(scope);
            }
        }
    }
}

fn reject_colliding_extract_targets(
    write_jobs: &[(&ConfigCatalog, &Vec<CatalogUpdateMessage>, &str)],
    config: &LoadedConfig,
    allow_mutating_probe: bool,
) -> Result<(), CliError> {
    if write_jobs.len() <= 1 {
        return Ok(());
    }
    let mut targets = Vec::with_capacity(write_jobs.len());
    for (catalog, _, locale) in write_jobs {
        let catalog_path =
            config.resolve_contained_catalog_path(&catalog.path, locale, catalog.format)?;
        targets.push((catalog.path.as_str(), catalog_path));
    }
    reject_colliding_catalog_targets(&config.root_dir, &targets, allow_mutating_probe)
}

pub(crate) fn reject_colliding_catalog_targets(
    root_dir: &Path,
    targets: &[(&str, PathBuf)],
    allow_mutating_probe: bool,
) -> Result<(), CliError> {
    reject_colliding_catalog_targets_with_options(
        root_dir,
        targets,
        &[],
        allow_mutating_probe,
        None,
        false,
    )
}

/// Checks that `write_targets` do not collide with one another or with any
/// `protected_targets`, while allowing `protected_targets` to overlap each
/// other (for example, a skipped fixed-path FCL catalog shared across locales).
pub(crate) fn reject_colliding_catalog_targets_with_protected(
    root_dir: &Path,
    write_targets: &[(&str, PathBuf)],
    protected_targets: &[(&str, PathBuf)],
    allow_mutating_probe: bool,
) -> Result<(), CliError> {
    reject_colliding_catalog_targets_with_options(
        root_dir,
        write_targets,
        protected_targets,
        allow_mutating_probe,
        None,
        false,
    )
}

fn reject_colliding_catalog_targets_with_options(
    root_dir: &Path,
    write_targets: &[(&str, PathBuf)],
    protected_targets: &[(&str, PathBuf)],
    allow_mutating_probe: bool,
    equivalence_override: Option<(DirFilenameEquivalence, bool)>,
    disable_identities: bool,
) -> Result<(), CliError> {
    if write_targets.is_empty() || (write_targets.len() == 1 && protected_targets.is_empty()) {
        return Ok(());
    }
    let mut dir_eq_cache: HashMap<FileIdentity, (DirFilenameEquivalence, bool)> = HashMap::new();
    let mut short_name_cache: HashMap<FileIdentity, bool> = HashMap::new();
    let mut tailless_short_name_cache: HashMap<FileIdentity, bool> = HashMap::new();
    let mut anchor_tries: HashMap<ExtractTargetAnchor, TargetPrefixNode<'_>> = HashMap::new();
    let mut seen_identities: HashMap<FileIdentity, (&str, PathBuf)> = HashMap::new();
    let mut needed_existing_dirs: HashMap<FileIdentity, &str> = HashMap::new();

    // Process all write targets first (recording them into the trie and
    // identity maps), then validate protected targets read-only against the
    // recorded write targets so protected paths never conflict with each other.
    let ordered_targets = write_targets
        .iter()
        .map(|(scope, path)| (*scope, path, true))
        .chain(
            protected_targets
                .iter()
                .map(|(scope, path)| (*scope, path, false)),
        );

    for (scope, catalog_path, is_write) in ordered_targets {
        let (relative_parent, file_name) = split_relative_catalog_path(root_dir, catalog_path)
            .map_err(|error| CliError::Io {
                path: catalog_path.clone(),
                source: error.into_io_error(),
            })?;

        let root_handle = ContainedDir::open_root(root_dir).map_err(|error| CliError::Io {
            path: root_dir.to_path_buf(),
            source: error.into_io_error(),
        })?;
        let mut current_id = if disable_identities {
            None
        } else {
            root_handle.self_identity().map_err(|error| CliError::Io {
                path: root_dir.to_path_buf(),
                source: error.into_io_error(),
            })?
        };
        let (mut current_eq, mut current_eq_confirmed) =
            equivalence_override.unwrap_or_else(|| {
                resolve_directory_equivalence(&root_handle, current_id, &mut dir_eq_cache)
            });
        let mut anchor =
            current_id.map_or(ExtractTargetAnchor::Root, ExtractTargetAnchor::Identity);
        let mut segment_dirs: Vec<ContainedDir> = vec![root_handle];
        let mut segments: Vec<TargetSegment> = Vec::new();
        let mut hit_missing = false;

        for component in relative_parent.components() {
            let std::path::Component::Normal(segment) = component else {
                continue;
            };
            let parent_dir_idx = segment_dirs.len() - 1;
            if hit_missing {
                segments.push(TargetSegment {
                    raw: segment.to_os_string(),
                    folded: fold_os_segment_for_bucket(segment, current_eq, current_eq_confirmed),
                    eq: current_eq,
                    eq_confirmed: current_eq_confirmed,
                    dir_idx: parent_dir_idx,
                    parent_id: current_id,
                    settled_by_identity: false,
                });
                continue;
            }
            match segment_dirs[parent_dir_idx]
                .open_existing_child_dir(segment)
                .map_err(|error| CliError::Io {
                    path: catalog_path.clone(),
                    source: error.into_io_error(),
                })? {
                Some(child) => {
                    let child_id = if disable_identities {
                        None
                    } else {
                        child.self_identity().map_err(|error| CliError::Io {
                            path: catalog_path.clone(),
                            source: error.into_io_error(),
                        })?
                    };
                    if let Some(id) = child_id {
                        if let Some((file_scope, _)) = seen_identities.get(&id) {
                            return Err(CliError::Io {
                                path: catalog_path.clone(),
                                source: std::io::Error::new(
                                    std::io::ErrorKind::AlreadyExists,
                                    format!(
                                        "catalog scope {scope:?} requires a directory where {file_scope:?} writes a catalog file",
                                    ),
                                ),
                            });
                        }
                        if is_write {
                            needed_existing_dirs.entry(id).or_insert(scope);
                        }
                    }
                    let (child_eq, child_eq_confirmed) =
                        equivalence_override.unwrap_or_else(|| {
                            resolve_directory_equivalence(&child, child_id, &mut dir_eq_cache)
                        });
                    if segments.is_empty()
                        && let Some(id) = child_id
                    {
                        // Advance the identity-keyed anchor whenever every
                        // existing directory along the prefix has a valid ID.
                        anchor = ExtractTargetAnchor::Identity(id);
                        segment_dirs[0] = child;
                    } else {
                        // When a volume does not expose file IDs, keep the
                        // segment inside the shared ancestor trie so spellings
                        // such as `Locales` and `locales` are compared under
                        // the parent directory's equivalence rules instead of
                        // splitting into separate path-keyed tries.
                        segments.push(TargetSegment {
                            raw: segment.to_os_string(),
                            folded: fold_os_segment_for_bucket(
                                segment,
                                current_eq,
                                current_eq_confirmed,
                            ),
                            eq: current_eq,
                            eq_confirmed: current_eq_confirmed,
                            dir_idx: parent_dir_idx,
                            parent_id: current_id,
                            settled_by_identity: false,
                        });
                        segment_dirs.push(child);
                    }
                    current_id = child_id;
                    current_eq = child_eq;
                    current_eq_confirmed = child_eq_confirmed;
                }
                None => {
                    hit_missing = true;
                    segments.push(TargetSegment {
                        raw: segment.to_os_string(),
                        folded: fold_os_segment_for_bucket(
                            segment,
                            current_eq,
                            current_eq_confirmed,
                        ),
                        eq: current_eq,
                        eq_confirmed: current_eq_confirmed,
                        dir_idx: parent_dir_idx,
                        parent_id: current_id,
                        settled_by_identity: false,
                    });
                }
            }
        }

        let leaf_dir_idx = segment_dirs.len() - 1;
        let leaf_identity = if !hit_missing && !disable_identities {
            segment_dirs[leaf_dir_idx]
                .file_identity(&file_name)
                .map_err(|error| CliError::Io {
                    path: catalog_path.clone(),
                    source: error.into_io_error(),
                })?
        } else {
            None
        };
        segments.push(TargetSegment {
            raw: file_name.clone(),
            folded: fold_os_segment_for_bucket(&file_name, current_eq, current_eq_confirmed),
            eq: current_eq,
            eq_confirmed: current_eq_confirmed,
            dir_idx: leaf_dir_idx,
            parent_id: current_id,
            settled_by_identity: !hit_missing && leaf_identity.is_some(),
        });

        if let Some(root_node) = anchor_tries.get(&anchor) {
            root_node.check_path_conflicts_readonly(
                &segments,
                &segment_dirs,
                scope,
                catalog_path,
                allow_mutating_probe,
                &mut short_name_cache,
                &mut tailless_short_name_cache,
            )?;
        }
        if is_write {
            anchor_tries.entry(anchor).or_default().record_write_path(
                &segments,
                &segment_dirs,
                scope,
                allow_mutating_probe,
            );
        }

        if let Some(identity) = leaf_identity {
            if let Some(dir_scope) = needed_existing_dirs.get(&identity) {
                return Err(CliError::Io {
                    path: catalog_path.clone(),
                    source: std::io::Error::new(
                        std::io::ErrorKind::AlreadyExists,
                        format!(
                            "catalog scope {scope:?} writes a file where {dir_scope:?} requires a parent directory",
                        ),
                    ),
                });
            }
            if is_write {
                if let Some((first_scope, _)) =
                    seen_identities.insert(identity, (scope, catalog_path.clone()))
                {
                    return Err(CliError::Io {
                        path: catalog_path.clone(),
                        source: std::io::Error::new(
                            std::io::ErrorKind::AlreadyExists,
                            format!(
                                "multiple catalog scopes ({first_scope:?} and {scope:?}) resolve to the same on-disk catalog file",
                            ),
                        ),
                    });
                }
            } else if let Some((first_scope, _)) = seen_identities.get(&identity) {
                return Err(CliError::Io {
                    path: catalog_path.clone(),
                    source: std::io::Error::new(
                        std::io::ErrorKind::AlreadyExists,
                        format!(
                            "multiple catalog scopes ({first_scope:?} and {scope:?}) resolve to the same on-disk catalog file",
                        ),
                    ),
                });
            }
        }
    }
    Ok(())
}

fn process_catalog(
    catalog: &ConfigCatalog,
    locale: &str,
    messages: &[CatalogUpdateMessage],
    config: &LoadedConfig,
    options: &ExtractOptions,
    operation: CatalogOperation,
) -> Result<CatalogJobOutcome, CliError> {
    let catalog_path =
        config.resolve_contained_catalog_path(&catalog.path, locale, catalog.format)?;
    let (relative_parent, file_name) = split_relative_catalog_path(&config.root_dir, &catalog_path)
        .map_err(|error| CliError::Io {
            path: catalog_path.clone(),
            source: error.into_io_error(),
        })?;
    let po_options = catalog.po.clone().map(Into::into);
    let target_path = catalog_path.to_string_lossy();
    let update_request = CatalogUpdateRequestRef {
        target_path: target_path.as_ref(),
        locale,
        source_locale: &config.source_locale,
        clean: options.clean,
        force_clean: options.force_clean,
        format: catalog.format,
        po: po_options.as_ref(),
        messages,
    };

    let mut lines = Vec::new();
    let drift = match operation {
        CatalogOperation::Write => {
            // Preview an existing catalog before acquiring a write lock so an
            // already up-to-date catalog in a read-only directory succeeds
            // without attempting to create a lock file, and reuse that preview
            // when the locked re-read confirms no concurrent writer changed it.
            let mut unchanged_result = None;
            let mut unlocked_preview = None;
            if let Some(existing_dir) =
                ContainedDir::open_subpath(&config.root_dir, &relative_parent, false).map_err(
                    |error| CliError::Io {
                        path: catalog_path.clone(),
                        source: error.into_io_error(),
                    },
                )?
            {
                let existing = existing_dir
                    .read_optional_file(&file_name)
                    .map_err(|error| CliError::Io {
                        path: catalog_path.clone(),
                        source: error.into_io_error(),
                    })?;
                let preview =
                    preview_catalog_update_from_content_ref(&update_request, existing.as_deref())?;
                if !preview.created && !preview.updated {
                    unchanged_result = Some(preview);
                } else {
                    unlocked_preview = Some((existing, preview));
                }
            }
            let result = match unchanged_result {
                Some(unchanged) => unchanged,
                None => {
                    let parent_dir =
                        ContainedDir::open_subpath(&config.root_dir, &relative_parent, true)
                            .map_err(|error| CliError::Io {
                                path: catalog_path.clone(),
                                source: error.into_io_error(),
                            })?
                            .expect("create_missing always opens the destination directory");
                    let _target_lock =
                        parent_dir
                            .lock_target(&file_name)
                            .map_err(|error| CliError::Io {
                                path: catalog_path.clone(),
                                source: error.into_io_error(),
                            })?;
                    // Re-read under the exclusive lock and carry the read bytes
                    // as a content precondition into atomic publication. If an
                    // external editor modifies the catalog in place before
                    // publication, re-read and re-merge rather than discarding
                    // the concurrent edit.
                    let mut preview_candidate = unlocked_preview;
                    let mut locked_result = None;
                    for attempt in 0..4 {
                        let existing =
                            parent_dir.read_optional_file(&file_name).map_err(|error| {
                                CliError::Io {
                                    path: catalog_path.clone(),
                                    source: error.into_io_error(),
                                }
                            })?;
                        let result = match preview_candidate.take() {
                            Some((prior_bytes, preview)) if prior_bytes == existing => preview,
                            _ => preview_catalog_update_from_content_ref(
                                &update_request,
                                existing.as_deref(),
                            )?,
                        };
                        if result.created || result.updated {
                            match parent_dir.write_file_atomically_if_unchanged(
                                &file_name,
                                result.content.as_bytes(),
                                existing.as_deref().map(str::as_bytes),
                                ContainedNewFileMode::Private,
                                ContainedWriteDurability::Rename,
                            ) {
                                Ok(_) => {
                                    locked_result = Some(result);
                                    break;
                                }
                                Err(ContainedFsError::Io(ref io_err))
                                    if io_err.kind() == std::io::ErrorKind::AlreadyExists
                                        && attempt + 1 < 4 =>
                                {
                                    continue;
                                }
                                Err(error) => {
                                    return Err(CliError::Io {
                                        path: catalog_path.clone(),
                                        source: error.into_io_error(),
                                    });
                                }
                            }
                        } else {
                            locked_result = Some(result);
                            break;
                        }
                    }
                    locked_result.expect("write loop always terminates with result or error")
                }
            };
            if options.verbose {
                lines.push(format!("  -> {}", catalog_path.display()));
                for diagnostic in result.diagnostics {
                    lines.push(tr!(
                        "Warning: {code}: {message}",
                        code = diagnostic.code,
                        message = diagnostic.message
                    ));
                }
            }
            None
        }
        CatalogOperation::Preview => {
            let existing =
                match ContainedDir::open_subpath(&config.root_dir, &relative_parent, false)
                    .map_err(|error| CliError::Io {
                        path: catalog_path.clone(),
                        source: error.into_io_error(),
                    })? {
                    Some(parent_dir) => {
                        parent_dir
                            .read_optional_file(&file_name)
                            .map_err(|error| CliError::Io {
                                path: catalog_path.clone(),
                                source: error.into_io_error(),
                            })?
                    }
                    None => None,
                };
            let result =
                preview_catalog_update_from_content_ref(&update_request, existing.as_deref())?;
            if options.verbose {
                lines.push(tr!("  -> checked {path}", path = catalog_path.display()));
                for diagnostic in result.diagnostics {
                    lines.push(tr!(
                        "Warning: {code}: {message}",
                        code = diagnostic.code,
                        message = diagnostic.message
                    ));
                }
            }
            let change = if result.created {
                Some(CatalogChangeKind::Created)
            } else if result.updated {
                Some(CatalogChangeKind::Modified)
            } else {
                None
            };
            change.map(|change| CatalogDrift {
                path: stable_catalog_path(&catalog_path, &config.root_dir),
                change,
            })
        }
    };

    Ok(CatalogJobOutcome { lines, drift })
}

fn stable_catalog_path(path: &Path, root: &Path) -> String {
    let relative = path.strip_prefix(root).unwrap_or(path);
    let value = relative.to_string_lossy();
    if std::path::MAIN_SEPARATOR == '\\' {
        value.replace('\\', "/")
    } else {
        value.into_owned()
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use palamedes::ExtractCache;

    use super::cache::{extract_cache_path, load_extract_cache};
    use super::test_support::{age_file, cached_extract_options, extract_options};
    use super::{run_extraction, run_extraction_with_cache};
    use crate::commands::test_support::{temp_dir, write_config};
    use crate::config::load_config;
    use crate::error::CliError;

    #[test]
    fn extract_writes_git_relative_origins_from_yaml_config() {
        let repo = temp_dir("extract-git");
        fs::create_dir(repo.join(".git")).expect("create git marker");
        let app = repo.join("apps/web");
        fs::create_dir_all(app.join("app")).expect("create app");
        write_config(&app, None);
        fs::write(
            app.join("app/page.tsx"),
            "import { t } from \"@palamedes/core/macro\";\nexport function title() { return t`Dashboard`; }\n",
        )
        .expect("write source");

        let config = load_config(&app, Some(&app.join("palamedes.yaml"))).expect("load config");
        run_extraction(&config, &extract_options()).expect("extract");

        let output = fs::read_to_string(app.join("locales/en/messages.po")).expect("read po");
        assert!(output.contains("msgid \"Dashboard\""));
        assert!(output.contains("#: apps/web/app/page.tsx#title"));
    }

    #[test]
    fn extract_appends_the_storage_extension_to_a_dotted_catalog_name() {
        let app = temp_dir("extract-dotted-catalog-name");
        fs::create_dir_all(app.join("app")).expect("create app");
        fs::write(
            app.join("palamedes.yaml"),
            r#"locales: [en]
source-locale: en
catalogs:
  - path: locales/{locale}/messages.v2
    include: [app]
"#,
        )
        .expect("write config");
        fs::write(
            app.join("app/page.tsx"),
            "import { t } from \"@palamedes/core/macro\";\nexport function title() { return t`Dashboard`; }\n",
        )
        .expect("write source");

        let config = load_config(&app, Some(&app.join("palamedes.yaml"))).expect("load config");
        run_extraction(&config, &extract_options()).expect("extract");

        let output =
            fs::read_to_string(app.join("locales/en/messages.v2.po")).expect("read dotted catalog");
        assert!(output.contains("msgid \"Dashboard\""));
        assert!(!app.join("locales/en/messages.po").exists());
    }

    #[test]
    fn extract_applies_per_catalog_po_output_options() {
        let app = temp_dir("extract-po-options");
        fs::create_dir_all(app.join("app")).expect("create app");
        fs::write(
            app.join("palamedes.yaml"),
            r#"locales: [en]
source-locale: en
source-reference-root: config
catalogs:
  - path: locales/{locale}/messages
    include: [app]
    po:
      line-breaks: "off"
"#,
        )
        .expect("write config");
        let long = "This deliberately long extracted message remains on one physical PO line even though it exceeds the default folding width.";
        fs::write(
            app.join("app/page.tsx"),
            format!(
                concat!(
                    "import {{ t }} from \"@palamedes/core/macro\";\n",
                    "export function message() {{ return t`{long}`; }}\n",
                    "export function a() {{ return t`Zebra`; }}\n",
                    "export function b() {{ return t`Álgebra`; }}\n",
                    "export function c() {{ return t`über`; }}\n",
                    "export function d() {{ return t`Uber`; }}\n"
                ),
                long = long
            ),
        )
        .expect("write source");

        let config = load_config(&app, Some(&app.join("palamedes.yaml"))).expect("load config");
        run_extraction(&config, &extract_options()).expect("extract");

        let output = fs::read_to_string(app.join("locales/en/messages.po")).expect("read po");
        assert!(
            output
                .lines()
                .any(|line| line == format!("msgid \"{long}\"")),
            "{output}"
        );
        assert!(
            output
                .lines()
                .any(|line| line == format!("msgstr \"{long}\"")),
            "{output}"
        );

        /*
         * Collated ordering has to survive the whole CLI path, not just the
         * core: code-point order would put "Zebra" ahead of "Álgebra".
         */
        let order = output
            .lines()
            .filter_map(|line| line.strip_prefix("msgid \""))
            .filter(|line| !line.is_empty() && *line != "\"")
            .map(|line| line.trim_end_matches('"').to_owned())
            .filter(|msgid| msgid != long)
            .collect::<Vec<_>>();
        assert_eq!(order, vec!["Álgebra", "Uber", "über", "Zebra"], "{output}");
    }

    #[test]
    fn force_clean_keeps_lingui_apostrophe_translations_and_is_idempotent() {
        let app = temp_dir("extract-apostrophe-migration");
        fs::create_dir_all(app.join("app")).expect("create app");
        fs::create_dir_all(app.join("locales/de")).expect("create target locale");
        write_config(&app, Some("config"));
        fs::write(
            app.join("app/page.tsx"),
            concat!(
                "import { t } from \"@palamedes/core/macro\";\n",
                "export function messages() {\n",
                "  const contraction = t`don't stop`;\n",
                "  const possessive = t`client's booking`;\n",
                "  const summer = t`l'été`;\n",
                "  const doubled = t`It''s ready`;\n",
                "  const boundary = t`L'${title}`;\n",
                "  return [contraction, possessive, summer, doubled, boundary];\n",
                "}\n",
            ),
        )
        .expect("write source");
        fs::write(
            app.join("locales/de/messages.po"),
            concat!(
                "msgid \"don't stop\"\n",
                "msgstr \"nicht aufhören\"\n\n",
                "msgid \"client's booking\"\n",
                "msgstr \"Buchung des Kunden\"\n\n",
                "msgid \"l'été\"\n",
                "msgstr \"der Sommer\"\n\n",
                "msgid \"It''s ready\"\n",
                "msgstr \"Es ist fertig\"\n",
            ),
        )
        .expect("write Lingui target catalog");

        let config = load_config(&app, Some(&app.join("palamedes.yaml"))).expect("load config");
        let mut options = extract_options();
        options.force_clean = true;
        run_extraction(&config, &options).expect("force-clean extraction");

        let source = fs::read_to_string(app.join("locales/en/messages.po")).expect("read source");
        for identity in [
            "don't stop",
            "client's booking",
            "l'été",
            // A doubled authored apostrophe renders one apostrophe, so a new
            // catalog stores its shortest spelling.
            "It's ready",
            "L''{title}",
        ] {
            assert!(
                source.contains(&format!("msgid \"{identity}\"")),
                "missing source identity {identity:?}:\n{source}"
            );
        }

        let target = fs::read_to_string(app.join("locales/de/messages.po")).expect("read target");
        for translation in [
            "nicht aufhören",
            "Buchung des Kunden",
            "der Sommer",
            "Es ist fertig",
        ] {
            assert!(
                target.contains(&format!("msgstr \"{translation}\"")),
                "{target}"
            );
        }
        assert!(!target.contains("msgid \"don''t stop\""), "{target}");
        // The existing doubled spelling keeps its translation attached.
        assert!(target.contains("msgid \"It''s ready\""), "{target}");

        run_extraction(&config, &options).expect("repeat force-clean extraction");
        assert_eq!(
            fs::read_to_string(app.join("locales/de/messages.po")).expect("read repeated target"),
            target
        );
    }

    #[test]
    fn extract_discovers_mdx_and_uses_shared_configured_semantics() {
        let app = temp_dir("extract-mdx");
        fs::create_dir_all(app.join("app")).expect("create app");
        fs::write(
            app.join("palamedes.yaml"),
            r#"locales: [en, de]
source-locale: en
source-reference-root: config
mdx:
  translatable-attributes: [alt, title]
  front-matter-fields: [title]
catalogs:
  - path: locales/{locale}/messages
    include: [app]
"#,
        )
        .expect("write config");
        fs::write(
            app.join("app/guide.mdx"),
            r#"---
title: Getting started
slug: getting-started
---

# Welcome {name}

<Card title="Open settings">Read the **guide**.</Card>
"#,
        )
        .expect("write MDX source");

        let config = load_config(&app, Some(&app.join("palamedes.yaml"))).expect("load config");
        run_extraction(&config, &extract_options()).expect("extract");

        let output = fs::read_to_string(app.join("locales/en/messages.po")).expect("read po");
        assert!(output.contains("msgid \"Getting started\""), "{output}");
        assert!(output.contains("msgid \"Welcome {name}\""), "{output}");
        assert!(output.contains("msgid \"Open settings\""), "{output}");
        assert!(
            output.contains("msgid \"<0>Read the <1>guide</1>.</0>\""),
            "{output}"
        );
        assert!(output.contains("#: app/guide.mdx"), "{output}");
        assert!(!output.contains("getting-started"), "{output}");
    }

    #[test]
    fn extract_supports_config_relative_origins() {
        let app = temp_dir("extract-config");
        fs::create_dir_all(app.join("app")).expect("create app");
        write_config(&app, Some("config"));
        fs::write(
            app.join("app/page.tsx"),
            "import { t } from \"@palamedes/core/macro\";\nexport function title() { return t`Dashboard`; }\n",
        )
        .expect("write source");

        let config = load_config(&app, Some(&app.join("palamedes.yaml"))).expect("load config");
        run_extraction(&config, &extract_options()).expect("extract");

        let output = fs::read_to_string(app.join("locales/en/messages.po")).expect("read po");
        assert!(output.contains("#: app/page.tsx"));
    }

    #[test]
    fn extract_can_disable_reference_scopes() {
        let app = temp_dir("extract-without-reference-scopes");
        fs::create_dir_all(app.join("app")).expect("create app");
        fs::write(
            app.join("palamedes.yaml"),
            r#"locales: [en, de]
source-locale: en
source-reference-root: config
reference-scopes: false
catalogs:
  - path: locales/{locale}/messages
    include: [app]
"#,
        )
        .expect("write config");
        fs::write(
            app.join("app/page.tsx"),
            concat!(
                "import { t } from \"@palamedes/core/macro\";\n",
                "export function title() { return t`Dashboard`; }\n",
                "export function repeatedTitle() { return t`Dashboard`; }\n",
            ),
        )
        .expect("write source");

        let config = load_config(&app, Some(&app.join("palamedes.yaml"))).expect("load config");
        run_extraction(&config, &extract_options()).expect("extract");

        let output = fs::read_to_string(app.join("locales/en/messages.po")).expect("read po");
        assert!(output.contains("#: app/page.tsx\n"));
        assert!(!output.contains("#title"));
        assert_eq!(output.matches("#: app/page.tsx\n").count(), 1);

        run_extraction(&config, &extract_options()).expect("repeat extraction");
        assert_eq!(
            fs::read_to_string(app.join("locales/en/messages.po")).expect("read repeated po"),
            output
        );
    }

    #[test]
    fn extract_matches_dot_path_include() {
        let app = temp_dir("extract-dot");
        fs::create_dir_all(app.join("app")).expect("create app");
        fs::write(
            app.join("palamedes.yaml"),
            r#"locales: [en, de]
source-locale: en
source-reference-root: config
catalogs:
  - path: locales/{locale}/messages
    include: ["."]
"#,
        )
        .expect("write config");
        fs::write(
            app.join("app/page.tsx"),
            "import { t } from \"@palamedes/core/macro\";\nexport function title() { return t`Dashboard`; }\n",
        )
        .expect("write source");

        let config = load_config(&app, Some(&app.join("palamedes.yaml"))).expect("load config");
        run_extraction(&config, &extract_options()).expect("extract");

        let output = fs::read_to_string(app.join("locales/en/messages.po")).expect("read po");
        assert!(
            output.contains("msgid \"Dashboard\""),
            "dot-path include should extract messages, got:\n{output}"
        );
    }

    #[test]
    fn extraction_failures_leave_existing_catalogs_unchanged() {
        let app = temp_dir("extract-failure");
        fs::create_dir_all(app.join("app")).expect("create app");
        write_config(&app, None);
        // The macro import keeps the file on the parsing path; marker-free
        // files skip the parse and can no longer fail extraction.
        fs::write(
            app.join("app/page.tsx"),
            "import { t } from \"@palamedes/core/macro\"\nconst broken =",
        )
        .expect("write invalid source");
        fs::create_dir_all(app.join("locales/en")).expect("create source locale");
        let catalog_path = app.join("locales/en/messages.po");
        let original = "msgid \"Existing\"\nmsgstr \"Existing\"\n";
        fs::write(&catalog_path, original).expect("write existing catalog");

        let config = load_config(&app, Some(&app.join("palamedes.yaml"))).expect("load config");
        let error = run_extraction(&config, &extract_options()).expect_err("extract should fail");

        assert!(matches!(error, CliError::ExtractionFailed { failures: 1 }));
        assert_eq!(
            fs::read_to_string(catalog_path).expect("read existing catalog"),
            original
        );
        assert!(!app.join("locales/de/messages.po").exists());
    }

    /*
     * Overlapping catalogs match the same file, and a failing file used to be
     * counted and reported once per catalog that matched it.
     */
    #[test]
    fn overlapping_catalogs_count_a_failing_file_once() {
        let app = temp_dir("extract-overlap-failure");
        fs::create_dir_all(app.join("app")).expect("create app");
        fs::write(
            app.join("palamedes.yaml"),
            r#"locales: [en]
source-locale: en
source-reference-root: config
catalogs:
  - path: locales/{locale}/messages
    include: [app]
  - path: locales/{locale}/other
    include: [app]
"#,
        )
        .expect("write config");
        fs::write(
            app.join("app/page.tsx"),
            "import { t } from \"@palamedes/core/macro\"\nconst broken =",
        )
        .expect("write invalid source");

        let config = load_config(&app, Some(&app.join("palamedes.yaml"))).expect("load config");
        let error = run_extraction(&config, &extract_options()).expect_err("extract should fail");

        assert!(
            matches!(error, CliError::ExtractionFailed { failures: 1 }),
            "the shared failing file must be counted once, got: {error:?}"
        );
    }

    /*
     * Retention sees the union of every catalog's files. Running it per catalog
     * made each catalog evict its siblings' entries, so a multi-catalog project
     * re-extracted almost everything on every run.
     */
    #[test]
    fn multi_catalog_extraction_keeps_every_catalog_cached() {
        let app = temp_dir("extract-multi-catalog-cache");
        fs::create_dir_all(app.join("app")).expect("create app");
        fs::create_dir_all(app.join("admin")).expect("create admin");
        fs::write(
            app.join("palamedes.yaml"),
            r#"locales: [en]
source-locale: en
source-reference-root: config
catalogs:
  - path: locales/{locale}/app
    include: [app]
  - path: locales/{locale}/admin
    include: [admin]
"#,
        )
        .expect("write config");
        for (dir, message) in [("app", "Dashboard"), ("admin", "Settings")] {
            let path = app.join(dir).join("page.tsx");
            fs::write(
                &path,
                format!(
                    "import {{ t }} from \"@palamedes/core/macro\";\nexport function title() {{ return t`{message}`; }}\n"
                ),
            )
            .expect("write source");
            age_file(&path);
        }

        let options = cached_extract_options();
        let config = load_config(&app, Some(&app.join("palamedes.yaml"))).expect("load config");
        let mut cache = load_extract_cache(&config, options.no_cache);
        run_extraction_with_cache(&config, &options, &mut cache).expect("extract");

        assert_eq!(
            cache.len(),
            2,
            "retention must keep the entries of every catalog"
        );
        assert!(
            fs::read_to_string(app.join("locales/en/app.po"))
                .expect("read app catalog")
                .contains("msgid \"Dashboard\"")
        );
        assert!(
            fs::read_to_string(app.join("locales/en/admin.po"))
                .expect("read admin catalog")
                .contains("msgid \"Settings\"")
        );
    }

    /*
     * The cache must never change what is written. This runs a cold run, a
     * mixed hit/miss run after touching one file, and an uncached run, and
     * requires all three catalogs to be byte-identical.
     */
    #[test]
    fn cached_extraction_matches_uncached_output() {
        let app = temp_dir("extract-cache-parity");
        fs::create_dir_all(app.join("app")).expect("create app");
        write_config(&app, None);
        fs::write(
            app.join("app/page.tsx"),
            "import { t } from \"@palamedes/core/macro\";\nexport function title() { return t`Dashboard`; }\n",
        )
        .expect("write source");
        fs::write(
            app.join("app/other.tsx"),
            "import { t } from \"@palamedes/core/macro\";\nexport function label() { return t`Reports`; }\n",
        )
        .expect("write source");

        let options = cached_extract_options();
        let config = load_config(&app, Some(&app.join("palamedes.yaml"))).expect("load config");
        let catalog_path = app.join("locales/en/messages.po");

        let mut cache = load_extract_cache(&config, options.no_cache);
        run_extraction_with_cache(&config, &options, &mut cache).expect("cold cached run");
        let cold = fs::read_to_string(&catalog_path).expect("read catalog");

        // One file changes, the other is served from the cache.
        fs::write(
            app.join("app/other.tsx"),
            "import { t } from \"@palamedes/core/macro\";\nexport function label() { return t`Reports overview`; }\n",
        )
        .expect("rewrite source");
        run_extraction_with_cache(&config, &options, &mut cache).expect("mixed hit/miss run");
        let mixed = fs::read_to_string(&catalog_path).expect("read catalog");

        let mut uncached = ExtractCache::disabled();
        run_extraction_with_cache(&config, &extract_options(), &mut uncached)
            .expect("uncached run");
        let plain = fs::read_to_string(&catalog_path).expect("read catalog");

        assert_eq!(mixed, plain, "cached output must match --no-cache output");
        assert_ne!(cold, mixed, "the edited message must reach the catalog");
        assert!(mixed.contains("msgid \"Reports overview\""));
        assert!(mixed.contains("msgid \"Dashboard\""));
        assert!(extract_cache_path(&config).exists() || cache.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn extract_refuses_to_write_through_symlink_escaping_root_dir() {
        use std::os::unix::fs::symlink;

        let outside = temp_dir("extract-symlink-outside");
        let app = temp_dir("extract-symlink-app");
        fs::create_dir_all(app.join("app")).expect("create app");
        write_config(&app, Some("config"));
        fs::write(
            app.join("app/page.tsx"),
            "import { t } from \"@palamedes/core/macro\";\nexport function title() { return t`Dashboard`; }\n",
        )
        .expect("write source");
        symlink(&outside, app.join("locales")).expect("symlink locales outside root");

        let config = load_config(&app, Some(&app.join("palamedes.yaml"))).expect("load config");
        let error = run_extraction(&config, &extract_options())
            .expect_err("extraction through escaping symlink must fail");

        assert!(
            error.to_string().contains("escapes root directory"),
            "unexpected error: {error}"
        );
        assert!(!outside.join("en/messages.po").exists());
    }

    #[test]
    fn extract_rejects_colliding_normalized_and_case_aliased_targets_before_writing() {
        let app = temp_dir("extract-colliding-scopes");
        fs::create_dir_all(app.join("app/a")).expect("create app/a");
        fs::create_dir_all(app.join("app/b")).expect("create app/b");
        fs::write(
            app.join("app/a/page.tsx"),
            "import { t } from \"@palamedes/core/macro\";\nexport function a() { return t`Alpha`; }\n",
        )
        .expect("write a");
        fs::write(
            app.join("app/b/page.tsx"),
            "import { t } from \"@palamedes/core/macro\";\nexport function b() { return t`Beta`; }\n",
        )
        .expect("write b");

        // Portable separator collision on clean checkout (no existing catalogs).
        fs::write(
            app.join("palamedes.yaml"),
            "locales: [en]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}/messages\n    include: [app/a]\n  - path: locales\\{locale}\\messages\n    include: [app/b]\n",
        )
        .expect("write config");
        let config = load_config(&app, Some(&app.join("palamedes.yaml"))).expect("load config");
        let error = run_extraction(&config, &extract_options())
            .expect_err("colliding separator-normalized extract scopes must be rejected");
        assert!(
            error
                .to_string()
                .contains("resolve to the same target file"),
            "unexpected error: {error}"
        );
        assert!(!app.join("locales/en/messages.po").exists());

        // Case-insensitive collision on clean checkout (when running on a case-insensitive volume).
        let is_ci = super::ContainedDir::open_root(&app)
            .expect("open root")
            .is_case_insensitive()
            .unwrap_or(cfg!(any(target_os = "macos", target_os = "windows")));
        if is_ci {
            fs::write(
                app.join("palamedes.yaml"),
                "locales: [en]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}/Messages\n    include: [app/a]\n  - path: locales/{locale}/messages\n    include: [app/b]\n",
            )
            .expect("write case-aliased config");
            let config = load_config(&app, Some(&app.join("palamedes.yaml"))).expect("load config");
            let error = run_extraction(&config, &extract_options())
                .expect_err("case-aliased extract scopes on case-insensitive volume must fail");
            assert!(
                error
                    .to_string()
                    .contains("resolve to the same target file"),
                "unexpected error: {error}"
            );
            assert!(!app.join("locales/en/messages.po").exists());
            assert!(!app.join("locales/en/Messages.po").exists());
        }

        use palamedes::DirFilenameEquivalence;

        let root_dir = super::ContainedDir::open_root(&app).expect("open root");
        let equivalence = root_dir
            .filename_equivalence()
            .unwrap_or(DirFilenameEquivalence::Exact);
        let is_unicode_norm = matches!(
            equivalence,
            DirFilenameEquivalence::UnicodeNfd
                | DirFilenameEquivalence::UnicodeHfsPlus
                | DirFilenameEquivalence::CaseInsensitiveUnicodeNfd
                | DirFilenameEquivalence::CaseInsensitiveHfsPlus
                | DirFilenameEquivalence::CaseInsensitiveUnicodeNfdicf
        );
        // Unicode NFC vs NFD collision on clean checkout (for example APFS/HFS+).
        let unicode_norm_aliases = root_dir
            .probe_names_equivalent(
                std::ffi::OsStr::new("caf\u{00e9}.po"),
                std::ffi::OsStr::new("cafe\u{0301}.po"),
            )
            .unwrap_or(is_unicode_norm);
        if unicode_norm_aliases {
            fs::write(
                app.join("palamedes.yaml"),
                "locales: [en]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}/caf\u{00e9}\n    include: [app/a]\n  - path: locales/{locale}/cafe\u{0301}\n    include: [app/b]\n",
            )
            .expect("write unicode-aliased config");
            let config = load_config(&app, Some(&app.join("palamedes.yaml"))).expect("load config");
            let error = run_extraction(&config, &extract_options()).expect_err(
                "Unicode-equivalent extract scopes on a normalizing filesystem must fail",
            );
            assert!(
                error
                    .to_string()
                    .contains("resolve to the same target file"),
                "unexpected error: {error}"
            );
            assert!(!app.join("locales/en/caf\u{00e9}.po").exists());
            assert!(!app.join("locales/en/cafe\u{0301}.po").exists());
        }

        // Full Unicode multi-character case folding collision (`straße` vs
        // `strasse`) on filesystems that fold `ß` to `ss` (APFS and Linux
        // `FS_CASEFOLD_FL`, NOT HFS+ or NTFS).
        let eszett_aliases = root_dir
            .probe_names_equivalent(
                std::ffi::OsStr::new("stra\u{00df}e.po"),
                std::ffi::OsStr::new("strasse.po"),
            )
            .unwrap_or(matches!(
                equivalence,
                DirFilenameEquivalence::CaseInsensitiveUnicodeNfd
                    | DirFilenameEquivalence::CaseInsensitiveUnicodeNfdicf
            ));
        if eszett_aliases {
            fs::write(
                app.join("palamedes.yaml"),
                "locales: [en]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}/stra\u{00df}e\n    include: [app/a]\n  - path: locales/{locale}/strasse\n    include: [app/b]\n",
            )
            .expect("write casefold-aliased config");
            let config = load_config(&app, Some(&app.join("palamedes.yaml"))).expect("load config");
            let error = run_extraction(&config, &extract_options()).expect_err(
                "Unicode full-casefold extract scopes on case-insensitive normalizing filesystem must fail",
            );
            assert!(
                error
                    .to_string()
                    .contains("resolve to the same target file"),
                "unexpected error: {error}"
            );
            assert!(!app.join("locales/en/stra\u{00df}e.po").exists());
            assert!(!app.join("locales/en/strasse.po").exists());
        }

        // Greek sigma/final-sigma collision (`σ` vs `ς`) on filesystems where
        // the volume itself equates both forms (for example NTFS `$UpCase`,
        // APFS, and Linux `FS_CASEFOLD_FL`, NOT ASCII-only XFS or HFS+).
        let sigma_aliases = root_dir
            .probe_names_equivalent(
                std::ffi::OsStr::new("\u{03c3}.po"),
                std::ffi::OsStr::new("\u{03c2}.po"),
            )
            .unwrap_or(matches!(
                equivalence,
                DirFilenameEquivalence::CaseInsensitiveNtfs
                    | DirFilenameEquivalence::CaseInsensitiveUnicodeNfd
                    | DirFilenameEquivalence::CaseInsensitiveUnicodeNfdicf
            ));
        if sigma_aliases {
            fs::write(
                app.join("palamedes.yaml"),
                "locales: [en]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}/\u{03c3}\n    include: [app/a]\n  - path: locales/{locale}/\u{03c2}\n    include: [app/b]\n",
            )
            .expect("write sigma-aliased config");
            let config = load_config(&app, Some(&app.join("palamedes.yaml"))).expect("load config");
            let error = run_extraction(&config, &extract_options()).expect_err(
                "sigma/final-sigma extract scopes on case-insensitive filesystem must fail",
            );
            assert!(
                error
                    .to_string()
                    .contains("resolve to the same target file"),
                "unexpected error: {error}"
            );
            assert!(!app.join("locales/en/\u{03c3}.po").exists());
            assert!(!app.join("locales/en/\u{03c2}.po").exists());
        }
    }

    #[test]
    fn fold_os_segment_matches_filesystem_equivalence_rules() {
        use palamedes::DirFilenameEquivalence;
        use std::ffi::OsStr;

        let ntfs = DirFilenameEquivalence::CaseInsensitiveNtfs;
        assert_eq!(
            super::fold_os_segment(OsStr::new("\u{03c3}.po"), ntfs),
            super::fold_os_segment(OsStr::new("\u{03a3}.po"), ntfs),
            "NTFS uppercase folding must equate Greek lowercase sigma and capital sigma"
        );
        #[cfg(not(windows))]
        assert_eq!(
            super::fold_os_segment(OsStr::new("\u{03c3}.po"), ntfs),
            super::fold_os_segment(OsStr::new("\u{03c2}.po"), ntfs),
            "non-Windows NTFS uppercase fallback must conservatively equate Greek sigma and final sigma"
        );
        assert_ne!(
            super::fold_os_segment(OsStr::new("stra\u{00df}e.po"), ntfs),
            super::fold_os_segment(OsStr::new("strasse.po"), ntfs),
            "NTFS 1-to-1 uppercase folding keeps ß and ss distinct"
        );
        assert_ne!(
            super::fold_os_segment(OsStr::new("\u{10400}.po"), ntfs),
            super::fold_os_segment(OsStr::new("\u{10428}.po"), ntfs),
            "NTFS UTF-16 code-unit folding keeps supplementary Deseret pairs distinct"
        );

        let apfs = DirFilenameEquivalence::CaseInsensitiveUnicodeNfd;
        assert_eq!(
            super::fold_os_segment(OsStr::new("stra\u{00df}e.po"), apfs),
            super::fold_os_segment(OsStr::new("strasse.po"), apfs),
            "APFS full case folding must equate ß and ss"
        );
        assert_eq!(
            super::fold_os_segment(OsStr::new("caf\u{00e9}.po"), apfs),
            super::fold_os_segment(OsStr::new("cafe\u{0301}.po"), apfs),
            "APFS normalization must equate NFC and NFD"
        );
        assert_eq!(
            super::fold_os_segment(OsStr::new("\u{03c3}.po"), apfs),
            super::fold_os_segment(OsStr::new("\u{03c2}.po"), apfs),
            "APFS full case folding must equate Greek sigma and final sigma"
        );
        assert_ne!(
            super::fold_os_segment(OsStr::new("foo\u{00ad}bar.po"), apfs),
            super::fold_os_segment(OsStr::new("foobar.po"), apfs),
            "APFS keeps default-ignorable soft hyphens distinct"
        );

        let hfs_plus = DirFilenameEquivalence::CaseInsensitiveHfsPlus;
        assert_ne!(
            super::fold_os_segment(OsStr::new("stra\u{00df}e.po"), hfs_plus),
            super::fold_os_segment(OsStr::new("strasse.po"), hfs_plus),
            "HFS+ per-code-unit folding keeps ß and ss distinct"
        );
        assert_ne!(
            super::fold_os_segment(OsStr::new("\u{1e9e}.po"), hfs_plus),
            super::fold_os_segment(OsStr::new("\u{00df}.po"), hfs_plus),
            "HFS+ frozen Unicode 3.2 table keeps post-3.2 capital sharp S (ẞ) distinct from ß"
        );
        assert_eq!(
            super::fold_os_segment(OsStr::new("caf\u{00e9}.po"), hfs_plus),
            super::fold_os_segment(OsStr::new("cafe\u{0301}.po"), hfs_plus),
            "HFS+ normalization equates NFC and NFD"
        );
        assert_eq!(
            super::fold_os_segment(OsStr::new("foo\u{200c}bar.po"), hfs_plus),
            super::fold_os_segment(OsStr::new("foobar.po"), hfs_plus),
            "HFS+ ignores zero-width non-joiner U+200C"
        );
        assert_eq!(
            super::fold_os_segment(OsStr::new("Messages.po"), hfs_plus),
            super::fold_os_segment(OsStr::new("messages.po"), hfs_plus),
            "HFS+ equates ASCII case variants"
        );
        assert_ne!(
            super::fold_os_segment(OsStr::new("\u{f900}.po"), hfs_plus),
            super::fold_os_segment(OsStr::new("\u{8c48}.po"), hfs_plus),
            "HFS+ excludes U+F900..=U+FAFF from canonical decomposition"
        );
        assert_ne!(
            super::fold_os_segment(OsStr::new("\u{1b06}.po"), hfs_plus),
            super::fold_os_segment(OsStr::new("\u{1b05}\u{1b35}.po"), hfs_plus),
            "HFS+ frozen Unicode 3.2 NFD leaves post-3.2 Balinese U+1B06 undecomposed"
        );

        let hfs_plus_cs = DirFilenameEquivalence::UnicodeHfsPlus;
        assert_ne!(
            super::fold_os_segment(OsStr::new("\u{f900}.po"), hfs_plus_cs),
            super::fold_os_segment(OsStr::new("\u{8c48}.po"), hfs_plus_cs),
            "Case-sensitive HFS+ also excludes U+F900..=U+FAFF from decomposition"
        );
        assert_ne!(
            super::fold_os_segment(OsStr::new("\u{1b06}.po"), hfs_plus_cs),
            super::fold_os_segment(OsStr::new("\u{1b05}\u{1b35}.po"), hfs_plus_cs),
            "Case-sensitive HFS+ also leaves post-3.2 Balinese U+1B06 undecomposed"
        );
        assert_eq!(
            super::fold_os_segment(OsStr::new("\u{1b06}.po"), apfs),
            super::fold_os_segment(OsStr::new("\u{1b05}\u{1b35}.po"), apfs),
            "Modern APFS NFD decomposes Balinese U+1B06 into U+1B05 U+1B35"
        );
        assert_eq!(
            super::fold_os_segment(OsStr::new("caf\u{00e9}.po"), hfs_plus_cs),
            super::fold_os_segment(OsStr::new("cafe\u{0301}.po"), hfs_plus_cs),
            "Case-sensitive HFS+ still normalizes standard Latin NFD"
        );
        assert_ne!(
            super::fold_os_segment(OsStr::new("Messages.po"), hfs_plus_cs),
            super::fold_os_segment(OsStr::new("messages.po"), hfs_plus_cs)
        );

        let linux_casefold = DirFilenameEquivalence::CaseInsensitiveUnicodeNfdicf;
        assert_eq!(
            super::fold_os_segment(OsStr::new("foo\u{00ad}bar.po"), linux_casefold),
            super::fold_os_segment(OsStr::new("foobar.po"), linux_casefold),
            "Linux NFDICF casefold removes default-ignorable code points such as U+00AD"
        );
        assert_eq!(
            super::fold_os_segment(OsStr::new("stra\u{00df}e.po"), linux_casefold),
            super::fold_os_segment(OsStr::new("strasse.po"), linux_casefold)
        );

        let apfs_cs = DirFilenameEquivalence::UnicodeNfd;
        assert_eq!(
            super::fold_os_segment(OsStr::new("caf\u{00e9}.po"), apfs_cs),
            super::fold_os_segment(OsStr::new("cafe\u{0301}.po"), apfs_cs)
        );
        assert_ne!(
            super::fold_os_segment(OsStr::new("Messages.po"), apfs_cs),
            super::fold_os_segment(OsStr::new("messages.po"), apfs_cs)
        );

        let linux = DirFilenameEquivalence::Exact;
        assert_ne!(
            super::fold_os_segment(OsStr::new("Messages.po"), linux),
            super::fold_os_segment(OsStr::new("messages.po"), linux)
        );
        assert_ne!(
            super::fold_os_segment(OsStr::new("caf\u{00e9}.po"), linux),
            super::fold_os_segment(OsStr::new("cafe\u{0301}.po"), linux)
        );
    }

    #[cfg(unix)]
    #[test]
    fn extract_succeeds_without_changes_in_read_only_catalog_directory() {
        use std::os::unix::fs::PermissionsExt;

        let root = temp_dir("extract-ro-noop");
        let src_dir = root.join("src");
        let locales_dir = root.join("locales");
        fs::create_dir_all(&src_dir).expect("create src");
        fs::create_dir_all(&locales_dir).expect("create locales");
        fs::write(
            root.join("palamedes.yaml"),
            "locales:\n  - en\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}\n    include:\n      - src\n",
        )
        .expect("write config");
        fs::write(
            src_dir.join("app.ts"),
            "import { t } from '@palamedes/core/macro';\nexport function msg() { return t`Hello`; }\n",
        )
        .expect("write source");

        let config = load_config(&root, Some(&root.join("palamedes.yaml"))).expect("load config");
        run_extraction(&config, &extract_options()).expect("initial extract");

        fs::set_permissions(&locales_dir, fs::Permissions::from_mode(0o555))
            .expect("chmod 0555 locales");
        // Skip assertion when running as root (CAP_DAC_OVERRIDE allows writes in 0555).
        let can_write = fs::write(locales_dir.join(".probe"), b"").is_ok();
        if can_write {
            let _ = fs::remove_file(locales_dir.join(".probe"));
        } else {
            run_extraction(&config, &extract_options())
                .expect("up-to-date extract in read-only catalog directory must succeed");
        }

        fs::set_permissions(&locales_dir, fs::Permissions::from_mode(0o755))
            .expect("restore locales permissions");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn unconfirmed_case_insensitive_fallback_checks_live_directory_equivalence() {
        use super::{ContainedDir, DirFilenameEquivalence};
        use std::ffi::OsStr;

        let root = temp_dir("extract-unconfirmed-eq");
        let dir = ContainedDir::open_root(&root).expect("open temp dir");
        let actually_ci = dir
            .probe_names_equivalent(OsStr::new("Messages.po"), OsStr::new("messages.po"))
            .expect("probe live filesystem case equivalence");
        // Even if the guessed fallback says CaseInsensitiveNtfs (confirmed=false),
        // `segments_collide_on_dir` consults the actual directory/entry identities
        // instead of blindly rejecting ASCII case variants.
        assert_eq!(
            super::segments_collide_on_dir(
                &dir,
                DirFilenameEquivalence::CaseInsensitiveNtfs,
                false,
                &[],
                OsStr::new("Messages.po"),
                &[],
                OsStr::new("messages.po"),
            ),
            actually_ci
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn extract_rejects_file_versus_directory_prefix_conflict_before_writing() {
        for catalogs in [
            "  - path: locales/{locale}\n    include:\n      - src\n  - path: locales/{locale}.po/messages\n    include:\n      - src\n",
            "  - path: locales/{locale}.po/messages\n    include:\n      - src\n  - path: locales/{locale}\n    include:\n      - src\n",
        ] {
            let root = temp_dir("extract-file-dir-prefix-conflict");
            let src_dir = root.join("src");
            fs::create_dir_all(&src_dir).expect("create src");
            fs::write(
                root.join("palamedes.yaml"),
                format!("locales:\n  - en\nsource-locale: en\ncatalogs:\n{catalogs}"),
            )
            .expect("write config");
            fs::write(
                src_dir.join("app.ts"),
                "import { t } from '@palamedes/core/macro';\nexport function msg() { return t`Hello`; }\n",
            )
            .expect("write source");

            let config =
                load_config(&root, Some(&root.join("palamedes.yaml"))).expect("load config");
            let err = run_extraction(&config, &extract_options())
                .expect_err("file vs directory prefix conflict must fail before writing");
            assert!(
                matches!(
                    err,
                    CliError::Io { ref source, .. }
                        if source.kind() == std::io::ErrorKind::AlreadyExists
                ),
                "expected AlreadyExists prefix conflict error, got {err:?}"
            );
            assert!(
                !root.join("locales").exists(),
                "no catalog directory or file should be created on prefix conflict"
            );
            let _ = fs::remove_dir_all(&root);
        }
    }

    #[test]
    fn unconfirmed_equivalence_fails_closed_when_probing_is_unavailable() {
        use super::{ContainedDir, DirFilenameEquivalence};
        use std::ffi::OsStr;

        let root = temp_dir("extract-unconfirmed-no-probe");
        let dir = ContainedDir::open_root(&root).expect("open temp dir");
        // Neither `Messages.po` nor `messages.po` exists and mutating probes
        // are disallowed (`extract --check` / read-only share): without a live
        // proof that the two spellings are distinct, we must fail closed.
        assert!(super::segment_pair_collides_on_dir(
            &dir,
            DirFilenameEquivalence::CaseInsensitiveUnicodeNfdicf,
            false,
            false,
            OsStr::new("Messages.po"),
            OsStr::new("messages.po"),
        ));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn extract_rejects_reserved_lock_directory_component_before_creating_dirs() {
        let root = temp_dir("extract-reserved-lock-dir");
        let src_dir = root.join("src");
        fs::create_dir_all(&src_dir).expect("create src");
        fs::write(
            root.join("palamedes.yaml"),
            "locales:\n  - en\nsource-locale: en\ncatalogs:\n  - path: .pmds-lock/{locale}\n    include:\n      - src\n",
        )
        .expect("write config");
        fs::write(
            src_dir.join("app.ts"),
            "import { t } from '@palamedes/core/macro';\nexport function msg() { return t`Hello`; }\n",
        )
        .expect("write source");

        let err = load_config(&root, Some(&root.join("palamedes.yaml")))
            .expect_err("reserved lock directory component must be rejected in config");
        assert!(
            err.to_string().contains(".pmds-lock"),
            "unexpected config error: {err}"
        );
        assert!(
            !root.join(".pmds-lock").exists(),
            "no .pmds-lock directory should be created"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn ntfs_short_name_matching_catches_standard_and_hash_aliases() {
        use std::ffi::OsStr;

        let check_pair = |long: &str, short: &str| {
            let mut node = super::TargetPrefixNode::default();
            assert!(
                node.matching_ntfs_short_name_children(OsStr::new(long))
                    .is_empty()
            );
            node.record_ntfs_short_name_child(OsStr::new(long), 0);
            let long_first = !node
                .matching_ntfs_short_name_children(OsStr::new(short))
                .is_empty();

            let mut rev_node = super::TargetPrefixNode::default();
            assert!(
                rev_node
                    .matching_ntfs_short_name_children(OsStr::new(short))
                    .is_empty()
            );
            rev_node.record_ntfs_short_name_child(OsStr::new(short), 0);
            let short_first = !rev_node
                .matching_ntfs_short_name_children(OsStr::new(long))
                .is_empty();

            (long_first, short_first)
        };

        for (long, short) in [
            ("longfilename.po", "LONGFI~1.po"),
            ("longfilename.po", "LONGF~10.PO"),
            ("my-long-file.po", "MY1A2B~1.po"),
            ("a.b.c.po", "ABC~1.PO"),
            (".hiddenlong", "HIDDEN~1"),
            ("caf\u{00e9}.po", "CAF_~1.po"),
            ("longdirectory.v2", "LONGDI~1.V2"),
        ] {
            let (lf, sf) = check_pair(long, short);
            assert!(
                lf,
                "expected long-then-short collision for ({long:?}, {short:?})"
            );
            assert!(
                sf,
                "expected short-then-long collision for ({long:?}, {short:?})"
            );
        }

        for (left, right) in [
            ("en.po", "de.po"),
            ("longfilename.po", "OTHER~1.po"),
            ("longfilename.po", "LO~1.po"),
            ("longfilename.po", "LONGFI~1.fcl"),
            ("longfilename.po", "otherlongfilename.po"),
            ("short.po", "SHORT~1.po"),
            ("longdir.v2", "LONGDI~1.V2"),
        ] {
            let (lf, sf) = check_pair(left, right);
            assert!(
                !lf,
                "did not expect false collision for ({left:?}, {right:?})"
            );
            assert!(
                !sf,
                "did not expect false reverse collision for ({left:?}, {right:?})"
            );
        }
    }

    #[test]
    fn reject_colliding_catalog_targets_allows_distinct_existing_long_and_short_files() {
        let root = temp_dir("extract-distinct-83-existing");
        let locales = root.join("locales/en");
        fs::create_dir_all(&locales).expect("create locales");
        let long_path = locales.join("LongFilename.po");
        let short_path = locales.join("LONGFI~2.po");
        fs::write(&long_path, "msgid \"\"\nmsgstr \"\"\n").expect("write long");
        fs::write(&short_path, "msgid \"\"\nmsgstr \"\"\n").expect("write short");

        let targets = [
            ("locales/{locale}/LongFilename", long_path),
            ("locales/{locale}/LONGFI~2", short_path),
        ];
        super::reject_colliding_catalog_targets(&root, &targets, false)
            .expect("distinct existing long and short files must not be rejected");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn reject_colliding_catalog_targets_catches_vfat_trailing_dot_missing_directory_alias() {
        use palamedes::DirFilenameEquivalence;
        use std::ffi::OsStr;

        let vfat = DirFilenameEquivalence::CaseInsensitiveVfat;
        assert_eq!(
            super::fold_os_segment(OsStr::new("locales."), vfat),
            super::fold_os_segment(OsStr::new("locales"), vfat),
            "VFAT folding must strip trailing dots"
        );
        assert_eq!(
            super::fold_os_segment(OsStr::new("Locales.."), vfat),
            super::fold_os_segment(OsStr::new("locales"), vfat),
            "VFAT folding must strip multiple trailing dots and fold case"
        );

        // Missing-directory case: neither `locales` nor `locales.` exists yet
        // on disk, so inode checks cannot help. Confirmed VFAT must reject the
        // trailing-dot alias before any directory or catalog file is created.
        let root = temp_dir("extract-vfat-trailing-dot-missing-dir");
        let targets = [
            ("locales/{locale}", root.join("locales/en.po")),
            ("locales./{locale}", root.join("locales./en.po")),
        ];
        let err = super::reject_colliding_catalog_targets_with_options(
            &root,
            &targets,
            &[],
            false,
            Some((vfat, true)),
            false,
        )
        .expect_err("VFAT trailing-dot missing directory alias must be rejected");
        assert!(
            matches!(
                err,
                CliError::Io { ref source, .. }
                    if source.kind() == std::io::ErrorKind::AlreadyExists
            ),
            "expected AlreadyExists error, got {err:?}"
        );
        assert!(
            !root.join("locales").exists() && !root.join("locales.").exists(),
            "no directories should be created on VFAT alias conflict"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn reject_colliding_catalog_targets_catches_existing_dir_aliases_without_file_ids() {
        use palamedes::DirFilenameEquivalence;

        let root = temp_dir("extract-existing-dir-no-file-ids");
        fs::create_dir_all(root.join("Locales")).expect("create Locales dir");
        let targets = [
            ("Locales/{locale}", root.join("Locales/en.po")),
            ("locales/{locale}", root.join("locales/en.po")),
        ];
        let err = super::reject_colliding_catalog_targets_with_options(
            &root,
            &targets,
            &[],
            false,
            Some((DirFilenameEquivalence::CaseInsensitiveNtfs, true)),
            true,
        )
        .expect_err("case-aliased existing parent directories without FileIdInfo must collide");
        assert!(
            matches!(
                err,
                CliError::Io { ref source, .. }
                    if source.kind() == std::io::ErrorKind::AlreadyExists
            ),
            "expected AlreadyExists error, got {err:?}"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn reject_colliding_catalog_targets_distinguishes_83_aliased_dirs_with_distinct_files() {
        use palamedes::DirFilenameEquivalence;

        let root = temp_dir("extract-83-aliased-dirs");
        let ntfs = Some((DirFilenameEquivalence::CaseInsensitiveNtfs, true));

        // Distinct files under potentially 8.3-aliased parent directories must be allowed.
        let distinct = [
            ("LongDirectory/first", root.join("LongDirectory/first.po")),
            ("LONGDI~1/second", root.join("LONGDI~1/second.po")),
        ];
        super::reject_colliding_catalog_targets_with_options(
            &root,
            &distinct,
            &[],
            false,
            ntfs,
            false,
        )
        .expect("distinct files under potentially 8.3-aliased directories must succeed");

        // Same leaf filename under potentially 8.3-aliased parent directories must fail.
        let same_leaf = [
            ("LongDirectory/first", root.join("LongDirectory/first.po")),
            ("LONGDI~1/first", root.join("LONGDI~1/first.po")),
        ];
        let err = super::reject_colliding_catalog_targets_with_options(
            &root,
            &same_leaf,
            &[],
            false,
            ntfs,
            false,
        )
        .expect_err("same leaf under 8.3-aliased directories must collide");
        assert!(matches!(
            err,
            CliError::Io { ref source, .. } if source.kind() == std::io::ErrorKind::AlreadyExists
        ));

        // File vs directory prefix conflict via 8.3 alias must fail.
        let file_vs_dir = [
            ("LongDirectory/first", root.join("LongDirectory/first.po")),
            ("LONGDI~1", root.join("LONGDI~1")),
        ];
        let err = super::reject_colliding_catalog_targets_with_options(
            &root,
            &file_vs_dir,
            &[],
            false,
            ntfs,
            false,
        )
        .expect_err("file vs directory via 8.3 alias must collide");
        assert!(matches!(
            err,
            CliError::Io { ref source, .. } if source.kind() == std::io::ErrorKind::AlreadyExists
        ));

        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn reject_colliding_catalog_targets_probes_vfat_trailing_dot_equivalence() {
        use palamedes::DirFilenameEquivalence;

        let root = temp_dir("extract-vfat-keep-last-dots");
        let vfat = Some((DirFilenameEquivalence::CaseInsensitiveVfat, true));

        // On a filesystem where `locales` and `locales.` are distinct (such as
        // Linux exFAT mounted with `keep_last_dots`, or APFS/ext4), probing
        // under `allow_mutating_probe = true` disproves the trailing-dot alias
        // instead of rejecting unconditionally.
        let trailing_dot = [
            ("locales/{locale}", root.join("locales/en.po")),
            ("locales./{locale}", root.join("locales./en.po")),
        ];
        super::reject_colliding_catalog_targets_with_options(
            &root,
            &trailing_dot,
            &[],
            true,
            vfat,
            false,
        )
        .expect(
            "distinct trailing-dot directories must be allowed when live probe disproves aliasing",
        );

        // Pure ASCII case collisions under VFAT/exFAT must still be rejected
        // immediately regardless of `keep_last_dots`.
        let case_collision = [
            ("Locales/{locale}", root.join("Locales/en.po")),
            ("locales/{locale}", root.join("locales/en.po")),
        ];
        let err = super::reject_colliding_catalog_targets_with_options(
            &root,
            &case_collision,
            &[],
            true,
            vfat,
            false,
        )
        .expect_err("case-aliased directories under VFAT/exFAT must collide");
        assert!(matches!(
            err,
            CliError::Io { ref source, .. } if source.kind() == std::io::ErrorKind::AlreadyExists
        ));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn vfat_tailless_short_name_matching_catches_nonumtail_aliases() {
        use palamedes::DirFilenameEquivalence;
        use std::ffi::OsStr;

        for (long, short) in [
            ("messages-long.po", "MESSAGES.PO"),
            ("messages-long.po", "messages.po"),
            ("my file.po", "MYFILE.PO"),
            ("foo.bar.po", "FOOBAR.PO"),
            ("longdirectory", "LONGDIRE"),
        ] {
            let mut node = super::TargetPrefixNode::default();
            node.record_ntfs_short_name_child(OsStr::new(long), 0);
            assert_eq!(
                node.matching_vfat_tailless_short_name_children(OsStr::new(short)),
                vec![0],
                "expected long {long:?} to match VFAT nonumtail short alias {short:?}"
            );

            let mut rev_node = super::TargetPrefixNode::default();
            rev_node.record_ntfs_short_name_child(OsStr::new(short), 0);
            assert_eq!(
                rev_node.matching_vfat_tailless_short_name_children(OsStr::new(long)),
                vec![0],
                "expected VFAT nonumtail short alias {short:?} to match long {long:?}"
            );
        }

        // Two distinct long names with the same 8-char prefix must not match as tail-less aliases.
        let mut node = super::TargetPrefixNode::default();
        node.record_ntfs_short_name_child(OsStr::new("messages-en.po"), 0);
        assert!(
            node.matching_vfat_tailless_short_name_children(OsStr::new("messages-fr.po"))
                .is_empty(),
            "two long names must not collide via tail-less 8.3 index"
        );

        let root = temp_dir("extract-vfat-nonumtail");
        let vfat = Some((DirFilenameEquivalence::CaseInsensitiveVfat, true));
        let ntfs = Some((DirFilenameEquivalence::CaseInsensitiveNtfs, true));
        let targets = [
            ("messages-long", root.join("messages-long.po")),
            ("messages", root.join("MESSAGES.PO")),
        ];

        // On VFAT when probing is disallowed (cannot disprove `nonumtail`), fail closed.
        let err = super::reject_colliding_catalog_targets_with_options(
            &root,
            &targets,
            &[],
            false,
            vfat,
            false,
        )
        .expect_err("VFAT nonumtail alias must be rejected when probing is disallowed");
        assert!(matches!(
            err,
            CliError::Io { ref source, .. } if source.kind() == std::io::ErrorKind::AlreadyExists
        ));

        // On NTFS, tail-less 8.3 aliases are never generated, so `messages-long.po` and `MESSAGES.PO` coexist.
        super::reject_colliding_catalog_targets_with_options(
            &root,
            &targets,
            &[],
            false,
            ntfs,
            false,
        )
        .expect("NTFS does not generate tail-less 8.3 aliases");

        // On a filesystem whose live probe disproves `PALAMEDE.TXT` (e.g. APFS/ext4 or VFAT without `nonumtail`),
        // `allow_mutating_probe = true` allows both distinct targets.
        #[cfg(unix)]
        super::reject_colliding_catalog_targets_with_options(
            &root,
            &targets,
            &[],
            true,
            vfat,
            false,
        )
        .expect(
            "live probe disproving nonumtail must allow distinct messages-long.po and MESSAGES.PO",
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn confirmed_exfat_skips_8dot3_collision_checks_in_read_only_mode() {
        use palamedes::DirFilenameEquivalence;

        let root = temp_dir("extract-exfat-no-8dot3");
        let exfat = Some((DirFilenameEquivalence::CaseInsensitiveExfat, true));

        // exFAT never generates DOS 8.3 short names (neither `~1` nor tail-less),
        // so read-only `--check` on a clean checkout must allow missing long/short
        // pairs without false collision errors.
        let long_and_short = [
            ("messages-long", root.join("messages-long.po")),
            ("messages", root.join("messages.po")),
            ("short-tilde", root.join("MESSAG~1.PO")),
        ];
        super::reject_colliding_catalog_targets_with_options(
            &root,
            &long_and_short,
            &[],
            false,
            exfat,
            false,
        )
        .expect("confirmed exFAT must not report 8.3 collisions in read-only mode");

        // Pure case collisions on exFAT must still be rejected.
        let case_collision = [
            ("Messages", root.join("Messages.po")),
            ("messages", root.join("messages.po")),
        ];
        let err = super::reject_colliding_catalog_targets_with_options(
            &root,
            &case_collision,
            &[],
            false,
            exfat,
            false,
        )
        .expect_err("case collision on confirmed exFAT must fail");
        assert!(matches!(
            err,
            CliError::Io { ref source, .. } if source.kind() == std::io::ErrorKind::AlreadyExists
        ));
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn confirmed_ntfs_probes_trailing_dot_and_space_variants_instead_of_rejecting_unconditionally()
    {
        use palamedes::DirFilenameEquivalence;

        let root = temp_dir("extract-ntfs-trailing-dot-probe");
        let ntfs = Some((DirFilenameEquivalence::CaseInsensitiveNtfs, true));

        // When probing is allowed on a filesystem that preserves trailing dots/spaces
        // (matching `NtCreateFile` on Windows and POSIX filesystems on Unix),
        // `assets/{locale}` and `assets./{locale}` (and `assets /{locale}`) are
        // allowed once the live probe disproves aliasing.
        let trailing_dot = [
            ("assets/{locale}", root.join("assets/en.po")),
            ("assets./{locale}", root.join("assets./en.po")),
        ];
        super::reject_colliding_catalog_targets_with_options(
            &root,
            &trailing_dot,
            &[],
            true,
            ntfs,
            false,
        )
        .expect("live probe disproving NTFS trailing-dot alias must allow both targets");

        // When probing is disallowed (`--check`), fail closed on potential trailing-dot alias.
        let err = super::reject_colliding_catalog_targets_with_options(
            &root,
            &trailing_dot,
            &[],
            false,
            ntfs,
            false,
        )
        .expect_err("read-only mode without probe must fail closed on NTFS trailing-dot alias");
        assert!(matches!(
            err,
            CliError::Io { ref source, .. } if source.kind() == std::io::ErrorKind::AlreadyExists
        ));

        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn write_runtime_manifest_preserves_existing_permissions_and_umask() {
        use std::os::unix::fs::PermissionsExt;

        let root = temp_dir("runtime-manifest-perms");
        fs::create_dir_all(root.join("src")).expect("create src");
        fs::write(
            root.join("palamedes.yaml"),
            "locales: [en]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}/messages\n    include: [src]\n",
        )
        .expect("write config");
        let source_file = root.join("src/app.ts");
        fs::write(
            &source_file,
            "import { t } from '@palamedes/core/macro';\nexport const msg = () => t`Hello`;\n",
        )
        .expect("write source");
        let config = load_config(&root, None).expect("load config");

        let baseline = root.join("baseline.txt");
        fs::write(&baseline, "x").expect("write baseline");
        let expected_umask_mode = fs::metadata(&baseline)
            .expect("baseline meta")
            .permissions()
            .mode()
            & 0o777;

        let manifest_rel = std::path::Path::new(".palamedes/runtime-manifest.json");
        let manifest_abs = root.join(manifest_rel);
        super::write_runtime_manifest(&config, manifest_rel, &[source_file.as_path()], false)
            .expect("initial manifest write");
        assert_eq!(
            fs::metadata(&manifest_abs)
                .expect("manifest meta")
                .permissions()
                .mode()
                & 0o777,
            expected_umask_mode
        );

        fs::set_permissions(&manifest_abs, fs::Permissions::from_mode(0o640))
            .expect("chmod manifest");
        fs::write(
            &source_file,
            "import { t } from '@palamedes/core/macro';\nexport const msg = () => t`Updated`;\n",
        )
        .expect("update source");
        super::write_runtime_manifest(&config, manifest_rel, &[source_file.as_path()], false)
            .expect("updated manifest write");
        assert_eq!(
            fs::metadata(&manifest_abs)
                .expect("updated meta")
                .permissions()
                .mode()
                & 0o777,
            0o640
        );

        // Existing symlink to a regular file must remain a symlink and update its target.
        let shared_target = root.join("shared/runtime-manifest.json");
        fs::create_dir_all(shared_target.parent().unwrap()).expect("create shared dir");
        fs::write(&shared_target, "{}\n").expect("seed shared target");
        let symlink_rel = std::path::Path::new(".palamedes/linked-manifest.json");
        let symlink_abs = root.join(symlink_rel);
        std::os::unix::fs::symlink(&shared_target, &symlink_abs).expect("create manifest symlink");

        super::write_runtime_manifest(&config, symlink_rel, &[source_file.as_path()], false)
            .expect("manifest update through symlink");
        assert!(
            fs::symlink_metadata(&symlink_abs)
                .expect("symlink meta")
                .file_type()
                .is_symlink(),
            "symlink must not be replaced by a regular file"
        );
        assert!(
            fs::read_to_string(&shared_target)
                .expect("read shared target")
                .contains("Updated"),
            "shared symlink target must receive the updated manifest"
        );

        // Dangling symlink must fail explicitly instead of silently replacing the link.
        let dangling_rel = std::path::Path::new(".palamedes/dangling-manifest.json");
        let dangling_abs = root.join(dangling_rel);
        std::os::unix::fs::symlink(root.join("missing/target.json"), &dangling_abs)
            .expect("create dangling symlink");
        assert!(
            super::write_runtime_manifest(&config, dangling_rel, &[source_file.as_path()], false)
                .is_err(),
            "dangling symlink must return an error"
        );
        assert!(
            fs::symlink_metadata(&dangling_abs)
                .expect("dangling symlink meta")
                .file_type()
                .is_symlink()
        );

        let _ = fs::remove_dir_all(&root);
    }
}
