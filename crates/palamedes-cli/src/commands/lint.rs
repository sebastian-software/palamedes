//! `pmds lint` — non-mutating Palamedes source-authoring diagnostics.

use std::path::{Path, PathBuf};

use clap::{Args, ValueEnum};
use palamedes::{
    SourceDiagnostic, SourceDiagnosticSeverity, SourceFileAnalysisRequest, lint_source_files_cached,
};
use serde::Serialize;

use crate::command::{Command, Context, VersionedJson, render_json};
use crate::commands::extract::cache::{load_extract_cache, persist_extract_cache};
use crate::commands::extract::sources::{collect_source_files, sort_and_dedupe_paths};
use crate::error::CliError;

/// Version of the `pmds lint --json` document shape (`schemaVersion`).
const LINT_JSON_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Args)]
pub struct LintOptions {
    // Explicit files bypass catalog discovery; paths are relative to the invocation directory.
    #[arg(help = tr!("Source files to check instead of configured catalog sources."))]
    #[arg(value_name = "FILE")]
    files: Vec<PathBuf>,
    #[arg(help = tr!("Path to a Palamedes config file."))]
    #[arg(short, long)]
    config: Option<PathBuf>,
    #[arg(help = tr!("Print one deterministic machine-readable JSON document."))]
    #[arg(long)]
    json: bool,
    #[arg(help = tr!("Fail on error or warning diagnostics."))]
    #[arg(long, default_value = "error")]
    fail_on: LintFailOn,
    #[arg(help = tr!("Worker threads for the parallel source-analysis pass."))]
    #[arg(long)]
    threads: Option<usize>,
    #[arg(help = tr!("Ignore and do not write the shared source-analysis cache."))]
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
        if self.files.is_empty() {
            for catalog in &config.catalogs {
                files.extend(collect_source_files(catalog, &config)?);
            }
        } else {
            let cwd = context.cwd()?;
            let canonical_root = std::fs::canonicalize(&config.root_dir).ok();
            files.extend(self.files.iter().map(|path| {
                let resolved: PathBuf = cwd.join(path).components().collect();
                std::fs::canonicalize(&resolved).map_or(resolved, |canonical| {
                    canonical_root
                        .as_ref()
                        .and_then(|root| canonical.strip_prefix(root).ok())
                        .map_or_else(
                            || canonical.clone(),
                            |relative| config.root_dir.join(relative),
                        )
                })
            }));
        }
        sort_and_dedupe_paths(&mut files);

        let mut diagnostics = Vec::new();
        let mut failed_files = Vec::new();
        let mut suppressed = 0usize;
        let analysis_options = config.analysis_options();
        let mut cache = load_extract_cache(&config, self.no_cache);

        let analysis_files = files
            .iter()
            .filter(|path| {
                if self.files.is_empty() || is_supported_source_file(path) {
                    true
                } else {
                    failed_files.push(LintFileFailure {
                        file: display_source_path(path, &config.root_dir),
                        message: "Expected a JS, JSX, TS, TSX, MDX, Vue, or Svelte source file; directories and unexpanded globs are not supported.".to_owned(),
                    });
                    false
                }
            })
            .map(|path| SourceFileAnalysisRequest {
                path: source_path_string(path),
                filename: display_source_path(path, &config.root_dir),
            })
            .collect::<Vec<_>>();
        let analyses = lint_source_files_cached(
            &analysis_files,
            &config.source_reference_root.to_string_lossy(),
            &analysis_options,
            self.threads.or(config.extract_threads),
            &mut cache,
        )?;

        for (file, analysis) in analysis_files.iter().zip(analyses) {
            match analysis {
                Ok(mut result) => {
                    diagnostics.append(&mut result.diagnostics);
                    suppressed += result.suppressed;
                }
                Err(error) => failed_files.push(LintFileFailure {
                    file: file.filename.clone(),
                    message: error.to_string(),
                }),
            }
        }

        let cache_keys = files
            .iter()
            .map(|path| source_path_string(path))
            .collect::<Vec<_>>();
        // A targeted run must preserve cached analysis for the rest of the project.
        if self.files.is_empty() {
            cache.retain_paths(&cache_keys.iter().map(String::as_str).collect());
        }
        persist_extract_cache(&config, &mut cache);

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
            return render_json(&VersionedJson::new(LINT_JSON_SCHEMA_VERSION, output));
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
            println!("  {} {}", tr!("help:"), diagnostic.help);
        }
        for failure in &output.failed_files {
            println!(
                "{}: error pmds/analysis-failed {}",
                failure.file, failure.message
            );
        }
        println!(
            "{}",
            tr!(
                "Source lint: {errors, plural, one {# error} other {# errors}}, {warnings, plural, one {# warning} other {# warnings}}, {infos, plural, one {# info message} other {# info messages}}, {suppressed, plural, one {# suppressed diagnostic} other {# suppressed diagnostics}} across {files, plural, one {# file} other {# files}}",
                errors = output.summary.errors,
                files = output.summary.files,
                infos = output.summary.infos,
                suppressed = output.summary.suppressed,
                warnings = output.summary.warnings
            )
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

fn is_supported_source_file(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|extension| extension.to_str()),
        Some("js" | "jsx" | "ts" | "tsx" | "mdx" | "vue" | "svelte")
    )
}

fn display_source_path(path: &Path, root_dir: &Path) -> String {
    source_path_string(path.strip_prefix(root_dir).unwrap_or(path))
}

fn source_path_string(path: &Path) -> String {
    let path = path.to_string_lossy();
    // Ferralk discovery uses forward slashes on Windows. Explicit paths must
    // use the same spelling for cache keys and machine-readable diagnostics.
    if cfg!(windows) {
        path.replace('\\', "/")
    } else {
        path.into_owned()
    }
}

fn severity_name(severity: SourceDiagnosticSeverity) -> &'static str {
    match severity {
        SourceDiagnosticSeverity::Error => "error",
        SourceDiagnosticSeverity::Warning => "warning",
        SourceDiagnosticSeverity::Info => "info",
    }
}

impl LintOptions {
    pub(crate) fn telemetry_config(&self) -> Option<&std::path::Path> {
        self.config.as_deref()
    }
}

#[cfg(test)]
fn apply_suppressions(
    source: &str,
    filename: &str,
    diagnostics: Vec<SourceDiagnostic>,
    comments: &[palamedes::SourceComment],
) -> (Vec<SourceDiagnostic>, usize) {
    let (suppressions, suppression_diagnostics) =
        palamedes::parse_lint_suppressions_from_comments(source, filename, comments);
    let result = palamedes::apply_lint_suppressions(
        filename,
        diagnostics,
        &suppressions,
        &suppression_diagnostics,
    );
    (result.diagnostics, result.suppressed)
}

#[cfg(test)]
fn parse_suppressions_from_comments(
    source: &str,
    filename: &str,
    comments: &[palamedes::SourceComment],
) -> (Vec<palamedes::LintSuppression>, Vec<SourceDiagnostic>) {
    palamedes::parse_lint_suppressions_from_comments(source, filename, comments)
}

#[cfg(test)]
fn parse_suppressions(
    source: &str,
    filename: &str,
) -> (Vec<palamedes::LintSuppression>, Vec<SourceDiagnostic>) {
    let analysis = palamedes::analyze_source(source, filename)
        .expect("suppression fixture should be valid authored source");
    parse_suppressions_from_comments(source, filename, &analysis.comments)
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
            files: Vec::new(),
            config: None,
            json: false,
            fail_on: LintFailOn::Error,
            threads: None,
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
    fn suppression_parser_requires_a_real_immediate_comment_directive() {
        let source = r#"const string = "// palamedes-lint-disable-line pmds/no-placeholder-only-message";
// explanation: palamedes-lint-disable-line pmds/no-placeholder-only-message
const trailing = 1; /* explanation palamedes-lint-disable-line pmds/no-placeholder-only-message */
/* palamedes-lint-disable-line pmds/no-placeholder-only-message, pmds/prefer-trans-in-jsx */
  //  palamedes-lint-disable-next-line pmds/no-empty-component-only-message
"#;
        let (suppressions, diagnostics) = super::parse_suppressions(source, "view.tsx");

        assert!(diagnostics.is_empty());
        assert_eq!(suppressions.len(), 3);
        assert_eq!(suppressions[0].line, 4);
        assert_eq!(suppressions[0].primary.line, 4);
        assert_eq!(suppressions[0].primary.column, 4);
        assert_eq!(suppressions[2].line, 6);
    }

    #[test]
    fn suppression_parser_accepts_comment_openers_after_code_and_by_file_kind() {
        let script =
            "const value = 1; /* palamedes-lint-disable-line pmds/no-placeholder-only-message */\n";
        let (suppressions, diagnostics) = super::parse_suppressions(script, "view.ts");
        assert!(diagnostics.is_empty());
        assert_eq!(suppressions.len(), 1);
        assert_eq!(suppressions[0].line, 1);

        let jsx =
            "const view = <>{/* palamedes-lint-disable-line pmds/prefer-trans-in-jsx */}</>;\n";
        let (suppressions, diagnostics) = super::parse_suppressions(jsx, "view.tsx");
        assert!(diagnostics.is_empty());
        assert_eq!(suppressions.len(), 1);

        let (suppressions, diagnostics) = super::parse_suppressions(
            "<!-- palamedes-lint-disable-line pmds/no-placeholder-only-message -->\n",
            "view.ts",
        );
        assert!(suppressions.is_empty());
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn suppression_parser_uses_file_specific_mdx_comments_and_skips_examples() {
        let source = r#"<!-- palamedes-lint-disable-next-line pmds/no-placeholder-only-message -->
{/* palamedes-lint-disable-line pmds/prefer-trans-in-jsx */}
// palamedes-lint-disable-line pmds/no-empty-component-only-message

   ````tsx
   // palamedes-lint-disable-next-line pmds/no-placeholder-only-message
   {/* palamedes-lint-disable-line pmds/prefer-trans-in-jsx */}
   ````
~~~javascript
<!-- palamedes-lint-disable-next-line pmds/no-empty-component-only-message -->
~~~
```
<!-- palamedes-lint-disable-next-line pmds/no-placeholder-only-message -->
"#;
        let (suppressions, diagnostics) = super::parse_suppressions(source, "guide.mdx");

        assert!(diagnostics.is_empty());
        assert_eq!(
            suppressions
                .iter()
                .map(|suppression| (suppression.primary.line, suppression.line))
                .collect::<Vec<_>>(),
            vec![(1, 2), (2, 2)]
        );
        assert_eq!(suppressions[0].line, 2);
        assert_eq!(suppressions[1].line, 2);
        assert_eq!(suppressions[1].primary.line, 2);
    }

    #[test]
    fn suppression_parser_keeps_unmatched_mdx_fences_inert() {
        let source = "# Guide\n\n  ~~~text\n  <!-- palamedes-lint-disable-next-line pmds/no-placeholder-only-message -->\n";
        let (suppressions, diagnostics) = super::parse_suppressions(source, "guide.mdx");
        assert!(suppressions.is_empty());
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn suppression_parser_requires_real_commonmark_fence_closures() {
        let source = concat!(
            r#"````tsx
<!-- palamedes-lint-disable-next-line pmds/no-placeholder-only-message -->
~~~~
<!-- palamedes-lint-disable-next-line pmds/no-placeholder-only-message -->
``` trailing text
<!-- palamedes-lint-disable-next-line pmds/no-placeholder-only-message -->
````
<!-- palamedes-lint-disable-next-line pmds/no-placeholder-only-message -->
~~~~typescript
<!-- palamedes-lint-disable-next-line pmds/no-placeholder-only-message -->
~~~
<!-- palamedes-lint-disable-next-line pmds/no-placeholder-only-message -->
~~~~ trailing text
<!-- palamedes-lint-disable-next-line pmds/no-placeholder-only-message -->
"#,
            "   ~~~~   \n",
            "<!-- palamedes-lint-disable-next-line pmds/no-placeholder-only-message -->\n",
        );
        let (suppressions, diagnostics) = super::parse_suppressions(source, "guide.mdx");

        assert!(diagnostics.is_empty());
        assert_eq!(suppressions.len(), 2);
        assert_eq!(suppressions[0].primary.line, 8);
        assert_eq!(suppressions[0].line, 9);
        assert_eq!(suppressions[1].primary.line, 16);
        assert_eq!(suppressions[1].line, 17);
    }

    #[test]
    fn suppression_parser_enforces_commonmark_fence_whitespace_and_backtick_info() {
        let nbsp_close = "```mdx\n```\u{a0}\n<!-- palamedes-lint-disable-next-line pmds/no-placeholder-only-message -->\n";
        let (suppressions, diagnostics) = super::parse_suppressions(nbsp_close, "guide.mdx");
        assert!(suppressions.is_empty());
        assert!(diagnostics.is_empty());

        let invalid_backtick_info = "```tsx`not-a-fence\n<!-- palamedes-lint-disable-next-line pmds/no-placeholder-only-message -->\n";
        let (suppressions, diagnostics) =
            super::parse_suppressions(invalid_backtick_info, "guide.mdx");
        assert!(diagnostics.is_empty());
        assert_eq!(suppressions.len(), 1);
        assert_eq!(suppressions[0].primary.line, 2);
        assert_eq!(suppressions[0].line, 3);
    }

    #[test]
    fn suppression_parser_allows_whitespace_only_multiline_comments() {
        let script = "/*\n \tpalamedes-lint-disable-line pmds/no-placeholder-only-message\n*/\n";
        let (suppressions, diagnostics) = super::parse_suppressions(script, "view.ts");
        assert!(diagnostics.is_empty());
        assert_eq!(suppressions.len(), 1);
        assert_eq!(suppressions[0].primary.line, 2);
        assert_eq!(suppressions[0].line, 2);

        let prose =
            "/* explanation\n palamedes-lint-disable-line pmds/no-placeholder-only-message\n*/\n";
        let (suppressions, diagnostics) = super::parse_suppressions(prose, "view.ts");
        assert!(suppressions.is_empty());
        assert!(diagnostics.is_empty());

        let mdx = "<!--\n palamedes-lint-disable-line pmds/no-placeholder-only-message\n-->\n{/*\n palamedes-lint-disable-next-line pmds/prefer-trans-in-jsx\n*/}\n";
        let (suppressions, diagnostics) = super::parse_suppressions(mdx, "guide.mdx");
        assert!(diagnostics.is_empty());
        assert_eq!(suppressions.len(), 2);
        assert_eq!(suppressions[0].primary.line, 2);
        assert_eq!(suppressions[0].line, 2);
        assert_eq!(suppressions[1].primary.line, 5);
        assert_eq!(suppressions[1].line, 7);
    }

    #[test]
    fn suppression_parser_recovers_after_jsx_and_mdx_text() {
        let jsx = r#"const first = <p>Ready</p>;
// palamedes-lint-disable-next-line pmds/no-placeholder-only-message
t`${status}`;
"#;
        let (suppressions, diagnostics) = super::parse_suppressions(jsx, "view.tsx");
        assert!(diagnostics.is_empty());
        assert_eq!(
            suppressions
                .iter()
                .map(|suppression| (suppression.primary.line, suppression.line))
                .collect::<Vec<_>>(),
            vec![(2, 3)]
        );

        let jsx_text = r#"const first = <p>Don't panic</p>;
// palamedes-lint-disable-next-line pmds/no-placeholder-only-message
t`${status}`;
"#;
        let (suppressions, diagnostics) = super::parse_suppressions(jsx_text, "view.tsx");
        assert!(diagnostics.is_empty());
        assert_eq!(
            suppressions
                .iter()
                .map(|suppression| (suppression.primary.line, suppression.line))
                .collect::<Vec<_>>(),
            vec![(2, 3)]
        );

        let trailing = "const label = <p>Ready</p>; // palamedes-lint-disable-line pmds/no-placeholder-only-message\n";
        let (suppressions, diagnostics) = super::parse_suppressions(trailing, "view.tsx");
        assert!(diagnostics.is_empty());
        assert_eq!(suppressions.len(), 1);
        assert_eq!(suppressions[0].line, 1);

        let mdx = r#"Here's an example:
<!-- palamedes-lint-disable-next-line pmds/no-placeholder-only-message -->
{t`${status}`}
<p>Don't panic</p>
{/* palamedes-lint-disable-next-line pmds/no-placeholder-only-message */}
{t`${status}`}
"#;
        let (suppressions, diagnostics) = super::parse_suppressions(mdx, "guide.mdx");
        assert!(diagnostics.is_empty());
        assert_eq!(
            suppressions
                .iter()
                .map(|suppression| (suppression.primary.line, suppression.line))
                .collect::<Vec<_>>(),
            vec![(2, 3), (5, 6)]
        );
    }

    #[test]
    fn suppression_parser_targets_after_multiline_comment_closes() {
        let source = "{/*\n palamedes-lint-disable-next-line pmds/no-placeholder-only-message\n*/}\nt`${status}`\n";
        let (suppressions, diagnostics) = super::parse_suppressions(source, "view.tsx");
        assert!(diagnostics.is_empty());
        assert_eq!(suppressions.len(), 1);
        assert_eq!(suppressions[0].primary.line, 2);
        assert_eq!(suppressions[0].line, 4);

        let source = "<!--\n palamedes-lint-disable-next-line pmds/no-placeholder-only-message\n-->\n{t`${status}`}\n";
        let (suppressions, diagnostics) = super::parse_suppressions(source, "guide.mdx");
        assert!(diagnostics.is_empty());
        assert_eq!(suppressions.len(), 1);
        assert_eq!(suppressions[0].primary.line, 2);
        assert_eq!(suppressions[0].line, 4);
    }

    #[test]
    fn suppression_parser_scans_template_expression_comments_not_raw_templates() {
        let source = r#"const prose = `// palamedes-lint-disable-next-line pmds/no-placeholder-only-message`;
const message = `outer ${tag`inner ${(
  // palamedes-lint-disable-next-line pmds/no-placeholder-only-message
  t`${status}`
)}`}`;
"#;
        let (suppressions, diagnostics) = super::parse_suppressions(source, "view.ts");

        assert!(diagnostics.is_empty());
        assert_eq!(suppressions.len(), 1);
        assert_eq!(suppressions[0].primary.line, 3);
        assert_eq!(suppressions[0].line, 4);
    }

    #[test]
    fn suppression_parser_ignores_regexp_braces_in_template_expressions() {
        let source = r#"const escaped = `outer ${/\}/.test(status) ? (
  // palamedes-lint-disable-next-line pmds/no-placeholder-only-message
  t`${status}`
) : ""}`;
const character_class = `outer ${/[}]/.test(status) ? (
  // palamedes-lint-disable-next-line pmds/no-placeholder-only-message
  t`${status}`
) : ""}`;
const division = `outer ${status / 2 ? (
  // palamedes-lint-disable-next-line pmds/no-placeholder-only-message
  t`${status}`
) : ""}`;
"#;
        let (suppressions, diagnostics) = super::parse_suppressions(source, "view.ts");

        assert!(diagnostics.is_empty());
        assert_eq!(suppressions.len(), 3);
        assert_eq!(
            suppressions
                .iter()
                .map(|suppression| (suppression.primary.line, suppression.line))
                .collect::<Vec<_>>(),
            vec![(2, 3), (6, 7), (10, 11)]
        );
    }

    #[test]
    fn suppression_parser_keeps_mdx_template_text_inert() {
        let source = r#"{`raw <!-- palamedes-lint-disable-next-line pmds/no-placeholder-only-message --> ${(
  // palamedes-lint-disable-next-line pmds/no-placeholder-only-message
  t`${status}`
)}`}
{`nested ${`escaped \` <!-- palamedes-lint-disable-next-line pmds/no-placeholder-only-message --> ${(
  /* palamedes-lint-disable-next-line pmds/prefer-trans-in-jsx */
  t`${status}`
)}`}`}
"#;
        let (suppressions, diagnostics) = super::parse_suppressions(source, "guide.mdx");

        assert!(diagnostics.is_empty());
        assert_eq!(suppressions.len(), 2);
        assert_eq!(
            suppressions
                .iter()
                .map(|suppression| (suppression.primary.line, suppression.line))
                .collect::<Vec<_>>(),
            vec![(2, 3), (6, 7)]
        );
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
            files: Vec::new(),
            config: None,
            json: false,
            fail_on: LintFailOn::Error,
            threads: None,
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
        let analysis = palamedes::analyze_source(source, "view.tsx").expect("analyze source");
        let (diagnostics, suppressed) =
            super::apply_suppressions(source, "view.tsx", Vec::new(), &analysis.comments);
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
            files: Vec::new(),
            config: None,
            json: true,
            fail_on: LintFailOn::Error,
            threads: None,
            no_cache: false,
        }
        .run(&context)
        .expect("cached lint");
        let cold = LintOptions {
            files: Vec::new(),
            config: None,
            json: true,
            fail_on: LintFailOn::Error,
            threads: None,
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
    fn warm_lint_reuses_extraction_only_and_suppressed_cache_entries() {
        let app = temp_dir("source-lint-warm-cache");
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
        let plain = app.join("src/plain.ts");
        let suppressed = app.join("src/suppressed.tsx");
        fs::write(&plain, "// ordinary comment\nexport const answer = 42;\n").expect("write plain");
        fs::write(
            &suppressed,
            r#"import { t } from "@palamedes/core/macro";
export function View({ status }: { status: string }) {
  // palamedes-lint-disable-next-line pmds/no-placeholder-only-message
  return <p>{t`${status}`}</p>;
}
"#,
        )
        .expect("write suppressed");
        let aged = std::time::SystemTime::now() - std::time::Duration::from_secs(10);
        for path in [&plain, &suppressed] {
            fs::File::options()
                .write(true)
                .open(path)
                .expect("open")
                .set_modified(aged)
                .expect("age");
        }

        let context = Context::with_cwd(&app);
        // Seed the shared cache via extraction (creating ExtractionOnly for plain.ts
        // and Complete with cached suppressions for suppressed.tsx).
        let config = context.load_config(None).expect("load config");
        let mut cache = crate::commands::extract::cache::load_extract_cache(&config, false);
        palamedes::extract_catalog_messages_cached(
            palamedes::ExtractCatalogMessagesRequest {
                root_dir: config.source_reference_root.to_string_lossy().into_owned(),
                files: vec![
                    plain.to_string_lossy().into_owned(),
                    suppressed.to_string_lossy().into_owned(),
                ],
                max_threads: Some(1),
            },
            config.analysis_options(),
            &mut cache,
        )
        .expect("seed extract cache");
        crate::commands::extract::cache::persist_extract_cache(&config, &mut cache);

        let warm = LintOptions {
            files: Vec::new(),
            config: None,
            json: true,
            fail_on: LintFailOn::Error,
            threads: Some(1),
            no_cache: false,
        }
        .run(&context)
        .expect("warm lint");
        let cold = LintOptions {
            files: Vec::new(),
            config: None,
            json: true,
            fail_on: LintFailOn::Error,
            threads: Some(1),
            no_cache: true,
        }
        .run(&context)
        .expect("cold lint");

        assert_eq!(warm.summary.files, 2);
        assert_eq!(warm.summary.suppressed, 1);
        assert_eq!(
            serde_json::to_vec(&warm).expect("warm json"),
            serde_json::to_vec(&cold).expect("cold json")
        );
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
            files: Vec::new(),
            config: None,
            json: false,
            fail_on: LintFailOn::Warning,
            threads: None,
            no_cache: true,
        };

        assert!(options.verdict(&result).is_err());
    }

    #[test]
    fn corrupt_cached_comment_ranges_do_not_panic() {
        use palamedes::{SourceComment, SourceCommentKind, SourceRange};

        let source = "/* palamedes-lint-disable-next-line pmds/no-pseudo-plural */ café\n";
        let cafe_mid_char = source.find('é').expect("multibyte char") + 1;
        let corrupt_comments = vec![
            // End beyond source length
            SourceComment {
                kind: SourceCommentKind::Block,
                range: SourceRange {
                    start: 0,
                    end: source.len() + 10,
                    line: 1,
                    column: 1,
                },
            },
            // End lands inside a multibyte UTF-8 character while end - 2 is valid
            SourceComment {
                kind: SourceCommentKind::Block,
                range: SourceRange {
                    start: 0,
                    end: cafe_mid_char,
                    line: 1,
                    column: 1,
                },
            },
            // Reversed start > end
            SourceComment {
                kind: SourceCommentKind::Line,
                range: SourceRange {
                    start: 20,
                    end: 5,
                    line: 1,
                    column: 1,
                },
            },
        ];

        let (suppressions, diagnostics) =
            super::parse_suppressions_from_comments(source, "app.ts", &corrupt_comments);
        assert!(suppressions.is_empty());
        assert!(diagnostics.is_empty());
    }
}
