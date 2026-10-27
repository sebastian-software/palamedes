use std::fs;
use std::path::Path;
use std::process::{Command, Output};

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

type Entries<'a> = &'a [(&'a str, &'a str)];
type CatalogFiles<'a> = &'a [(&'a str, Entries<'a>)];

fn po(locale: &str, entries: Entries<'_>) -> String {
    let mut catalog = format!(
        "msgid \"\"\nmsgstr \"\"\n\"Language: {locale}\\n\"\n\"Content-Type: text/plain; charset=UTF-8\\n\"\n"
    );
    for (id, translation) in entries {
        catalog.push_str(&format!("\nmsgid \"{id}\"\nmsgstr \"{translation}\"\n"));
    }
    catalog
}

/// A data-config project whose catalogs live at `locales/<name>/{locale}.po`.
fn js_project(locales: &[&str], catalogs: &[(&str, CatalogFiles<'_>)]) -> tempfile::TempDir {
    let directory = tempfile::tempdir().unwrap();
    let mut config = format!(
        "locales: [{}]\nsource-locale: en\ncatalogs:\n",
        locales.join(", ")
    );
    fs::create_dir(directory.path().join("src")).unwrap();
    for (name, files) in catalogs {
        config.push_str(&format!(
            "  - path: locales/{name}/{{locale}}\n    include: [src]\n"
        ));
        let catalog_dir = directory.path().join("locales").join(name);
        fs::create_dir_all(&catalog_dir).unwrap();
        for (locale, entries) in *files {
            fs::write(
                catalog_dir.join(format!("{locale}.po")),
                po(locale, entries),
            )
            .unwrap();
        }
    }
    fs::write(directory.path().join("palamedes.yaml"), config).unwrap();
    directory
}

fn compile_js(project: &Path, extra: &[&str]) -> Output {
    compiler()
        .current_dir(project)
        .args(["catalog", "compile", "--target", "js", "--output", "out"])
        .args(extra)
        .output()
        .unwrap()
}

/// The catalog path as the CLI reports it, from the canonical config root.
fn catalog_path(project: &Path, catalog: &str) -> String {
    fs::canonicalize(project)
        .unwrap()
        .join(catalog)
        .to_string_lossy()
        .into_owned()
}

#[test]
fn js_icu_diagnostics_name_the_catalog_locale_and_source_that_failed() {
    let project = js_project(
        &["en", "de"],
        &[(
            "app",
            &[
                ("en", &[("Hello {name}", "Hello {name"), ("Bye", "Bye")]),
                ("de", &[("Hello {name}", ""), ("Bye", "Tschüss")]),
            ],
        )],
    );
    let english = catalog_path(project.path(), "locales/app/en.po");
    // The broken message lives in en.po; compiling `de` reaches it through the
    // source-locale fallback and must not blame de.po for it.
    for locale in ["de", "en"] {
        let output = compile_js(project.path(), &["--locale", locale]);
        assert_eq!(output.status.code(), Some(1), "{output:?}");
        let stderr = String::from_utf8(output.stderr).unwrap();
        assert!(
            stderr.contains(&format!("{english}: ")),
            "{locale}: {stderr}"
        );
        assert!(stderr.contains("[compile.invalid_icu_message]"), "{stderr}");
        assert!(stderr.contains("\nLocale: en"), "{locale}: {stderr}");
        assert!(stderr.contains("\nSource: Hello {name}"), "{stderr}");
        assert!(!stderr.contains("de.po"), "{locale}: {stderr}");
        assert!(
            !project
                .path()
                .join("out")
                .join(format!("{locale}.mjs"))
                .exists()
        );
    }

    let output = compile_js(project.path(), &["--locale", "de", "--json"]);
    assert_eq!(output.status.code(), Some(1), "{output:?}");
    let report: serde_json::Value = serde_json::from_slice(&output.stdout)
        .unwrap_or_else(|error| panic!("{error}: {output:?}"));
    assert_eq!(report["catalogs"], serde_json::json!([]), "{report}");
    let diagnostics = report["diagnostics"].as_array().unwrap();
    assert_eq!(diagnostics.len(), 1, "{report}");
    let diagnostic = &diagnostics[0];
    assert_eq!(diagnostic["severity"], "error");
    assert_eq!(diagnostic["code"], "compile.invalid_icu_message");
    assert_eq!(diagnostic["catalogPath"], english);
    assert_eq!(diagnostic["locale"], "en");
    assert_eq!(diagnostic["requestedLocale"], "de");
    assert_eq!(diagnostic["sourceKey"]["message"], "Hello {name}");
    assert!(
        diagnostic["message"].as_str().unwrap().contains("ICU"),
        "{report}"
    );
}

#[test]
fn js_target_applies_cli_fallback_locales() {
    let project = js_project(
        &["en", "de", "de-AT"],
        &[(
            "app",
            &[
                ("en", &[("Save", "Save")]),
                ("de", &[("Save", "Speichern")]),
                ("de-AT", &[("Save", "")]),
            ],
        )],
    );
    let output = compile_js(project.path(), &["--locale", "de-AT"]);
    assert!(output.status.success(), "{output:?}");
    let module = fs::read_to_string(project.path().join("out/de-AT.mjs")).unwrap();
    assert!(module.contains("\"Save\""), "{module}");

    let output = compile_js(
        project.path(),
        &["--locale", "de-AT", "--fallback-locale", "de", "--json"],
    );
    assert!(output.status.success(), "{output:?}");
    let report: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["missing"][0]["resolvedLocale"], "de", "{report}");
    let module = fs::read_to_string(project.path().join("out/de-AT.mjs")).unwrap();
    assert!(module.contains("Speichern"), "{module}");

    let output = compile_js(project.path(), &["--fallback-locale", "fr"]);
    assert_eq!(output.status.code(), Some(1), "{output:?}");
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("--fallback-locale fr"),
        "{output:?}"
    );
}

#[test]
fn js_target_rejects_conflicting_messages_across_catalogs() {
    let project = js_project(
        &["en", "de"],
        &[
            (
                "first",
                &[
                    ("en", &[("Save", "Save")]),
                    ("de", &[("Save", "Speichern")]),
                ],
            ),
            (
                "second",
                &[("en", &[("Save", "Save")]), ("de", &[("Save", "Sichern")])],
            ),
        ],
    );
    let first = catalog_path(project.path(), "locales/first/de.po");
    let second = catalog_path(project.path(), "locales/second/de.po");
    let output = compile_js(project.path(), &["--locale", "de"]);
    assert_eq!(output.status.code(), Some(1), "{output:?}");
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains(&first), "{stderr}");
    assert!(stderr.contains(&second), "{stderr}");
    assert!(stderr.contains("[compile.conflicting_message]"), "{stderr}");
    assert!(stderr.contains("\nSource: Save"), "{stderr}");
    assert!(!project.path().join("out/de.mjs").exists());

    let output = compile_js(project.path(), &["--locale", "de", "--json"]);
    assert_eq!(output.status.code(), Some(1), "{output:?}");
    let report: serde_json::Value = serde_json::from_slice(&output.stdout)
        .unwrap_or_else(|error| panic!("{error}: {output:?}"));
    let diagnostic = &report["diagnostics"][0];
    assert_eq!(diagnostic["code"], "compile.conflicting_message");
    assert_eq!(diagnostic["catalogPath"], second);
    assert_eq!(diagnostic["conflictingCatalogPath"], first);
    assert_eq!(diagnostic["locale"], "de");
    assert_eq!(diagnostic["sourceKey"]["message"], "Save");
}

#[test]
fn js_target_accepts_shared_messages_that_compile_identically() {
    let project = js_project(
        &["en", "de"],
        &[
            (
                "first",
                &[
                    ("en", &[("Save", "Save"), ("Open", "Open")]),
                    ("de", &[("Save", "Speichern"), ("Open", "Öffnen")]),
                ],
            ),
            (
                "second",
                &[
                    ("en", &[("Save", "Save"), ("Open", "Open")]),
                    // An untranslated copy yields to the translation instead
                    // of replacing it with the source fallback.
                    ("de", &[("Save", "Speichern"), ("Open", "")]),
                ],
            ),
        ],
    );
    let output = compile_js(project.path(), &["--locale", "de"]);
    assert!(output.status.success(), "{output:?}");
    let module = fs::read_to_string(project.path().join("out/de.mjs")).unwrap();
    assert!(module.contains("Speichern"), "{module}");
    assert!(module.contains("Öffnen"), "{module}");
    assert!(!module.contains("\"Open\""), "{module}");
}
