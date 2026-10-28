use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[test]
fn lint_verdicts_have_a_dedicated_exit_code() {
    let fixture = fixture_dir("verdict");
    fs::create_dir_all(fixture.join("src")).expect("create source directory");
    fs::write(
        fixture.join("palamedes.yaml"),
        "locales: [en]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}/messages\n    include: [src]\n",
    )
    .expect("write config");
    fs::write(
        fixture.join("src/view.tsx"),
        "import { t } from \"@palamedes/core/macro\";\nexport function Label({ status }) { return t`${status}`; }\n",
    )
    .expect("write source");

    let warning = pmds(
        &fixture,
        &["lint", "--json", "--fail-on", "warning", "--threads", "1"],
    );
    assert_eq!(warning.status.code(), Some(4), "{warning:?}");
    let stdout = String::from_utf8_lossy(&warning.stdout);
    assert!(stdout.contains("pmds/no-placeholder-only-message"));
    // The document is versioned, and the version leads the top level.
    assert!(
        stdout.starts_with("{\n  \"schemaVersion\": 1,\n"),
        "{stdout}"
    );
    let document: serde_json::Value = serde_json::from_str(&stdout).expect("lint JSON");
    let mut keys = document
        .as_object()
        .expect("lint JSON object")
        .keys()
        .map(String::as_str)
        .collect::<Vec<_>>();
    keys.sort_unstable();
    assert_eq!(
        keys,
        ["diagnostics", "failedFiles", "schemaVersion", "summary"]
    );

    let default_threshold = pmds(&fixture, &["lint", "--json"]);
    assert!(default_threshold.status.success(), "{default_threshold:?}");

    let usage = pmds(&fixture, &["lint", "--fail-on", "info"]);
    assert_eq!(usage.status.code(), Some(2), "{usage:?}");

    fs::remove_dir_all(fixture).expect("cleanup fixture");
}

#[test]
fn lint_analysis_failure_shares_the_dedicated_verdict_exit_code() {
    let fixture = fixture_dir("analysis-failure");
    fs::create_dir_all(fixture.join("src")).expect("create source directory");
    fs::write(
        fixture.join("palamedes.yaml"),
        "locales: [en]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}/messages\n    include: [src]\n",
    )
    .expect("write config");
    fs::write(
        fixture.join("src/view.tsx"),
        "import { t } from \"@palamedes/core/macro\";\nexport const label = t`${status}`;\n",
    )
    .expect("write invalid source");

    let output = pmds(&fixture, &["lint", "--json"]);
    assert_eq!(output.status.code(), Some(4), "{output:?}");

    fs::remove_dir_all(fixture).expect("cleanup fixture");
}

#[test]
fn lint_suppresses_an_inner_template_expression_comment_not_raw_template_text() {
    let fixture = fixture_dir("template-expression-suppression");
    fs::create_dir_all(fixture.join("src")).expect("create source directory");
    fs::write(
        fixture.join("palamedes.yaml"),
        "locales: [en]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}/messages\n    include: [src]\n",
    )
    .expect("write config");
    fs::write(
        fixture.join("src/view.tsx"),
        r#"import { t } from "@palamedes/core/macro";
export function Label({ status }) {
  const prose = `// palamedes-lint-disable-next-line pmds/no-placeholder-only-message`;
  const label = `outer ${(
    // palamedes-lint-disable-next-line pmds/no-placeholder-only-message
    t`${status}`
  )}`;
  return <p>{label}</p>;
}
"#,
    )
    .expect("write source");

    let output = pmds(
        &fixture,
        &["lint", "--json", "--fail-on", "warning", "--threads", "1"],
    );
    assert!(output.status.success(), "{output:?}");
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("\"suppressed\": 1"), "{stdout}");

    fs::remove_dir_all(fixture).expect("cleanup fixture");
}

#[test]
fn lint_does_not_treat_raw_template_text_as_a_suppression() {
    let fixture = fixture_dir("raw-template-prose");
    fs::create_dir_all(fixture.join("src")).expect("create source directory");
    fs::write(
        fixture.join("palamedes.yaml"),
        "locales: [en]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}/messages\n    include: [src]\n",
    )
    .expect("write config");
    fs::write(
        fixture.join("src/view.tsx"),
        r#"import { t } from "@palamedes/core/macro";
export function Label({ status }) {
  const prose = `// palamedes-lint-disable-next-line pmds/no-placeholder-only-message`;
  return t`${status}`;
}
"#,
    )
    .expect("write source");

    let output = pmds(&fixture, &["lint", "--json", "--fail-on", "warning"]);
    assert_eq!(output.status.code(), Some(4), "{output:?}");
    assert!(String::from_utf8_lossy(&output.stdout).contains("pmds/no-placeholder-only-message"));

    fs::remove_dir_all(fixture).expect("cleanup fixture");
}

#[test]
fn lint_keeps_commonmark_fence_edge_cases_on_the_public_path() {
    let fixture = fixture_dir("commonmark-fence");
    fs::create_dir_all(fixture.join("src")).expect("create source directory");
    fs::write(
        fixture.join("palamedes.yaml"),
        "locales: [en]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}/messages\n    include: [src]\n",
    )
    .expect("write config");
    fs::write(
        fixture.join("src/nbsp-close.mdx"),
        "```mdx\n```\u{a0}\n<!-- palamedes-lint-disable-next-line pmds/no-placeholder-only-message -->\n",
    )
    .expect("write NBSP fence source");
    fs::write(
        fixture.join("src/invalid-opener.mdx"),
        "```tsx`not-a-fence\n<!-- palamedes-lint-disable-next-line pmds/no-placeholder-only-message -->\n",
    )
    .expect("write invalid opener source");

    let output = pmds(&fixture, &["lint", "--json", "--fail-on", "warning"]);
    assert_eq!(output.status.code(), Some(4), "{output:?}");
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert_eq!(
        stdout.matches("pmds/unused-suppression").count(),
        1,
        "{stdout}"
    );

    fs::remove_dir_all(fixture).expect("cleanup fixture");
}

#[test]
fn lint_suppresses_a_template_expression_comment_after_a_regexp_literal() {
    let fixture = fixture_dir("regexp-template-expression-suppression");
    fs::create_dir_all(fixture.join("src")).expect("create source directory");
    fs::write(
        fixture.join("palamedes.yaml"),
        "locales: [en]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}/messages\n    include: [src]\n",
    )
    .expect("write config");
    fs::write(
        fixture.join("src/view.tsx"),
        r#"import { t } from "@palamedes/core/macro";
export function Label({ status }) {
  const label = `outer ${/}/.test(status) ? (
    // palamedes-lint-disable-next-line pmds/no-placeholder-only-message
    t`${status}`
  ) : ""}`;
  return <p>{label}</p>;
}
"#,
    )
    .expect("write source");

    let output = pmds(
        &fixture,
        &["lint", "--json", "--fail-on", "warning", "--threads", "1"],
    );
    assert!(output.status.success(), "{output:?}");
    assert!(
        String::from_utf8_lossy(&output.stdout).contains("\"suppressed\": 1"),
        "{output:?}"
    );

    fs::remove_dir_all(fixture).expect("cleanup fixture");
}

#[test]
fn lint_treats_only_mdx_template_expression_comments_as_suppressions() {
    let fixture = fixture_dir("mdx-template-expression-suppression");
    fs::create_dir_all(fixture.join("src")).expect("create source directory");
    fs::write(
        fixture.join("palamedes.yaml"),
        "locales: [en]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}/messages\n    include: [src]\n",
    )
    .expect("write config");
    fs::write(
        fixture.join("src/guide.mdx"),
        r#"import { t } from "@palamedes/core/macro";

{`raw <!-- palamedes-lint-disable-next-line pmds/no-placeholder-only-message --> ${(
  // palamedes-lint-disable-next-line pmds/no-placeholder-only-message
  t`${status}`
)}`}
"#,
    )
    .expect("write source");

    let output = pmds(
        &fixture,
        &["lint", "--json", "--fail-on", "warning", "--threads", "1"],
    );
    assert_eq!(output.status.code(), Some(4), "{output:?}");
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert_eq!(
        stdout.matches("pmds/unused-suppression").count(),
        1,
        "{stdout}"
    );

    fs::remove_dir_all(fixture).expect("cleanup fixture");
}

#[test]
fn lint_suppression_survives_a_jsx_closing_tag() {
    let fixture = fixture_dir("scanner-sync");
    fs::create_dir_all(fixture.join("src")).expect("create source directory");
    fs::write(
        fixture.join("palamedes.yaml"),
        "locales: [en]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}/messages\n    include: [src]\n",
    )
    .expect("write config");
    fs::write(
        fixture.join("src/view.tsx"),
        r#"import { t } from "@palamedes/core/macro";
export function Label({ status }) {
  const first = <p>Ready</p>;
  // palamedes-lint-disable-next-line pmds/no-placeholder-only-message
  return <>{first}{t`${status}`}</>;
}
"#,
    )
    .expect("write JSX source");
    let output = pmds(
        &fixture,
        &["lint", "--json", "--fail-on", "warning", "--threads", "1"],
    );
    assert!(output.status.success(), "{output:?}");
    assert!(
        String::from_utf8_lossy(&output.stdout).contains("\"suppressed\": 1"),
        "{output:?}"
    );

    fs::remove_dir_all(fixture).expect("cleanup fixture");
}

#[test]
fn lint_configuration_failures_keep_the_generic_exit_code() {
    let fixture = fixture_dir("configuration-failure");
    fs::create_dir_all(&fixture).expect("create fixture");

    let output = pmds(&fixture, &["lint", "--json"]);
    assert_eq!(output.status.code(), Some(1), "{output:?}");

    fs::remove_dir_all(fixture).expect("cleanup fixture");
}

#[test]
fn lint_reports_an_unwritable_extraction_cache_without_verbose_output() {
    let fixture = fixture_dir("cache-write-failure");
    fs::create_dir_all(fixture.join("src")).expect("create source directory");
    fs::write(
        fixture.join("palamedes.yaml"),
        "locales: [en]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}/messages\n    include: [src]\n",
    )
    .expect("write config");
    fs::write(
        fixture.join("src/view.tsx"),
        "import { t } from \"@palamedes/core/macro\";\nexport function label() { return t`Hello`; }\n",
    )
    .expect("write source");
    fs::File::options()
        .write(true)
        .open(fixture.join("src/view.tsx"))
        .expect("open source")
        .set_modified(SystemTime::now() - Duration::from_secs(10))
        .expect("age source for cache eligibility");
    // A file where the cache directory belongs makes saving fail consistently
    // across platforms without relying on permission bits or privileged users.
    fs::write(fixture.join(".palamedes"), "not a directory")
        .expect("block cache directory creation");

    let output = pmds(&fixture, &["lint", "--json", "--threads", "1"]);

    assert!(output.status.success(), "{output:?}");
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("Warning: could not write the extraction cache to"),
        "{output:?}"
    );
    assert!(stderr.contains(".palamedes"), "{output:?}");

    fs::remove_dir_all(fixture).expect("cleanup fixture");
}

#[test]
fn targeted_lint_resolves_files_from_cwd_and_bypasses_catalog_patterns() {
    let fixture = fixture_dir("targeted-paths");
    fs::create_dir_all(fixture.join("src")).expect("create source directory");
    fs::create_dir_all(fixture.join("config")).expect("create config directory");
    fs::write(
        fixture.join("config/palamedes.yaml"),
        "locales: [en]\nsource-locale: en\nlint:\n  rules:\n    placeholder-only: error\ncatalogs:\n  - path: locales/{locale}/messages\n    include: [unrelated]\n    exclude: ['**/*.tsx']\n",
    )
    .expect("write config");
    fs::write(
        fixture.join("src/view.tsx"),
        "import { t } from \"@palamedes/core/macro\";\nexport function label(status) { return t`${status}`; }\n",
    )
    .expect("write source");
    // A broken, unselected file must never reach native analysis.
    fs::write(fixture.join("src/broken.tsx"), "export const = ;").expect("write broken file");
    let absolute = fixture.join("src/view.tsx");
    let output = pmds(
        &fixture,
        &[
            "lint",
            "src/view.tsx",
            "./src/view.tsx",
            "src/../src/view.tsx",
            absolute.to_str().expect("UTF-8 path"),
            "--config",
            "config/palamedes.yaml",
            "--json",
        ],
    );
    assert_eq!(output.status.code(), Some(4), "{output:?}");
    let result: serde_json::Value = serde_json::from_slice(&output.stdout).expect("JSON result");
    assert_eq!(result["summary"]["files"], 1);
    assert_eq!(result["summary"]["errors"], 1);
    assert_eq!(result["failedFiles"], serde_json::json!([]));
    assert_eq!(
        result["diagnostics"][0]["code"],
        "pmds/no-placeholder-only-message"
    );
    assert!(
        !fixture.join("config/locales").exists(),
        "lint must not write catalogs"
    );
    fs::remove_dir_all(fixture).expect("cleanup fixture");
}

#[test]
fn targeted_lint_reports_bad_inputs_in_json_instead_of_passing_an_empty_scan() {
    let fixture = targeted_fixture("targeted-failures");
    fs::write(fixture.join("notes.txt"), "plain text").expect("write unsupported file");
    let output = pmds(
        &fixture,
        &[
            "lint",
            "src/missing.tsx",
            "notes.txt",
            "src",
            "src/*.tsx",
            "--json",
        ],
    );
    assert_eq!(output.status.code(), Some(4), "{output:?}");
    let result: serde_json::Value = serde_json::from_slice(&output.stdout).expect("JSON result");
    assert_eq!(result["summary"]["files"], 4);
    assert_eq!(result["summary"]["failedFiles"], 4);
    assert_eq!(result["failedFiles"].as_array().expect("failures").len(), 4);
    assert!(
        result["diagnostics"]
            .as_array()
            .expect("diagnostics")
            .is_empty()
    );
    fs::remove_dir_all(fixture).expect("cleanup fixture");
}

#[test]
fn targeted_lint_keeps_other_cache_entries_and_matches_cold_results_after_edits() {
    let fixture = targeted_fixture("targeted-cache");
    for file in ["view.tsx", "other.tsx"] {
        fs::write(
            fixture.join("src").join(file),
            "import { t } from \"@palamedes/core/macro\";\nexport function label(status) { return t`${status}`; }\n",
        )
        .expect("write source");
    }
    let aged = SystemTime::now() - Duration::from_secs(10);
    for file in ["view.tsx", "other.tsx"] {
        fs::File::options()
            .write(true)
            .open(fixture.join("src").join(file))
            .expect("open source")
            .set_modified(aged)
            .expect("age source");
    }
    let full = pmds(&fixture, &["lint", "--json"]);
    assert!(full.status.success(), "{full:?}");
    let cache_path = fixture.join(".palamedes/extract-cache.json");
    let before: serde_json::Value =
        serde_json::from_slice(&fs::read(&cache_path).expect("cache")).expect("cache JSON");
    let targeted = pmds(&fixture, &["lint", "src/view.tsx", "--json"]);
    assert!(targeted.status.success(), "{targeted:?}");
    let after: serde_json::Value =
        serde_json::from_slice(&fs::read(&cache_path).expect("cache")).expect("cache JSON");
    assert_eq!(
        before, after,
        "targeted lint must preserve unrelated cached files"
    );
    assert!(
        fs::read_to_string(&cache_path)
            .expect("cache text")
            .contains("other.tsx")
    );
    fs::write(
        fixture.join("src/view.tsx"),
        "import { t } from \"@palamedes/core/macro\";\nexport function label() { return t`Ready`; }\n",
    )
    .expect("edit source");
    let warm = pmds(
        &fixture,
        &["lint", "src/view.tsx", "--json", "--fail-on", "warning"],
    );
    let repeated = pmds(
        &fixture,
        &["lint", "src/view.tsx", "--json", "--fail-on", "warning"],
    );
    let cold = pmds(
        &fixture,
        &[
            "lint",
            "src/view.tsx",
            "--json",
            "--fail-on",
            "warning",
            "--no-cache",
        ],
    );
    assert!(warm.status.success(), "{warm:?}");
    assert!(repeated.status.success(), "{repeated:?}");
    assert!(cold.status.success(), "{cold:?}");
    assert_eq!(warm.stdout, cold.stdout);
    assert_eq!(warm.stdout, repeated.stdout);
    assert!(
        fs::read_to_string(&cache_path)
            .expect("cache text")
            .contains("other.tsx")
    );
    fs::remove_dir_all(fixture).expect("cleanup fixture");
}

#[test]
fn targeted_lint_preserves_component_suppressions_and_mdx_support() {
    let fixture = targeted_fixture("targeted-formats");
    for extension in ["vue", "svelte"] {
        fs::write(
            fixture.join(format!("src/view.{extension}")),
            "<script setup>\nimport { t } from \"@palamedes/core/macro\";\nconst status = 'Ready';\n// palamedes-lint-disable-next-line pmds/no-placeholder-only-message\nconst label = t`${status}`;\n</script>\n",
        )
        .expect("write component");
    }
    fs::write(
        fixture.join("src/guide.mdx"),
        "# A guide\n\nA source file supported by the native lint path.\n",
    )
    .expect("write MDX");
    let output = pmds(
        &fixture,
        &[
            "lint",
            "src/view.vue",
            "src/view.svelte",
            "src/guide.mdx",
            "--json",
            "--fail-on",
            "warning",
        ],
    );
    assert!(output.status.success(), "{output:?}");
    let result: serde_json::Value = serde_json::from_slice(&output.stdout).expect("JSON result");
    assert_eq!(result["summary"]["files"], 3);
    assert_eq!(result["summary"]["suppressed"], 2);
    fs::remove_dir_all(fixture).expect("cleanup fixture");
}

fn targeted_fixture(name: &str) -> PathBuf {
    let fixture = fixture_dir(name);
    fs::create_dir_all(fixture.join("src")).expect("create source directory");
    fs::write(
        fixture.join("palamedes.yaml"),
        "locales: [en]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}/messages\n    include: [src]\n",
    )
    .expect("write config");
    fixture
}

fn pmds(root: &Path, arguments: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_pmds"))
        .env(
            "PALAMEDES_UI_CATALOG_DIR",
            concat!(env!("OUT_DIR"), "/catalogs"),
        )
        .env("PALAMEDES_UI_LOCALE", "en")
        .args(arguments)
        .current_dir(root)
        .output()
        .expect("run pmds")
}

fn fixture_dir(name: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    std::env::temp_dir().join(format!(
        "palamedes-cli-lint-exit-{name}-{}-{stamp}",
        std::process::id()
    ))
}
