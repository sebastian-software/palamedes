//! The `pmds` argument surface and the dispatch table behind it.
//!
//! Adding a command means adding a variant here and a [`crate::command::Command`]
//! implementation in its own module — the two places that have to agree, and
//! nothing else.

use clap::{CommandFactory, FromArgMatches, Parser, Subcommand};

use crate::command::{Context, execute};
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
#[command(about = tr!("Palamedes CLI for extraction, source lint, audits, reports, and catalogs"))]
pub struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    #[command(about = tr!("Extract messages from source files."))]
    Extract(ExtractOptions),
    #[command(about = tr!("Check Palamedes source authoring without updating catalogs."))]
    Lint(LintOptions),
    #[command(about = tr!("Audit catalogs for translation and ICU authoring issues."))]
    Audit(AuditOptions),
    #[command(about = tr!("Report per-locale catalog translation completeness."))]
    Report(ReportOptions),
    #[command(about = tr!("Work with Palamedes catalog files."))]
    Catalog(CatalogCommand),
    #[command(about = tr!("Show version information."))]
    Version,
    #[command(about = tr!("Dispatch an explicitly configured binary plugin namespace."))]
    #[command(external_subcommand)]
    Plugin(Vec<String>),
}

impl Cli {
    pub fn parse_localized() -> Result<Self, clap::Error> {
        let matches = localize_help(Self::command()).try_get_matches()?;
        Self::from_arg_matches(&matches)
    }
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

fn localize_help(command: clap::Command) -> clap::Command {
    let mut command = command
        .help_template(format!(
            "{{about-with-newline}}\n{} {{usage}}\n\n{{all-args}}{{after-help}}",
            tr!("Usage:")
        ))
        .subcommand_help_heading(tr!("Commands"))
        .mut_subcommands(localize_help);
    command.build();
    let has_help = command.get_arguments().any(|arg| arg.get_id() == "help");
    let has_version = command.get_arguments().any(|arg| arg.get_id() == "version");
    let has_help_command = command
        .get_subcommands()
        .any(|command| command.get_name() == "help");
    command = command.mut_args(|arg| {
        let heading = if arg.is_positional() {
            tr!("Arguments")
        } else {
            tr!("Options")
        };
        arg.help_heading(heading)
    });
    if has_help {
        command = command.mut_arg("help", |arg| arg.help(tr!("Print help")));
    }
    if has_version {
        command = command.mut_arg("version", |arg| arg.help(tr!("Print version")));
    }
    if has_help_command {
        command = command.mut_subcommand("help", |command| {
            command.about(tr!(
                "Print this message or the help of the given subcommand(s)"
            ))
        });
    }
    command
}
