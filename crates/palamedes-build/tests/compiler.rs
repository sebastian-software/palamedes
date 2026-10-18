use std::fs;

use palamedes_build::{CatalogBuilder, extract_messages};

fn catalogs(translation: &str) -> tempfile::TempDir {
    let directory = tempfile::tempdir().unwrap();
    for (locale, value) in [("en", "It's {name}"), ("de", translation)] {
        fs::write(
            directory.path().join(format!("{locale}.po")),
            format!("msgid \"It's {{name}}\"\nmsgstr {value:?}\n"),
        )
        .unwrap();
    }
    directory
}

#[test]
fn canonical_compilation_emits_data_and_only_ids_as_executable_rust() {
    let directory = catalogs("Es ist {name}");
    let output = tempfile::tempdir().unwrap();
    let compiled = CatalogBuilder::new(directory.path(), "en")
        .locales(&["en", "de"])
        .compile_to(output.path())
        .unwrap();
    let generated = fs::read_to_string(compiled.rust_module).unwrap();
    assert!(generated.contains("macro_rules! translate"));
    assert!(generated.contains("It's {name}")); // Only compile-time input, removed by rustc constant evaluation.
    assert!(!generated.contains("Es ist"));
    let data = fs::read_to_string(compiled.catalog_directory.join("de.pmd.json")).unwrap();
    assert!(data.contains("Es ist"));
    assert!(!data.contains("It's"));
    let first = fs::read(output.path().join("catalogs/de.pmd.json")).unwrap();
    CatalogBuilder::new(directory.path(), "en")
        .locales(&["en", "de"])
        .compile_to(output.path())
        .unwrap();
    assert_eq!(
        first,
        fs::read(output.path().join("catalogs/de.pmd.json")).unwrap()
    );
}

#[test]
fn invalid_or_unsupported_translations_stop_the_build() {
    for translation in [
        "Broken {",
        "Es ist {wrong}",
        "{name, number}",
        "{name, plural, one {eins} other {viele}}",
        "",
    ] {
        let directory = catalogs(translation);
        let output = tempfile::tempdir().unwrap();
        assert!(
            CatalogBuilder::new(directory.path(), "en")
                .locales(&["en", "de"])
                .compile_to(output.path())
                .is_err(),
            "{translation}"
        );
    }
    let directory = catalogs("Es ist {name}");
    fs::write(
        directory.path().join("de.po"),
        "msgid \"Different\"\nmsgstr \"Anders\"\n",
    )
    .unwrap();
    let output = tempfile::tempdir().unwrap();
    assert!(
        CatalogBuilder::new(directory.path(), "en")
            .locales(&["en", "de"])
            .compile_to(output.path())
            .is_err()
    );
    assert!(
        CatalogBuilder::new(directory.path(), "en")
            .locales(&["en", "../de"])
            .compile_to(output.path())
            .is_err()
    );
}

#[test]
fn rust_extraction_handles_nested_attributes_raw_literals_and_comments() {
    let messages = extract_messages(
        r##"
        // tr!("Not a message")
        #[command(about = tr!("About"))]
        fn run() {
            let text = "tr!(\"Not source\")";
            tr!(r#"A "quoted" {name}"#, name = text);
            module::tr!("Nested");
        }
    "##,
        "tr",
    )
    .unwrap();
    assert_eq!(
        messages
            .iter()
            .map(|message| message.message.as_str())
            .collect::<Vec<_>>(),
        ["About", "A \"quoted\" {name}", "Nested"]
    );
    assert_eq!(messages[0].line, 3);
    let explicit = extract_messages(
        "translate!(&catalog, \"Hello {name}\", name = name)",
        "translate",
    )
    .unwrap();
    assert_eq!(explicit[0].message, "Hello {name}");
    assert!(extract_messages("tr!(dynamic)", "tr").is_err());
    assert!(extract_messages("tr!(\"dynamic\".to_owned())", "tr").is_err());
    assert!(
        extract_messages(
            "translate!(&catalog, dynamic, other = \"wrong source\")",
            "translate"
        )
        .is_err()
    );
    let generic =
        extract_messages("translate!(catalog::<A, B>(), \"Generic\")", "translate").unwrap();
    assert_eq!(generic[0].message, "Generic");
}
