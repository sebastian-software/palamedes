use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn audit_error_threshold_exits_its_policy_code() {
    let fixture = fixture_dir("audit-error-threshold");
    write_config(&fixture);
    write_catalogs(
        &fixture,
        "msgid \"Save\"\nmsgstr \"Save\"\n",
        "msgid \"Save\"\nmsgstr \"\"\n",
    );

    let output = audit(&fixture, &[]);

    assert_eq!(output.status.code(), Some(5), "{output:?}");
    assert!(
        String::from_utf8_lossy(&output.stdout).contains("Catalog audit failed: 1 error(s)"),
        "{output:?}"
    );

    fs::remove_dir_all(fixture).expect("cleanup");
}

#[test]
fn audit_warning_threshold_prints_failed_status_and_exits_its_policy_code() {
    let fixture = fixture_dir("audit-warning-threshold");
    write_config(&fixture);
    write_catalogs(
        &fixture,
        "msgid \"Save\"\nmsgstr \"Save\"\n",
        "msgid \"Save\"\nmsgstr \"Speichern\"\n\nmsgid \"Only target\"\nmsgstr \"Nur Ziel\"\n",
    );

    let default = audit(&fixture, &[]);
    assert!(default.status.success(), "{default:?}");
    assert!(String::from_utf8_lossy(&default.stdout)
        .contains("Catalog audit passed: 0 error(s), 1 warning(s), 0 info"));

    let fail_on_warning = audit(&fixture, &["--fail-on", "warning"]);
    assert_eq!(
        fail_on_warning.status.code(),
        Some(5),
        "{fail_on_warning:?}"
    );
    assert!(String::from_utf8_lossy(&fail_on_warning.stdout)
        .contains("Catalog audit failed: 0 error(s), 1 warning(s), 0 info"));

    fs::remove_dir_all(fixture).expect("cleanup");
}

#[test]
fn audit_info_threshold_prints_failed_status_and_exits_its_policy_code() {
    let fixture = fixture_dir("audit-info-threshold");
    write_config(&fixture);
    write_catalogs(
        &fixture,
        "msgid \"Save\"\nmsgstr \"Save\"\n",
        "#, fuzzy\nmsgid \"Save\"\nmsgstr \"Speichern\"\n",
    );

    let default = audit(&fixture, &[]);
    assert!(default.status.success(), "{default:?}");
    assert!(String::from_utf8_lossy(&default.stdout)
        .contains("Catalog audit passed: 0 error(s), 0 warning(s), 1 info"));

    let fail_on_info = audit(&fixture, &["--fail-on", "info"]);
    assert_eq!(fail_on_info.status.code(), Some(5), "{fail_on_info:?}");
    assert!(
        String::from_utf8_lossy(&fail_on_info.stdout)
            .contains("Catalog audit failed: 0 error(s), 0 warning(s), 1 info"),
        "{fail_on_info:?}"
    );
    assert!(
        String::from_utf8_lossy(&fail_on_info.stderr)
            .contains("Catalog audit failed with 0 error(s), 0 warning(s), and 1 info"),
        "{fail_on_info:?}"
    );

    fs::remove_dir_all(fixture).expect("cleanup");
}

#[test]
fn audit_json_output_remains_machine_readable_when_its_threshold_fails() {
    let fixture = fixture_dir("audit-json-threshold");
    write_config(&fixture);
    write_catalogs(
        &fixture,
        "msgid \"Save\"\nmsgstr \"Save\"\n",
        "msgid \"Save\"\nmsgstr \"Speichern\"\n\nmsgid \"Only target\"\nmsgstr \"Nur Ziel\"\n",
    );

    let output = audit(&fixture, &["--json", "--fail-on", "warning"]);
    assert_eq!(output.status.code(), Some(5), "{output:?}");
    let json: serde_json::Value = serde_json::from_slice(&output.stdout).expect("audit JSON");
    assert_eq!(json["summary"]["warnings"], 1);
    assert!(!String::from_utf8_lossy(&output.stdout).contains("Catalog audit"));

    fs::remove_dir_all(fixture).expect("cleanup");
}

#[test]
fn audit_operational_failures_keep_the_generic_exit_code() {
    let fixture = fixture_dir("audit-configuration-failure");
    fs::create_dir_all(&fixture).expect("create fixture");

    let output = audit(&fixture, &[]);

    assert_eq!(output.status.code(), Some(1), "{output:?}");

    fs::remove_dir_all(fixture).expect("cleanup");
}

fn audit(cwd: &Path, arguments: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_pmds"))
        .arg("audit")
        .args(arguments)
        .current_dir(cwd)
        .output()
        .expect("run pmds audit")
}

fn write_config(fixture: &Path) {
    fs::create_dir_all(fixture.join("locales/en")).expect("create source catalog dir");
    fs::create_dir_all(fixture.join("locales/de")).expect("create target catalog dir");
    fs::write(
        fixture.join("palamedes.yaml"),
        r#"locales: [en, de]
source-locale: en
catalogs:
  - path: locales/{locale}/messages
    include: [app]
"#,
    )
    .expect("write config");
}

fn write_catalogs(fixture: &Path, source: &str, target: &str) {
    fs::write(fixture.join("locales/en/messages.po"), source).expect("write source catalog");
    fs::write(fixture.join("locales/de/messages.po"), target).expect("write target catalog");
}

fn fixture_dir(name: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    std::env::temp_dir().join(format!(
        "palamedes-cli-{name}-{}-{stamp}",
        std::process::id()
    ))
}
