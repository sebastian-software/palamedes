//! `pmds lint` — non-mutating Palamedes source-authoring diagnostics.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use clap::{Args, ValueEnum};
use palamedes::{
    analyze_source_file_cached, default_cache_path, ExtractCache, ExtractCatalogMessagesOptions,
    SourceDiagnostic, SourceDiagnosticSeverity, SourceRange, SOURCE_DIAGNOSTIC_CODES,
};
use serde::Serialize;

use crate::command::{render_json, Command, Context};
use crate::commands::extract::sources::{collect_source_files, sort_and_dedupe_paths};
use crate::error::CliError;

#[derive(Debug, Args)]
pub struct LintOptions {
    /// Path to a Palamedes config file.
    #[arg(short, long)]
    config: Option<PathBuf>,
    /// Print one deterministic machine-readable JSON document.
    #[arg(long)]
    json: bool,
    /// Fail on error or warning diagnostics.
    #[arg(long, default_value = "error")]
    fail_on: LintFailOn,
    /// Ignore and do not write the shared source-analysis cache.
    #[arg(long)]
    no_cache: bool,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum LintFailOn {
    Error,
    Warning,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LintResult {
    diagnostics: Vec<SourceDiagnostic>,
    failed_files: Vec<LintFileFailure>,
    summary: LintSummary,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct LintFileFailure {
    file: String,
    message: String,
}

#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct LintSummary {
    files: usize,
    errors: usize,
    warnings: usize,
    infos: usize,
    suppressed: usize,
    failed_files: usize,
}

impl Command for LintOptions {
    type Output = LintResult;

    fn run(&self, context: &Context) -> Result<Self::Output, CliError> {
        let config = context.load_config(self.config.as_deref())?;
        let mut files = Vec::new();
        for catalog in &config.catalogs {
            files.extend(collect_source_files(catalog, &config)?);
        }
        sort_and_dedupe_paths(&mut files);

        let mut diagnostics = Vec::new();
        let mut failed_files = Vec::new();
        let mut suppressed = 0usize;
        let analysis_options = ExtractCatalogMessagesOptions {
            reference_scopes: config.reference_scopes,
            mdx: config.mdx.clone(),
            rules: config.lint.rules.clone().into(),
        };
        let cache_path = default_cache_path(&config.root_dir);
        let mut cache = if self.no_cache || !config.extract_cache {
            ExtractCache::disabled()
        } else {
            ExtractCache::load_with_options(
                &cache_path,
                &config.source_reference_root.to_string_lossy(),
                &analysis_options,
            )
        };

        for path in &files {
            let filename = display_source_path(path, &config.root_dir);
            match analyze_source_file_cached(
                &path.to_string_lossy(),
                &filename,
                &config.source_reference_root.to_string_lossy(),
                &analysis_options,
                &mut cache,
            ) {
                Ok(result) => {
                    let (mut file_diagnostics, file_suppressed) =
                        apply_suppressions(&result.source, &filename, result.analysis.diagnostics);
                    diagnostics.append(&mut file_diagnostics);
                    suppressed += file_suppressed;
                }
                Err(error) => failed_files.push(LintFileFailure {
                    file: filename,
                    message: error.to_string(),
                }),
            }
        }

        let cache_keys = files
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        cache.retain_paths(&cache_keys.iter().map(String::as_str).collect());
        let _ = cache.save(&cache_path);

        diagnostics.sort_by(|left, right| {
            (
                left.file.as_str(),
                left.primary.start,
                left.primary.end,
                left.code.as_str(),
            )
                .cmp(&(
                    right.file.as_str(),
                    right.primary.start,
                    right.primary.end,
                    right.code.as_str(),
                ))
        });
        failed_files.sort_by(|left, right| left.file.cmp(&right.file));

        let mut summary = LintSummary {
            files: files.len(),
            suppressed,
            failed_files: failed_files.len(),
            ..LintSummary::default()
        };
        for diagnostic in &diagnostics {
            match diagnostic.severity {
                SourceDiagnosticSeverity::Error => summary.errors += 1,
                SourceDiagnosticSeverity::Warning => summary.warnings += 1,
                SourceDiagnosticSeverity::Info => summary.infos += 1,
            }
        }

        Ok(LintResult {
            diagnostics,
            failed_files,
            summary,
        })
    }

    fn render(&self, output: &Self::Output) -> Result<(), CliError> {
        if self.json {
            return render_json(output);
        }

        for diagnostic in &output.diagnostics {
            println!(
                "{}:{}:{}: {} {} {}",
                diagnostic.file,
                diagnostic.primary.line,
                diagnostic.primary.column,
                severity_name(diagnostic.severity),
                diagnostic.code,
                diagnostic.message
            );
            println!("  help: {}", diagnostic.help);
        }
        for failure in &output.failed_files {
            println!(
                "{}: error pmds/analysis-failed {}",
                failure.file, failure.message
            );
        }
        println!(
            "Source lint: {} error(s), {} warning(s), {} info, {} suppressed across {} file(s)",
            output.summary.errors,
            output.summary.warnings,
            output.summary.infos,
            output.summary.suppressed,
            output.summary.files
        );
        Ok(())
    }

    fn verdict(&self, output: &Self::Output) -> Result<(), CliError> {
        if output.summary.failed_files > 0 {
            return Err(CliError::LintAnalysisFailed {
                failures: output.summary.failed_files,
            });
        }
        match self.fail_on {
            LintFailOn::Warning if output.summary.errors > 0 || output.summary.warnings > 0 => {
                Err(CliError::LintFailedOnWarning {
                    errors: output.summary.errors,
                    warnings: output.summary.warnings,
                })
            }
            LintFailOn::Error if output.summary.errors > 0 => Err(CliError::LintFailedOnError {
                errors: output.summary.errors,
            }),
            _ => Ok(()),
        }
    }
}

fn display_source_path(path: &Path, root_dir: &Path) -> String {
    path.strip_prefix(root_dir)
        .unwrap_or(path)
        .to_string_lossy()
        .into_owned()
}

fn severity_name(severity: SourceDiagnosticSeverity) -> &'static str {
    match severity {
        SourceDiagnosticSeverity::Error => "error",
        SourceDiagnosticSeverity::Warning => "warning",
        SourceDiagnosticSeverity::Info => "info",
    }
}

#[derive(Debug)]
struct Suppression {
    line: usize,
    code: String,
    primary: SourceRange,
}

fn apply_suppressions(
    source: &str,
    filename: &str,
    diagnostics: Vec<SourceDiagnostic>,
) -> (Vec<SourceDiagnostic>, usize) {
    let (suppressions, mut suppression_diagnostics) = parse_suppressions(source, filename);
    let mut used = vec![false; suppressions.len()];
    let mut suppressed = 0usize;
    for diagnostic in diagnostics {
        if let Some(index) = suppressions.iter().position(|suppression| {
            suppression.line == diagnostic.primary.line && suppression.code == diagnostic.code
        }) {
            used[index] = true;
            suppressed += 1;
        } else {
            suppression_diagnostics.push(diagnostic);
        }
    }
    for (suppression, used) in suppressions.into_iter().zip(used) {
        if !used {
            suppression_diagnostics.push(suppression_diagnostic(
                filename,
                suppression.primary,
                "pmds/unused-suppression",
                &format!("Unused suppression for `{}`.", suppression.code),
                "Remove the directive or move it to the exact line that emits this diagnostic.",
            ));
        }
    }
    (suppression_diagnostics, suppressed)
}

fn parse_suppressions(source: &str, filename: &str) -> (Vec<Suppression>, Vec<SourceDiagnostic>) {
    const DIRECTIVES: &[(&str, usize)] = &[
        ("palamedes-lint-disable-next-line", 1),
        ("palamedes-lint-disable-line", 0),
    ];

    let mut suppressions = Vec::new();
    let mut diagnostics = Vec::new();
    let mut line_start = 0usize;
    for (line_index, line) in source.split_inclusive('\n').enumerate() {
        for (directive, line_delta) in DIRECTIVES {
            let Some(marker_index) = line.find(directive) else {
                continue;
            };
            if !["//", "{/*", "<!--"]
                .iter()
                .any(|comment| line[..marker_index].contains(comment))
            {
                continue;
            }
            let rest = line[marker_index + directive.len()..]
                .trim()
                .trim_end_matches(['*', '/', '}', '-', '>'])
                .trim();
            let codes = rest
                .split([',', ' ', '\t'])
                .filter(|code| !code.is_empty())
                .collect::<BTreeSet<_>>();
            let range = SourceRange {
                start: line_start + marker_index,
                end: line_start + marker_index + directive.len(),
                line: line_index + 1,
                column: line[..marker_index].chars().count() + 1,
            };
            if codes.is_empty() {
                diagnostics.push(suppression_diagnostic(
                    filename,
                    range,
                    "pmds/invalid-suppression",
                    "This suppression does not name a diagnostic code.",
                    "Add one or more exact Palamedes diagnostic codes after the directive.",
                ));
                continue;
            }
            for code in codes {
                if SOURCE_DIAGNOSTIC_CODES.contains(&code) {
                    suppressions.push(Suppression {
                        line: line_index + 1 + line_delta,
                        code: code.to_owned(),
                        primary: range.clone(),
                    });
                } else {
                    diagnostics.push(suppression_diagnostic(
                        filename,
                        range.clone(),
                        "pmds/unknown-suppression-code",
                        &format!("Unknown Palamedes suppression code `{code}`."),
                        "Use a diagnostic code emitted by `pmds lint`; suppressions are code-specific.",
                    ));
                }
            }
        }
        line_start += line.len();
    }
    (suppressions, diagnostics)
}

fn suppression_diagnostic(
    filename: &str,
    primary: SourceRange,
    code: &str,
    message: &str,
    help: &str,
) -> SourceDiagnostic {
    SourceDiagnostic {
        code: code.to_owned(),
        severity: SourceDiagnosticSeverity::Warning,
        file: filename.to_owned(),
        primary,
        message: message.to_owned(),
        help: help.to_owned(),
        related: None,
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::{LintFailOn, LintOptions};
    use crate::command::{Command, Context};
    use crate::commands::test_support::temp_dir;

    #[test]
    fn lint_dedupes_catalog_files_and_applies_code_specific_suppressions() {
        let app = temp_dir("source-lint");
        fs::create_dir_all(app.join("src")).expect("create source dir");
        fs::write(
            app.join("palamedes.yaml"),
            r#"locales: [en]
source-locale: en
catalogs:
  - path: locales/{locale}/app
    include: [src]
  - path: locales/{locale}/shared
    include: [src]
"#,
        )
        .expect("write config");
        fs::write(
            app.join("src/view.tsx"),
            r#"import { t } from "@palamedes/core/macro";
function View({ status }) {
  // palamedes-lint-disable-next-line pmds/no-placeholder-only-message
  return <p>{t`${status}`}</p>;
}
"#,
        )
        .expect("write source");

        let output = LintOptions {
            config: None,
            json: false,
            fail_on: LintFailOn::Error,
            no_cache: true,
        }
        .run(&Context::with_cwd(&app))
        .expect("run lint");

        assert_eq!(output.summary.files, 1);
        assert_eq!(output.summary.suppressed, 1);
        assert_eq!(output.summary.infos, 1);
        assert_eq!(output.diagnostics[0].code, "pmds/prefer-trans-in-jsx");
    }

    #[test]
    fn lint_reports_unknown_and_malformed_suppressions() {
        let source =
            "// palamedes-lint-disable-next-line\n// palamedes-lint-disable-line pmds/not-a-rule\n";
        let (_, diagnostics) = super::parse_suppressions(source, "view.tsx");
        assert_eq!(diagnostics.len(), 2);
        assert_eq!(diagnostics[0].code, "pmds/invalid-suppression");
        assert_eq!(diagnostics[1].code, "pmds/unknown-suppression-code");
    }

    #[test]
    fn lint_discovers_all_supported_source_extensions() {
        let app = temp_dir("source-lint-extensions");
        fs::create_dir_all(app.join("src")).expect("create source dir");
        fs::write(
            app.join("palamedes.yaml"),
            r#"locales: [en]
source-locale: en
catalogs:
  - path: locales/{locale}/app
    include: [src]
"#,
        )
        .expect("write config");
        for extension in ["js", "ts", "jsx", "tsx"] {
            fs::write(
                app.join(format!("src/source.{extension}")),
                "export const value = 1\n",
            )
            .expect("write source");
        }
        fs::write(app.join("src/guide.mdx"), "# Hello\n").expect("write MDX");

        let output = LintOptions {
            config: None,
            json: false,
            fail_on: LintFailOn::Error,
            no_cache: true,
        }
        .run(&Context::with_cwd(&app))
        .expect("run lint");

        assert_eq!(output.summary.files, 5);
        assert!(output.failed_files.is_empty());
        fs::remove_dir_all(app).expect("cleanup");
    }

    #[test]
    fn lint_reports_unused_suppressions() {
        let source =
            "// palamedes-lint-disable-next-line pmds/no-placeholder-only-message\nconst ok = 1\n";
        let (diagnostics, suppressed) = super::apply_suppressions(source, "view.tsx", Vec::new());
        assert_eq!(suppressed, 0);
        assert_eq!(diagnostics[0].code, "pmds/unused-suppression");
    }

    #[test]
    fn cached_and_uncached_json_results_are_byte_equivalent() {
        let app = temp_dir("source-lint-cache");
        fs::create_dir_all(app.join("src")).expect("create source dir");
        fs::write(
            app.join("palamedes.yaml"),
            r#"locales: [en]
source-locale: en
catalogs:
  - path: locales/{locale}/app
    include: [src]
"#,
        )
        .expect("write config");
        let source = app.join("src/view.tsx");
        fs::write(
            &source,
            r#"import { t } from "@palamedes/core/macro";
function View({ status }) { return <p>{t`${status}`}</p>; }
"#,
        )
        .expect("write source");
        let aged = std::time::SystemTime::now() - std::time::Duration::from_secs(10);
        fs::File::options()
            .write(true)
            .open(&source)
            .expect("open source")
            .set_modified(aged)
            .expect("age source");

        let context = Context::with_cwd(&app);
        let cached = LintOptions {
            config: None,
            json: true,
            fail_on: LintFailOn::Error,
            no_cache: false,
        }
        .run(&context)
        .expect("cached lint");
        let cold = LintOptions {
            config: None,
            json: true,
            fail_on: LintFailOn::Error,
            no_cache: true,
        }
        .run(&context)
        .expect("uncached lint");

        assert_eq!(
            serde_json::to_vec(&cached).expect("cached json"),
            serde_json::to_vec(&cold).expect("uncached json")
        );
        assert!(app.join(".palamedes/extract-cache.json").exists());
        fs::remove_dir_all(app).expect("cleanup");
    }

    #[test]
    fn warning_threshold_fails_after_building_the_result() {
        let mut result = super::LintResult {
            diagnostics: Vec::new(),
            failed_files: Vec::new(),
            summary: super::LintSummary::default(),
        };
        result.summary.warnings = 1;
        let options = LintOptions {
            config: None,
            json: false,
            fail_on: LintFailOn::Warning,
            no_cache: true,
        };

        assert!(options.verdict(&result).is_err());
    }
}
