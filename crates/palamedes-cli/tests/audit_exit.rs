use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn audit_info_threshold_fails_on_fuzzy_markers_without_changing_the_default() {
    let fixture = fixture_dir("audit-info-threshold");
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
    fs::write(
        fixture.join("locales/en/messages.po"),
        "msgid \"Save\"\nmsgstr \"Save\"\n",
    )
    .expect("write source catalog");
    fs::write(
        fixture.join("locales/de/messages.po"),
        "#, fuzzy\nmsgid \"Save\"\nmsgstr \"Speichern\"\n",
    )
    .expect("write target catalog");

    let default = audit(&fixture, &[]);
    assert!(default.status.success(), "{default:?}");

    let fail_on_info = audit(&fixture, &["--fail-on", "info"]);
    assert_eq!(fail_on_info.status.code(), Some(1), "{fail_on_info:?}");
    assert!(
        String::from_utf8_lossy(&fail_on_info.stdout).contains("1 info"),
        "{fail_on_info:?}"
    );
    assert!(
        String::from_utf8_lossy(&fail_on_info.stderr)
            .contains("Catalog audit failed with 0 error(s), 0 warning(s), and 1 info"),
        "{fail_on_info:?}"
    );

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
