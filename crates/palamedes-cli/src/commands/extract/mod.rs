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

use std::collections::{BTreeMap, HashMap};
use std::ffi::{OsStr, OsString};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use clap::Args;
use palamedes::{
    CatalogUpdateMessage, CatalogUpdateRequest, ContainedDir, ContainedFsError,
    ContainedNewFileMode, ContainedWriteDurability, DirFilenameEquivalence, ExtractCache,
    ExtractCatalogFileFailure, FileIdentity, SourceFileAnalysisRequest,
    collect_runtime_macro_manifest, extract_catalog_messages_cached,
    preview_catalog_update_from_content, split_relative_catalog_path,
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
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|source| CliError::Io {
            path: parent.to_path_buf(),
            source,
        })?;
    }
    fs::write(&target, contents).map_err(|source| CliError::Io {
        path: target.clone(),
        source,
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
    reject_colliding_extract_targets(write_jobs, config)?;

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

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
enum ExtractTargetAnchor {
    Identity(FileIdentity),
    Path(PathBuf),
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
                DirFilenameEquivalence::CaseInsensitiveNtfs => ntfs_casefold(text),
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

fn default_platform_equivalence() -> DirFilenameEquivalence {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        DirFilenameEquivalence::CaseInsensitiveUnicodeNfd
    }
    #[cfg(target_os = "windows")]
    {
        DirFilenameEquivalence::CaseInsensitiveNtfs
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "windows")))]
    {
        DirFilenameEquivalence::Exact
    }
}

fn probe_unknown_dir_equivalence(dir: &ContainedDir) -> Option<DirFilenameEquivalence> {
    let case_insensitive = dir.probe_names_equivalent(OsStr::new("a"), OsStr::new("A"))?;
    let unicode_normalizing = dir
        .probe_names_equivalent(OsStr::new("caf\u{00e9}"), OsStr::new("cafe\u{0301}"))
        .unwrap_or(false);
    Some(match (case_insensitive, unicode_normalizing) {
        (false, false) => DirFilenameEquivalence::Exact,
        (false, true) => DirFilenameEquivalence::UnicodeNfd,
        (true, false) => DirFilenameEquivalence::CaseInsensitiveNtfs,
        (true, true) => DirFilenameEquivalence::CaseInsensitiveUnicodeNfdicf,
    })
}

fn resolve_directory_equivalence(
    dir: &ContainedDir,
    identity: Option<FileIdentity>,
    parent: Option<(Option<FileIdentity>, DirFilenameEquivalence)>,
    cache: &mut HashMap<FileIdentity, DirFilenameEquivalence>,
) -> DirFilenameEquivalence {
    if let Some(id) = identity
        && let Some(&cached) = cache.get(&id)
    {
        return cached;
    }
    let same_vol_parent = match (identity, parent) {
        (Some(id), Some((Some(parent_id), parent_eq))) if id.same_volume(parent_id) => {
            Some(parent_eq)
        }
        _ => None,
    };
    let equivalence = dir
        .filename_equivalence()
        .or_else(|| probe_unknown_dir_equivalence(dir))
        .or(same_vol_parent)
        .unwrap_or_else(default_platform_equivalence);
    if let Some(id) = identity {
        cache.insert(id, equivalence);
    }
    equivalence
}

fn segments_collide_on_dir(
    anchor_dir: &ContainedDir,
    equivalence: DirFilenameEquivalence,
    left_remaining: &[OsString],
    left_file: &OsStr,
    right_remaining: &[OsString],
    right_file: &OsStr,
) -> bool {
    if left_remaining.len() != right_remaining.len() {
        return false;
    }
    let is_ascii_ci = matches!(
        equivalence,
        DirFilenameEquivalence::CaseInsensitiveNtfs
            | DirFilenameEquivalence::CaseInsensitiveUnicodeNfd
            | DirFilenameEquivalence::CaseInsensitiveHfsPlus
            | DirFilenameEquivalence::CaseInsensitiveUnicodeNfdicf
    );
    let pairs = left_remaining
        .iter()
        .map(OsString::as_os_str)
        .chain(std::iter::once(left_file))
        .zip(
            right_remaining
                .iter()
                .map(OsString::as_os_str)
                .chain(std::iter::once(right_file)),
        );
    for (left, right) in pairs {
        if left == right {
            continue;
        }
        if is_ascii_ci
            && let (Some(l_str), Some(r_str)) = (left.to_str(), right.to_str())
            && l_str.is_ascii()
            && r_str.is_ascii()
            && l_str.eq_ignore_ascii_case(r_str)
        {
            continue;
        }
        // Non-ASCII equivalence depends on the mounted volume's Unicode
        // version (for example Linux ext4 `utf8-12.1` vs Unicode 16 in Rust).
        // Ask the mounted filesystem before rejecting as a collision; fall back
        // to the folded decision when the directory cannot be probed (e.g.
        // read-only directory or Windows where `RtlUpcaseUnicodeChar` is exact).
        if anchor_dir.probe_names_equivalent(left, right) == Some(false) {
            return false;
        }
    }
    true
}

fn reject_colliding_extract_targets(
    write_jobs: &[(&ConfigCatalog, &Vec<CatalogUpdateMessage>, &str)],
    config: &LoadedConfig,
) -> Result<(), CliError> {
    type SeenBucket<'a> = Vec<(&'a str, Vec<OsString>, OsString)>;

    let mut dir_eq_cache: HashMap<FileIdentity, DirFilenameEquivalence> = HashMap::new();
    let mut seen_paths: HashMap<(ExtractTargetAnchor, Vec<OsString>, OsString), SeenBucket<'_>> =
        HashMap::new();
    let mut seen_identities: HashMap<FileIdentity, (&str, PathBuf)> = HashMap::new();

    for (catalog, _, locale) in write_jobs {
        let catalog_path =
            config.resolve_contained_catalog_path(&catalog.path, locale, catalog.format)?;
        let (relative_parent, file_name) =
            split_relative_catalog_path(&config.root_dir, &catalog_path).map_err(|error| {
                CliError::Io {
                    path: catalog_path.clone(),
                    source: error.into_io_error(),
                }
            })?;

        let mut current =
            ContainedDir::open_root(&config.root_dir).map_err(|error| CliError::Io {
                path: config.root_dir.clone(),
                source: error.into_io_error(),
            })?;
        let mut current_id = current.self_identity().map_err(|error| CliError::Io {
            path: config.root_dir.clone(),
            source: error.into_io_error(),
        })?;
        let mut current_eq =
            resolve_directory_equivalence(&current, current_id, None, &mut dir_eq_cache);
        let mut existing_prefix = PathBuf::new();
        let mut remaining_segments: Vec<OsString> = Vec::new();
        let mut raw_remaining_segments: Vec<OsString> = Vec::new();
        let mut hit_missing = false;

        for component in relative_parent.components() {
            let std::path::Component::Normal(segment) = component else {
                continue;
            };
            if hit_missing {
                raw_remaining_segments.push(segment.to_os_string());
                remaining_segments.push(fold_os_segment(segment, current_eq));
                continue;
            }
            match current
                .open_existing_child_dir(segment)
                .map_err(|error| CliError::Io {
                    path: catalog_path.clone(),
                    source: error.into_io_error(),
                })? {
                Some(child) => {
                    let child_id = child.self_identity().map_err(|error| CliError::Io {
                        path: catalog_path.clone(),
                        source: error.into_io_error(),
                    })?;
                    let child_eq = resolve_directory_equivalence(
                        &child,
                        child_id,
                        Some((current_id, current_eq)),
                        &mut dir_eq_cache,
                    );
                    current = child;
                    current_id = child_id;
                    current_eq = child_eq;
                    existing_prefix.push(segment);
                }
                None => {
                    hit_missing = true;
                    raw_remaining_segments.push(segment.to_os_string());
                    remaining_segments.push(fold_os_segment(segment, current_eq));
                }
            }
        }

        let anchor = current_id.map_or_else(
            || ExtractTargetAnchor::Path(existing_prefix),
            ExtractTargetAnchor::Identity,
        );
        let normalized_name = fold_os_segment(&file_name, current_eq);
        let key = (anchor, remaining_segments, normalized_name);
        let bucket = seen_paths.entry(key).or_default();
        if let Some((first_scope, _, _)) =
            bucket
                .iter()
                .find(|(_, prev_raw_remaining, prev_raw_file)| {
                    segments_collide_on_dir(
                        &current,
                        current_eq,
                        prev_raw_remaining,
                        prev_raw_file,
                        &raw_remaining_segments,
                        &file_name,
                    )
                })
        {
            return Err(CliError::Io {
                path: catalog_path,
                source: std::io::Error::new(
                    std::io::ErrorKind::AlreadyExists,
                    format!(
                        "multiple catalog scopes ({first_scope:?} and {:?}) resolve to the same target file",
                        catalog.path
                    ),
                ),
            });
        }
        bucket.push((
            catalog.path.as_str(),
            raw_remaining_segments,
            file_name.clone(),
        ));
        if !hit_missing
            && let Some(identity) =
                current
                    .file_identity(&file_name)
                    .map_err(|error| CliError::Io {
                        path: catalog_path.clone(),
                        source: error.into_io_error(),
                    })?
            && let Some((first_scope, _)) =
                seen_identities.insert(identity, (catalog.path.as_str(), catalog_path.clone()))
        {
            return Err(CliError::Io {
                path: catalog_path,
                source: std::io::Error::new(
                    std::io::ErrorKind::AlreadyExists,
                    format!(
                        "multiple catalog scopes ({first_scope:?} and {:?}) resolve to the same on-disk catalog file",
                        catalog.path
                    ),
                ),
            });
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
    let make_request = || CatalogUpdateRequest {
        target_path: catalog_path.to_string_lossy().into_owned(),
        locale: locale.to_owned(),
        source_locale: config.source_locale.clone(),
        clean: options.clean,
        force_clean: options.force_clean,
        format: catalog.format,
        po: catalog.po.clone().map(Into::into),
        messages: messages.to_vec(),
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
                    preview_catalog_update_from_content(make_request(), existing.as_deref())?;
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
                    // Re-read under the exclusive lock; reuse the unlocked
                    // preview when the bytes match, and re-render only if a
                    // concurrent writer changed the file in the meantime.
                    let existing = parent_dir.read_optional_file(&file_name).map_err(|error| {
                        CliError::Io {
                            path: catalog_path.clone(),
                            source: error.into_io_error(),
                        }
                    })?;
                    let locked_result = match unlocked_preview {
                        Some((prior_bytes, preview)) if prior_bytes == existing => preview,
                        _ => preview_catalog_update_from_content(
                            make_request(),
                            existing.as_deref(),
                        )?,
                    };
                    if locked_result.created || locked_result.updated {
                        parent_dir
                            .write_file_atomically(
                                &file_name,
                                locked_result.content.as_bytes(),
                                ContainedNewFileMode::Private,
                                ContainedWriteDurability::Rename,
                            )
                            .map_err(|error: ContainedFsError| CliError::Io {
                                path: catalog_path.clone(),
                                source: error.into_io_error(),
                            })?;
                    }
                    locked_result
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
            let result = preview_catalog_update_from_content(make_request(), existing.as_deref())?;
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
            .unwrap_or_else(super::default_platform_equivalence);
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
            super::fold_os_segment(OsStr::new("\u{03c2}.po"), ntfs),
            "NTFS uppercase folding must equate Greek sigma and final sigma"
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
}
