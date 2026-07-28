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

#[cfg(test)]
mod tests {
    use super::{Command, Context, VersionCommand};

    /// Build identity must be answerable with no project and no reachable
    /// directory around it.
    #[test]
    fn version_needs_neither_config_nor_a_usable_directory() {
        let context = Context::with_cwd("/palamedes/does/not/exist");
        VersionCommand
            .run(&context)
            .expect("version must not consult the environment");
    }
}
