use std::fs;
use std::path::Path;
use std::process::{Command, Output};

fn pmds(args: &[&str], cwd: &Path) -> Output {
    Command::new(env!("CARGO_BIN_EXE_pmds"))
        .env(
            "PALAMEDES_UI_CATALOG_DIR",
            concat!(env!("OUT_DIR"), "/catalogs"),
        )
        .env("PALAMEDES_UI_LOCALE", "en")
        .env("PALAMEDES_UPDATE_CHECK", "0")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("run pmds")
}

fn project() -> tempfile::TempDir {
    let directory = tempfile::tempdir().unwrap();
    fs::write(
        directory.path().join("palamedes.yaml"),
        "locales: [en, de]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}\n    include: [src]\n",
    )
    .unwrap();
    fs::create_dir(directory.path().join("src")).unwrap();
    fs::write(
        directory.path().join("src/booking.ts"),
        "import { plural, t } from \"@palamedes/core/macro\";\nexport const f = (id: string, seats: number) => [t`Booking ${id} is confirmed.`, plural(seats, { one: \"# seat\", other: \"# seats\" })];\n",
    )
    .unwrap();
    directory
}

#[test]
fn extract_writes_and_checks_the_runtime_macro_manifest() {
    let directory = project();
    let root = directory.path();

    let extract = pmds(&["extract", "--runtime-manifest", "gen/macros.json"], root);
    assert!(extract.status.success(), "{extract:?}");
    let manifest: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(root.join("gen/macros.json")).unwrap()).unwrap();
    assert_eq!(manifest["version"], 1);
    assert_eq!(
        manifest["templates"][0]["strings"],
        serde_json::json!(["Booking ", " is confirmed."])
    );
    assert_eq!(
        manifest["templates"][0]["values"],
        serde_json::json!(["id"])
    );
    assert_eq!(manifest["choices"][0]["value"], "seats");

    let clean = pmds(
        &[
            "extract",
            "--check",
            "--runtime-manifest",
            "gen/macros.json",
        ],
        root,
    );
    assert!(clean.status.success(), "{clean:?}");

    fs::write(root.join("gen/macros.json"), "{}\n").unwrap();
    let stale = pmds(
        &[
            "extract",
            "--check",
            "--runtime-manifest",
            "gen/macros.json",
        ],
        root,
    );
    assert!(!stale.status.success(), "{stale:?}");
    assert!(
        String::from_utf8_lossy(&stale.stderr)
            .contains("runtime macro manifest gen/macros.json is out of date"),
        "{stale:?}"
    );
    assert_eq!(
        fs::read_to_string(root.join("gen/macros.json")).unwrap(),
        "{}\n"
    );
}

#[test]
fn catalog_compile_writes_parser_free_javascript_modules() {
    let directory = project();
    let root = directory.path();
    assert!(pmds(&["extract"], root).status.success());

    let compile = pmds(
        &[
            "catalog",
            "compile",
            "--target",
            "js",
            "--output",
            "gen/catalogs",
            "--json",
        ],
        root,
    );
    assert!(compile.status.success(), "{compile:?}");
    let result: serde_json::Value = serde_json::from_slice(&compile.stdout).unwrap();
    assert_eq!(result["catalogs"].as_array().unwrap().len(), 2);
    assert_eq!(result["missing"].as_array().unwrap().len(), 2);
    let german = fs::read_to_string(root.join("gen/catalogs/de.mjs")).unwrap();
    assert!(
        german.starts_with("import{defineCompiledCatalog as __palamedesDefineCompiledCatalog}from\"@palamedes/core/compiled\";"),
        "{german}"
    );
    assert!(german.contains("export const messages="), "{german}");

    let strict = pmds(
        &[
            "catalog",
            "compile",
            "--target",
            "js",
            "--output",
            "gen/strict",
            "--locale",
            "de",
            "--fail-on-missing",
        ],
        root,
    );
    assert_eq!(strict.status.code(), Some(1), "{strict:?}");
    assert!(
        String::from_utf8_lossy(&strict.stderr)
            .contains("Could not compile JavaScript catalog modules"),
        "{strict:?}"
    );
}

#[test]
fn rust_target_still_requires_its_contract_inputs() {
    let directory = project();
    let output = pmds(
        &["catalog", "compile", "--target", "rust", "--output", "out"],
        directory.path(),
    );

    assert_eq!(output.status.code(), Some(2), "{output:?}");
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("--schema"),
        "{output:?}"
    );
}
