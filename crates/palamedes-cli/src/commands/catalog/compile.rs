//! Compile catalogs ahead of time for hosts that run without a bundler.
//!
//! `--target rust` compiles data-only language updates against an exported
//! application contract. `--target js` renders the configured PO catalogs as
//! parser-free JavaScript modules, one per locale, for unbundled Node code
//! that uses runtime macros (ADR-006).

use std::collections::btree_map::Entry;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use clap::{Args, ValueEnum};
use palamedes::{
    CatalogArtifactDiagnosticSeverity, CatalogArtifactRequest, CatalogArtifactSourceKey,
    CatalogParseRequest, FallbackLocales, compile_catalog_artifact, compiled_message_key,
    parse_catalog, render_catalog_module,
};
use palamedes_build::{CatalogBuilder, CatalogContract, CatalogUpdate, MissingTranslation};
use serde::Serialize;

use crate::command::{Command, Context, VersionedJson, render_json};
use crate::config::{ConfigCatalog, LoadedConfig};
use crate::error::CliError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
enum CompileTarget {
    Rust,
    Js,
}

/// Version of the `pmds catalog compile --json` document shape (`schemaVersion`).
const COMPILE_JSON_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Args)]
pub struct CompileOptions {
    #[arg(long, help = tr!("Compiled catalog target."))]
    target: CompileTarget,
    #[arg(short, long, help = tr!("Path to a Palamedes config file."))]
    config: Option<PathBuf>,
    #[arg(long, required_if_eq("target", "rust"), help = tr!("Directory containing source and target PO catalogs."))]
    catalog_dir: Option<PathBuf>,
    #[arg(long, required_if_eq("target", "rust"), help = tr!("Exported Rust application schema."))]
    schema: Option<PathBuf>,
    #[arg(long, required_if_eq("target", "rust"), help = tr!("Output locale; repeat for multiple languages."))]
    locale: Vec<String>,
    #[arg(long, help = tr!("Directory for compiled language files."))]
    output: PathBuf,
    #[arg(long, help = tr!("Fallback locale; repeat in resolution order."))]
    fallback_locale: Vec<String>,
    #[arg(long, help = tr!("Reject missing or fuzzy translations instead of compiling a fallback."))]
    fail_on_missing: bool,
    #[arg(long, help = tr!("Write the compilation result as JSON."))]
    json: bool,
}

/// The compilation result, rendered as text or as the `--json` document.
///
/// Compilation failures are reported as `diagnostics` instead of an early
/// error, so `--json` callers receive them in the same document. No module or
/// language file is written while any diagnostic exists.
#[derive(Debug, Serialize)]
pub struct CompileReport {
    #[serde(flatten)]
    update: CatalogUpdate,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    diagnostics: Vec<CompileDiagnostic>,
}

/// One catalog failure, shaped like the catalog audit diagnostics.
///
/// The JavaScript target always knows the catalog and both locales. A Rust
/// target failure carries only what its build error names, so those fields
/// are omitted when the error does not identify them.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CompileDiagnostic {
    severity: CatalogArtifactDiagnosticSeverity,
    code: String,
    message: String,
    /// The catalog file that holds the failing message.
    #[serde(skip_serializing_if = "Option::is_none")]
    catalog_path: Option<String>,
    /// The locale of that catalog, which differs from `requested_locale` when
    /// the message was reached through a fallback.
    #[serde(skip_serializing_if = "Option::is_none")]
    locale: Option<String>,
    /// The locale whose module was being compiled.
    #[serde(skip_serializing_if = "Option::is_none")]
    requested_locale: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_key: Option<CatalogArtifactSourceKey>,
    /// For `compile.conflicting_message`, the catalog that compiled the same
    /// runtime ID differently first.
    #[serde(skip_serializing_if = "Option::is_none")]
    conflicting_catalog_path: Option<String>,
}

const MISSING_TRANSLATION: &str = "compile.missing_translation";
const CONFLICTING_MESSAGE: &str = "compile.conflicting_message";
const INVALID_CATALOG: &str = "compile.invalid_catalog";
const INVALID_LOCALE: &str = "compile.invalid_locale";
const INVALID_SCHEMA: &str = "compile.invalid_schema";
const CONTRACT_MISMATCH: &str = "compile.contract_mismatch";
const UNSUPPORTED_MESSAGE: &str = "compile.unsupported_message";
const PLACEHOLDER_MISMATCH: &str = "compile.placeholder_mismatch";
const PLURAL_ARGUMENT: &str = "compile.plural_argument";
const IO_ERROR: &str = "compile.io_error";
const COMPILE_FAILED: &str = "compile.failed";

impl Command for CompileOptions {
    type Output = CompileReport;

    fn run(&self, context: &Context) -> Result<Self::Output, CliError> {
        let cwd = context.cwd()?;
        match self.target {
            CompileTarget::Rust => Ok(match self.compile_rust(&cwd) {
                Ok(update) => CompileReport {
                    update,
                    diagnostics: Vec::new(),
                },
                // A failed update writes nothing, so the document reports no
                // catalogs and the one error that stopped the build.
                Err(error) => CompileReport {
                    update: CatalogUpdate {
                        catalogs: Vec::new(),
                        missing: Vec::new(),
                    },
                    diagnostics: vec![rust_diagnostic(&error, &self.rust_catalog_dir(&cwd))],
                },
            }),
            CompileTarget::Js => {
                let config = context.load_config(self.config.as_deref())?;
                compile_js(
                    &config,
                    &self.locale,
                    &self.fallback_locale,
                    self.fail_on_missing,
                    &cwd.join(&self.output),
                )
                .map_err(|message| CliError::JsCatalogCompilation { message })
            }
        }
    }

    fn render(&self, output: &Self::Output) -> Result<(), CliError> {
        if self.json {
            return render_json(&VersionedJson::new(COMPILE_JSON_SCHEMA_VERSION, output));
        }
        // The verdict reports the diagnostics; nothing was compiled.
        if !output.diagnostics.is_empty() {
            return Ok(());
        }
        let count = output.update.catalogs.len();
        let summary = match self.target {
            CompileTarget::Rust => tr!(
                "{count, plural, one {Compiled # Rust language catalog.} other {Compiled # Rust language catalogs.}}",
                count = count
            ),
            CompileTarget::Js => tr!(
                "{count, plural, one {Compiled # JavaScript catalog module.} other {Compiled # JavaScript catalog modules.}}",
                count = count
            ),
        };
        println!("{summary}");
        for missing in &output.update.missing {
            let message = match &missing.context {
                Some(context) => format!("{:?} (msgctxt {context:?})", missing.message),
                None => format!("{:?}", missing.message),
            };
            eprintln!(
                "{}",
                tr!(
                    "{locale}: missing translation for {message}; compiled fallback from {resolved}.",
                    locale = missing.locale,
                    message = message,
                    resolved = missing.resolved_locale
                )
            );
        }
        Ok(())
    }

    fn verdict(&self, output: &Self::Output) -> Result<(), CliError> {
        if output.diagnostics.is_empty() {
            return Ok(());
        }
        if self.target == CompileTarget::Rust {
            // The message is the build error's own text, so stderr reads the
            // same with and without `--json`.
            return Err(CliError::CatalogCompilation {
                message: output
                    .diagnostics
                    .iter()
                    .map(|diagnostic| diagnostic.message.as_str())
                    .collect::<Vec<_>>()
                    .join("\n\n"),
            });
        }
        Err(CliError::JsCatalogCompilation {
            message: output
                .diagnostics
                .iter()
                .map(CompileDiagnostic::render)
                .collect::<Vec<_>>()
                .join("\n\n"),
        })
    }
}

impl CompileOptions {
    fn rust_catalog_dir(&self, cwd: &Path) -> PathBuf {
        // Clap requires the catalog directory for the Rust target.
        cwd.join(self.catalog_dir.as_deref().unwrap_or(Path::new("")))
    }

    fn compile_rust(&self, cwd: &Path) -> Result<CatalogUpdate, palamedes_build::Error> {
        // Clap requires the schema for the Rust target.
        let schema = self.schema.as_deref().unwrap_or(Path::new(""));
        let contract = CatalogContract::load(cwd.join(schema))?;
        CatalogBuilder::new(self.rust_catalog_dir(cwd), &contract.source_locale)
            .locales(&self.locale.iter().map(String::as_str).collect::<Vec<_>>())
            .fallback_locales(
                &self
                    .fallback_locale
                    .iter()
                    .map(String::as_str)
                    .collect::<Vec<_>>(),
            )
            .fail_on_missing(self.fail_on_missing)
            .compile_updates(&contract, &cwd.join(&self.output))
    }
}

/// Maps a Rust catalog build error onto the diagnostic shape of the
/// JavaScript target.
///
/// The build error has no codes of its own, so each kind gets a stable one
/// here; kinds the JavaScript target shares keep its codes. Only what the
/// error names is filled in: its locale, its source message, and the file it
/// read. A PO catalog is always `<catalog-dir>/<locale>.po`, so errors about
/// one catalog's content name that file. The message is the error's own text.
fn rust_diagnostic(error: &palamedes_build::Error, catalog_dir: &Path) -> CompileDiagnostic {
    use palamedes_build::Error;

    let catalog = |locale: &str| {
        Some(
            catalog_dir
                .join(format!("{locale}.po"))
                .to_string_lossy()
                .into_owned(),
        )
    };
    let source_key = |message: &str| {
        Some(CatalogArtifactSourceKey {
            message: message.to_owned(),
            context: None,
        })
    };
    let (code, catalog_path, locale, source_key) = match error {
        Error::Io { path, .. } => (
            IO_ERROR,
            Some(path.to_string_lossy().into_owned()),
            None,
            None,
        ),
        Error::InvalidLocales => (INVALID_LOCALE, None, None, None),
        Error::InvalidLocale { locale } => (INVALID_LOCALE, None, Some(locale), None),
        Error::ParsePo { locale, .. } | Error::InvalidCatalog { locale, .. } => {
            (INVALID_CATALOG, catalog(locale), Some(locale), None)
        }
        Error::CompileCatalog { locale, .. } => (INVALID_CATALOG, None, Some(locale), None),
        Error::UnsupportedMessage {
            locale, message, ..
        } => (UNSUPPORTED_MESSAGE, None, Some(locale), source_key(message)),
        Error::PlaceholderMismatch { locale, message } => (
            PLACEHOLDER_MISMATCH,
            None,
            Some(locale),
            source_key(message),
        ),
        Error::PluralArgument { locale, message } => {
            (PLURAL_ARGUMENT, None, Some(locale), source_key(message))
        }
        Error::MissingTranslation { locale, message } => (
            MISSING_TRANSLATION,
            catalog(locale),
            Some(locale),
            source_key(message),
        ),
        Error::ContractMismatch => (CONTRACT_MISMATCH, None, None, None),
        Error::DecodeContract { path, .. } => (
            INVALID_SCHEMA,
            Some(path.to_string_lossy().into_owned()),
            None,
            None,
        ),
        Error::InvalidContract { .. } => (INVALID_SCHEMA, None, None, None),
        // Serialization failures and errors of build-script-only entry points;
        // new kinds land here until they get a code of their own.
        _ => (COMPILE_FAILED, None, None, None),
    };
    CompileDiagnostic {
        severity: CatalogArtifactDiagnosticSeverity::Error,
        code: code.to_owned(),
        message: error.to_string(),
        catalog_path,
        locale: locale.cloned(),
        requested_locale: None,
        source_key,
        conflicting_catalog_path: None,
    }
}

impl CompileDiagnostic {
    /// Mirrors the bundler's compile errors: catalog, locale, then source.
    fn render(&self) -> String {
        let mut text = match &self.catalog_path {
            Some(catalog_path) => format!("{catalog_path}: {} [{}]", self.message, self.code),
            None => format!("{} [{}]", self.message, self.code),
        };
        if let Some(locale) = &self.locale {
            text.push_str(&format!("\nLocale: {locale}"));
            if let Some(requested) = self
                .requested_locale
                .as_ref()
                .filter(|requested| *requested != locale)
            {
                text.push_str(&format!(" (fallback for {requested})"));
            }
        }
        if let Some(source_key) = &self.source_key {
            text.push_str(&format!("\nSource: {}", source_key.message));
            if let Some(context) = &source_key.context {
                text.push_str(&format!(" [context: {context}]"));
            }
        }
        text
    }
}

/// One compiled message of a locale module and the catalog it came from.
struct MergedMessage {
    code: String,
    catalog_path: String,
    /// Set when the message was compiled from a fallback locale because the
    /// catalog lacks a translation.
    fallback: Option<Fallback>,
}

/// The source message behind a fallback and the locale that supplied it.
struct Fallback {
    source_key: CatalogArtifactSourceKey,
    resolved_locale: String,
}

/// Writes `<output>/<locale>.mjs` for every requested locale, merging all
/// configured catalogs of that locale into one module. Fallbacks come from the
/// configuration, as in the bundler plugins, unless `--fallback-locale`
/// replaces them with one shared chain, as for the Rust target.
///
/// Missing translations are judged on the merged module: a message that one
/// catalog lacks but another translates is complete.
fn compile_js(
    config: &LoadedConfig,
    locales: &[String],
    fallback_locales: &[String],
    fail_on_missing: bool,
    output: &Path,
) -> Result<CompileReport, String> {
    let locales = if locales.is_empty() {
        config.locales.clone()
    } else {
        locales.to_vec()
    };
    let mut requested = BTreeSet::new();
    if let Some(repeated) = locales
        .iter()
        .find(|locale| !requested.insert(locale.as_str()))
    {
        return Err(format!(
            "--locale {repeated} is given more than once; each locale compiles to one module."
        ));
    }
    if let Some(unknown) = fallback_locales
        .iter()
        .find(|fallback| !config.locales.contains(fallback))
    {
        return Err(format!(
            "--fallback-locale {unknown} is not listed in the configured locales ({}).",
            config.locales.join(", ")
        ));
    }

    let mut update = CatalogUpdate {
        catalogs: Vec::new(),
        missing: Vec::new(),
    };
    let mut diagnostics = Vec::new();
    let mut modules = Vec::new();
    for locale in &locales {
        let mut messages = BTreeMap::<String, MergedMessage>::new();
        for catalog in &config.catalogs {
            let resource = config.resolve_catalog_path(&catalog.path, locale, catalog.format);
            let resource_path = resource.to_string_lossy().into_owned();
            let mut artifact_config = config.artifact_config();
            if !fallback_locales.is_empty() {
                artifact_config.fallback_locales =
                    Some(FallbackLocales::Shared(fallback_locales.to_vec()));
            }
            let artifact = match compile_catalog_artifact(&CatalogArtifactRequest {
                config: artifact_config,
                resource_path: resource_path.clone(),
            }) {
                Ok(artifact) => artifact,
                // A catalog that does not parse or normalize, such as one with
                // a duplicate msgid, is a diagnostic so `--json` reports it.
                Err(error) => {
                    diagnostics.push(CompileDiagnostic {
                        severity: CatalogArtifactDiagnosticSeverity::Error,
                        code: INVALID_CATALOG.to_owned(),
                        message: error.to_string(),
                        catalog_path: Some(resource_path.clone()),
                        locale: Some(locale.clone()),
                        requested_locale: Some(locale.clone()),
                        source_key: None,
                        conflicting_catalog_path: None,
                    });
                    continue;
                }
            };

            let errors_before = diagnostics.len();
            for diagnostic in &artifact.diagnostics {
                if diagnostic.severity != CatalogArtifactDiagnosticSeverity::Error {
                    continue;
                }
                // A fallback message belongs to the catalog of its own locale.
                let catalog_path = config
                    .resolve_catalog_path(&catalog.path, &diagnostic.locale, catalog.format)
                    .to_string_lossy()
                    .into_owned();
                diagnostics.push(CompileDiagnostic {
                    severity: diagnostic.severity,
                    code: diagnostic.code.clone(),
                    message: diagnostic.message.clone(),
                    catalog_path: Some(catalog_path),
                    locale: Some(diagnostic.locale.clone()),
                    requested_locale: Some(locale.clone()),
                    source_key: Some(clone_source_key(&diagnostic.source_key)),
                    conflicting_catalog_path: None,
                });
            }

            if diagnostics.len() > errors_before {
                continue;
            }
            let mut fallbacks = BTreeMap::new();
            if config.pseudo_locale.as_deref() != Some(locale.as_str()) {
                for missing in &artifact.missing {
                    fallbacks.insert(
                        missing.compiled_id.as_str(),
                        Fallback {
                            source_key: clone_source_key(&missing.source_key),
                            resolved_locale: missing
                                .resolved_locale
                                .clone()
                                .unwrap_or_else(|| config.source_locale.clone()),
                        },
                    );
                }
            }

            for (id, code) in &artifact.messages {
                let fallback = fallbacks.remove(id.as_str());
                match messages.entry(id.clone()) {
                    Entry::Vacant(entry) => {
                        entry.insert(MergedMessage {
                            code: code.clone(),
                            catalog_path: resource_path.clone(),
                            fallback,
                        });
                    }
                    Entry::Occupied(mut entry) => {
                        let existing = entry.get();
                        // The same source message in several catalogs shares
                        // one runtime ID. Identical output is the normal case,
                        // and a translation wins over another catalog's
                        // fallback for the same message.
                        if existing.code == *code
                            || (fallback.is_some() && existing.fallback.is_none())
                        {
                            // A translation that happens to match the
                            // fallback text still completes the message.
                            if fallback.is_none() {
                                entry.get_mut().fallback = None;
                            }
                            continue;
                        }
                        if existing.fallback.is_some() && fallback.is_none() {
                            entry.insert(MergedMessage {
                                code: code.clone(),
                                catalog_path: resource_path.clone(),
                                fallback,
                            });
                            continue;
                        }
                        diagnostics.push(CompileDiagnostic {
                            severity: CatalogArtifactDiagnosticSeverity::Error,
                            code: CONFLICTING_MESSAGE.to_owned(),
                            message: format!(
                                "Compiles differently than in {}; one locale module cannot hold both translations of a shared message.",
                                existing.catalog_path
                            ),
                            catalog_path: Some(resource_path.clone()),
                            locale: Some(locale.clone()),
                            requested_locale: Some(locale.clone()),
                            source_key: find_source_key(config, catalog, &resource, locale, entry.key()),
                            conflicting_catalog_path: Some(existing.catalog_path.clone()),
                        });
                    }
                }
            }
        }

        // Only fallbacks that no catalog translates are missing.
        let mut fallbacks = messages
            .values()
            .filter_map(|message| {
                message
                    .fallback
                    .as_ref()
                    .map(|fallback| (fallback, &message.catalog_path))
            })
            .collect::<Vec<_>>();
        fallbacks.sort_by(|(left, _), (right, _)| {
            (&left.source_key.message, &left.source_key.context)
                .cmp(&(&right.source_key.message, &right.source_key.context))
        });
        for (fallback, catalog_path) in fallbacks {
            let resolved_locale = &fallback.resolved_locale;
            if fail_on_missing {
                diagnostics.push(CompileDiagnostic {
                    severity: CatalogArtifactDiagnosticSeverity::Error,
                    code: MISSING_TRANSLATION.to_owned(),
                    message: format!(
                        "Missing or fuzzy translation; --fail-on-missing rejects the fallback from {resolved_locale}."
                    ),
                    catalog_path: Some(catalog_path.clone()),
                    locale: Some(locale.clone()),
                    requested_locale: Some(locale.clone()),
                    source_key: Some(clone_source_key(&fallback.source_key)),
                    conflicting_catalog_path: None,
                });
            } else {
                update.missing.push(MissingTranslation {
                    locale: locale.clone(),
                    message: fallback.source_key.message.clone(),
                    context: fallback.source_key.context.clone(),
                    resolved_locale: resolved_locale.clone(),
                });
            }
        }

        let messages = messages
            .into_iter()
            .map(|(id, message)| (id, message.code))
            .collect::<BTreeMap<_, _>>();
        let module_path = output.join(format!("{locale}.mjs"));
        let code = render_catalog_module(&messages, locale, &module_path.to_string_lossy())
            .map_err(|error| error.to_string())?;
        modules.push((module_path, code));
    }

    if diagnostics.is_empty() {
        fs::create_dir_all(output).map_err(|error| format!("{}: {error}", output.display()))?;
        for (module_path, code) in modules {
            fs::write(&module_path, format!("{code}\n"))
                .map_err(|error| format!("{}: {error}", module_path.display()))?;
            update.catalogs.push(module_path);
        }
    }
    Ok(CompileReport {
        update,
        diagnostics,
    })
}

fn clone_source_key(source_key: &CatalogArtifactSourceKey) -> CatalogArtifactSourceKey {
    CatalogArtifactSourceKey {
        message: source_key.message.clone(),
        context: source_key.context.clone(),
    }
}

/// Recovers the source message behind a runtime ID from the catalog that
/// compiled it. Only conflicts need this, so the extra parse stays off the
/// successful path.
fn find_source_key(
    config: &LoadedConfig,
    catalog: &ConfigCatalog,
    resource: &Path,
    locale: &str,
    compiled_id: &str,
) -> Option<CatalogArtifactSourceKey> {
    let parsed = parse_catalog(&CatalogParseRequest {
        target_path: resource.to_string_lossy().into_owned(),
        locale: locale.to_owned(),
        source_locale: config.source_locale.clone(),
        format: catalog.format,
    })
    .ok()?;
    parsed
        .messages
        .into_iter()
        .find(|message| {
            compiled_message_key(&message.message, message.context.as_deref()) == compiled_id
        })
        .map(|message| CatalogArtifactSourceKey {
            message: message.message,
            context: message.context,
        })
}

impl CompileOptions {
    pub(crate) fn telemetry_config(&self) -> Option<&std::path::Path> {
        self.config.as_deref()
    }
}
