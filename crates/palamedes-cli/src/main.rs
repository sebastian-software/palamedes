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

use clap::Parser;

fn main() {
    if let Err(error) = cli::Cli::parse().execute() {
        eprintln!("Error: {error}");
        std::process::exit(1);
    }
}
