//! The execution contract every built-in command implements.
//!
//! The shape deliberately mirrors a binary plugin command (ADR 018): a command
//! resolves its inputs from a context, produces a structured result, renders
//! that result, and only then reports the verdict that decides the exit code.
//!
//! Nothing here crosses a process boundary, and nothing is meant to. Built-ins
//! stay compiled into `pmds` precisely so they keep working without
//! configuration, plugin resolution, or the npm wrapper (ADR 017), the same way
//! git keeps its core commands in one binary and reserves subprocess dispatch
//! for third-party extensions. The point of the shared shape is that a command
//! reaches the outside world through its context and its renderer instead of
//! reaching for process globals — so it stays testable, and so moving one
//! behind the plugin protocol later would be a swap of those two pieces rather
//! than a rewrite of its body.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::config::{load_config, LoadedConfig};
use crate::error::CliError;

/// The environment a command runs in.
///
/// Built-in commands own configuration discovery rather than receiving an
/// already-resolved config, because several of them must work where no config
/// exists: `catalog merge` runs as a Git merge driver in arbitrary worktrees,
/// and `version` answers before any project is set up. So the context carries
/// the directory that resolution starts from, not the result of it.
pub struct Context {
    /// Where path resolution starts. `None` defers to the process, and the
    /// lookup happens only when a command actually loads configuration.
    cwd: Option<PathBuf>,
}

impl Context {
    /*
     * Resolving the working directory here rather than on demand would make
     * every command pay for it, including the two that deliberately do not
     * read configuration: `version` answers before any project exists, and
     * `catalog merge --source-locale` runs as a Git merge driver wherever the
     * conflicted worktree happens to be. Both must still answer when the
     * process has no usable cwd.
     */
    /// Builds the context for the current process.
    pub fn from_env() -> Self {
        Self { cwd: None }
    }

    /// Builds a context rooted at an explicit directory, so a command can be
    /// driven through its full contract without changing the process cwd.
    #[cfg(test)]
    pub fn with_cwd(cwd: impl Into<PathBuf>) -> Self {
        Self {
            cwd: Some(cwd.into()),
        }
    }

    /// Loads the Palamedes configuration, honoring an explicit `--config` path.
    pub fn load_config(&self, explicit_path: Option<&Path>) -> Result<LoadedConfig, CliError> {
        let config = load_config(&self.cwd()?, explicit_path);
        Ok(config?)
    }

    /// Resolves the invocation directory when a command needs to interpret a
    /// path supplied by an external tool such as Git.
    pub fn cwd(&self) -> Result<PathBuf, CliError> {
        self.cwd.clone().map_or_else(current_dir, Ok)
    }
}

fn current_dir() -> Result<PathBuf, CliError> {
    std::env::current_dir().map_err(CliError::CurrentDir)
}

/// One built-in `pmds` command.
pub trait Command {
    /// The structured result this command produces. `()` for commands that
    /// only stream progress and have nothing left to report at the end.
    type Output;

    /// Runs the command against the resolved environment.
    fn run(&self, context: &Context) -> Result<Self::Output, CliError>;

    /// Writes the result to stdout, as text or as the `--json` envelope.
    fn render(&self, output: &Self::Output) -> Result<(), CliError>;

    /// The failure a policy flag turns an otherwise successful run into.
    ///
    /// Checked after `render`, which is what lets `--fail-on` and
    /// `--fail-if-below` decide the exit code without ever suppressing the
    /// report that explains the decision.
    fn verdict(&self, output: &Self::Output) -> Result<(), CliError> {
        let _ = output;
        Ok(())
    }
}

/// Runs one command through the full contract: execute, render, then judge.
pub fn execute<C: Command>(command: &C, context: &Context) -> Result<(), CliError> {
    let output = command.run(context)?;
    command.render(&output)?;
    command.verdict(&output)
}

/// Writes the single JSON document a `--json` invocation produces.
pub fn render_json<T: Serialize>(value: &T) -> Result<(), CliError> {
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::Context;

    /*
     * Dispatch builds one context up front, before it knows which command was
     * invoked. Resolving the working directory eagerly there made `pmds
     * version` and `catalog merge --source-locale` panic in a worktree whose
     * cwd had been removed, even though neither reads configuration.
     */
    #[test]
    fn from_env_defers_resolving_the_working_directory() {
        assert!(Context::from_env().cwd.is_none());
    }
}
