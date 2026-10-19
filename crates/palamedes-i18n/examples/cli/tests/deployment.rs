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
        "Hallo Ada {literal}!\nVorschau für Ada {literal}\n2 Dateien\n"
    );
    for (count, expected) in [("0", "0 Dateien"), ("1", "1 Datei"), ("2", "2 Dateien")] {
        let output = Command::new(&executable)
            .arg(&catalogs)
            .args(["de", "Ada", count])
            .current_dir(directory.path())
            .env("PATH", "")
            .output()
            .unwrap();
        assert!(output.status.success(), "{output:?}");
        assert_eq!(
            String::from_utf8(output.stdout).unwrap().lines().last(),
            Some(expected)
        );
    }
    // Compile real PO changes against the application's exported contract.
    // The application executable is copied once and is never rebuilt here.
    let before = fs::read(&executable).unwrap();
    let po = directory.path().join("locales");
    fs::create_dir(&po).unwrap();
    fs::copy(
        concat!(env!("CARGO_MANIFEST_DIR"), "/locales/en.po"),
        po.join("en.po"),
    )
    .unwrap();
    let german_po =
        fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/locales/de.po")).unwrap();
    fs::write(po.join("de.po"), german_po.replace("Hallo ", "Guten Tag ")).unwrap();
    let contract =
        palamedes_build::CatalogContract::load(concat!(env!("OUT_DIR"), "/schema.pmd.json"))
            .unwrap();
    palamedes_build::CatalogBuilder::new(&po, "en")
        .locales(&["de"])
        .compile_updates(&contract, &catalogs)
        .unwrap();
    assert!(
        String::from_utf8(run("de").stdout)
            .unwrap()
            .starts_with("Guten Tag ")
    );
    let french_po = german_po
        .replace("Hallo ", "Bonjour ")
        .replace("Vorschau für ", "Aperçu pour ")
        .replace("Bereit für ", "Prêt pour ")
        .replace("# Datei}", "# fichier}")
        .replace("# Dateien}", "# fichiers}");
    fs::write(po.join("fr.po"), french_po).unwrap();
    palamedes_build::CatalogBuilder::new(&po, "en")
        .locales(&["fr"])
        .compile_updates(&contract, &catalogs)
        .unwrap();
    let french = run("fr");
    assert!(french.status.success(), "{french:?}");
    let french = String::from_utf8(french.stdout).unwrap();
    assert!(french.starts_with("Bonjour "));
    assert!(french.ends_with("2 fichiers\n"));
    assert_eq!(fs::read(&executable).unwrap(), before);
    assert!(!catalogs.join("en.pmd.json").exists());
    let path = catalogs.join("de.pmd.json");
    let missing = run("en");
    assert!(!missing.status.success());
    assert!(missing.stdout.is_empty());
    fs::write(&path, "{}").unwrap();
    let corrupt = run("de");
    assert!(!corrupt.status.success());
    assert!(corrupt.stdout.is_empty());
    let binary = fs::read(&executable).unwrap();
    for text in [
        "Hello {name}!",
        "Hallo ",
        "¡Hola, ",
        "{count, plural",
        "# Dateien",
        "# archivos",
    ] {
        assert!(
            !binary
                .windows(text.len())
                .any(|window| window == text.as_bytes()),
            "embedded message: {text}"
        );
    }
}
