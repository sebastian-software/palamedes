//! `pmds version` — build identity, answerable without any project setup.

use crate::command::{Command, Context};
use crate::error::CliError;

/// `pmds version` takes no options.
#[derive(Debug)]
pub struct VersionCommand;

impl Command for VersionCommand {
    type Output = ();

    fn run(&self, _context: &Context) -> Result<Self::Output, CliError> {
        Ok(())
    }

    fn render(&self, _output: &Self::Output) -> Result<(), CliError> {
        println!("pmds (Palamedes) v{}", env!("CARGO_PKG_VERSION"));
        println!("Fast i18n tooling for modern apps");
        Ok(())
    }
}
