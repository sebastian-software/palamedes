use std::fs;
use std::process::{Command, Output};

fn pmds(args: &[&str], environment: &[(&str, &str)], cwd: &std::path::Path) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_pmds"));
    command
        .args(args)
        .current_dir(cwd)
        .env("PALAMEDES_UPDATE_CHECK", "0");
    for name in [
        "PALAMEDES_UI_LOCALE",
        "LC_ALL",
        "LC_MESSAGES",
        "LANG",
        "LANGUAGE",
    ] {
        command.env_remove(name);
    }
    for (name, value) in environment {
        command.env(name, value);
    }
    command.output().expect("run localized pmds")
}

#[test]
fn help_and_version_use_the_environment_without_needing_a_project() {
    let directory = tempfile::tempdir().unwrap();
    for (environment, expected) in [
        (
            vec![("LC_ALL", "de_DE.UTF-8"), ("LC_MESSAGES", "es_ES")],
            "Aufruf:",
        ),
        (
            vec![
                ("LC_ALL", ""),
                ("LC_MESSAGES", "es_ES.UTF-8"),
                ("LANG", "de_DE"),
            ],
            "Uso:",
        ),
        (
            vec![("PALAMEDES_UI_LOCALE", "es-MX"), ("LC_ALL", "de_DE")],
            "Uso:",
        ),
        (vec![("LC_ALL", "C.UTF-8"), ("LANG", "de_DE")], "Usage:"),
        (vec![("LC_ALL", "POSIX"), ("LANG", "de_DE")], "Usage:"),
        (vec![("LC_ALL", "fr_FR"), ("LANG", "de_DE")], "Usage:"),
        (vec![("LC_ALL", "de_!"), ("LANG", "es_ES")], "Usage:"),
        (vec![], "Usage:"),
    ] {
        let output = pmds(&["--help"], &environment, directory.path());
        assert!(output.status.success(), "{output:?}");
        assert!(
            String::from_utf8_lossy(&output.stdout).contains(expected),
            "{output:?}"
        );
        assert!(output.stderr.is_empty(), "{output:?}");
    }
    let german = pmds(
        &["help", "catalog", "merge"],
        &[("LANG", "de_DE")],
        directory.path(),
    );
    let help = String::from_utf8_lossy(&german.stdout);
    assert!(german.status.success(), "{german:?}");
    assert!(help.contains("Optionen:"), "{help}");
    assert!(help.contains("--source-locale"), "{help}");
    assert!(help.contains("Quellsprache"), "{help}");
    let version = pmds(&["version"], &[("LANG", "es_ES")], directory.path());
    assert!(version.status.success());
    assert!(String::from_utf8_lossy(&version.stdout).contains("Herramientas de i18n"));
}

#[test]
fn localized_errors_preserve_status_streams_and_argument_values() {
    let directory = tempfile::tempdir().unwrap();
    let missing = directory.path().join("missing-{source}.yaml");
    let output = pmds(
        &["report", "--config", missing.to_str().unwrap()],
        &[("LANG", "de_DE")],
        directory.path(),
    );
    assert_eq!(output.status.code(), Some(1));
    assert!(output.stdout.is_empty());
    let error = String::from_utf8_lossy(&output.stderr);
    assert!(
        error.contains("Fehler: Palamedes-Konfiguration existiert nicht:"),
        "{error}"
    );
    assert!(error.contains("missing-{source}.yaml"), "{error}");
    let syntax = pmds(
        &["report", "--unknown"],
        &[("LANG", "es_ES")],
        directory.path(),
    );
    assert_eq!(syntax.status.code(), Some(2));
    assert!(syntax.stdout.is_empty());
    assert!(
        String::from_utf8_lossy(&syntax.stderr)
            .contains("Argumentos de línea de comandos no válidos.")
    );
}

#[test]
fn catalog_selection_json_and_policy_codes_are_independent_of_ui_language() {
    let directory = tempfile::tempdir().unwrap();
    fs::write(directory.path().join("palamedes.yaml"), "locales: [en, de, es]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}\n    include: [src]\n").unwrap();
    fs::create_dir(directory.path().join("locales")).unwrap();
    fs::write(
        directory.path().join("locales/en.po"),
        "msgid \"Hello\"\nmsgstr \"Hello\"\n",
    )
    .unwrap();
    fs::write(
        directory.path().join("locales/de.po"),
        "msgid \"Hello\"\nmsgstr \"\"\n",
    )
    .unwrap();
    fs::write(
        directory.path().join("locales/es.po"),
        "msgid \"Hello\"\nmsgstr \"Hola\"\n",
    )
    .unwrap();
    let args = [
        "report",
        "--locale",
        "de",
        "--json",
        "--fail-if-below",
        "90",
    ];
    let english = pmds(&args, &[("LANG", "en_US")], directory.path());
    for locale in ["de_DE", "es_ES"] {
        let translated = pmds(&args, &[("LANG", locale)], directory.path());
        assert_eq!(translated.status.code(), Some(6));
        assert_eq!(english.stdout, translated.stdout);
        let document: serde_json::Value = serde_json::from_slice(&translated.stdout).unwrap();
        assert_eq!(document["locales"][0]["locale"], "de");
    }
    let human = pmds(
        &["report", "--locale", "es"],
        &[("LANG", "de_DE")],
        directory.path(),
    );
    assert!(human.status.success());
    let text = String::from_utf8_lossy(&human.stdout);
    assert!(text.contains("Übersetzt"), "{text}");
    assert!(text.contains("es") && text.contains("100%"), "{text}");
}

#[test]
fn installed_binary_needs_neither_node_nor_adjacent_catalog_files() {
    let directory = tempfile::tempdir().unwrap();
    let executable = directory
        .path()
        .join(format!("pmds{}", std::env::consts::EXE_SUFFIX));
    fs::copy(env!("CARGO_BIN_EXE_pmds"), &executable).unwrap();
    let output = Command::new(executable)
        .arg("version")
        .current_dir(directory.path())
        .env("PATH", "")
        .env("PALAMEDES_UI_LOCALE", "de")
        .env("PALAMEDES_UPDATE_CHECK", "0")
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");
    assert!(String::from_utf8_lossy(&output.stdout).contains("Schnelle i18n-Werkzeuge"));
    assert!(output.stderr.is_empty());
}
