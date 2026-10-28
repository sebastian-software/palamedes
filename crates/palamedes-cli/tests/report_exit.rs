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

/// The `--json` document is a public contract: `schemaVersion` leads, and the
/// top level and each locale carry exactly the documented fields.
#[test]
fn report_json_document_has_a_versioned_top_level_shape() {
    let fixture = fixture_dir("json-shape");
    write_project(&fixture);

    let output = pmds(&fixture, &["report", "--json"]);

    assert!(output.status.success(), "{output:?}");
    let stdout = String::from_utf8(output.stdout).expect("UTF-8 stdout");
    assert!(
        stdout.starts_with("{\n  \"schemaVersion\": 1,\n"),
        "{stdout}"
    );
    let json: serde_json::Value = serde_json::from_str(&stdout).expect("report JSON");
    assert_eq!(keys(&json), ["locales", "schemaVersion"]);
    assert_eq!(json["schemaVersion"], 1);
    let locales = json["locales"].as_array().expect("locales array");
    assert_eq!(locales.len(), 1, "{json}");
    assert_eq!(
        keys(&locales[0]),
        [
            "fuzzy",
            "locale",
            "missing",
            "percent",
            "total",
            "translated"
        ]
    );
    assert_eq!(locales[0]["locale"], "de");
    assert_eq!(locales[0]["total"], 2);
    assert_eq!(locales[0]["translated"], 1);
    assert_eq!(locales[0]["missing"], 1);
    assert_eq!(locales[0]["fuzzy"], 0);
    assert_eq!(locales[0]["percent"], 50.0);

    fs::remove_dir_all(fixture).expect("cleanup fixture");
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
        "palamedes-cli-report-exit-{name}-{}-{stamp}",
        std::process::id()
    ))
}
