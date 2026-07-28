//! `pmds catalog` — file-level catalog workflows.

use clap::{Args, Subcommand};

pub mod convert;
pub mod merge;

use convert::ConvertOptions;
use merge::MergeOptions;

#[derive(Debug, Args)]
pub struct CatalogCommand {
    #[command(subcommand)]
    pub(crate) command: CatalogSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum CatalogSubcommand {
    /// Merge two catalog files with semantic use-first behavior.
    Merge(MergeOptions),
    /// Convert configured PO catalogs to another Palamedes storage format.
    Convert(ConvertOptions),
}
