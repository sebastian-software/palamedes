//! `pmds catalog` — file-level catalog workflows.

use clap::{Args, Subcommand};

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
    /// Merge two current catalogs, optionally against an explicit ancestor.
    Merge(MergeOptions),
    /// Run as a deletion-aware Git merge driver with merge/rebase role mapping.
    MergeDriver(MergeDriverOptions),
    /// Convert configured PO catalogs to another Palamedes storage format.
    Convert(ConvertOptions),
}
