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

#[test]
fn cli_uses_real_plural_translations_for_compilation_summaries() {
    let output = tempfile::tempdir().unwrap();
    for (ui, singular, plural) in [
        (
            "en",
            "Compiled 1 Rust language catalog.",
            "Compiled 2 Rust language catalogs.",
        ),
        (
            "de",
            "1 Rust-Sprachkatalog kompiliert.",
            "2 Rust-Sprachkataloge kompiliert.",
        ),
        (
            "es",
            "Se compiló 1 catálogo de idiomas para Rust.",
            "Se compilaron 2 catálogos de idiomas para Rust.",
        ),
        (
            "fr",
            "1 catalogue de langue Rust compilé.",
            "2 catalogues de langue Rust compilés.",
        ),
    ] {
        for (locales, expected) in [(&["en"][..], singular), (&["en", "de"][..], plural)] {
            let mut command = compiler();
            command
                .env("PALAMEDES_UI_LOCALE", ui)
                .args([
                    "catalog",
                    "compile",
                    "--target",
                    "rust",
                    "--schema",
                    concat!(env!("OUT_DIR"), "/schema.pmd.json"),
                    "--catalog-dir",
                    concat!(env!("CARGO_MANIFEST_DIR"), "/locales"),
                    "--output",
                ])
                .arg(output.path());
            for locale in locales {
                command.args(["--locale", locale]);
            }
            let result = command.output().unwrap();
            assert!(result.status.success(), "{result:?}");
            assert_eq!(String::from_utf8(result.stdout).unwrap().trim(), expected);
        }
    }
}

#[test]
fn fallback_diagnostics_quote_source_messages_and_leave_json_raw() {
    let directory = tempfile::tempdir().unwrap();
    let po = directory.path().join("po");
    fs::create_dir(&po).unwrap();
    fs::copy(
        concat!(env!("CARGO_MANIFEST_DIR"), "/locales/en.po"),
        po.join("en.po"),
    )
    .unwrap();
    fs::write(po.join("de.po"), "").unwrap();
    let compile = |json: bool| {
        let mut command = compiler();
        command
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
            .arg(directory.path().join("out"));
        if json {
            command.arg("--json");
        }
        command.output().unwrap()
    };
    let output = compile(false);
    assert!(output.status.success(), "{output:?}");
    let warning = String::from_utf8(output.stderr).unwrap();
    assert!(warning.contains("missing translation for \"Invalid command-line arguments.\"; compiled fallback from en."), "{warning}");
    // Human-readable warnings use the same quoted Debug format as build.rs.
    assert!(
        warning
            .lines()
            .all(|line| line.contains("missing translation for \"")
                && line.ends_with("\"; compiled fallback from en.")),
        "{warning}"
    );
    let json = compile(true);
    assert!(json.status.success());
    assert!(json.stderr.is_empty());
    let report: serde_json::Value = serde_json::from_slice(&json.stdout).unwrap();
    assert!(
        report["missing"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["message"] == "Invalid command-line arguments.")
    );
}

#[test]
fn javascript_target_compiles_fuzzy_entries_as_missing_fallbacks() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    fs::write(
        root.join("palamedes.yaml"),
        "locales: [en, de]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}\n    include: [src]\n",
    )
    .unwrap();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::create_dir_all(root.join("locales")).unwrap();
    fs::write(
        root.join("locales/en.po"),
        "msgid \"\"\nmsgstr \"\"\n\"Language: en\\n\"\n\nmsgid \"Fuzzy one\"\nmsgstr \"\"\n",
    )
    .unwrap();
    fs::write(
        root.join("locales/de.po"),
        "msgid \"\"\nmsgstr \"\"\n\"Language: de\\n\"\n\n#, fuzzy\nmsgid \"Fuzzy one\"\nmsgstr \"Unscharf\"\n",
    )
    .unwrap();
    let compile = |strict: bool| {
        let mut command = compiler();
        command
            .current_dir(root)
            .args(["catalog", "compile", "--target", "js", "--locale", "de"])
            .args(["--output", "out", "--json"]);
        if strict {
            command.arg("--fail-on-missing");
        }
        command.output().unwrap()
    };

    let output = compile(false);
    assert!(output.status.success(), "{output:?}");
    let report: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(
        report["missing"],
        serde_json::json!([
            { "locale": "de", "message": "Fuzzy one", "resolvedLocale": "en" }
        ])
    );
    let module = fs::read_to_string(root.join("out/de.mjs")).unwrap();
    assert!(module.contains("\"Fuzzy one\""), "{module}");
    assert!(!module.contains("Unscharf"), "{module}");

    let strict = compile(true);
    assert_eq!(strict.status.code(), Some(1), "{strict:?}");
    assert!(
        String::from_utf8_lossy(&strict.stderr).contains("\"Fuzzy one\""),
        "{strict:?}"
    );
}
