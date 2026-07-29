//! `pmds catalog convert` — migrate PO catalogs to another storage format.

use std::fs;
use std::path::{Path, PathBuf};

use clap::{Args, ValueEnum};
use palamedes::{
    combine_catalog_files, CatalogConflictStrategy, CatalogFileCombineRequest, CatalogFileFormat,
};

use crate::command::{Command, Context};
use crate::commands::read_po;
use crate::error::CliError;

#[derive(Debug, Args)]
pub struct ConvertOptions {
    /// Input catalog file for single-file conversion.
    input: Option<PathBuf>,
    /// Path to a Palamedes config file for config-wide conversion.
    #[arg(short, long)]
    config: Option<PathBuf>,
    /// Target catalog format.
    #[arg(long)]
    to: ConvertFormat,
    /// Output catalog path for single-file conversion.
    #[arg(long)]
    output: Option<PathBuf>,
    /// Source locale for single-file conversion.
    #[arg(long, default_value = "en")]
    source_locale: String,
    /// Locale for single-file conversion.
    #[arg(long)]
    locale: Option<String>,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum ConvertFormat {
    Fcl,
}

/// What a conversion did, in the two shapes the command supports.
#[derive(Debug)]
pub enum ConvertReport {
    SingleFile {
        input: PathBuf,
        output: PathBuf,
        /// True when `--config` was passed alongside a single input file, in
        /// which case it played no part in selecting catalogs.
        config_ignored: bool,
    },
    Configured {
        converted: usize,
        skipped: usize,
    },
}

impl Command for ConvertOptions {
    type Output = ConvertReport;

    fn run(&self, context: &Context) -> Result<Self::Output, CliError> {
        match (&self.input, &self.config) {
            (Some(input), config_path) => {
                let output = self
                    .output
                    .clone()
                    .unwrap_or_else(|| input.with_extension(convert_extension(self.to)));
                convert_one_catalog(
                    input,
                    &output,
                    &self.source_locale,
                    self.locale.as_deref(),
                    self.to,
                )?;
                Ok(ConvertReport::SingleFile {
                    input: input.clone(),
                    output,
                    config_ignored: config_path.is_some(),
                })
            }
            (None, Some(config_path)) => {
                if self.output.is_some() {
                    return Err(CliError::InvalidConvertOutput);
                }
                let config = context.load_config(Some(config_path))?;
                let mut converted = 0usize;
                let mut skipped = 0usize;
                for catalog in &config.catalogs {
                    if catalog.format != palamedes::PalamedesCatalogFormat::Po {
                        skipped += config.locales.len();
                        continue;
                    }
                    for locale in &config.locales {
                        let input = config
                            .resolve_catalog_path(&catalog.path, locale)
                            .with_extension(catalog.format.extension());
                        if !input.exists() {
                            skipped += 1;
                            continue;
                        }
                        let output = config
                            .resolve_catalog_path(&catalog.path, locale)
                            .with_extension(convert_extension(self.to));
                        convert_one_catalog(
                            &input,
                            &output,
                            &config.source_locale,
                            Some(locale),
                            self.to,
                        )?;
                        converted += 1;
                    }
                }
                Ok(ConvertReport::Configured { converted, skipped })
            }
            (None, None) => Err(CliError::MissingConvertInput),
        }
    }

    fn render(&self, output: &Self::Output) -> Result<(), CliError> {
        match output {
            ConvertReport::SingleFile {
                input,
                output,
                config_ignored,
            } => {
                println!("Converted {} -> {}", input.display(), output.display());
                if *config_ignored {
                    println!(
                        "Single-file input provided; --config was not used for catalog selection."
                    );
                }
            }
            ConvertReport::Configured { converted, skipped } => {
                println!("Converted {converted} catalog(s), skipped {skipped}.");
                println!(
                    "Update Palamedes config catalogs to use `format: fcl` before switching workflows."
                );
            }
        }
        Ok(())
    }
}

fn convert_one_catalog(
    input: &Path,
    output: &Path,
    source_locale: &str,
    locale: Option<&str>,
    to: ConvertFormat,
) -> Result<(), CliError> {
    if input.extension().and_then(|ext| ext.to_str()) != Some("po") {
        return Err(CliError::UnsupportedConvertSource);
    }
    reject_fuzzy_po(input)?;
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).map_err(|source| CliError::Io {
            path: parent.to_path_buf(),
            source,
        })?;
    }
    combine_catalog_files(CatalogFileCombineRequest {
        input_paths: vec![input.to_path_buf()],
        output_path: output.to_path_buf(),
        format: Some(match to {
            ConvertFormat::Fcl => CatalogFileFormat::Fcl,
        }),
        source_locale: source_locale.to_owned(),
        locale: locale.map(str::to_owned),
        conflict_strategy: CatalogConflictStrategy::UseFirst,
        po: None,
    })?;
    Ok(())
}

fn reject_fuzzy_po(path: &Path) -> Result<(), CliError> {
    let catalog = read_po(path)?;
    if catalog
        .items
        .iter()
        .any(|item| item.flags.get("fuzzy").copied().unwrap_or(false))
    {
        return Err(CliError::FuzzyCatalogInput {
            path: path.to_path_buf(),
        });
    }
    Ok(())
}

const fn convert_extension(to: ConvertFormat) -> &'static str {
    match to {
        ConvertFormat::Fcl => "fcl",
    }
}
