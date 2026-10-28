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
        String::from_utf8_lossy(&output.stdout).contains("Catalog audit failed: 1 error"),
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
    assert!(
        String::from_utf8_lossy(&default.stdout)
            .contains("Catalog audit passed: 0 errors, 1 warning, 0 info messages")
    );

    let fail_on_warning = audit(&fixture, &["--fail-on", "warning"]);
    assert_eq!(
        fail_on_warning.status.code(),
        Some(5),
        "{fail_on_warning:?}"
    );
    assert!(
        String::from_utf8_lossy(&fail_on_warning.stdout)
            .contains("Catalog audit failed: 0 errors, 1 warning, 0 info messages")
    );

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
    assert!(
        String::from_utf8_lossy(&default.stdout)
            .contains("Catalog audit passed: 0 errors, 0 warnings, 1 info message")
    );

    let fail_on_info = audit(&fixture, &["--fail-on", "info"]);
    assert_eq!(fail_on_info.status.code(), Some(5), "{fail_on_info:?}");
    assert!(
        String::from_utf8_lossy(&fail_on_info.stdout)
            .contains("Catalog audit failed: 0 errors, 0 warnings, 1 info message"),
        "{fail_on_info:?}"
    );
    assert!(
        String::from_utf8_lossy(&fail_on_info.stderr)
            .contains("Catalog audit failed with 0 errors, 0 warnings, and 1 info message"),
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

/// The `--json` document is a public contract: `schemaVersion` leads, and the
/// top level and each diagnostic carry exactly the documented fields.
#[test]
fn audit_json_document_has_a_versioned_top_level_shape() {
    let fixture = fixture_dir("audit-json-shape");
    write_config(&fixture);
    write_catalogs(
        &fixture,
        "msgid \"Save\"\nmsgstr \"Save\"\n",
        "msgid \"Save\"\nmsgstr \"\"\n",
    );

    let output = audit(&fixture, &["--json"]);
    assert_eq!(output.status.code(), Some(5), "{output:?}");
    let stdout = String::from_utf8(output.stdout).expect("UTF-8 stdout");
    assert!(
        stdout.starts_with("{\n  \"schemaVersion\": 1,\n"),
        "{stdout}"
    );
    let json: serde_json::Value = serde_json::from_str(&stdout).expect("audit JSON");
    assert_eq!(keys(&json), ["diagnostics", "schemaVersion", "summary"]);
    assert_eq!(json["schemaVersion"], 1);
    assert_eq!(
        keys(&json["summary"]),
        [
            "diagnostics",
            "errors",
            "infos",
            "sourceMessages",
            "targetLocales",
            "warnings"
        ]
    );
    assert_eq!(json["summary"]["errors"], 1);
    let diagnostic = &json["diagnostics"][0];
    assert_eq!(
        keys(diagnostic),
        [
            "catalogPath",
            "code",
            "locale",
            "message",
            "name",
            "severity",
            "sourceKey"
        ]
    );
    assert_eq!(diagnostic["severity"], "error");
    assert_eq!(diagnostic["code"], "catalog.empty_translation");
    assert_eq!(diagnostic["locale"], "de");
    assert_eq!(diagnostic["sourceKey"]["message"], "Save");

    fs::remove_dir_all(fixture).expect("cleanup");
}

fn keys(value: &serde_json::Value) -> Vec<&str> {
    let mut keys = value
        .as_object()
        .unwrap_or_else(|| panic!("not an object: {value}"))
        .keys()
        .map(String::as_str)
        .collect::<Vec<_>>();
    keys.sort_unstable();
    keys
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
        .env(
            "PALAMEDES_UI_CATALOG_DIR",
            concat!(env!("OUT_DIR"), "/catalogs"),
        )
        .env("PALAMEDES_UI_LOCALE", "en")
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
