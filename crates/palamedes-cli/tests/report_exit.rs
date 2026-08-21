use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn report_threshold_prints_the_report_and_exits_its_policy_code() {
    let fixture = fixture_dir("threshold");
    write_project(&fixture);

    let output = pmds(&fixture, &["report", "--fail-if-below", "90"]);

    assert_eq!(output.status.code(), Some(6), "{output:?}");
    assert!(
        String::from_utf8_lossy(&output.stdout).contains("de"),
        "{output:?}"
    );
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("Catalog completeness below 90%"),
        "{output:?}"
    );

    fs::remove_dir_all(fixture).expect("cleanup fixture");
}

#[test]
fn report_json_stays_machine_readable_when_its_threshold_fails() {
    let fixture = fixture_dir("json-threshold");
    write_project(&fixture);

    let output = pmds(&fixture, &["report", "--json", "--fail-if-below", "90"]);

    assert_eq!(output.status.code(), Some(6), "{output:?}");
    let json: serde_json::Value = serde_json::from_slice(&output.stdout).expect("report JSON");
    assert_eq!(json["locales"][0]["locale"], "de");
    assert!(!String::from_utf8_lossy(&output.stdout).contains("Catalog completeness below"));

    fs::remove_dir_all(fixture).expect("cleanup fixture");
}

#[test]
fn report_operational_failures_keep_the_generic_exit_code() {
    let fixture = fixture_dir("configuration-failure");
    fs::create_dir_all(&fixture).expect("create fixture");

    let output = pmds(&fixture, &["report", "--fail-if-below", "90"]);

    assert_eq!(output.status.code(), Some(1), "{output:?}");

    fs::remove_dir_all(fixture).expect("cleanup fixture");
}

fn write_project(root: &Path) {
    fs::create_dir_all(root.join("locales/en")).expect("create source catalog dir");
    fs::create_dir_all(root.join("locales/de")).expect("create target catalog dir");
    fs::write(
        root.join("palamedes.yaml"),
        "locales: [en, de]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}/messages\n    include: [app]\n",
    )
    .expect("write config");
    fs::write(
        root.join("locales/en/messages.po"),
        "msgid \"Hello\"\nmsgstr \"Hello\"\n\nmsgid \"Bye\"\nmsgstr \"Bye\"\n",
    )
    .expect("write source catalog");
    fs::write(
        root.join("locales/de/messages.po"),
        "msgid \"Hello\"\nmsgstr \"Hallo\"\n\nmsgid \"Bye\"\nmsgstr \"\"\n",
    )
    .expect("write target catalog");
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
        "palamedes-cli-report-exit-{name}-{}-{stamp}",
        std::process::id()
    ))
}
