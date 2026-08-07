use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::{SystemTime, UNIX_EPOCH};

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
    assert!(String::from_utf8_lossy(&warning.stdout).contains("pmds/no-placeholder-only-message"));

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
fn lint_configuration_failures_keep_the_generic_exit_code() {
    let fixture = fixture_dir("configuration-failure");
    fs::create_dir_all(&fixture).expect("create fixture");

    let output = pmds(&fixture, &["lint", "--json"]);
    assert_eq!(output.status.code(), Some(1), "{output:?}");

    fs::remove_dir_all(fixture).expect("cleanup fixture");
}

fn pmds(root: &Path, arguments: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_pmds"))
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
