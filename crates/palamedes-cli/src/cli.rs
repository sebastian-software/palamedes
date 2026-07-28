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
use crate::commands::report::ReportOptions;
use crate::commands::version::VersionCommand;
use crate::error::CliError;

#[derive(Debug, Parser)]
#[command(name = "pmds")]
#[command(version)]
#[command(about = "Palamedes CLI for extraction, audits, reports, and catalog workflows")]
pub struct Cli {
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

impl Cli {
    /// Runs the invoked command.
    pub fn execute(&self) -> Result<(), CliError> {
        let context = Context::from_env();
        match &self.command {
            Command::Extract(options) => execute(options, &context),
            Command::Audit(options) => execute(options, &context),
            Command::Report(options) => execute(options, &context),
            Command::Catalog(catalog) => match &catalog.command {
                CatalogSubcommand::Merge(options) => execute(options, &context),
                CatalogSubcommand::Convert(options) => execute(options, &context),
            },
            Command::Version => execute(&VersionCommand, &context),
        }
    }
}
