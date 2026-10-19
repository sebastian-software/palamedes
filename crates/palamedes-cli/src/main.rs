//! `pmds`, the native Palamedes CLI.
//!
//! Built-in commands live here and are compiled into the binary. They are
//! reached without loading configuration or resolving plugins (ADR-015), which
//! is what guarantees that a missing or broken plugin can never affect
//! `extract`, `lint`, `audit`, `report`, `catalog`, or `version`.

#[macro_use]
mod i18n;
mod cli;
mod command;
mod commands;
mod config;
mod error;
mod plugins;
mod update_check;

use std::io::{self, Write};
use std::process::ExitCode;

fn main() -> ExitCode {
    if let Err(error) = i18n::initialize() {
        eprintln!("pmds: {error}");
        return ExitCode::from(1);
    }
    let cli = match cli::Cli::parse_localized() {
        Ok(cli) => cli,
        Err(error) => {
            if !matches!(
                error.kind(),
                clap::error::ErrorKind::DisplayHelp | clap::error::ErrorKind::DisplayVersion
            ) && i18n::language() != i18n::Language::English
            {
                eprintln!("{}", tr!("Invalid command-line arguments."));
            }
            let _ = error.print();
            return ExitCode::from(u8::try_from(error.exit_code()).unwrap_or(2));
        }
    };
    let update_check = update_check::UpdateCheck::start();
    let exit_code = match cli.execute() {
        Ok(code) => code,
        Err(error) => {
            eprintln!("{} {}", tr!("Error:"), error.localized());
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
