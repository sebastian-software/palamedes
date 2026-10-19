//! Compile data-only language updates against an exported application contract.

use std::path::PathBuf;

use clap::{Args, ValueEnum};
use palamedes_build::{CatalogBuilder, CatalogContract, CatalogUpdate};

use crate::command::{Command, Context, render_json};
use crate::error::CliError;

#[derive(Debug, Clone, Copy, ValueEnum)]
enum CompileTarget {
    Rust,
}

#[derive(Debug, Args)]
pub struct CompileOptions {
    #[arg(long, help = tr!("Compiled catalog target."))]
    target: CompileTarget,
    #[arg(long, help = tr!("Directory containing source and target PO catalogs."))]
    catalog_dir: PathBuf,
    #[arg(long, help = tr!("Exported Rust application schema."))]
    schema: PathBuf,
    #[arg(long, required = true, help = tr!("Output locale; repeat for multiple languages."))]
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
        let compile = || -> Result<CatalogUpdate, Box<dyn std::error::Error>> {
            match self.target {
                CompileTarget::Rust => {
                    let contract = CatalogContract::load(cwd.join(&self.schema))?;
                    CatalogBuilder::new(cwd.join(&self.catalog_dir), &contract.source_locale)
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
        };
        compile().map_err(|source| CliError::CatalogCompilation {
            message: source.to_string(),
        })
    }

    fn render(&self, output: &Self::Output) -> Result<(), CliError> {
        if self.json {
            return render_json(output);
        }
        println!(
            "{}",
            tr!(
                "{count, plural, one {Compiled # Rust language catalog.} other {Compiled # Rust language catalogs.}}",
                count = output.catalogs.len()
            )
        );
        for missing in &output.missing {
            eprintln!(
                "{}",
                tr!(
                    "{locale}: missing translation for {message}; compiled fallback from {resolved}.",
                    locale = missing.locale,
                    message = missing.message,
                    resolved = missing.resolved_locale
                )
            );
        }
        Ok(())
    }
}
