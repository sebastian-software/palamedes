use std::collections::BTreeMap;

use palamedes_i18n::{
    Catalog, CatalogArtifact, Error, FORMAT_VERSION, Instruction, Message, MessageSpec, Schema,
};

const SCHEMA: Schema = Schema {
    fingerprint: "fixture-v1",
    messages: &[
        MessageSpec {
            id: "constant",
            arguments: &[],
            plural_arguments: &[],
            literal: true,
        },
        MessageSpec {
            id: "greeting",
            arguments: &["name"],
            plural_arguments: &[],
            literal: false,
        },
        MessageSpec {
            id: "selection",
            arguments: &["mode", "name"],
            plural_arguments: &[],
            literal: false,
        },
    ],
};

fn artifact(locale: &str) -> CatalogArtifact {
    CatalogArtifact {
        version: FORMAT_VERSION,
        fingerprint: "fixture-v1".into(),
        locale: locale.into(),
        messages: BTreeMap::from([
            (
                "constant".into(),
                Message::Literal("Literal {braces}".into()),
            ),
            (
                "greeting".into(),
                Message::Program(vec![
                    Instruction::Text {
                        value: "Hallo ".into(),
                    },
                    Instruction::Argument {
                        name: "name".into(),
                    },
                ]),
            ),
            (
                "selection".into(),
                Message::Program(vec![Instruction::Select {
                    name: "mode".into(),
                    options: BTreeMap::from([
                        (
                            "preview".into(),
                            vec![
                                Instruction::Text {
                                    value: "Vorschau: ".into(),
                                },
                                Instruction::Argument {
                                    name: "name".into(),
                                },
                            ],
                        ),
                        (
                            "other".into(),
                            vec![
                                Instruction::Text {
                                    value: "Bereit: ".into(),
                                },
                                Instruction::Argument {
                                    name: "name".into(),
                                },
                            ],
                        ),
                    ]),
                }]),
            ),
        ]),
    }
}

#[test]
fn external_data_is_validated_and_rendered_without_icu_interpretation() {
    let bytes = serde_json::to_vec(&artifact("de")).unwrap();
    let catalog = Catalog::from_bytes(&bytes, "de", SCHEMA).unwrap();
    assert_eq!(catalog.locale(), "de");
    assert_eq!(catalog.literal("constant").unwrap(), "Literal {braces}");
    assert_eq!(
        catalog
            .render(
                "greeting",
                &[("name", "Ada {nested, plural, other {bad}}".into())]
            )
            .unwrap(),
        "Hallo Ada {nested, plural, other {bad}}"
    );
    for (mode, expected) in [("preview", "Vorschau: Ada"), ("unexpected", "Bereit: Ada")] {
        assert_eq!(
            catalog
                .render(
                    "selection",
                    &[("name", "Ada".into()), ("mode", mode.into())]
                )
                .unwrap(),
            expected
        );
    }
    assert!(matches!(
        catalog.render("greeting", &[]),
        Err(Error::Arguments(_))
    ));
    assert!(matches!(
        catalog.render("greeting", &[("name", "a".into()), ("name", "b".into())]),
        Err(Error::Arguments(_))
    ));
    assert!(matches!(
        catalog.literal("missing"),
        Err(Error::MissingMessage(_))
    ));
}

#[test]
fn incompatible_or_incomplete_data_never_becomes_source_fallback() {
    for mutate in [
        |value: &mut CatalogArtifact| value.version += 1,
        |value: &mut CatalogArtifact| value.fingerprint.push('x'),
        |value: &mut CatalogArtifact| value.locale = "es".into(),
        |value: &mut CatalogArtifact| {
            value.messages.remove("greeting");
        },
        |value: &mut CatalogArtifact| {
            value
                .messages
                .insert("extra".into(), Message::Literal("extra".into()));
        },
        |value: &mut CatalogArtifact| {
            value
                .messages
                .insert("greeting".into(), Message::Literal("wrong kind".into()));
        },
        |value: &mut CatalogArtifact| {
            value.messages.insert(
                "greeting".into(),
                Message::Program(vec![Instruction::Argument {
                    name: "wrong".into(),
                }]),
            );
        },
        |value: &mut CatalogArtifact| {
            value.messages.insert(
                "selection".into(),
                Message::Program(vec![Instruction::Select {
                    name: "mode".into(),
                    options: BTreeMap::new(),
                }]),
            );
        },
    ] {
        let mut value = artifact("de");
        mutate(&mut value);
        assert!(Catalog::from_bytes(&serde_json::to_vec(&value).unwrap(), "de", SCHEMA).is_err());
    }
    assert!(Catalog::from_bytes(br#"{"raw": "ICU {name}"}"#, "de", SCHEMA).is_err());
    let directory = tempfile::tempdir().unwrap();
    assert!(matches!(
        Catalog::load(directory.path().join("missing.json"), "en", SCHEMA),
        Err(Error::Io { .. })
    ));
}

#[test]
fn catalogs_have_no_shared_locale_state() {
    let mut spanish = artifact("es");
    spanish
        .messages
        .insert("constant".into(), Message::Literal("Español".into()));
    let german =
        Catalog::from_bytes(&serde_json::to_vec(&artifact("de")).unwrap(), "de", SCHEMA).unwrap();
    let spanish =
        Catalog::from_bytes(&serde_json::to_vec(&spanish).unwrap(), "es", SCHEMA).unwrap();
    std::thread::scope(|scope| {
        scope.spawn(|| assert_eq!(german.literal("constant").unwrap(), "Literal {braces}"));
        scope.spawn(|| assert_eq!(spanish.literal("constant").unwrap(), "Español"));
    });
}

#[test]
fn file_errors_keep_the_path_and_distinguish_incompatibility_causes() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("selected.pmd.json");
    for (field, value, expected) in [
        ("version", serde_json::json!(999), "format version mismatch"),
        ("locale", serde_json::json!("fr"), "locale mismatch"),
        (
            "fingerprint",
            serde_json::json!("old-contract"),
            "contract fingerprint mismatch",
        ),
    ] {
        let mut data = serde_json::to_value(artifact("de")).unwrap();
        data[field] = value;
        std::fs::write(&path, serde_json::to_vec(&data).unwrap()).unwrap();
        let error = Catalog::load(&path, "de", SCHEMA).unwrap_err();
        assert!(matches!(error, Error::Load { .. }));
        let text = error.to_string();
        assert!(
            text.contains(path.to_str().unwrap()) && text.contains(expected),
            "{text}"
        );
        assert!(std::error::Error::source(&error).is_some());
    }
    std::fs::write(&path, "{}").unwrap();
    let text = Catalog::load(&path, "de", SCHEMA).unwrap_err().to_string();
    assert!(text.contains(path.to_str().unwrap()) && text.contains("missing field"));
}
