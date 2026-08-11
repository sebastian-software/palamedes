//! `pmds catalog merge` — semantic catalog merge, usable as a Git merge driver.

use std::path::{Path, PathBuf};
use std::process::Command as ProcessCommand;

use clap::{Args, ValueEnum};
use palamedes::{
    combine_catalog_files, merge_catalog_files_three_way, CatalogConflictStrategy,
    CatalogFileCombineRequest, CatalogFileCombineResult, CatalogFileThreeWayMergeRequest,
    PalamedesCatalogFormat,
};

use crate::command::{Command, Context};
use crate::config::ConfigError;
use crate::error::CliError;

#[derive(Debug, Args)]
pub struct MergeOptions {
    /// Two current catalog files, ordered as ours and theirs when `--base` is set.
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
    /// Common ancestor catalog path for a deletion-aware three-way merge.
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

#[derive(Debug, Args)]
pub struct MergeDriverOptions {
    /// Common ancestor supplied by Git as `%O`.
    ancestor: PathBuf,
    /// Git's `%A` file (stage 2 during conflicts).
    current: PathBuf,
    /// Git's `%B` file (stage 3 during conflicts).
    other: PathBuf,
    /// Output catalog, normally `%A`.
    output: PathBuf,
    /// Real catalog pathname supplied by Git as `%P`.
    #[arg(long)]
    path: PathBuf,
    /// Path to a Palamedes config file.
    #[arg(short, long)]
    config: Option<PathBuf>,
    /// Catalog format.
    #[arg(long)]
    format: Option<MergeFormat>,
    /// Catalog conflict strategy. `use-first` always means the logical branch
    /// being merged or rebased, even though Git swaps `%A`/`%B` during rebase.
    #[arg(long, default_value = "use-first")]
    conflict_strategy: MergeConflictStrategy,
    /// Source locale for catalog semantics.
    #[arg(long)]
    source_locale: Option<String>,
    /// Locale of the merged catalog.
    #[arg(long)]
    locale: Option<String>,
    /// Git operation role mapping. `auto` detects an active rebase.
    #[arg(long, default_value = "auto")]
    operation: GitMergeOperation,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
enum GitMergeOperation {
    Auto,
    Merge,
    Rebase,
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
            /*
             * A JS/TS config is a fully supported project setup that only the
             * JS toolchain can read, so refusing here would break the merge
             * driver in those projects entirely. Say what is lost and merge.
             */
            Err(CliError::Config(ConfigError::JsConfigUnsupported { path }))
                if self.config.is_none() =>
            {
                eprintln!(
                    "Note: pmds cannot read {}, so configured PO output options and source-locale are not applied to this merge.",
                    path.display()
                );
                None
            }
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
        let po = match config.as_ref() {
            Some(config) => config
                .catalog_for_path(
                    self.path.as_deref().unwrap_or(&self.output),
                    &context.cwd()?,
                )?
                .and_then(|catalog| catalog.po.clone())
                .map(Into::into),
            None => None,
        };

        let logical_format = self.path.as_deref().and_then(MergeFormat::from_path);
        let format = self.format.map(MergeFormat::core).or(logical_format);
        let conflict_strategy = self.conflict_strategy.core();
        let result = match &self.base {
            Some(base) => merge_catalog_files_three_way(CatalogFileThreeWayMergeRequest {
                ancestor_path: base.clone(),
                ours_path: self.inputs[0].clone(),
                theirs_path: self.inputs[1].clone(),
                output_path: self.output.clone(),
                format,
                source_locale,
                locale: self.locale.clone(),
                conflict_strategy,
                po,
            }),
            None => combine_catalog_files(CatalogFileCombineRequest {
                input_paths: self.inputs.clone(),
                output_path: self.output.clone(),
                format,
                source_locale,
                locale: self.locale.clone(),
                conflict_strategy,
                po,
            }),
        };
        result.map_err(|error| self.inference_error(CliError::from(error), logical_format))
    }

    /// The merged catalog file is the result. Git merge drivers run inside
    /// `git merge`, where stdout chatter on every conflicted catalog is noise,
    /// so a successful merge stays silent and the exit code carries the answer.
    fn render(&self, _output: &Self::Output) -> Result<(), CliError> {
        Ok(())
    }
}

impl Command for MergeDriverOptions {
    type Output = CatalogFileCombineResult;

    fn run(&self, context: &Context) -> Result<Self::Output, CliError> {
        let (ours, theirs) = self.logical_sides();
        MergeOptions {
            inputs: vec![ours.to_path_buf(), theirs.to_path_buf()],
            output: self.output.clone(),
            config: self.config.clone(),
            format: self.format,
            base: Some(self.ancestor.clone()),
            conflict_strategy: self.conflict_strategy,
            source_locale: self.source_locale.clone(),
            locale: self.locale.clone(),
            path: Some(self.path.clone()),
        }
        .run(context)
    }

    fn render(&self, _output: &Self::Output) -> Result<(), CliError> {
        Ok(())
    }
}

impl MergeDriverOptions {
    fn logical_sides(&self) -> (&Path, &Path) {
        match self.resolved_operation() {
            GitMergeOperation::Rebase => (&self.other, &self.current),
            GitMergeOperation::Merge | GitMergeOperation::Auto => (&self.current, &self.other),
        }
    }

    fn resolved_operation(&self) -> GitMergeOperation {
        match self.operation {
            GitMergeOperation::Auto if git_path_exists("rebase-merge") => GitMergeOperation::Rebase,
            GitMergeOperation::Auto if git_path_exists("rebase-apply") => GitMergeOperation::Rebase,
            GitMergeOperation::Auto => GitMergeOperation::Merge,
            operation => operation,
        }
    }
}

impl MergeFormat {
    fn core(self) -> PalamedesCatalogFormat {
        match self {
            Self::Po => PalamedesCatalogFormat::Po,
            Self::Fcl => PalamedesCatalogFormat::Fcl,
        }
    }

    fn from_path(path: &Path) -> Option<PalamedesCatalogFormat> {
        path.extension()
            .and_then(|extension| extension.to_str())
            .and_then(PalamedesCatalogFormat::from_extension)
    }
}

impl MergeOptions {
    fn inference_error(
        &self,
        error: CliError,
        logical_format: Option<PalamedesCatalogFormat>,
    ) -> CliError {
        let merge_paths = self
            .base
            .iter()
            .chain(self.inputs.iter())
            .chain(std::iter::once(&self.output));
        if self.format.is_none()
            && logical_format.is_none()
            && self.path.is_some()
            && merge_paths
                .clone()
                .all(|path| MergeFormat::from_path(path).is_none())
        {
            let paths = self
                .base
                .iter()
                .chain(self.inputs.iter())
                .chain(std::iter::once(&self.output))
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>()
                .join(", ");
            if let Some(path) = &self.path {
                return CliError::MergeFormatInference {
                    path: path.clone(),
                    paths,
                };
            }
        }
        error
    }
}

impl MergeConflictStrategy {
    fn core(self) -> CatalogConflictStrategy {
        match self {
            Self::UseFirst => CatalogConflictStrategy::UseFirst,
            Self::UseLast => CatalogConflictStrategy::UseLast,
            Self::Error => CatalogConflictStrategy::Error,
        }
    }
}

fn git_path_exists(name: &str) -> bool {
    let Ok(output) = ProcessCommand::new("git")
        .args(["rev-parse", "--git-path", name])
        .output()
    else {
        return false;
    };
    if !output.status.success() {
        return false;
    }
    let path = String::from_utf8_lossy(&output.stdout);
    Path::new(path.trim()).exists()
}

#[cfg(test)]
mod tests {
    use super::{GitMergeOperation, MergeConflictStrategy, MergeDriverOptions};
    use std::path::PathBuf;

    #[test]
    fn explicit_rebase_mapping_keeps_the_rebased_branch_first() {
        let options = MergeDriverOptions {
            ancestor: PathBuf::from("base"),
            current: PathBuf::from("upstream"),
            other: PathBuf::from("rebased-branch"),
            output: PathBuf::from("upstream"),
            path: PathBuf::from("messages.po"),
            config: None,
            format: None,
            conflict_strategy: MergeConflictStrategy::UseFirst,
            source_locale: Some("en".to_owned()),
            locale: Some("de".to_owned()),
            operation: GitMergeOperation::Rebase,
        };

        let (ours, theirs) = options.logical_sides();
        assert_eq!(ours, PathBuf::from("rebased-branch"));
        assert_eq!(theirs, PathBuf::from("upstream"));
    }
}
