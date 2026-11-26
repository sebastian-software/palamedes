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
use std::ffi::OsString;
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
                DirFilenameEquivalence::CaseInsensitiveNtfs => ntfs_casefold(text),
                DirFilenameEquivalence::CaseInsensitiveUnicodeNfd => {
                    unicode_full_casefold_nfd(text, false)
                }
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
        .or(same_vol_parent)
        .unwrap_or_else(default_platform_equivalence);
    if let Some(id) = identity {
        cache.insert(id, equivalence);
    }
    equivalence
}

fn reject_colliding_extract_targets(
    write_jobs: &[(&ConfigCatalog, &Vec<CatalogUpdateMessage>, &str)],
    config: &LoadedConfig,
) -> Result<(), CliError> {
    let mut dir_eq_cache: HashMap<FileIdentity, DirFilenameEquivalence> = HashMap::new();
    let mut seen_paths: HashMap<(ExtractTargetAnchor, Vec<OsString>, OsString), &str> =
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
        let mut hit_missing = false;

        for component in relative_parent.components() {
            let std::path::Component::Normal(segment) = component else {
                continue;
            };
            if hit_missing {
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
        if let Some(first_scope) = seen_paths.insert(key, catalog.path.as_str()) {
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

        // Unicode NFC vs NFD collision on clean checkout (for example APFS/HFS+).
        let is_unicode_norm = super::ContainedDir::open_root(&app)
            .expect("open root")
            .is_unicode_normalizing()
            .unwrap_or(cfg!(target_os = "macos"));
        if is_unicode_norm {
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

        // Full Unicode case folding collision (`straße` vs `strasse`) on
        // case-insensitive normalizing filesystems (for example default APFS).
        if is_ci && is_unicode_norm {
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

        // Greek sigma/final-sigma collision (`σ` vs `ς`) on case-insensitive
        // filesystems (both NTFS `$UpCase` and APFS full case folding).
        if is_ci {
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
