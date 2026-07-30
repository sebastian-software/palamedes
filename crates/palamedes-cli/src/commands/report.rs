//! `pmds report` — per-locale catalog translation completeness.

use std::path::PathBuf;

use clap::Args;
use palamedes::{measure_catalog_coverage, CatalogCoverageRequest, CatalogCoverageResult};

use crate::command::{render_json, Command, Context};
use crate::commands::normalize_locale_list;
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

impl Command for ReportOptions {
    type Output = CatalogCoverageResult;

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

fn build_report(
    config: &LoadedConfig,
    locales: &[String],
) -> Result<CatalogCoverageResult, CliError> {
    measure_catalog_coverage(CatalogCoverageRequest {
        config: config.artifact_config(),
        locales: locales.to_vec(),
    })
    .map_err(CliError::from)
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

fn print_report(result: &CatalogCoverageResult) {
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

    use super::{build_report, ReportOptions};
    use crate::command::{Command, Context};
    use crate::commands::test_support::{temp_dir, write_config};
    use crate::config::load_config;
    use crate::error::CliError;

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

    /*
     * The whole point of splitting the verdict out of the run: a threshold
     * decides the exit code, but only after the report that explains it has
     * been produced and rendered. Driving the command through its contract
     * also covers config discovery from the context's directory.
     */
    #[test]
    fn threshold_failures_come_after_the_report_is_rendered() {
        let app = temp_dir("report-threshold");
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
            "msgid \"Hello\"\nmsgstr \"Hallo\"\n\nmsgid \"Bye\"\nmsgstr \"\"\n",
        )
        .expect("write target po");

        let options = ReportOptions {
            config: None,
            locale: Vec::new(),
            json: false,
            fail_if_below: Some(90.0),
        };
        // No --config: the catalog is found through the context's directory.
        let context = Context::with_cwd(&app);

        let report = options.run(&context).expect("run produces a report");
        assert_eq!(report.locales[0].translated, 1);
        assert_eq!(report.locales[0].total, 2);

        options
            .render(&report)
            .expect("render precedes the verdict");

        let error = options.verdict(&report).expect_err("50% is below 90%");
        assert!(
            matches!(error, CliError::CompletenessBelowThreshold { .. }),
            "expected a threshold failure, got: {error:?}"
        );
    }

    /// An out-of-range threshold is rejected before any catalog is read, so it
    /// cannot produce a report that no verdict could ever accept.
    #[test]
    fn out_of_range_thresholds_fail_before_running() {
        let options = ReportOptions {
            config: None,
            locale: Vec::new(),
            json: false,
            fail_if_below: Some(150.0),
        };
        let error = options
            .run(&Context::with_cwd("/palamedes/does/not/exist"))
            .expect_err("150% is not a percentage");

        assert!(matches!(error, CliError::InvalidThreshold));
    }
}
