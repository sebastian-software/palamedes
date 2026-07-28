//! `pmds report` — per-locale catalog translation completeness.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use clap::Args;
use palamedes::{parse_catalog, CatalogParseRequest};
use serde::Serialize;

use crate::command::{render_json, Command, Context};
use crate::commands::{normalize_locale_list, read_po};
use crate::config::LoadedConfig;
use crate::error::CliError;

#[derive(Debug, Args)]
pub struct ReportOptions {
    /// Path to a Palamedes config file.
    #[arg(short, long)]
    config: Option<PathBuf>,
    /// Only report selected target locale(s); comma-separated values are supported.
    #[arg(long, num_args = 1..)]
    locale: Vec<String>,
    /// Print the machine-readable report as JSON.
    #[arg(long)]
    json: bool,
    /// Fail when any reported locale is below this translated percentage.
    #[arg(long)]
    fail_if_below: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct CompletenessReport {
    locales: Vec<LocaleCompletenessReport>,
}

#[derive(Debug, Serialize)]
struct LocaleCompletenessReport {
    locale: String,
    total: usize,
    translated: usize,
    missing: usize,
    fuzzy: usize,
    percent: f64,
}

#[derive(Debug, Clone, Eq, Ord, PartialEq, PartialOrd)]
struct MessageKey {
    message: String,
    context: Option<String>,
}

#[derive(Debug)]
struct MutableLocaleStats {
    locale: String,
    total: usize,
    translated: usize,
    missing: usize,
    fuzzy: usize,
}

impl Command for ReportOptions {
    type Output = CompletenessReport;

    fn run(&self, context: &Context) -> Result<Self::Output, CliError> {
        // Reject an out-of-range threshold before doing any work: the run
        // would be discarded by a verdict that can never pass.
        if self
            .fail_if_below
            .is_some_and(|value| !(0.0..=100.0).contains(&value))
        {
            return Err(CliError::InvalidThreshold);
        }
        let config = context.load_config(self.config.as_deref())?;
        let locales = resolve_report_locales(&config, &self.locale);
        build_report(&config, &locales)
    }

    fn render(&self, output: &Self::Output) -> Result<(), CliError> {
        if self.json {
            return render_json(output);
        }
        print_report(output);
        Ok(())
    }

    fn verdict(&self, output: &Self::Output) -> Result<(), CliError> {
        let Some(threshold) = self.fail_if_below else {
            return Ok(());
        };
        let failing = output
            .locales
            .iter()
            .filter(|locale| locale.percent < threshold)
            .map(|locale| format!("{} ({})", locale.locale, format_percent(locale.percent)))
            .collect::<Vec<_>>();
        if failing.is_empty() {
            return Ok(());
        }
        Err(CliError::CompletenessBelowThreshold {
            threshold: format_percent(threshold),
            locales: failing.join(", "),
        })
    }
}

fn build_report(config: &LoadedConfig, locales: &[String]) -> Result<CompletenessReport, CliError> {
    let mut stats = locales
        .iter()
        .map(|locale| {
            (
                locale.clone(),
                MutableLocaleStats {
                    locale: locale.clone(),
                    total: 0,
                    translated: 0,
                    missing: 0,
                    fuzzy: 0,
                },
            )
        })
        .collect::<BTreeMap<_, _>>();

    for catalog in &config.catalogs {
        let source_path = config
            .resolve_catalog_path(&catalog.path, &config.source_locale)
            .with_extension(catalog.format.extension());
        let source_catalog = read_catalog_for_report(
            &source_path,
            &config.source_locale,
            &config.source_locale,
            catalog.format,
        )?;
        let source_messages = source_catalog
            .into_iter()
            .filter(|message| !message.obsolete)
            .map(|message| MessageKey {
                message: message.message,
                context: message.context,
            })
            .collect::<Vec<_>>();

        for locale in locales {
            let Some(locale_stats) = stats.get_mut(locale) else {
                continue;
            };
            locale_stats.total += source_messages.len();

            if locale == &config.source_locale {
                locale_stats.translated += source_messages.len();
                continue;
            }

            let target_path = config
                .resolve_catalog_path(&catalog.path, locale)
                .with_extension(catalog.format.extension());
            /*
             * Fuzzy entries carry a translation that needs review; gettext
             * tooling treats them as untranslated, and so does this report.
             * The flag only exists in the PO storage format.
             */
            let fuzzy_keys = if catalog.format == palamedes::PalamedesCatalogFormat::Po
                && target_path.exists()
            {
                read_po(&target_path)?
                    .items
                    .into_iter()
                    .filter(|item| item.flags.get("fuzzy").copied().unwrap_or(false))
                    .map(|item| MessageKey {
                        message: item.msgid,
                        context: item.msgctxt,
                    })
                    .collect::<BTreeSet<_>>()
            } else {
                BTreeSet::new()
            };
            let target_messages = if target_path.exists() {
                read_catalog_for_report(
                    &target_path,
                    &config.source_locale,
                    locale,
                    catalog.format,
                )?
                .into_iter()
                .filter(|message| !message.obsolete)
                .map(|message| {
                    (
                        MessageKey {
                            message: message.message,
                            context: message.context,
                        },
                        message.translated,
                    )
                })
                .collect::<BTreeMap<_, _>>()
            } else {
                BTreeMap::new()
            };

            for source_message in &source_messages {
                let Some(target) = target_messages.get(source_message) else {
                    locale_stats.missing += 1;
                    continue;
                };
                if fuzzy_keys.contains(source_message) {
                    locale_stats.fuzzy += 1;
                    locale_stats.missing += 1;
                } else if *target {
                    locale_stats.translated += 1;
                } else {
                    locale_stats.missing += 1;
                }
            }
        }
    }

    Ok(CompletenessReport {
        locales: stats
            .into_values()
            .map(|locale| LocaleCompletenessReport {
                percent: if locale.total == 0 {
                    100.0
                } else {
                    (locale.translated as f64 / locale.total as f64) * 100.0
                },
                locale: locale.locale,
                total: locale.total,
                translated: locale.translated,
                missing: locale.missing,
                fuzzy: locale.fuzzy,
            })
            .collect(),
    })
}

fn read_catalog_for_report(
    path: &Path,
    source_locale: &str,
    locale: &str,
    format: palamedes::PalamedesCatalogFormat,
) -> Result<Vec<palamedes::ParsedCatalogMessage>, CliError> {
    let result = parse_catalog(&CatalogParseRequest {
        target_path: path.to_string_lossy().into_owned(),
        locale: locale.to_owned(),
        source_locale: source_locale.to_owned(),
        format,
    })?;
    Ok(result.messages)
}

fn resolve_report_locales(config: &LoadedConfig, selected: &[String]) -> Vec<String> {
    let selected = normalize_locale_list(selected);
    if !selected.is_empty() {
        return selected;
    }
    config
        .locales
        .iter()
        .filter(|locale| locale.as_str() != config.source_locale)
        .filter(|locale| Some(locale.as_str()) != config.pseudo_locale.as_deref())
        .cloned()
        .collect()
}

fn print_report(result: &CompletenessReport) {
    if result.locales.is_empty() {
        println!("No target locales configured.");
        return;
    }

    let locale_column_width = result
        .locales
        .iter()
        .map(|locale| locale.locale.len())
        .max()
        .unwrap_or("Locale".len())
        .max("Locale".len())
        + 2;

    println!(
        "{:<locale_column_width$}Translated  Missing  Fuzzy  Complete",
        "Locale"
    );
    for locale in &result.locales {
        let translated = format!("{}/{}", locale.translated, locale.total);
        println!(
            "{:<locale_column_width$}{:<11} {:<8} {:<6} {}",
            locale.locale,
            translated,
            locale.missing,
            locale.fuzzy,
            format_percent(locale.percent)
        );
    }
}

fn format_percent(value: f64) -> String {
    let rounded = (value * 10.0).round() / 10.0;
    if rounded.fract() == 0.0 {
        format!("{rounded:.0}%")
    } else {
        format!("{rounded:.1}%")
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::build_report;
    use crate::commands::test_support::{temp_dir, write_config};
    use crate::config::load_config;

    #[test]
    fn report_counts_translated_and_missing_messages() {
        let app = temp_dir("report");
        write_config(&app, None);
        fs::create_dir_all(app.join("locales/en")).expect("create source locale");
        fs::create_dir_all(app.join("locales/de")).expect("create target locale");
        fs::write(
            app.join("locales/en/messages.po"),
            "msgid \"Hello\"\nmsgstr \"Hello\"\n\nmsgid \"Bye\"\nmsgstr \"Bye\"\n",
        )
        .expect("write source po");
        fs::write(
            app.join("locales/de/messages.po"),
            "#, fuzzy\nmsgid \"Hello\"\nmsgstr \"Hallo\"\n",
        )
        .expect("write target po");

        let config = load_config(&app, Some(&app.join("palamedes.yaml"))).expect("load config");
        let report = build_report(&config, &["de".to_owned()]).expect("build report");

        /*
         * The de catalog translates "Hello" but flags it fuzzy: fuzzy entries
         * need review and count as untranslated, matching gettext semantics.
         */
        assert_eq!(report.locales[0].total, 2);
        assert_eq!(report.locales[0].translated, 0);
        assert_eq!(report.locales[0].missing, 2);
        assert_eq!(report.locales[0].fuzzy, 1);
    }
}
