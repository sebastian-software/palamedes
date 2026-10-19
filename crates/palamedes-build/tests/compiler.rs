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
        "{name, date}",
        "{name, time}",
        "<strong>{name}</strong>",
        "",
    ] {
        let directory = catalogs(translation);
        let output = tempfile::tempdir().unwrap();
        assert!(
            CatalogBuilder::new(directory.path(), "en")
                .locales(&["en", "de"])
                .fail_on_missing(true)
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

#[test]
fn missing_fuzzy_and_absent_entries_compile_fallbacks_unless_strict() {
    for translation in [
        "msgstr \"\"\n",
        "#, fuzzy\nmsgstr \"Nicht verwenden {name}\"\n",
    ] {
        let directory = catalogs("Es ist {name}");
        // PO flags precede msgid, not msgstr.
        let target = if translation.starts_with("#, fuzzy") {
            "#, fuzzy\nmsgid \"It's {name}\"\nmsgstr \"Nicht verwenden {name}\"\n".to_owned()
        } else {
            format!("msgid \"It's {{name}}\"\n{translation}")
        };
        fs::write(directory.path().join("de.po"), target).unwrap();
        let output = tempfile::tempdir().unwrap();
        let compiled = CatalogBuilder::new(directory.path(), "en")
            .locales(&["de"])
            .compile_to(output.path())
            .unwrap();
        assert_eq!(compiled.missing.len(), 1);
        let catalog = fs::read_to_string(compiled.catalog_directory.join("de.pmd.json")).unwrap();
        assert!(catalog.contains("It's "), "{catalog}");
        assert!(!catalog.contains("Nicht verwenden"));
        assert!(!compiled.catalog_directory.join("en.pmd.json").exists());
        assert!(
            CatalogBuilder::new(directory.path(), "en")
                .locales(&["de"])
                .fail_on_missing(true)
                .compile_to(output.path())
                .is_err()
        );
    }
    let directory = catalogs("Es ist {name}");
    fs::write(directory.path().join("de.po"), "").unwrap();
    fs::write(
        directory.path().join("fr.po"),
        "msgid \"It's {name}\"\nmsgstr \"C'est {name}\"\n",
    )
    .unwrap();
    let output = tempfile::tempdir().unwrap();
    let compiled = CatalogBuilder::new(directory.path(), "en")
        .locales(&["de"])
        .fallback_locales(&["fr"])
        .compile_to(output.path())
        .unwrap();
    assert_eq!(compiled.missing.len(), 1);
    assert_eq!(compiled.missing[0].resolved_locale, "fr");
    assert!(
        fs::read_to_string(compiled.catalog_directory.join("de.pmd.json"))
            .unwrap()
            .contains("C'est ")
    );
}

#[test]
fn updates_use_the_exported_contract_and_do_not_touch_outputs_on_mismatch() {
    let directory = catalogs("Es ist {name}");
    let build = tempfile::tempdir().unwrap();
    let compiled = CatalogBuilder::new(directory.path(), "en")
        .locales(&["de"])
        .compile_to(build.path())
        .unwrap();
    let schema = fs::read_to_string(&compiled.schema_file).unwrap();
    assert!(!schema.contains("It's") && !schema.contains("Es ist"));
    let contract = palamedes_build::CatalogContract::load(compiled.schema_file).unwrap();
    let output = tempfile::tempdir().unwrap();
    fs::write(
        directory.path().join("de.po"),
        "msgid \"It's {name}\"\nmsgstr \"Neu für {name}\"\n",
    )
    .unwrap();
    let update = CatalogBuilder::new(directory.path(), "en")
        .locales(&["de"])
        .compile_updates(&contract, output.path())
        .unwrap();
    assert_eq!(update.catalogs.len(), 1);
    assert!(!output.path().join("messages.rs").exists());
    let path = &update.catalogs[0];
    let valid = fs::read(path).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o640)).unwrap();
        CatalogBuilder::new(directory.path(), "en")
            .locales(&["de"])
            .compile_updates(&contract, output.path())
            .unwrap();
        assert_eq!(
            fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o640
        );
    }
    assert!(String::from_utf8_lossy(&valid).contains("Neu für "));
    fs::write(
        directory.path().join("en.po"),
        "msgid \"Changed {name}\"\nmsgstr \"Changed {name}\"\n",
    )
    .unwrap();
    assert!(
        CatalogBuilder::new(directory.path(), "en")
            .locales(&["en"])
            .compile_updates(&contract, output.path())
            .is_err()
    );
    assert_eq!(fs::read(path).unwrap(), valid);
    // Source-only ICU failures are fatal even when a translation hides them.
    fs::write(
        directory.path().join("en.po"),
        "msgid \"{name, number}\"\nmsgstr \"Text\"\n",
    )
    .unwrap();
    assert!(
        CatalogBuilder::new(directory.path(), "en")
            .locales(&["en"])
            .compile_to(build.path())
            .is_err()
    );
}

#[test]
fn application_builds_remove_stale_output_locales_but_updates_keep_other_locales() {
    let directory = catalogs("Es ist {name}");
    let output = tempfile::tempdir().unwrap();
    CatalogBuilder::new(directory.path(), "en")
        .locales(&["en", "de"])
        .compile_to(output.path())
        .unwrap();
    let compiled = CatalogBuilder::new(directory.path(), "en")
        .locales(&["de"])
        .compile_to(output.path())
        .unwrap();
    assert!(!compiled.catalog_directory.join("en.pmd.json").exists());
    let contract = palamedes_build::CatalogContract::load(compiled.schema_file).unwrap();
    let preserved = compiled.catalog_directory.join("fr.pmd.json");
    fs::write(&preserved, "previous compatible locale").unwrap();
    CatalogBuilder::new(directory.path(), "en")
        .locales(&["de"])
        .compile_updates(&contract, &compiled.catalog_directory)
        .unwrap();
    assert_eq!(
        fs::read_to_string(preserved).unwrap(),
        "previous compatible locale"
    );
}

#[test]
fn canonical_plural_lowering_preserves_quoting_offsets_and_nested_ordinal_scope() {
    let source = "{count, plural, offset:1 =0 {Nobody} one {'#' # guest} other {{mode, select, short {# guests} other {{inner, selectordinal, one {#st} two {#nd} few {#rd} other {#th}} and # guests}}}}";
    let po = tempfile::tempdir().unwrap();
    fs::write(
        po.path().join("en.po"),
        format!("msgid {source:?}\nmsgstr {source:?}\n"),
    )
    .unwrap();
    let output = tempfile::tempdir().unwrap();
    let compiled = CatalogBuilder::new(po.path(), "en")
        .locales(&["en"])
        .compile_to(output.path())
        .unwrap();
    let bytes = fs::read(compiled.catalog_directory.join("en.pmd.json")).unwrap();
    let artifact: palamedes_i18n::CatalogArtifact = serde_json::from_slice(&bytes).unwrap();
    // Generated applications have static schemas. This test supplies the same
    // public contract without compiling a second Rust process for each pattern.
    let id: &'static str = Box::leak(
        artifact
            .messages
            .keys()
            .next()
            .unwrap()
            .clone()
            .into_boxed_str(),
    );
    let schema = palamedes_i18n::Schema {
        fingerprint: Box::leak(artifact.fingerprint.into_boxed_str()),
        messages: Box::leak(Box::new([palamedes_i18n::MessageSpec {
            id,
            arguments: &["count", "inner", "mode"],
            literal: false,
        }])),
    };
    let catalog = palamedes_i18n::Catalog::from_bytes(&bytes, "en", schema).unwrap();
    for (count, inner, mode, expected) in [
        ("0", "2", "full", "Nobody"),
        ("2", "2", "full", "# 1 guest"),
        ("4", "2", "short", "3 guests"),
        ("4", "2", "full", "2nd and 3 guests"),
        ("5", "21", "full", "21st and 4 guests"),
    ] {
        assert_eq!(
            catalog
                .render(
                    id,
                    &[
                        ("count", count.into()),
                        ("inner", inner.into()),
                        ("mode", mode.into())
                    ]
                )
                .unwrap(),
            expected
        );
    }
    let contract = palamedes_build::CatalogContract::load(compiled.schema_file).unwrap();
    fs::write(po.path().join("de.po"), "").unwrap();
    let update = CatalogBuilder::new(po.path(), "en")
        .locales(&["de"])
        .compile_updates(&contract, output.path())
        .unwrap();
    assert_eq!(update.missing.len(), 1);
    let catalog = palamedes_i18n::Catalog::load(&update.catalogs[0], "de", schema).unwrap();
    assert_eq!(
        catalog
            .render(
                id,
                &[
                    ("count", "2".into()),
                    ("inner", "3".into()),
                    ("mode", "full".into())
                ]
            )
            .unwrap(),
        "# 1 guest"
    );
}
