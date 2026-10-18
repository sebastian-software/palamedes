use std::fs;
use std::process::Command;

#[test]
fn copied_application_loads_replaceable_external_data_and_has_no_language_fallback() {
    let directory = tempfile::tempdir().unwrap();
    let executable = directory
        .path()
        .join(format!("greeting{}", std::env::consts::EXE_SUFFIX));
    fs::copy(
        env!("CARGO_BIN_EXE_palamedes-example-rust-cli"),
        &executable,
    )
    .unwrap();
    let catalogs = directory.path().join("translations");
    fs::create_dir(&catalogs).unwrap();
    fs::copy(
        concat!(env!("OUT_DIR"), "/catalogs/de.pmd.json"),
        catalogs.join("de.pmd.json"),
    )
    .unwrap();
    let run = |locale: &str| {
        Command::new(&executable)
            .arg(&catalogs)
            .arg(locale)
            .arg("Ada {literal}")
            .current_dir(directory.path())
            .env("PATH", "")
            .output()
            .unwrap()
    };
    let german = run("de");
    assert!(german.status.success(), "{german:?}");
    assert_eq!(
        String::from_utf8(german.stdout).unwrap(),
        "Hallo Ada {literal}!\nVorschau für Ada {literal}\n"
    );
    // Translators can update a compatible language without rebuilding Rust.
    let path = catalogs.join("de.pmd.json");
    let data = fs::read_to_string(&path)
        .unwrap()
        .replace("Hallo ", "Guten Tag ");
    fs::write(&path, data).unwrap();
    assert!(
        String::from_utf8(run("de").stdout)
            .unwrap()
            .starts_with("Guten Tag ")
    );
    // A compatible new locale is also a data-only installation.
    let french = fs::read_to_string(&path)
        .unwrap()
        .replace("\"locale\":\"de\"", "\"locale\":\"fr\"")
        .replace("Guten Tag ", "Bonjour ");
    fs::write(catalogs.join("fr.pmd.json"), french).unwrap();
    let french = run("fr");
    assert!(french.status.success(), "{french:?}");
    assert!(
        String::from_utf8(french.stdout)
            .unwrap()
            .starts_with("Bonjour ")
    );
    let missing = run("en");
    assert!(!missing.status.success());
    assert!(missing.stdout.is_empty());
    fs::write(&path, "{}").unwrap();
    let corrupt = run("de");
    assert!(!corrupt.status.success());
    assert!(corrupt.stdout.is_empty());
    let binary = fs::read(&executable).unwrap();
    for text in ["Hello {name}!", "Hallo ", "¡Hola, "] {
        assert!(
            !binary
                .windows(text.len())
                .any(|window| window == text.as_bytes()),
            "embedded message: {text}"
        );
    }
}
