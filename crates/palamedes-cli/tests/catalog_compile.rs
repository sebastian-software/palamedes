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
    let report = versioned_json(&result);
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

/// Parses a `--json` document after checking that `schemaVersion` leads it.
fn versioned_json(output: &Output) -> serde_json::Value {
    assert!(
        output.stdout.starts_with(b"{\n  \"schemaVersion\": 1,\n"),
        "schemaVersion is not the first field: {output:?}"
    );
    serde_json::from_slice(&output.stdout).unwrap_or_else(|error| panic!("{error}: {output:?}"))
}

fn compile_rust(catalog_dir: &Path, output: &Path, extra: &[&str]) -> Output {
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
        .arg(catalog_dir)
        .args(["--locale", "de", "--output"])
        .arg(output)
        .args(extra)
        .output()
        .unwrap()
}

/// Parses a failed Rust-target `--json` run and returns its one diagnostic,
/// after checking that nothing was compiled and stderr kept the plain text.
fn rust_failure(output: &Output) -> serde_json::Value {
    assert_eq!(output.status.code(), Some(1), "{output:?}");
    let report = versioned_json(output);
    assert_eq!(report["catalogs"], serde_json::json!([]), "{report}");
    assert_eq!(report["missing"], serde_json::json!([]), "{report}");
    let diagnostics = report["diagnostics"].as_array().unwrap();
    assert_eq!(diagnostics.len(), 1, "{report}");
    let diagnostic = diagnostics[0].clone();
    assert_eq!(diagnostic["severity"], "error");
    assert!(diagnostic.get("requestedLocale").is_none(), "{diagnostic}");
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains(&format!(
            "Could not compile Rust language catalogs: {}",
            diagnostic["message"].as_str().unwrap()
        )),
        "{stderr}"
    );
    diagnostic
}

#[test]
fn rust_target_reports_contract_mismatches_as_json_diagnostics() {
    let directory = tempfile::tempdir().unwrap();
    let po = directory.path().join("po");
    fs::create_dir(&po).unwrap();
    let english =
        fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/locales/en.po")).unwrap();
    fs::write(
        po.join("en.po"),
        format!("{english}\nmsgid \"A new source message\"\nmsgstr \"A new source message\"\n"),
    )
    .unwrap();
    fs::copy(
        concat!(env!("CARGO_MANIFEST_DIR"), "/locales/de.po"),
        po.join("de.po"),
    )
    .unwrap();
    let out = directory.path().join("out");

    let output = compile_rust(&po, &out, &["--json"]);
    let diagnostic = rust_failure(&output);
    assert_eq!(diagnostic["code"], "compile.contract_mismatch");
    assert!(
        diagnostic["message"]
            .as_str()
            .unwrap()
            .contains("changes the application message contract"),
        "{diagnostic}"
    );
    assert!(diagnostic.get("catalogPath").is_none(), "{diagnostic}");
    assert!(diagnostic.get("locale").is_none(), "{diagnostic}");
    assert!(!out.join("de.pmd.json").exists());

    // Without --json the failure stays plain text with the same exit code.
    let plain = compile_rust(&po, &out, &[]);
    assert_eq!(plain.status.code(), Some(1), "{plain:?}");
    assert!(plain.stdout.is_empty(), "{plain:?}");
    assert!(
        String::from_utf8_lossy(&plain.stderr).contains(
            "Could not compile Rust language catalogs: catalog update changes the application message contract"
        ),
        "{plain:?}"
    );
}

#[test]
fn rust_target_reports_missing_translations_with_locale_catalog_and_source() {
    let directory = tempfile::tempdir().unwrap();
    let po = directory.path().join("po");
    fs::create_dir(&po).unwrap();
    fs::copy(
        concat!(env!("CARGO_MANIFEST_DIR"), "/locales/en.po"),
        po.join("en.po"),
    )
    .unwrap();
    fs::write(po.join("de.po"), "").unwrap();

    let output = compile_rust(
        &po,
        &directory.path().join("out"),
        &["--fail-on-missing", "--json"],
    );
    let diagnostic = rust_failure(&output);
    assert_eq!(diagnostic["code"], "compile.missing_translation");
    assert_eq!(diagnostic["locale"], "de");
    assert!(
        diagnostic["sourceKey"]["message"].is_string(),
        "{diagnostic}"
    );
    assert!(diagnostic["sourceKey"].get("context").is_none());
    assert_eq!(
        fs::canonicalize(diagnostic["catalogPath"].as_str().unwrap()).unwrap(),
        fs::canonicalize(po.join("de.po")).unwrap()
    );
}

#[test]
fn rust_target_reports_unreadable_catalogs_with_their_path() {
    let directory = tempfile::tempdir().unwrap();
    let po = directory.path().join("po");
    fs::create_dir(&po).unwrap();
    fs::copy(
        concat!(env!("CARGO_MANIFEST_DIR"), "/locales/en.po"),
        po.join("en.po"),
    )
    .unwrap();

    let output = compile_rust(&po, &directory.path().join("out"), &["--json"]);
    let diagnostic = rust_failure(&output);
    assert_eq!(diagnostic["code"], "compile.io_error");
    assert!(
        diagnostic["catalogPath"]
            .as_str()
            .unwrap()
            .ends_with("de.po"),
        "{diagnostic}"
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

/// Checks that a reported `catalogPath` names `catalog` in `project` and
/// returns it as printed.
///
/// The CLI joins the configured pattern onto its config root, which comes from
/// the working directory. That root is spelled differently per platform (an
/// 8.3 short name on Windows, `/private/var` on macOS), so the comparison goes
/// through the file system instead of predicting the spelling.
fn reported_catalog_path(reported: &serde_json::Value, project: &Path, catalog: &str) -> String {
    let reported = reported
        .as_str()
        .unwrap_or_else(|| panic!("catalog path is not a string: {reported}"));
    assert_eq!(
        fs::canonicalize(reported).unwrap(),
        fs::canonicalize(project.join(catalog)).unwrap(),
        "{reported} does not name {catalog}"
    );
    reported.to_owned()
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
    let output = compile_js(project.path(), &["--locale", "de", "--json"]);
    assert_eq!(output.status.code(), Some(1), "{output:?}");
    let report = versioned_json(&output);
    assert_eq!(report["catalogs"], serde_json::json!([]), "{report}");
    let diagnostics = report["diagnostics"].as_array().unwrap();
    assert_eq!(diagnostics.len(), 1, "{report}");
    let diagnostic = &diagnostics[0];
    assert_eq!(diagnostic["severity"], "error");
    assert_eq!(diagnostic["code"], "compile.invalid_icu_message");
    let english = reported_catalog_path(
        &diagnostic["catalogPath"],
        project.path(),
        "locales/app/en.po",
    );
    assert_eq!(diagnostic["locale"], "en");
    assert_eq!(diagnostic["requestedLocale"], "de");
    assert_eq!(diagnostic["sourceKey"]["message"], "Hello {name}");
    assert!(
        diagnostic["message"].as_str().unwrap().contains("ICU"),
        "{report}"
    );

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
    let output = compile_js(project.path(), &["--locale", "de", "--json"]);
    assert_eq!(output.status.code(), Some(1), "{output:?}");
    let report: serde_json::Value = serde_json::from_slice(&output.stdout)
        .unwrap_or_else(|error| panic!("{error}: {output:?}"));
    let diagnostic = &report["diagnostics"][0];
    assert_eq!(diagnostic["code"], "compile.conflicting_message");
    let second = reported_catalog_path(
        &diagnostic["catalogPath"],
        project.path(),
        "locales/second/de.po",
    );
    let first = reported_catalog_path(
        &diagnostic["conflictingCatalogPath"],
        project.path(),
        "locales/first/de.po",
    );
    assert_eq!(diagnostic["locale"], "de");
    assert_eq!(diagnostic["sourceKey"]["message"], "Save");

    let output = compile_js(project.path(), &["--locale", "de"]);
    assert_eq!(output.status.code(), Some(1), "{output:?}");
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains(&format!("{second}: ")), "{stderr}");
    assert!(stderr.contains(&format!("than in {first};")), "{stderr}");
    assert!(stderr.contains("[compile.conflicting_message]"), "{stderr}");
    assert!(stderr.contains("\nSource: Save"), "{stderr}");
    assert!(!project.path().join("out/de.mjs").exists());
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
    let report: serde_json::Value = serde_json::from_slice(&strict.stdout)
        .unwrap_or_else(|error| panic!("{error}: {strict:?}"));
    let diagnostics = report["diagnostics"].as_array().unwrap();
    assert_eq!(diagnostics.len(), 1, "{report}");
    assert_eq!(diagnostics[0]["code"], "compile.missing_translation");
    assert_eq!(diagnostics[0]["locale"], "de");
    assert_eq!(diagnostics[0]["sourceKey"]["message"], "Fuzzy one");
    assert!(
        diagnostics[0]["message"]
            .as_str()
            .unwrap()
            .starts_with("Missing or fuzzy translation;"),
        "{report}"
    );
}

#[test]
fn js_target_judges_missing_translations_on_the_merged_module() {
    let project = js_project(
        &["en", "de"],
        &[
            (
                "first",
                &[
                    ("en", &[("Save", "Save"), ("Open", "Open")]),
                    ("de", &[("Save", ""), ("Open", "")]),
                ],
            ),
            (
                "second",
                &[
                    ("en", &[("Save", "Save")]),
                    ("de", &[("Save", "Speichern")]),
                ],
            ),
        ],
    );
    let output = compile_js(project.path(), &["--locale", "de", "--json"]);
    assert!(output.status.success(), "{output:?}");
    let report: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    // `Save` is translated by the second catalog, so only `Open` is missing.
    assert_eq!(
        report["missing"],
        serde_json::json!([{ "locale": "de", "message": "Open", "resolvedLocale": "en" }]),
        "{report}"
    );

    let output = compile_js(
        project.path(),
        &["--locale", "de", "--fail-on-missing", "--json"],
    );
    assert_eq!(output.status.code(), Some(1), "{output:?}");
    let report: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    let diagnostics = report["diagnostics"].as_array().unwrap();
    assert_eq!(diagnostics.len(), 1, "{report}");
    assert_eq!(diagnostics[0]["code"], "compile.missing_translation");
    assert_eq!(diagnostics[0]["sourceKey"]["message"], "Open");

    fs::write(
        project.path().join("locales/first/de.po"),
        po("de", &[("Save", ""), ("Open", "Öffnen")]),
    )
    .unwrap();
    let output = compile_js(project.path(), &["--locale", "de", "--fail-on-missing"]);
    assert!(output.status.success(), "{output:?}");
    let module = fs::read_to_string(project.path().join("out/de.mjs")).unwrap();
    assert!(module.contains("Speichern"), "{module}");
}

#[test]
fn js_target_reports_message_context_of_missing_translations() {
    let project = js_project(&["en", "de"], &[]);
    let catalogs = project.path().join("locales");
    fs::create_dir_all(&catalogs).unwrap();
    fs::write(
        project.path().join("palamedes.yaml"),
        "locales: [en, de]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}\n    include: [src]\n",
    )
    .unwrap();
    fs::write(
        catalogs.join("en.po"),
        "msgid \"Save\"\nmsgstr \"Save\"\n\nmsgctxt \"menu\"\nmsgid \"Save\"\nmsgstr \"Save\"\n",
    )
    .unwrap();
    fs::write(
        catalogs.join("de.po"),
        "msgid \"Save\"\nmsgstr \"Speichern\"\n\nmsgctxt \"menu\"\nmsgid \"Save\"\nmsgstr \"\"\n",
    )
    .unwrap();

    let output = compile_js(project.path(), &["--locale", "de", "--json"]);
    assert!(output.status.success(), "{output:?}");
    let report: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(
        report["missing"],
        serde_json::json!([{
            "locale": "de",
            "message": "Save",
            "context": "menu",
            "resolvedLocale": "en"
        }]),
        "{report}"
    );

    let output = compile_js(project.path(), &["--locale", "de"]);
    assert!(output.status.success(), "{output:?}");
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(
        stderr.contains("missing translation for \"Save\" (msgctxt \"menu\")"),
        "{stderr}"
    );
}

#[test]
fn js_target_reports_unreadable_catalogs_in_the_json_document() {
    let project = js_project(
        &["en", "de"],
        &[(
            "app",
            &[
                ("en", &[("Save", "Save")]),
                ("de", &[("Save", "Speichern"), ("Save", "Sichern")]),
            ],
        )],
    );
    let output = compile_js(project.path(), &["--locale", "de", "--json"]);
    assert_eq!(output.status.code(), Some(1), "{output:?}");
    let report: serde_json::Value = serde_json::from_slice(&output.stdout)
        .unwrap_or_else(|error| panic!("{error}: {output:?}"));
    let diagnostics = report["diagnostics"].as_array().unwrap();
    assert_eq!(diagnostics.len(), 1, "{report}");
    assert_eq!(diagnostics[0]["code"], "compile.invalid_catalog");
    assert_eq!(diagnostics[0]["locale"], "de");
    reported_catalog_path(
        &diagnostics[0]["catalogPath"],
        project.path(),
        "locales/app/de.po",
    );
    assert!(!project.path().join("out/de.mjs").exists());

    let output = compile_js(project.path(), &["--locale", "de"]);
    assert_eq!(output.status.code(), Some(1), "{output:?}");
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("[compile.invalid_catalog]"), "{stderr}");
}

#[test]
fn js_target_rejects_repeated_locales() {
    let project = js_project(
        &["en", "de"],
        &[(
            "app",
            &[
                ("en", &[("Save", "Save")]),
                ("de", &[("Save", "Speichern")]),
            ],
        )],
    );
    let output = compile_js(project.path(), &["--locale", "de", "--locale", "de"]);
    assert_eq!(output.status.code(), Some(1), "{output:?}");
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("--locale de is given more than once"),
        "{output:?}"
    );
    assert!(!project.path().join("out/de.mjs").exists());
}
