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

use crate::config::{load_config, ConfigError, LoadedConfig};
use crate::error::CliError;

/// The environment a command runs in.
///
/// Built-in commands own configuration discovery rather than receiving an
/// already-resolved config, because several of them must work where no config
/// exists: `catalog merge` runs as a Git merge driver in arbitrary worktrees,
/// and `version` answers before any project is set up. So the context carries
/// the directory that resolution starts from, not the result of it.
pub struct Context {
    cwd: PathBuf,
}

impl Context {
    /// Builds the context for the current process.
    pub fn from_env() -> Self {
        Self {
            cwd: std::env::current_dir().expect("current dir"),
        }
    }

    /// Loads the Palamedes configuration, honoring an explicit `--config` path.
    pub fn load_config(&self, explicit_path: Option<&Path>) -> Result<LoadedConfig, ConfigError> {
        load_config(&self.cwd, explicit_path)
    }
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
