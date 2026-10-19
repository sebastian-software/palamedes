use std::fs;
use std::process::Command;

#[test]
fn real_rust_compilation_resolves_literal_values_and_checks_calls() {
    let directory = tempfile::tempdir().unwrap();
    let runtime = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    fs::create_dir(directory.path().join("src")).unwrap();
    fs::write(directory.path().join("Cargo.toml"), format!(
        "[package]\nname = \"translation-call-contract\"\nversion = \"0.0.0\"\nedition = \"2024\"\n[workspace]\n[dependencies]\npalamedes-i18n = {{ path = {:?} }}\n", runtime.to_str().unwrap()
    )).unwrap();
    let generated = fs::read_to_string(concat!(env!("OUT_DIR"), "/messages.rs")).unwrap();
    for (call, expected_error) in [
        (
            r#"translate!(catalog, r"Hello {name}!", name = "Ada")"#,
            None,
        ),
        (
            r#"translate!(catalog, "Hello \u{7b}name\u{7d}!", name = "Ada")"#,
            None,
        ),
        (
            r#"translate!(catalog, "{count, plural, one {# file} other {# files}}", count = 2_usize)"#,
            None,
        ),
        (
            r#"translate!(catalog, "{count, plural, one {# file} other {# files}}", count = &2_usize)"#,
            None,
        ),
        (
            r#"translate!(catalog, "{count, plural, one {# file} other {# files}}", count = "1.0".parse::<palamedes_i18n::PluralNumber>().unwrap())"#,
            None,
        ),
        (
            r#"translate!(catalog, "{count, plural, one {# file} other {# files}}", count = "drei")"#,
            Some("MacroArgument<true>"),
        ),
        (
            r#"translate!(catalog, "{count, plural, one {# file} other {# files}}", count = String::from("3"))"#,
            Some("MacroArgument<true>"),
        ),
        (
            r#"translate!(catalog, "{count, plural, one {# file} other {# files}}", count = true)"#,
            Some("MacroArgument<true>"),
        ),
        (
            r#"translate!(catalog, "{count, plural, one {# file} other {# files}}")"#,
            Some("translation argument count mismatch"),
        ),
        (
            r#"translate!(catalog, "Unknown source")"#,
            Some("source message is absent"),
        ),
        (
            r#"translate!(catalog, "Hello {name}!")"#,
            Some("translation argument count mismatch"),
        ),
        (
            r#"translate!(catalog, "Hello {name}!", wrong = "Ada")"#,
            Some("unknown translation argument"),
        ),
        (
            r#"translate!(catalog, "Hello {name}!", name = "Ada", name = "Grace")"#,
            Some("translation argument count mismatch"),
        ),
        (
            r#"translate!(catalog, "{mode, select, preview {Preview for {name}} other {Ready for {name}}}", name = "Ada", name = "Grace")"#,
            Some("duplicate translation argument"),
        ),
    ] {
        fs::write(directory.path().join("src/lib.rs"), format!("{generated}\npub fn check(catalog: &palamedes_i18n::Catalog) {{ let _ = {call}; }}\n")).unwrap();
        let output = Command::new(env!("CARGO"))
            .args(["check", "--offline", "--quiet"])
            .current_dir(directory.path())
            .env("CARGO_TARGET_DIR", directory.path().join("target"))
            .env("CARGO_BUILD_BUILD_DIR", directory.path().join("build"))
            .env(
                "RUSTC",
                std::path::Path::new(env!("CARGO")).with_file_name("rustc"),
            )
            .output()
            .unwrap();
        let stderr = String::from_utf8_lossy(&output.stderr);
        match expected_error {
            None => assert!(output.status.success(), "{call}: {stderr}"),
            Some(expected) => {
                assert!(!output.status.success(), "accepted {call}");
                assert!(stderr.contains(expected), "{call}: {stderr}");
            }
        }
    }
}
