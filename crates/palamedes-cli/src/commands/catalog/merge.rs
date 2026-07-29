//! `pmds catalog merge` — semantic catalog merge, usable as a Git merge driver.

use std::path::PathBuf;

use clap::{Args, ValueEnum};
use palamedes::{
    combine_catalog_files, CatalogConflictStrategy, CatalogFileCombineRequest,
    CatalogFileCombineResult, CatalogFileFormat,
};

use crate::command::{Command, Context};
use crate::config::ConfigError;
use crate::error::CliError;

#[derive(Debug, Args)]
pub struct MergeOptions {
    /// Input catalog files in precedence order.
    #[arg(required = true)]
    inputs: Vec<PathBuf>,
    /// Output catalog path.
    #[arg(long)]
    output: PathBuf,
    /// Path to a Palamedes config file.
    #[arg(short, long)]
    config: Option<PathBuf>,
    /// Catalog format.
    #[arg(long)]
    format: Option<MergeFormat>,
    /// Ancestor catalog path supplied by Git merge drivers.
    #[arg(long)]
    base: Option<PathBuf>,
    /// Catalog conflict strategy.
    #[arg(long, default_value = "use-first")]
    conflict_strategy: MergeConflictStrategy,
    /// Source locale for catalog semantics.
    #[arg(long)]
    source_locale: Option<String>,
    /// Locale of the merged catalog.
    #[arg(long)]
    locale: Option<String>,
    /// Real catalog pathname. Git merge drivers hand the driver temporary
    /// files, so `--output` cannot identify which configured catalog is being
    /// merged; pass `%P` here. Defaults to `--output`.
    #[arg(long)]
    path: Option<PathBuf>,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum MergeFormat {
    Po,
    Fcl,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum MergeConflictStrategy {
    UseFirst,
    UseLast,
    Error,
}

impl Command for MergeOptions {
    type Output = CatalogFileCombineResult;

    fn run(&self, context: &Context) -> Result<Self::Output, CliError> {
        if self.inputs.len() != 2 {
            return Err(CliError::InvalidMergeInputCount(self.inputs.len()));
        }
        /*
         * A Git merge driver runs wherever the conflicted worktree is, which
         * need not be a Palamedes project. Only an explicit --config makes a
         * missing config fatal; otherwise carry on without one rather than
         * refusing the merge.
         */
        let config = match context.load_config(self.config.as_deref()) {
            Ok(config) => Some(config),
            Err(CliError::Config(ConfigError::NotFound)) if self.config.is_none() => None,
            Err(error) => return Err(error),
        };

        let source_locale = match &self.source_locale {
            Some(source_locale) => source_locale.clone(),
            None => config
                .as_ref()
                .map_or_else(|| "en".to_owned(), |config| config.source_locale.clone()),
        };

        /*
         * Without the catalog's own options a merged catalog comes back folded
         * differently than the project writes it, and the next extraction
         * turns that into a diff.
         */
        let po = config.as_ref().and_then(|config| {
            config
                .catalog_for_path(self.path.as_deref().unwrap_or(&self.output))
                .and_then(|catalog| catalog.po.clone())
                .map(Into::into)
        });

        let mut input_paths = self.inputs.clone();
        if let Some(base) = &self.base {
            input_paths.push(base.clone());
        }

        Ok(combine_catalog_files(CatalogFileCombineRequest {
            input_paths,
            output_path: self.output.clone(),
            format: self.format.map(|format| match format {
                MergeFormat::Po => CatalogFileFormat::Po,
                MergeFormat::Fcl => CatalogFileFormat::Fcl,
            }),
            source_locale,
            locale: self.locale.clone(),
            conflict_strategy: match self.conflict_strategy {
                MergeConflictStrategy::UseFirst => CatalogConflictStrategy::UseFirst,
                MergeConflictStrategy::UseLast => CatalogConflictStrategy::UseLast,
                MergeConflictStrategy::Error => CatalogConflictStrategy::Error,
            },
            po,
        })?)
    }

    /// The merged catalog file is the result. Git merge drivers run inside
    /// `git merge`, where stdout chatter on every conflicted catalog is noise,
    /// so a successful merge stays silent and the exit code carries the answer.
    fn render(&self, _output: &Self::Output) -> Result<(), CliError> {
        Ok(())
    }
}
