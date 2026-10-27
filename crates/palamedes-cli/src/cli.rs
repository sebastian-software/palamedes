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
    #[arg(long, global = true, help = tr!("Disable network access for update checks and usage reporting."))]
    offline: bool,
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
    #[command(about = tr!("Manage optional usage reporting."))]
    Telemetry(crate::telemetry::Options),
    #[command(about = tr!("Dispatch an explicitly configured binary plugin namespace."))]
    #[command(external_subcommand)]
    Plugin(Vec<String>),
}

impl Cli {
    pub fn telemetry_context(&self) -> app_tracking::project::RepositoryContext {
        let explicit = match &self.command {
            Command::Extract(options) => options.telemetry_config(),
            Command::Lint(options) => options.telemetry_config(),
            Command::Audit(options) => options.telemetry_config(),
            Command::Report(options) => options.telemetry_config(),
            Command::Catalog(options) => match &options.command {
                CatalogSubcommand::Merge(options) => match options.telemetry_config() {
                    Some(path) => Some(path),
                    None => return crate::telemetry::unknown_context(),
                },
                CatalogSubcommand::Convert(options) => match options.telemetry_config() {
                    Some(path) => Some(path),
                    None => return crate::telemetry::unknown_context(),
                },
                CatalogSubcommand::Compile(options) => match options.telemetry_config() {
                    Some(path) => Some(path),
                    None => return crate::telemetry::unknown_context(),
                },
                CatalogSubcommand::MergeDriver(_) => return crate::telemetry::unknown_context(),
            },
            Command::Plugin(_) => return crate::telemetry::unknown_context(),
            Command::Version | Command::Telemetry(_) => return crate::telemetry::unknown_context(),
        };
        crate::telemetry::project_context(explicit)
    }

    pub fn offline(&self) -> bool {
        self.offline
    }

    pub fn telemetry_category(&self) -> Option<&'static str> {
        match &self.command {
            Command::Extract(_) => Some("extract"),
            Command::Lint(_) => Some("lint"),
            Command::Audit(_) => Some("audit"),
            Command::Report(_) => Some("report"),
            Command::Catalog(catalog) => match &catalog.command {
                CatalogSubcommand::Merge(_) => Some("catalogmerge"),
                CatalogSubcommand::MergeDriver(_) => None,
                CatalogSubcommand::Convert(_) => Some("catalogconvert"),
                CatalogSubcommand::Compile(_) => Some("catalogcompile"),
            },
            Command::Plugin(_) => Some("plugin"),
            Command::Version | Command::Telemetry(_) => None,
        }
    }

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
                CatalogSubcommand::Compile(options) => execute(options, &context).map(|()| 0),
            },
            Command::Version => execute(&VersionCommand, &context).map(|()| 0),
            Command::Telemetry(options) => crate::telemetry::execute(options, self.offline),
            Command::Plugin(args) => Ok(plugins::run(args, &context)),
        }
    }
}

fn localize_help(command: clap::Command) -> clap::Command {
    // Build the tree once, from the root. clap copies global arguments such as
    // `--offline` into each subcommand while the root builds, and a subcommand
    // that was already built cannot take them: its help renderer panics.
    let mut command = set_help_template(command);
    command.build();
    localize_built_help(command)
}

fn set_help_template(command: clap::Command) -> clap::Command {
    command
        .help_template(format!(
            "{{about-with-newline}}\n{} {{usage}}\n\n{{all-args}}{{after-help}}",
            tr!("Usage:")
        ))
        .subcommand_help_heading(tr!("Commands"))
        .mut_subcommands(set_help_template)
}

fn localize_built_help(command: clap::Command) -> clap::Command {
    let has_help = command.get_arguments().any(|arg| arg.get_id() == "help");
    let has_version = command.get_arguments().any(|arg| arg.get_id() == "version");
    let has_help_command = command
        .get_subcommands()
        .any(|command| command.get_name() == "help");
    let mut command = command.mut_args(|arg| {
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
                "Print this message or the help of the given subcommands"
            ))
        });
    }
    // The generated `help` subcommand has never been localized beyond its
    // about text, so keep it out of the recursion.
    command.mut_subcommands(|subcommand| {
        if subcommand.get_name() == "help" {
            subcommand
        } else {
            localize_built_help(subcommand)
        }
    })
}
