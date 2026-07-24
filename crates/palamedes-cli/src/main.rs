mod config;

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Instant;

use clap::{Args, Parser, Subcommand, ValueEnum};
use config::{load_config, ConfigCatalog, ConfigError, LoadedConfig};
use globset::{Glob, GlobSet, GlobSetBuilder};
use ignore::WalkBuilder;
use notify::{RecursiveMode, Watcher};
use palamedes::{
    audit_catalogs, combine_catalog_files, extract_catalog_messages_from_files, parse_catalog,
    parse_po, update_catalog_file, CatalogAuditDiagnostic, CatalogAuditRequest, CatalogAuditResult,
    CatalogConflictStrategy, CatalogFileCombineRequest, CatalogFileFormat, CatalogParseRequest,
    CatalogUpdateMessage, CatalogUpdateRequest,
};
use serde::Serialize;
use thiserror::Error;

const TIMING_MARKER: &str = "__PALAMEDES_TIMINGS__";

#[derive(Debug, Parser)]
#[command(name = "pmds")]
#[command(about = "Palamedes CLI for extraction, audits, reports, and catalog workflows")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Extract messages from source files.
    Extract(ExtractOptions),
    /// Audit catalogs for translation and ICU authoring issues.
    Audit(AuditOptions),
    /// Report per-locale catalog translation completeness.
    Report(ReportOptions),
    /// Work with Palamedes catalog files.
    Catalog(CatalogCommand),
    /// Show version information.
    Version,
}

#[derive(Debug, Args)]
struct ExtractOptions {
    /// Path to a Palamedes config file.
    #[arg(short, long)]
    config: Option<PathBuf>,
    /// Watch for file changes.
    #[arg(short, long)]
    watch: bool,
    /// Remove obsolete messages from catalogs.
    #[arg(long)]
    clean: bool,
    /// Remove obsolete messages immediately, including entries without obsolete-since.
    #[arg(long)]
    force_clean: bool,
    /// Show verbose output.
    #[arg(short, long)]
    verbose: bool,
}

#[derive(Debug, Args)]
struct AuditOptions {
    /// Path to a Palamedes config file.
    #[arg(short, long)]
    config: Option<PathBuf>,
    /// Only audit selected target locale(s).
    #[arg(long, num_args = 1..)]
    locale: Vec<String>,
    /// Print the machine-readable audit result as JSON.
    #[arg(long)]
    json: bool,
    /// Fail on error or warning diagnostics.
    #[arg(long, default_value = "error")]
    fail_on: FailOn,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum FailOn {
    Error,
    Warning,
}

#[derive(Debug, Args)]
struct ReportOptions {
    /// Path to a Palamedes config file.
    #[arg(short, long)]
    config: Option<PathBuf>,
    /// Only report selected target locale(s); comma-separated values are supported.
    #[arg(long, num_args = 1..)]
    locale: Vec<String>,
    /// Print the machine-readable report as JSON.
    #[arg(long)]
    json: bool,
    /// Fail when any reported locale is below this translated percentage.
    #[arg(long)]
    fail_if_below: Option<f64>,
}

#[derive(Debug, Args)]
struct CatalogCommand {
    #[command(subcommand)]
    command: CatalogSubcommand,
}

#[derive(Debug, Subcommand)]
enum CatalogSubcommand {
    /// Merge two catalog files with semantic use-first behavior.
    Merge(MergeOptions),
    /// Convert configured PO catalogs to another Palamedes storage format.
    Convert(ConvertOptions),
}

#[derive(Debug, Args)]
struct MergeOptions {
    /// Input catalog files in precedence order.
    #[arg(required = true)]
    inputs: Vec<PathBuf>,
    /// Output catalog path.
    #[arg(long)]
    output: PathBuf,
    /// Path to a Palamedes config file.
    #[arg(short, long)]
    config: Option<PathBuf>,
    /// Catalog format.
    #[arg(long)]
    format: Option<MergeFormat>,
    /// Ancestor catalog path supplied by Git merge drivers.
    #[arg(long)]
    base: Option<PathBuf>,
    /// Catalog conflict strategy.
    #[arg(long, default_value = "use-first")]
    conflict_strategy: MergeConflictStrategy,
    /// Source locale for catalog semantics.
    #[arg(long)]
    source_locale: Option<String>,
    /// Locale of the merged catalog.
    #[arg(long)]
    locale: Option<String>,
}

#[derive(Debug, Args)]
struct ConvertOptions {
    /// Input catalog file for single-file conversion.
    input: Option<PathBuf>,
    /// Path to a Palamedes config file for config-wide conversion.
    #[arg(short, long)]
    config: Option<PathBuf>,
    /// Target catalog format.
    #[arg(long)]
    to: ConvertFormat,
    /// Output catalog path for single-file conversion.
    #[arg(long)]
    output: Option<PathBuf>,
    /// Source locale for single-file conversion.
    #[arg(long, default_value = "en")]
    source_locale: String,
    /// Locale for single-file conversion.
    #[arg(long)]
    locale: Option<String>,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum ConvertFormat {
    Fcl,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum MergeFormat {
    Po,
    Fcl,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum MergeConflictStrategy {
    UseFirst,
    UseLast,
    Error,
}

#[derive(Debug, Error)]
enum CliError {
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

#[derive(Debug)]
struct CatalogExtractionResult {
    messages: Vec<CatalogUpdateMessage>,
    file_count: usize,
    failed_file_count: usize,
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

#[derive(Debug, Serialize)]
struct CompletenessReport {
    locales: Vec<LocaleCompletenessReport>,
}

#[derive(Debug, Serialize)]
struct LocaleCompletenessReport {
    locale: String,
    total: usize,
    translated: usize,
    missing: usize,
    percent: f64,
}

#[derive(Debug, Clone, Eq, Ord, PartialEq, PartialOrd)]
struct MessageKey {
    message: String,
    context: Option<String>,
}

#[derive(Debug)]
struct MutableLocaleStats {
    locale: String,
    total: usize,
    translated: usize,
    missing: usize,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("Error: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), CliError> {
    let cli = Cli::parse();
    match cli.command {
        Command::Extract(options) => run_extract(options),
        Command::Audit(options) => run_audit(options).map(|_| ()),
        Command::Report(options) => run_report(options).map(|_| ()),
        Command::Catalog(command) => match command.command {
            CatalogSubcommand::Merge(options) => run_catalog_merge(options).map(|_| ()),
            CatalogSubcommand::Convert(options) => run_catalog_convert(options).map(|_| ()),
        },
        Command::Version => {
            println!("pmds (Palamedes) v{}", env!("CARGO_PKG_VERSION"));
            println!("Fast i18n tooling for modern apps");
            Ok(())
        }
    }
}

fn run_extract(options: ExtractOptions) -> Result<(), CliError> {
    let config = load_config(
        &std::env::current_dir().expect("current dir"),
        options.config.as_deref(),
    )?;
    if options.verbose {
        eprintln!("Config loaded from {}", config.config_path.display());
    }

    if options.watch {
        run_watch_mode(&config, &options)
    } else {
        run_extraction(&config, &options)
    }
}

fn run_extraction(config: &LoadedConfig, options: &ExtractOptions) -> Result<(), CliError> {
    let started_at = Instant::now();
    let mut total_write_ms = 0;
    let mut total_glob_ms = 0;
    let mut total_extract_ms = 0;
    let mut total_messages = 0;
    let mut total_files = 0;
    let mut total_failed_files = 0;
    let mut results = Vec::with_capacity(config.catalogs.len());

    for catalog in &config.catalogs {
        let result = extract_from_catalog(catalog, config, options.verbose)?;
        total_glob_ms += result.glob_ms;
        total_extract_ms += result.extract_ms;
        total_messages += result.messages.len();
        total_files += result.file_count;
        total_failed_files += result.failed_file_count;
        results.push(result);
    }

    if total_failed_files > 0 {
        return Err(CliError::ExtractionFailed {
            failures: total_failed_files,
        });
    }

    for (catalog, result) in config.catalogs.iter().zip(&results) {
        for locale in &config.locales {
            total_write_ms += write_catalog(catalog, locale, &result.messages, config, options)?;
        }
    }

    let total_ms = started_at.elapsed().as_millis();
    println!("✓ Extracted {total_messages} messages from {total_files} files ({total_ms}ms)");

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

    Ok(())
}

fn extract_from_catalog(
    catalog: &ConfigCatalog,
    config: &LoadedConfig,
    verbose: bool,
) -> Result<CatalogExtractionResult, CliError> {
    let glob_started_at = Instant::now();
    let files = collect_source_files(catalog, config)?;
    let glob_ms = glob_started_at.elapsed().as_millis();

    if verbose {
        eprintln!("Found {} files to extract from", files.len());
    }

    if files.is_empty() {
        eprintln!(
            "Warning: catalog '{}' matched no source files (include: {}); writing an empty catalog.",
            catalog.path,
            catalog.include.join(", ")
        );
    }

    let extract_started_at = Instant::now();
    let result = extract_catalog_messages_from_files(palamedes::ExtractCatalogMessagesRequest {
        root_dir: config.source_reference_root.to_string_lossy().into_owned(),
        files: files
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect(),
    })?;
    let extract_ms = extract_started_at.elapsed().as_millis();

    for failure in &result.failed_files {
        eprintln!(
            "Warning: Failed to extract from {}: {}",
            failure.path, failure.message
        );
    }

    Ok(CatalogExtractionResult {
        messages: result.messages,
        file_count: result.file_count,
        failed_file_count: result.failed_files.len(),
        glob_ms,
        extract_ms,
    })
}

fn write_catalog(
    catalog: &ConfigCatalog,
    locale: &str,
    messages: &[CatalogUpdateMessage],
    config: &LoadedConfig,
    options: &ExtractOptions,
) -> Result<u128, CliError> {
    let started_at = Instant::now();
    let catalog_path = config
        .resolve_catalog_path(&catalog.path, locale)
        .with_extension(catalog.format.extension());
    if let Some(parent) = catalog_path.parent() {
        fs::create_dir_all(parent).map_err(|source| CliError::Io {
            path: parent.to_path_buf(),
            source,
        })?;
    }

    let result = update_catalog_file(CatalogUpdateRequest {
        target_path: catalog_path.to_string_lossy().into_owned(),
        locale: locale.to_owned(),
        source_locale: config.source_locale.clone(),
        clean: options.clean,
        force_clean: options.force_clean,
        format: catalog.format,
        messages: messages.to_vec(),
    })?;

    if options.verbose {
        eprintln!("  -> {}", catalog_path.display());
        for diagnostic in result.diagnostics {
            eprintln!("Warning: {}: {}", diagnostic.code, diagnostic.message);
        }
    }

    Ok(started_at.elapsed().as_millis())
}

fn collect_source_files(
    catalog: &ConfigCatalog,
    config: &LoadedConfig,
) -> Result<Vec<PathBuf>, CliError> {
    let include_patterns = normalized_include_patterns(catalog, config);
    let include = build_glob_set(&include_patterns, "include")?;
    let exclude = build_exclude_set(catalog, config)?;
    let mut files = BTreeSet::new();

    for root in walk_roots_for_patterns(&include_patterns, &config.root_dir) {
        for entry in WalkBuilder::new(root)
            .standard_filters(false)
            .hidden(false)
            .build()
        {
            let Ok(entry) = entry else {
                continue;
            };
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if exclude.is_match(path) {
                continue;
            }
            if include.is_match(path) {
                files.insert(path.to_path_buf());
            }
        }
    }

    Ok(files.into_iter().collect())
}

fn build_include_set(catalog: &ConfigCatalog, config: &LoadedConfig) -> Result<GlobSet, CliError> {
    build_glob_set(&normalized_include_patterns(catalog, config), "include")
}

fn normalized_include_patterns(catalog: &ConfigCatalog, config: &LoadedConfig) -> Vec<String> {
    catalog
        .include
        .iter()
        .map(|pattern| {
            // Collapse `.`/`./` segments so dot paths resolve to a real
            // directory (`.` -> the config root) instead of a literal `/.`
            // fragment that silently matches no source files. Expand bare
            // directories to a recursive source glob; pass through anything
            // that already points at a file or contains glob syntax.
            let resolved: PathBuf = config.resolve_pattern(pattern).components().collect();
            if resolved.is_dir() {
                format!("{}/**/*.{{js,jsx,ts,tsx}}", resolved.to_string_lossy())
            } else {
                resolved.to_string_lossy().into_owned()
            }
        })
        .collect()
}

fn build_glob_set(patterns: &[String], label: &str) -> Result<GlobSet, CliError> {
    let mut builder = GlobSetBuilder::new();
    for pattern in patterns {
        builder.add(Glob::new(pattern).map_err(|source| CliError::GlobPattern {
            pattern: pattern.clone(),
            source,
        })?);
    }
    builder.build().map_err(|source| CliError::GlobPattern {
        pattern: label.to_owned(),
        source,
    })
}

fn walk_roots_for_patterns(patterns: &[String], fallback: &Path) -> Vec<PathBuf> {
    let mut roots = BTreeSet::new();
    for pattern in patterns {
        let prefix_end = pattern.find(['*', '?', '[', '{']).unwrap_or(pattern.len());
        let prefix = Path::new(&pattern[..prefix_end]);
        let root = if prefix.is_dir() {
            prefix.to_path_buf()
        } else {
            prefix
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| fallback.to_path_buf())
        };
        roots.insert(root);
    }
    if roots.is_empty() {
        roots.insert(fallback.to_path_buf());
    }
    roots.into_iter().collect()
}

fn build_exclude_set(catalog: &ConfigCatalog, config: &LoadedConfig) -> Result<GlobSet, CliError> {
    let mut builder = GlobSetBuilder::new();
    let excludes = if catalog.exclude.is_empty() {
        vec!["**/node_modules/**".to_owned()]
    } else {
        catalog.exclude.clone()
    };
    for pattern in excludes {
        let resolved = config.resolve_pattern(&pattern);
        let normalized = resolved.to_string_lossy().into_owned();
        builder.add(
            Glob::new(&normalized).map_err(|source| CliError::GlobPattern {
                pattern: normalized,
                source,
            })?,
        );
    }
    builder.build().map_err(|source| CliError::GlobPattern {
        pattern: "exclude".to_owned(),
        source,
    })
}

fn run_watch_mode(config: &LoadedConfig, options: &ExtractOptions) -> Result<(), CliError> {
    println!("Watching for changes...");
    run_watch_extraction(config, options)?;

    let (tx, rx) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(tx)?;
    watcher.watch(&config.root_dir, RecursiveMode::Recursive)?;

    loop {
        match rx.recv() {
            Ok(Ok(event)) => {
                if event
                    .paths
                    .iter()
                    .any(|path| should_rerun_for_path(path, config))
                {
                    if options.verbose {
                        eprintln!("Source changed; extracting catalogs");
                    }
                    run_watch_extraction(config, options)?;
                }
            }
            Ok(Err(error)) => return Err(CliError::Watch(error)),
            Err(_) => return Ok(()),
        }
    }
}

fn run_watch_extraction(config: &LoadedConfig, options: &ExtractOptions) -> Result<(), CliError> {
    match run_extraction(config, options) {
        Err(CliError::ExtractionFailed { failures }) => {
            eprintln!(
                "Warning: Extraction failed for {failures} source file(s); catalogs were not updated. Continuing to watch for changes."
            );
            Ok(())
        }
        result => result,
    }
}

fn should_rerun_for_path(path: &Path, config: &LoadedConfig) -> bool {
    if path
        .components()
        .any(|component| component.as_os_str() == "node_modules")
    {
        return false;
    }
    if path.extension().and_then(|value| value.to_str()) == Some("po") {
        return false;
    }
    config.catalogs.iter().any(|catalog| {
        match (
            build_include_set(catalog, config),
            build_exclude_set(catalog, config),
        ) {
            (Ok(include), Ok(exclude)) => include.is_match(path) && !exclude.is_match(path),
            _ => false,
        }
    })
}

fn run_audit(options: AuditOptions) -> Result<CatalogAuditResult, CliError> {
    let config = load_config(
        &std::env::current_dir().expect("current dir"),
        options.config.as_deref(),
    )?;
    let result = audit_catalogs(CatalogAuditRequest {
        config: config.artifact_config(),
        locales: normalize_locale_list(&options.locale),
        checks: Default::default(),
        metadata: Vec::new(),
    })?;

    if options.json {
        println!("{}", serde_json::to_string_pretty(&result)?);
    } else {
        print_audit_result(&result);
    }

    match options.fail_on {
        FailOn::Warning if result.summary.errors > 0 || result.summary.warnings > 0 => {
            Err(CliError::AuditFailedOnWarning {
                errors: result.summary.errors,
                warnings: result.summary.warnings,
            })
        }
        FailOn::Error if result.summary.errors > 0 => Err(CliError::AuditFailedOnError {
            errors: result.summary.errors,
        }),
        _ => Ok(result),
    }
}

fn print_audit_result(result: &CatalogAuditResult) {
    let status = if result.summary.errors > 0 {
        "failed"
    } else {
        "passed"
    };
    println!(
        "Catalog audit {status}: {} error(s), {} warning(s), {} info",
        result.summary.errors, result.summary.warnings, result.summary.infos
    );

    let mut grouped = BTreeMap::<&str, Vec<&CatalogAuditDiagnostic>>::new();
    for diagnostic in &result.diagnostics {
        grouped
            .entry(diagnostic.catalog_path.as_str())
            .or_default()
            .push(diagnostic);
    }

    for (catalog_path, diagnostics) in grouped {
        println!("\n{catalog_path}");
        for diagnostic in diagnostics {
            let locale = diagnostic
                .locale
                .as_ref()
                .map(|locale| format!(" [{locale}]"))
                .unwrap_or_default();
            println!(
                "  [{:?}] {}{}: {}",
                diagnostic.severity, diagnostic.code, locale, diagnostic.message
            );
            if let Some(source_key) = &diagnostic.source_key {
                let context = source_key
                    .context
                    .as_ref()
                    .map(|context| format!(" [context: {context}]"))
                    .unwrap_or_default();
                println!("    Source: {}{}", source_key.message, context);
            }
        }
    }
}

fn run_report(options: ReportOptions) -> Result<CompletenessReport, CliError> {
    let threshold = match options.fail_if_below {
        Some(value) if !(0.0..=100.0).contains(&value) => return Err(CliError::InvalidThreshold),
        value => value,
    };
    let config = load_config(
        &std::env::current_dir().expect("current dir"),
        options.config.as_deref(),
    )?;
    let locales = resolve_report_locales(&config, &options.locale);
    let result = build_report(&config, &locales)?;

    if options.json {
        println!("{}", serde_json::to_string_pretty(&result)?);
    } else {
        print_report(&result);
    }

    if let Some(threshold) = threshold {
        let failing = result
            .locales
            .iter()
            .filter(|locale| locale.percent < threshold)
            .map(|locale| format!("{} ({})", locale.locale, format_percent(locale.percent)))
            .collect::<Vec<_>>();
        if !failing.is_empty() {
            return Err(CliError::CompletenessBelowThreshold {
                threshold: format_percent(threshold),
                locales: failing.join(", "),
            });
        }
    }

    Ok(result)
}

fn build_report(config: &LoadedConfig, locales: &[String]) -> Result<CompletenessReport, CliError> {
    let mut stats = locales
        .iter()
        .map(|locale| {
            (
                locale.clone(),
                MutableLocaleStats {
                    locale: locale.clone(),
                    total: 0,
                    translated: 0,
                    missing: 0,
                },
            )
        })
        .collect::<BTreeMap<_, _>>();

    for catalog in &config.catalogs {
        let source_path = config
            .resolve_catalog_path(&catalog.path, &config.source_locale)
            .with_extension(catalog.format.extension());
        let source_catalog = read_catalog_for_report(
            &source_path,
            &config.source_locale,
            &config.source_locale,
            catalog.format,
        )?;
        let source_messages = source_catalog
            .into_iter()
            .filter(|message| !message.obsolete)
            .map(|message| MessageKey {
                message: message.message,
                context: message.context,
            })
            .collect::<Vec<_>>();

        for locale in locales {
            let Some(locale_stats) = stats.get_mut(locale) else {
                continue;
            };
            locale_stats.total += source_messages.len();

            if locale == &config.source_locale {
                locale_stats.translated += source_messages.len();
                continue;
            }

            let target_path = config
                .resolve_catalog_path(&catalog.path, locale)
                .with_extension(catalog.format.extension());
            let target_messages = if target_path.exists() {
                read_catalog_for_report(
                    &target_path,
                    &config.source_locale,
                    locale,
                    catalog.format,
                )?
                .into_iter()
                .filter(|message| !message.obsolete)
                .map(|message| {
                    (
                        MessageKey {
                            message: message.message,
                            context: message.context,
                        },
                        message.translated,
                    )
                })
                .collect::<BTreeMap<_, _>>()
            } else {
                BTreeMap::new()
            };

            for source_message in &source_messages {
                let Some(target) = target_messages.get(source_message) else {
                    locale_stats.missing += 1;
                    continue;
                };
                if *target {
                    locale_stats.translated += 1;
                } else {
                    locale_stats.missing += 1;
                }
            }
        }
    }

    Ok(CompletenessReport {
        locales: stats
            .into_values()
            .map(|locale| LocaleCompletenessReport {
                percent: if locale.total == 0 {
                    100.0
                } else {
                    (locale.translated as f64 / locale.total as f64) * 100.0
                },
                locale: locale.locale,
                total: locale.total,
                translated: locale.translated,
                missing: locale.missing,
            })
            .collect(),
    })
}

fn read_catalog_for_report(
    path: &Path,
    source_locale: &str,
    locale: &str,
    format: palamedes::PalamedesCatalogFormat,
) -> Result<Vec<palamedes::ParsedCatalogMessage>, CliError> {
    let result = parse_catalog(&CatalogParseRequest {
        target_path: path.to_string_lossy().into_owned(),
        locale: locale.to_owned(),
        source_locale: source_locale.to_owned(),
        format,
    })?;
    Ok(result.messages)
}

fn read_po(path: &Path) -> Result<palamedes::JsPoFile, CliError> {
    let source = fs::read_to_string(path).map_err(|source| CliError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    Ok(parse_po(&source)?)
}

fn resolve_report_locales(config: &LoadedConfig, selected: &[String]) -> Vec<String> {
    let selected = normalize_locale_list(selected);
    if !selected.is_empty() {
        return selected;
    }
    config
        .locales
        .iter()
        .filter(|locale| locale.as_str() != config.source_locale)
        .filter(|locale| Some(locale.as_str()) != config.pseudo_locale.as_deref())
        .cloned()
        .collect()
}

fn normalize_locale_list(values: &[String]) -> Vec<String> {
    values
        .iter()
        .flat_map(|value| value.split(','))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn print_report(result: &CompletenessReport) {
    if result.locales.is_empty() {
        println!("No target locales configured.");
        return;
    }

    let locale_column_width = result
        .locales
        .iter()
        .map(|locale| locale.locale.len())
        .max()
        .unwrap_or("Locale".len())
        .max("Locale".len())
        + 2;

    println!(
        "{:<locale_column_width$}Translated  Missing  Complete",
        "Locale"
    );
    for locale in &result.locales {
        let translated = format!("{}/{}", locale.translated, locale.total);
        println!(
            "{:<locale_column_width$}{:<11} {:<8} {}",
            locale.locale,
            translated,
            locale.missing,
            format_percent(locale.percent)
        );
    }
}

fn format_percent(value: f64) -> String {
    let rounded = (value * 10.0).round() / 10.0;
    if rounded.fract() == 0.0 {
        format!("{rounded:.0}%")
    } else {
        format!("{rounded:.1}%")
    }
}

fn run_catalog_merge(
    options: MergeOptions,
) -> Result<palamedes::CatalogFileCombineResult, CliError> {
    if options.inputs.len() != 2 {
        return Err(CliError::InvalidMergeInputCount(options.inputs.len()));
    }
    let source_locale = match options.source_locale {
        Some(source_locale) => source_locale,
        None => match load_config(
            &std::env::current_dir().expect("current dir"),
            options.config.as_deref(),
        ) {
            Ok(config) => config.source_locale,
            Err(ConfigError::NotFound) if options.config.is_none() => "en".to_owned(),
            Err(error) => return Err(CliError::Config(error)),
        },
    };

    let mut input_paths = options.inputs;
    if let Some(base) = options.base {
        input_paths.push(base);
    }

    Ok(combine_catalog_files(CatalogFileCombineRequest {
        input_paths,
        output_path: options.output,
        format: options.format.map(|format| match format {
            MergeFormat::Po => CatalogFileFormat::Po,
            MergeFormat::Fcl => CatalogFileFormat::Fcl,
        }),
        source_locale,
        locale: options.locale,
        conflict_strategy: match options.conflict_strategy {
            MergeConflictStrategy::UseFirst => CatalogConflictStrategy::UseFirst,
            MergeConflictStrategy::UseLast => CatalogConflictStrategy::UseLast,
            MergeConflictStrategy::Error => CatalogConflictStrategy::Error,
        },
    })?)
}

fn run_catalog_convert(options: ConvertOptions) -> Result<(), CliError> {
    match (options.input, options.config) {
        (Some(input), config_path) => {
            let output = options
                .output
                .unwrap_or_else(|| input.with_extension(convert_extension(options.to)));
            convert_one_catalog(
                &input,
                &output,
                &options.source_locale,
                options.locale.as_deref(),
                options.to,
            )?;
            println!("Converted {} -> {}", input.display(), output.display());
            if config_path.is_some() {
                println!(
                    "Single-file input provided; --config was not used for catalog selection."
                );
            }
            Ok(())
        }
        (None, Some(config_path)) => {
            if options.output.is_some() {
                return Err(CliError::InvalidConvertOutput);
            }
            let config = load_config(
                &std::env::current_dir().expect("current dir"),
                Some(&config_path),
            )?;
            let mut converted = 0usize;
            let mut skipped = 0usize;
            for catalog in &config.catalogs {
                if catalog.format != palamedes::PalamedesCatalogFormat::Po {
                    skipped += config.locales.len();
                    continue;
                }
                for locale in &config.locales {
                    let input = config
                        .resolve_catalog_path(&catalog.path, locale)
                        .with_extension(catalog.format.extension());
                    if !input.exists() {
                        skipped += 1;
                        continue;
                    }
                    let output = config
                        .resolve_catalog_path(&catalog.path, locale)
                        .with_extension(convert_extension(options.to));
                    convert_one_catalog(
                        &input,
                        &output,
                        &config.source_locale,
                        Some(locale),
                        options.to,
                    )?;
                    converted += 1;
                }
            }
            println!("Converted {converted} catalog(s), skipped {skipped}.");
            println!(
                "Update Palamedes config catalogs to use `format: fcl` before switching workflows."
            );
            Ok(())
        }
        (None, None) => Err(CliError::MissingConvertInput),
    }
}

fn convert_one_catalog(
    input: &Path,
    output: &Path,
    source_locale: &str,
    locale: Option<&str>,
    to: ConvertFormat,
) -> Result<(), CliError> {
    if input.extension().and_then(|ext| ext.to_str()) != Some("po") {
        return Err(CliError::UnsupportedConvertSource);
    }
    reject_fuzzy_po(input)?;
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).map_err(|source| CliError::Io {
            path: parent.to_path_buf(),
            source,
        })?;
    }
    combine_catalog_files(CatalogFileCombineRequest {
        input_paths: vec![input.to_path_buf()],
        output_path: output.to_path_buf(),
        format: Some(match to {
            ConvertFormat::Fcl => CatalogFileFormat::Fcl,
        }),
        source_locale: source_locale.to_owned(),
        locale: locale.map(str::to_owned),
        conflict_strategy: CatalogConflictStrategy::UseFirst,
    })?;
    Ok(())
}

fn reject_fuzzy_po(path: &Path) -> Result<(), CliError> {
    let catalog = read_po(path)?;
    if catalog
        .items
        .iter()
        .any(|item| item.flags.get("fuzzy").copied().unwrap_or(false))
    {
        return Err(CliError::FuzzyCatalogInput {
            path: path.to_path_buf(),
        });
    }
    Ok(())
}

const fn convert_extension(to: ConvertFormat) -> &'static str {
    match to {
        ConvertFormat::Fcl => "fcl",
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{
        build_report, load_config, run_extraction, run_watch_extraction, CliError, ExtractOptions,
    };

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
        assert!(output.contains("#: apps/web/app/page.tsx"));
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
        fs::write(app.join("app/page.tsx"), "const broken =").expect("write invalid source");
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

    #[test]
    fn watch_extraction_recovers_after_parse_failures() {
        let app = temp_dir("watch-extract-failure");
        fs::create_dir_all(app.join("app")).expect("create app");
        write_config(&app, None);
        let source_path = app.join("app/page.tsx");
        fs::write(&source_path, "const broken =").expect("write invalid source");

        let config = load_config(&app, Some(&app.join("palamedes.yaml"))).expect("load config");
        run_watch_extraction(&config, &extract_options()).expect("watch should remain active");
        assert!(!app.join("locales/en/messages.po").exists());

        fs::write(
            source_path,
            "import { t } from \"@palamedes/core/macro\";\nexport function title() { return t`Recovered`; }\n",
        )
        .expect("repair source");
        run_watch_extraction(&config, &extract_options()).expect("watch should recover");

        let output =
            fs::read_to_string(app.join("locales/en/messages.po")).expect("read recovered catalog");
        assert!(output.contains("msgid \"Recovered\""));
    }

    #[test]
    fn report_counts_translated_and_missing_messages() {
        let app = temp_dir("report");
        write_config(&app, None);
        fs::create_dir_all(app.join("locales/en")).expect("create source locale");
        fs::create_dir_all(app.join("locales/de")).expect("create target locale");
        fs::write(
            app.join("locales/en/messages.po"),
            "msgid \"Hello\"\nmsgstr \"Hello\"\n\nmsgid \"Bye\"\nmsgstr \"Bye\"\n",
        )
        .expect("write source po");
        fs::write(
            app.join("locales/de/messages.po"),
            "#, fuzzy\nmsgid \"Hello\"\nmsgstr \"Hallo\"\n",
        )
        .expect("write target po");

        let config = load_config(&app, Some(&app.join("palamedes.yaml"))).expect("load config");
        let report = build_report(&config, &["de".to_owned()]).expect("build report");

        assert_eq!(report.locales[0].total, 2);
        assert_eq!(report.locales[0].translated, 1);
        assert_eq!(report.locales[0].missing, 1);
    }

    fn write_config(dir: &std::path::Path, source_reference_root: Option<&str>) {
        fs::create_dir_all(dir).expect("create config dir");
        let reference_root = source_reference_root
            .map(|value| format!("source-reference-root: {value}\n"))
            .unwrap_or_default();
        fs::write(
            dir.join("palamedes.yaml"),
            format!(
                r#"locales: [en, de]
source-locale: en
{reference_root}catalogs:
  - path: locales/{{locale}}/messages
    include: [app]
"#
            ),
        )
        .expect("write config");
    }

    fn extract_options() -> ExtractOptions {
        ExtractOptions {
            config: None,
            watch: false,
            clean: false,
            force_clean: false,
            verbose: false,
        }
    }

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("palamedes-cli-main-{name}-{id}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }
}
