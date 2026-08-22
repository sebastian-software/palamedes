//! `pmds catalog convert` — migrate PO catalogs to another storage format.

use std::fs;
use std::path::{Path, PathBuf};

use clap::{Args, ValueEnum};
use palamedes::{convert_catalog_file, CatalogFileConvertRequest, PalamedesCatalogFormat};

use crate::command::{Command, Context};
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
                        let input =
                            config.resolve_catalog_path(&catalog.path, locale, catalog.format);
                        if !input.exists() {
                            skipped += 1;
                            continue;
                        }
                        let output = input.with_extension(convert_extension(self.to));
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
    if input
        .extension()
        .and_then(|extension| extension.to_str())
        .and_then(PalamedesCatalogFormat::from_extension)
        != Some(PalamedesCatalogFormat::Po)
    {
        return Err(CliError::UnsupportedConvertSource);
    }
    if let Some(parent) = output
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent).map_err(|source| CliError::Io {
            path: parent.to_path_buf(),
            source,
        })?;
    }
    convert_catalog_file(CatalogFileConvertRequest {
        input_path: input.to_path_buf(),
        output_path: output.to_path_buf(),
        source_format: PalamedesCatalogFormat::Po,
        target_format: match to {
            ConvertFormat::Fcl => PalamedesCatalogFormat::Fcl,
        },
        source_locale: source_locale.to_owned(),
        locale: locale.map(str::to_owned),
    })?;
    Ok(())
}

const fn convert_extension(to: ConvertFormat) -> &'static str {
    match to {
        ConvertFormat::Fcl => "fcl",
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::{convert_one_catalog, ConvertFormat, ConvertOptions, ConvertReport};
    use crate::command::{Command, Context};
    use crate::commands::test_support::temp_dir;

    #[test]
    fn configured_conversion_preserves_a_dotted_catalog_name() {
        let fixture = temp_dir("convert-dotted-catalog-name");
        let config_path = fixture.join("palamedes.yaml");
        fs::write(
            &config_path,
            r#"locales: [en]
source-locale: en
catalogs:
  - path: locales/{locale}/messages.v2
    include: [src]
"#,
        )
        .expect("write config");
        let catalog_dir = fixture.join("locales/en");
        fs::create_dir_all(&catalog_dir).expect("create catalog dir");
        fs::write(
            catalog_dir.join("messages.v2.po"),
            "msgid \"\"\nmsgstr \"\"\n\"Language: en\\n\"\n\nmsgid \"Hello\"\nmsgstr \"Hello\"\n",
        )
        .expect("write catalog");
        let options = ConvertOptions {
            input: None,
            config: Some(config_path),
            to: ConvertFormat::Fcl,
            output: None,
            source_locale: "en".to_owned(),
            locale: None,
        };

        let report = options
            .run(&Context::with_cwd(&fixture))
            .expect("convert configured catalog");

        assert!(matches!(
            report,
            ConvertReport::Configured {
                converted: 1,
                skipped: 0
            }
        ));
        assert!(catalog_dir.join("messages.v2.fcl").exists());
        assert!(!catalog_dir.join("messages.fcl").exists());
    }

    #[test]
    fn fuzzy_po_conversion_preserves_review_metadata_in_fcl() {
        let fixture = temp_dir("convert-fuzzy-po");
        let input = fixture.join("de.po");
        let output = fixture.join("de.fcl");
        fs::write(
            &input,
            concat!(
                "msgid \"\"\n",
                "msgstr \"\"\n",
                "\"Language: de\\n\"\n\n",
                "# Translator note\n",
                "#, fuzzy\n",
                "msgid \"Hello\"\n",
                "msgstr \"Hallo\"\n",
            ),
        )
        .expect("write input");

        convert_one_catalog(&input, &output, "en", Some("de"), ConvertFormat::Fcl)
            .expect("convert fuzzy catalog");

        let converted = fs::read_to_string(output).expect("read output");
        assert!(converted.contains("tc=Translator note"));
        assert!(converted.contains("f=fuzzy"));
    }
}
