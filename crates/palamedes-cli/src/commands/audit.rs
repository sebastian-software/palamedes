//! `pmds audit` — translation and ICU authoring checks across catalogs.

use std::collections::BTreeMap;
use std::path::PathBuf;

use clap::{Args, ValueEnum};
use palamedes::{
    CatalogAuditDiagnostic, CatalogAuditRequest, CatalogAuditResult, CatalogAuditSummary,
    audit_catalogs,
};

use crate::command::{Command, Context, render_json};
use crate::commands::normalize_locale_list;
use crate::error::CliError;

#[derive(Debug, Args)]
pub struct AuditOptions {
    #[arg(help = tr!("Path to a Palamedes config file."))]
    #[arg(short, long)]
    config: Option<PathBuf>,
    #[arg(help = tr!("Only audit selected target locales."))]
    #[arg(long, num_args = 1..)]
    locale: Vec<String>,
    #[arg(help = tr!("Print the machine-readable audit result as JSON."))]
    #[arg(long)]
    json: bool,
    #[arg(help = tr!("Fail on error, warning, or info diagnostics."))]
    #[arg(long, default_value = "error")]
    fail_on: FailOn,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum FailOn {
    Error,
    Warning,
    Info,
}

impl Command for AuditOptions {
    type Output = CatalogAuditResult;

    fn run(&self, context: &Context) -> Result<Self::Output, CliError> {
        let config = context.load_config(self.config.as_deref())?;
        Ok(audit_catalogs(CatalogAuditRequest {
            config: config.artifact_config(),
            locales: normalize_locale_list(&self.locale),
            checks: Default::default(),
            metadata: Vec::new(),
        })?)
    }

    fn render(&self, output: &Self::Output) -> Result<(), CliError> {
        if self.json {
            return render_json(output);
        }
        print_audit_result(output, self.fail_on);
        Ok(())
    }

    fn verdict(&self, output: &Self::Output) -> Result<(), CliError> {
        if !self.fail_on.should_fail(&output.summary) {
            return Ok(());
        }

        match self.fail_on {
            FailOn::Info => Err(CliError::AuditFailedOnInfo {
                errors: output.summary.errors,
                warnings: output.summary.warnings,
                infos: output.summary.infos,
            }),
            FailOn::Warning => Err(CliError::AuditFailedOnWarning {
                errors: output.summary.errors,
                warnings: output.summary.warnings,
            }),
            FailOn::Error => Err(CliError::AuditFailedOnError {
                errors: output.summary.errors,
            }),
        }
    }
}

impl FailOn {
    fn should_fail(self, summary: &CatalogAuditSummary) -> bool {
        match self {
            Self::Info => summary.errors > 0 || summary.warnings > 0 || summary.infos > 0,
            Self::Warning => summary.errors > 0 || summary.warnings > 0,
            Self::Error => summary.errors > 0,
        }
    }
}

fn print_audit_result(result: &CatalogAuditResult, fail_on: FailOn) {
    let status = if fail_on.should_fail(&result.summary) {
        tr!("failed")
    } else {
        tr!("passed")
    };
    println!(
        "{}",
        tr!(
            "Catalog audit {status}: {errors, plural, one {# error} other {# errors}}, {warnings, plural, one {# warning} other {# warnings}}, {infos, plural, one {# info message} other {# info messages}}",
            errors = result.summary.errors,
            infos = result.summary.infos,
            status = status,
            warnings = result.summary.warnings
        )
    );

    let mut grouped = BTreeMap::<&str, Vec<&CatalogAuditDiagnostic>>::new();
    for diagnostic in &result.diagnostics {
        grouped
            .entry(diagnostic.catalog_path.as_str())
            .or_default()
            .push(diagnostic);
    }

    for (catalog_path, diagnostics) in grouped {
        println!("\n{catalog_path}");
        for diagnostic in diagnostics {
            let locale = diagnostic
                .locale
                .as_ref()
                .map(|locale| format!(" [{locale}]"))
                .unwrap_or_default();
            println!(
                "  [{:?}] {}{}: {}",
                diagnostic.severity, diagnostic.code, locale, diagnostic.message
            );
            if let Some(source_key) = &diagnostic.source_key {
                let context = source_key
                    .context
                    .as_ref()
                    .map(|context| format!(" [context: {context}]"))
                    .unwrap_or_default();
                println!("    {} {}{}", tr!("Source:"), source_key.message, context);
            }
        }
    }
}

impl AuditOptions {
    pub(crate) fn telemetry_config(&self) -> Option<&std::path::Path> {
        self.config.as_deref()
    }
}

#[cfg(test)]
mod tests {
    use super::FailOn;
    use palamedes::CatalogAuditSummary;

    #[test]
    fn fail_on_thresholds_share_exact_severity_boundaries() {
        let errors = CatalogAuditSummary {
            errors: 1,
            ..CatalogAuditSummary::default()
        };
        let warnings = CatalogAuditSummary {
            warnings: 1,
            ..CatalogAuditSummary::default()
        };
        let infos = CatalogAuditSummary {
            infos: 1,
            ..CatalogAuditSummary::default()
        };

        assert!(FailOn::Error.should_fail(&errors));
        assert!(!FailOn::Error.should_fail(&warnings));
        assert!(FailOn::Warning.should_fail(&warnings));
        assert!(!FailOn::Warning.should_fail(&infos));
        assert!(FailOn::Info.should_fail(&infos));
        assert!(!FailOn::Info.should_fail(&CatalogAuditSummary::default()));
    }
}
