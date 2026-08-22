//! `pmds lint` — non-mutating Palamedes source-authoring diagnostics.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use clap::{Args, ValueEnum};
use palamedes::{
    analyze_source_files_cached, SourceComment, SourceCommentKind, SourceDiagnostic,
    SourceDiagnosticSeverity, SourceFileAnalysisRequest, SourceRange, SOURCE_DIAGNOSTIC_CODES,
};
use serde::Serialize;

use crate::command::{render_json, Command, Context};
use crate::commands::extract::cache::{load_extract_cache, persist_extract_cache};
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
    /// Worker threads for the parallel source-analysis pass.
    #[arg(long)]
    threads: Option<usize>,
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
        let analysis_options = config.analysis_options();
        let mut cache = load_extract_cache(&config, self.no_cache);

        let analysis_files = files
            .iter()
            .map(|path| SourceFileAnalysisRequest {
                path: path.to_string_lossy().into_owned(),
                filename: display_source_path(path, &config.root_dir),
            })
            .collect::<Vec<_>>();
        let analyses = analyze_source_files_cached(
            &analysis_files,
            &config.source_reference_root.to_string_lossy(),
            &analysis_options,
            self.threads.or(config.extract_threads),
            &mut cache,
        )?;

        for (file, analysis) in analysis_files.iter().zip(analyses) {
            match analysis {
                Ok(result) => {
                    let comments = result.analysis.comments;
                    let (mut file_diagnostics, file_suppressed) = apply_suppressions(
                        &result.source,
                        &file.filename,
                        result.analysis.diagnostics,
                        &comments,
                    );
                    diagnostics.append(&mut file_diagnostics);
                    suppressed += file_suppressed;
                }
                Err(error) => failed_files.push(LintFileFailure {
                    file: file.filename.clone(),
                    message: error.to_string(),
                }),
            }
        }

        let cache_keys = files
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        cache.retain_paths(&cache_keys.iter().map(String::as_str).collect());
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
    comments: &[SourceComment],
) -> (Vec<SourceDiagnostic>, usize) {
    let (suppressions, mut suppression_diagnostics) =
        parse_suppressions_from_comments(source, filename, comments);
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

fn parse_suppressions_from_comments(
    source: &str,
    filename: &str,
    comments: &[SourceComment],
) -> (Vec<Suppression>, Vec<SourceDiagnostic>) {
    const DIRECTIVES: &[(&str, usize)] = &[
        ("palamedes-lint-disable-next-line", 1),
        ("palamedes-lint-disable-line", 0),
    ];

    let mut suppressions = Vec::new();
    let mut diagnostics = Vec::new();
    for comment in comments {
        let Some((directive_start, directive_source)) = comment_directive_source(source, comment)
        else {
            continue;
        };
        let Some((directive, line_delta)) = DIRECTIVES
            .iter()
            .find(|(directive, _)| directive_source.starts_with(*directive))
        else {
            continue;
        };
        let rest = directive_source[directive.len()..].trim();
        let codes = rest
            .split([',', ' ', '\t'])
            .filter(|code| !code.is_empty())
            .collect::<BTreeSet<_>>();
        let range = source_range(source, directive_start, directive.len());
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
                    line: suppression_line(
                        source,
                        comment,
                        directive_start,
                        range.line,
                        *line_delta,
                    ),
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
    (suppressions, diagnostics)
}

fn comment_directive_source<'a>(
    source: &'a str,
    comment: &SourceComment,
) -> Option<(usize, &'a str)> {
    let (opening_width, closing_width) = match comment.kind {
        SourceCommentKind::Line => (2, 0),
        SourceCommentKind::Block => (2, 2),
        SourceCommentKind::Html => (4, 3),
    };
    let content_start = comment.range.start.checked_add(opening_width)?;
    let content_end = comment.range.end.checked_sub(closing_width)?;
    let content = source.get(content_start..content_end)?;
    let directive_source = content.trim_start();
    let directive_start = content_start + content.len() - directive_source.len();
    Some((directive_start, directive_source))
}

fn source_range(source: &str, start: usize, length: usize) -> SourceRange {
    let prefix = &source[..start];
    let line_start = prefix.rfind('\n').map_or(0, |index| index + 1);
    SourceRange {
        start,
        end: start + length,
        line: prefix.bytes().filter(|byte| *byte == b'\n').count() + 1,
        column: source[line_start..start].chars().count() + 1,
    }
}

fn suppression_line(
    source: &str,
    comment: &SourceComment,
    directive_start: usize,
    directive_line: usize,
    line_delta: usize,
) -> usize {
    if line_delta == 0 {
        return directive_line;
    }
    if comment.kind == SourceCommentKind::Line {
        return directive_line + 1;
    }
    directive_line
        + source[directive_start..comment.range.end]
            .bytes()
            .filter(|byte| *byte == b'\n')
            .count()
        + 1
}

#[cfg(test)]
fn parse_suppressions(source: &str, filename: &str) -> (Vec<Suppression>, Vec<SourceDiagnostic>) {
    let analysis = palamedes::analyze_source(source, filename)
        .expect("suppression fixture should be valid authored source");
    parse_suppressions_from_comments(source, filename, &analysis.comments)
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
            config: None,
            json: true,
            fail_on: LintFailOn::Error,
            threads: None,
            no_cache: false,
        }
        .run(&context)
        .expect("cached lint");
        let cold = LintOptions {
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
            threads: None,
            no_cache: true,
        };

        assert!(options.verdict(&result).is_err());
    }
}
