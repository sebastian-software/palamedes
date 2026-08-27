//! `pmds`, the native Palamedes CLI.
//!
//! Built-in commands live here and are compiled into the binary. They are
//! reached without loading configuration or resolving plugins (ADR 017), which
//! is what guarantees that a missing or broken plugin can never affect
//! `extract`, `lint`, `audit`, `report`, `catalog`, or `version`.

mod cli;
mod command;
mod commands;
mod config;
mod error;
mod plugins;
mod update_check;

use clap::Parser;
use std::io::{self, Write};
use std::process::ExitCode;

fn main() -> ExitCode {
    let cli = cli::Cli::parse();
    let update_check = update_check::UpdateCheck::start();
    let exit_code = match cli.execute() {
        Ok(code) => code,
        Err(error) => {
            eprintln!("Error: {error}");
            error.exit_code()
        }
    };

    if let Some(notice) = update_check.finish() {
        // Advisory output must not turn a successful command into a broken-pipe
        // panic when stderr is closed by its caller.
        let _ = writeln!(io::stderr().lock(), "{notice}");
    }

    ExitCode::from(exit_code)
}
