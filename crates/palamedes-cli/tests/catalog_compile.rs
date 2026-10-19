use std::fs;
use std::process::Command;

fn compiler() -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_pmds"));
    command
        .env(
            "PALAMEDES_UI_CATALOG_DIR",
            concat!(env!("OUT_DIR"), "/catalogs"),
        )
        .env("PALAMEDES_UI_LOCALE", "en")
        .env("PALAMEDES_UPDATE_CHECK", "0");
    command
}

#[test]
fn real_po_updates_run_in_a_copied_binary_and_changed_contracts_preserve_old_data() {
    let directory = tempfile::tempdir().unwrap();
    let po = directory.path().join("locales");
    fs::create_dir(&po).unwrap();
    fs::copy(
        concat!(env!("CARGO_MANIFEST_DIR"), "/locales/en.po"),
        po.join("en.po"),
    )
    .unwrap();
    let german = fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/locales/de.po")).unwrap();
    fs::write(
        po.join("de.po"),
        german.replace("Schnelle i18n-Werkzeuge", "Aktualisierte i18n-Werkzeuge"),
    )
    .unwrap();
    let executable = directory
        .path()
        .join(format!("pmds{}", std::env::consts::EXE_SUFFIX));
    fs::copy(env!("CARGO_BIN_EXE_pmds"), &executable).unwrap();
    let before = fs::read(&executable).unwrap();
    let output = directory.path().join("pmds-locales");
    let compile = || {
        compiler()
            .args([
                "catalog",
                "compile",
                "--target",
                "rust",
                "--schema",
                concat!(env!("OUT_DIR"), "/schema.pmd.json"),
                "--catalog-dir",
            ])
            .arg(&po)
            .args(["--locale", "de", "--output"])
            .arg(&output)
            .arg("--json")
            .output()
            .unwrap()
    };
    let result = compile();
    assert!(result.status.success(), "{result:?}");
    let report: serde_json::Value = serde_json::from_slice(&result.stdout).unwrap();
    assert_eq!(report["catalogs"].as_array().unwrap().len(), 1);
    assert!(report["missing"].as_array().unwrap().is_empty());
    let result = Command::new(&executable)
        .arg("version")
        .env("PATH", "")
        .env_remove("PALAMEDES_UI_CATALOG_DIR")
        .env("PALAMEDES_UI_LOCALE", "de")
        .env("PALAMEDES_UPDATE_CHECK", "0")
        .current_dir(directory.path())
        .output()
        .unwrap();
    assert!(result.status.success(), "{result:?}");
    assert!(String::from_utf8_lossy(&result.stdout).contains("Aktualisierte i18n-Werkzeuge"));
    assert_eq!(fs::read(&executable).unwrap(), before);
    assert!(!output.join("en.pmd.json").exists());
    let data = fs::read(output.join("de.pmd.json")).unwrap();
    fs::write(
        po.join("en.po"),
        format!(
            "{}\nmsgid \"A new source message\"\nmsgstr \"A new source message\"\n",
            fs::read_to_string(po.join("en.po")).unwrap()
        ),
    )
    .unwrap();
    let rejected = compile();
    assert_eq!(rejected.status.code(), Some(1));
    assert!(
        String::from_utf8_lossy(&rejected.stderr)
            .contains("changes the application message contract")
    );
    assert_eq!(fs::read(output.join("de.pmd.json")).unwrap(), data);
}
