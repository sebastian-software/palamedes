//! `pmds catalog` — file-level catalog workflows.

use clap::{Args, Subcommand};

pub mod compile;
pub mod convert;
pub mod merge;

use convert::ConvertOptions;
use merge::{MergeDriverOptions, MergeOptions};

#[derive(Debug, Args)]
pub struct CatalogCommand {
    #[command(subcommand)]
    pub(crate) command: CatalogSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum CatalogSubcommand {
    #[command(about = tr!("Merge two current catalogs, optionally against an explicit ancestor."))]
    Merge(MergeOptions),
    #[command(about = tr!("Run as a deletion-aware Git merge driver with merge/rebase role mapping."))]
    MergeDriver(MergeDriverOptions),
    #[command(about = tr!("Convert configured PO catalogs to another Palamedes storage format."))]
    Convert(ConvertOptions),
    #[command(about = tr!("Compile catalogs ahead of time into JavaScript modules or Rust language files."))]
    Compile(compile::CompileOptions),
}
