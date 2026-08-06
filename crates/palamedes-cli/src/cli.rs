//! The `pmds` argument surface and the dispatch table behind it.
//!
//! Adding a command means adding a variant here and a [`crate::command::Command`]
//! implementation in its own module — the two places that have to agree, and
//! nothing else.

use clap::{Parser, Subcommand};

use crate::command::{execute, Context};
use crate::commands::audit::AuditOptions;
use crate::commands::catalog::{CatalogCommand, CatalogSubcommand};
use crate::commands::extract::ExtractOptions;
use crate::commands::lint::LintOptions;
use crate::commands::report::ReportOptions;
use crate::commands::version::VersionCommand;
use crate::error::CliError;
use crate::plugins;

#[derive(Debug, Parser)]
#[command(name = "pmds")]
#[command(version)]
#[command(about = "Palamedes CLI for extraction, source lint, audits, reports, and catalogs")]
pub struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Extract messages from source files.
    Extract(ExtractOptions),
    /// Check Palamedes source authoring without updating catalogs.
    Lint(LintOptions),
    /// Audit catalogs for translation and ICU authoring issues.
    Audit(AuditOptions),
    /// Report per-locale catalog translation completeness.
    Report(ReportOptions),
    /// Work with Palamedes catalog files.
    Catalog(CatalogCommand),
    /// Show version information.
    Version,
    /// Dispatch an explicitly configured binary plugin namespace.
    #[command(external_subcommand)]
    Plugin(Vec<String>),
}

impl Cli {
    /// Runs the invoked command.
    pub fn execute(&self) -> Result<u8, CliError> {
        let context = Context::from_env();
        match &self.command {
            Command::Extract(options) => execute(options, &context).map(|()| 0),
            Command::Lint(options) => execute(options, &context).map(|()| 0),
            Command::Audit(options) => execute(options, &context).map(|()| 0),
            Command::Report(options) => execute(options, &context).map(|()| 0),
            Command::Catalog(catalog) => match &catalog.command {
                CatalogSubcommand::Merge(options) => execute(options, &context).map(|()| 0),
                CatalogSubcommand::MergeDriver(options) => execute(options, &context).map(|()| 0),
                CatalogSubcommand::Convert(options) => execute(options, &context).map(|()| 0),
            },
            Command::Version => execute(&VersionCommand, &context).map(|()| 0),
            Command::Plugin(args) => Ok(plugins::run(args, &context)),
        }
    }
}
