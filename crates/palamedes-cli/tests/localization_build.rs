#[allow(dead_code)]
#[path = "../build_support/cli_catalogs.rs"]
mod cli_catalogs;

fn catalogs(translation: &str) -> tempfile::TempDir {
    let directory = tempfile::tempdir().unwrap();
    for (locale, value) in [
        ("en", "It's {name}"),
        ("de", translation),
        ("es", "Es {name}"),
    ] {
        std::fs::write(
            directory.path().join(format!("{locale}.po")),
            format!("msgid \"It's {{name}}\"\nmsgstr {value:?}\n"),
        )
        .unwrap();
    }
    directory
}

#[test]
fn canonical_compilation_handles_natural_apostrophes_and_rejects_broken_translations() {
    let valid = catalogs("Es ist {name}");
    cli_catalogs::render_catalogs(valid.path()).expect("canonical apostrophe handling");
    for translation in ["Broken {", "Es ist {wrong}", "{name, number}", ""] {
        let invalid = catalogs(translation);
        assert!(
            cli_catalogs::render_catalogs(invalid.path()).is_err(),
            "accepted {translation:?}"
        );
    }
}
