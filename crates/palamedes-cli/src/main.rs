//! `pmds`, the native Palamedes CLI.
//!
//! Built-in commands live here and are compiled into the binary. They are
//! reached without loading configuration or resolving plugins (ADR 017), which
//! is what guarantees that a missing or broken plugin can never affect
//! `extract`, `audit`, `report`, `catalog`, or `version`.

mod cli;
mod command;
mod commands;
mod config;
mod error;
mod plugins;

use clap::Parser;
use std::process::ExitCode;

fn main() -> ExitCode {
    match cli::Cli::parse().execute() {
        Ok(code) => ExitCode::from(code),
        Err(error) => {
            eprintln!("Error: {error}");
            ExitCode::from(error.exit_code())
        }
    }
}
