//! `pmds extract` — read source files, update catalogs.

mod cache;
pub(crate) mod sources;
#[cfg(test)]
mod test_support;
mod watch;

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use clap::Args;
use palamedes::{
    extract_catalog_messages_cached, preview_catalog_file_update, update_catalog_file,
    CatalogUpdateMessage, CatalogUpdateRequest, ExtractCache, ExtractCatalogFileFailure,
};
use serde::Serialize;

use crate::command::{render_json, Command, Context};
use crate::config::{ConfigCatalog, LoadedConfig};
use crate::error::CliError;
use cache::{load_extract_cache, persist_extract_cache};
use sources::{collect_source_files, sort_and_dedupe_paths};
use watch::run_watch_mode;

/// Prefix the benchmark harness looks for when `PALAMEDES_TIMING_JSON=1`
/// turns on the machine-readable timing line.
const TIMING_MARKER: &str = "__PALAMEDES_TIMINGS__";

#[derive(Debug, Args)]
pub struct ExtractOptions {
    /// Path to a Palamedes config file.
    #[arg(short, long)]
    config: Option<PathBuf>,
    /// Watch for file changes.
    #[arg(short, long)]
    watch: bool,
    /// Verify that extraction would leave every configured catalog unchanged.
    #[arg(long, conflicts_with = "watch")]
    check: bool,
    /// Print the extraction check as one JSON document.
    #[arg(long, requires = "check")]
    json: bool,
    /// Remove obsolete messages whose obsolete-since marker is older than the
    /// 30-day grace period; undated entries are kept (use --force-clean to
    /// remove everything immediately).
    #[arg(long)]
    clean: bool,
    /// Remove obsolete messages immediately, including entries without obsolete-since.
    #[arg(long)]
    force_clean: bool,
    /// Worker threads for the parallel extraction pass. Overrides
    /// `extract-threads` in the config file; 1 forces serial extraction.
    #[arg(long, value_name = "COUNT")]
    threads: Option<usize>,
    /// Ignore and do not write the extraction cache.
    #[arg(long)]
    no_cache: bool,
    /// Show verbose output.
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
            return render_json(report);
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
            eprintln!("Config loaded from {}", config.config_path.display());
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
            ExtractCheckStatus::Clean => println!("✓ Catalogs are up to date."),
            ExtractCheckStatus::Drift => {
                println!("Catalog drift detected:");
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
            Self::Created => "create",
            Self::Modified => "modify",
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
    let mut cache = load_extract_cache(config, options);
    let result = run_extraction_with_cache(config, options, &mut cache);
    persist_extract_cache(config, options, &mut cache);
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
        eprintln!("Warning: Failed to extract from {path}: {message}");
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
    let total_write_ms = write_started_at.elapsed().as_millis();

    if options.check {
        return Ok(ExtractOutput::Check(ExtractCheckReport::from_catalogs(
            drift,
        )));
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

    Ok(ExtractOutput::Completed)
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
        eprintln!("Found {} files to extract from", files.len());
    }

    if files.is_empty() {
        eprintln!(
            "Warning: catalog '{}' matched no source files (include: {}); projecting an empty catalog.",
            catalog.path,
            catalog.include.join(", ")
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
        palamedes::ExtractCatalogMessagesOptions {
            reference_scopes: config.reference_scopes,
            mdx: config.mdx.clone(),
            rules: config.lint.rules.clone().into(),
        },
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

fn process_catalog(
    catalog: &ConfigCatalog,
    locale: &str,
    messages: &[CatalogUpdateMessage],
    config: &LoadedConfig,
    options: &ExtractOptions,
    operation: CatalogOperation,
) -> Result<CatalogJobOutcome, CliError> {
    let catalog_path = config
        .resolve_catalog_path(&catalog.path, locale)
        .with_extension(catalog.format.extension());
    let request = CatalogUpdateRequest {
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
            if let Some(parent) = catalog_path.parent() {
                fs::create_dir_all(parent).map_err(|source| CliError::Io {
                    path: parent.to_path_buf(),
                    source,
                })?;
            }
            let result = update_catalog_file(request)?;
            if options.verbose {
                lines.push(format!("  -> {}", catalog_path.display()));
                for diagnostic in result.diagnostics {
                    lines.push(format!(
                        "Warning: {}: {}",
                        diagnostic.code, diagnostic.message
                    ));
                }
            }
            None
        }
        CatalogOperation::Preview => {
            let result = preview_catalog_file_update(request)?;
            if options.verbose {
                lines.push(format!("  -> checked {}", catalog_path.display()));
                for diagnostic in result.diagnostics {
                    lines.push(format!(
                        "Warning: {}: {}",
                        diagnostic.code, diagnostic.message
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
                "msgstr \"der Sommer\"\n",
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
            "It''s ready",
            "L''{title}",
        ] {
            assert!(
                source.contains(&format!("msgid \"{identity}\"")),
                "missing source identity {identity:?}:\n{source}"
            );
        }

        let target = fs::read_to_string(app.join("locales/de/messages.po")).expect("read target");
        for translation in ["nicht aufhören", "Buchung des Kunden", "der Sommer"] {
            assert!(
                target.contains(&format!("msgstr \"{translation}\"")),
                "{target}"
            );
        }
        assert!(!target.contains("msgid \"don''t stop\""), "{target}");

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
        let mut cache = load_extract_cache(&config, &options);
        run_extraction_with_cache(&config, &options, &mut cache).expect("extract");

        assert_eq!(
            cache.len(),
            2,
            "retention must keep the entries of every catalog"
        );
        assert!(fs::read_to_string(app.join("locales/en/app.po"))
            .expect("read app catalog")
            .contains("msgid \"Dashboard\""));
        assert!(fs::read_to_string(app.join("locales/en/admin.po"))
            .expect("read admin catalog")
            .contains("msgid \"Settings\""));
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

        let mut cache = load_extract_cache(&config, &options);
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
}
