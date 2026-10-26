//! Compile catalogs ahead of time for hosts that run without a bundler.
//!
//! `--target rust` compiles data-only language updates against an exported
//! application contract. `--target js` renders the configured PO catalogs as
//! parser-free JavaScript modules, one per locale, for unbundled Node code
//! that uses runtime macros (ADR-006).

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use clap::{Args, ValueEnum};
use palamedes::{
    CatalogArtifactDiagnosticSeverity, CatalogArtifactRequest, compile_catalog_artifact,
    render_catalog_module,
};
use palamedes_build::{CatalogBuilder, CatalogContract, CatalogUpdate, MissingTranslation};

use crate::command::{Command, Context, render_json};
use crate::config::LoadedConfig;
use crate::error::CliError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
enum CompileTarget {
    Rust,
    Js,
}

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

impl Command for CompileOptions {
    type Output = CatalogUpdate;

    fn run(&self, context: &Context) -> Result<Self::Output, CliError> {
        let cwd = context.cwd()?;
        match self.target {
            CompileTarget::Rust => self.compile_rust(&cwd),
            CompileTarget::Js => {
                let config = context.load_config(self.config.as_deref())?;
                compile_js(
                    &config,
                    &self.locale,
                    self.fail_on_missing,
                    &cwd.join(&self.output),
                )
                .map_err(|message| CliError::JsCatalogCompilation { message })
            }
        }
    }

    fn render(&self, output: &Self::Output) -> Result<(), CliError> {
        if self.json {
            return render_json(output);
        }
        let count = output.catalogs.len();
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
        for missing in &output.missing {
            eprintln!(
                "{}",
                tr!(
                    "{locale}: missing translation for {message}; compiled fallback from {resolved}.",
                    locale = missing.locale,
                    message = format!("{:?}", missing.message),
                    resolved = missing.resolved_locale
                )
            );
        }
        Ok(())
    }
}

impl CompileOptions {
    fn compile_rust(&self, cwd: &Path) -> Result<CatalogUpdate, CliError> {
        let compile = || -> Result<CatalogUpdate, Box<dyn std::error::Error>> {
            // Clap requires both paths for the Rust target.
            let schema = self.schema.as_deref().unwrap_or(Path::new(""));
            let catalog_dir = self.catalog_dir.as_deref().unwrap_or(Path::new(""));
            let contract = CatalogContract::load(cwd.join(schema))?;
            CatalogBuilder::new(cwd.join(catalog_dir), &contract.source_locale)
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
        };
        compile().map_err(|source| CliError::CatalogCompilation {
            message: source.to_string(),
        })
    }
}

/// Writes `<output>/<locale>.mjs` for every requested locale, merging all
/// configured catalogs of that locale into one module. Fallbacks come from the
/// configuration, as in the bundler plugins.
fn compile_js(
    config: &LoadedConfig,
    locales: &[String],
    fail_on_missing: bool,
    output: &Path,
) -> Result<CatalogUpdate, String> {
    let locales = if locales.is_empty() {
        config.locales.clone()
    } else {
        locales.to_vec()
    };
    fs::create_dir_all(output).map_err(|error| format!("{}: {error}", output.display()))?;

    let mut update = CatalogUpdate {
        catalogs: Vec::new(),
        missing: Vec::new(),
    };
    for locale in &locales {
        let mut messages = BTreeMap::new();
        for catalog in &config.catalogs {
            let resource = config.resolve_catalog_path(&catalog.path, locale, catalog.format);
            let resource_path = resource.to_string_lossy().into_owned();
            let artifact = compile_catalog_artifact(&CatalogArtifactRequest {
                config: config.artifact_config(),
                resource_path: resource_path.clone(),
            })
            .map_err(|error| error.to_string())?;
            if let Some(diagnostic) = artifact
                .diagnostics
                .iter()
                .find(|diagnostic| diagnostic.severity == CatalogArtifactDiagnosticSeverity::Error)
            {
                return Err(format!(
                    "{locale} ({resource_path}): {} [{}]",
                    diagnostic.message, diagnostic.code
                ));
            }
            if config.pseudo_locale.as_deref() != Some(locale.as_str()) {
                for missing in &artifact.missing {
                    if fail_on_missing {
                        return Err(format!(
                            "{locale} ({resource_path}): missing translation for {:?}",
                            missing.source_key.message
                        ));
                    }
                    update.missing.push(MissingTranslation {
                        locale: locale.clone(),
                        message: missing.source_key.message.clone(),
                        resolved_locale: missing
                            .resolved_locale
                            .clone()
                            .unwrap_or_else(|| config.source_locale.clone()),
                    });
                }
            }
            messages.extend(artifact.messages);
        }

        let module_path = output.join(format!("{locale}.mjs"));
        let code = render_catalog_module(&messages, locale, &module_path.to_string_lossy())
            .map_err(|error| error.to_string())?;
        fs::write(&module_path, format!("{code}\n"))
            .map_err(|error| format!("{}: {error}", module_path.display()))?;
        update.catalogs.push(module_path);
    }
    Ok(update)
}

impl CompileOptions {
    pub(crate) fn telemetry_config(&self) -> Option<&std::path::Path> {
        self.config.as_deref()
    }
}
