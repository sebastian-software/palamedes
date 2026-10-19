use palamedes_i18n::{Catalog, Error, FORMAT_VERSION, MessageSpec, Schema};
use serde_json::{Value, json};

const SCHEMA: Schema = Schema {
    fingerprint: "plural-fixture",
    messages: &[MessageSpec {
        id: "message",
        arguments: &["count"],
        plural_arguments: &["count"],
        literal: false,
    }],
};

fn load(locale: &str, program: Value, schema: Schema) -> Result<Catalog, Error> {
    Catalog::from_bytes(
        &serde_json::to_vec(&json!({
            "version": FORMAT_VERSION, "fingerprint": "plural-fixture", "locale": locale,
            "messages": {"message": {"kind": "program", "value": program}}
        }))
        .unwrap(),
        locale,
        schema,
    )
}

fn category_program(kind: &str) -> Value {
    let options: serde_json::Map<_, _> = ["zero", "one", "two", "few", "many", "other"]
        .into_iter()
        .map(|category| (category.into(), json!([{"op":"text", "value":category}])))
        .collect();
    json!([{"op":"plural", "name":"count", "kind":kind, "offset":0, "options":options}])
}

fn render(catalog: &Catalog, count: &str) -> Result<String, Error> {
    catalog.render("message", &[("count", count.into())])
}

#[test]
fn cldr_cardinal_categories_follow_each_catalog_locale_and_visible_decimal_digits() {
    for (locale, cases) in [
        (
            "en",
            vec![
                ("0", "other"),
                ("1", "one"),
                ("2", "other"),
                ("1.0", "other"),
                ("-1", "one"),
            ],
        ),
        ("de", vec![("0", "other"), ("1", "one"), ("1.5", "other")]),
        ("fr", vec![("0", "one"), ("1.5", "one"), ("2", "other")]),
        (
            "ru",
            vec![
                ("1", "one"),
                ("2", "few"),
                ("5", "many"),
                ("11", "many"),
                ("21", "one"),
                ("22", "few"),
                ("1.0", "other"),
                ("1.5", "other"),
            ],
        ),
        (
            "pl",
            vec![
                ("1", "one"),
                ("2", "few"),
                ("5", "many"),
                ("12", "many"),
                ("22", "few"),
                ("1.5", "other"),
            ],
        ),
        (
            "ar",
            vec![
                ("0", "zero"),
                ("1", "one"),
                ("2", "two"),
                ("3", "few"),
                ("11", "many"),
                ("100", "other"),
                ("1.5", "other"),
            ],
        ),
        ("ja", vec![("1", "other"), ("2", "other")]),
        ("pt-PT", vec![("0", "other"), ("1", "one")]),
        ("pt-BR", vec![("0", "one"), ("1", "one")]),
    ] {
        let catalog = load(locale, category_program("cardinal"), SCHEMA).unwrap();
        for (count, expected) in cases {
            assert_eq!(
                render(&catalog, count).unwrap(),
                expected,
                "{locale}: {count}"
            );
        }
    }
}

#[test]
fn ordinal_rules_are_distinct_from_cardinal_rules() {
    let catalog = load("en", category_program("ordinal"), SCHEMA).unwrap();
    for (count, expected) in [
        ("1", "one"),
        ("2", "two"),
        ("3", "few"),
        ("4", "other"),
        ("11", "other"),
        ("12", "other"),
        ("13", "other"),
        ("21", "one"),
        ("22", "two"),
        ("23", "few"),
    ] {
        assert_eq!(render(&catalog, count).unwrap(), expected, "{count}");
    }
    let german = load("de", category_program("ordinal"), SCHEMA).unwrap();
    assert_eq!(render(&german, "1").unwrap(), "other");
}

#[test]
fn exact_selectors_precede_offset_categories_and_keep_large_integers_exact() {
    let catalog = load(
        "en",
        json!([{"op":"plural","name":"count","kind":"cardinal","offset":1,"options":{
            "=0":[{"op":"text","value":"empty"}],
            "=2":[{"op":"text","value":"exact:"},{"op":"pound"}],
            "=18446744073709551615":[{"op":"text","value":"large"}],
            "one":[{"op":"text","value":"one:"},{"op":"pound"}],
            "other":[{"op":"text","value":"other:"},{"op":"pound"}]
        }}]),
        SCHEMA,
    )
    .unwrap();
    for (count, expected) in [
        ("0", "empty"),
        ("2", "exact:1"),
        ("2.0", "exact:1.0"),
        ("3", "other:2"),
        ("-1", "other:-2"),
        ("2.5", "other:1.5"),
        ("18446744073709551615", "large"),
        ("9007199254740993", "other:9007199254740992"),
    ] {
        assert_eq!(render(&catalog, count).unwrap(), expected, "{count}");
    }
    // Missing named categories use other, even when the locale selects one.
    let catalog = load(
        "en",
        json!([{"op":"plural","name":"count","kind":"cardinal","offset":1,"options":{
            "other":[{"op":"pound"}]
        }}]),
        SCHEMA,
    )
    .unwrap();
    assert_eq!(render(&catalog, "2").unwrap(), "1");
    assert_eq!(
        render(&catalog, "0.000000000000000001").unwrap(),
        "-0.999999999999999999"
    );
}

#[test]
fn pound_tracks_the_innermost_plural_through_selects_and_restores_outer_scope() {
    const NESTED: Schema = Schema {
        fingerprint: "plural-fixture",
        messages: &[MessageSpec {
            id: "message",
            arguments: &["count", "inner", "mode"],
            plural_arguments: &["count", "inner"],
            literal: false,
        }],
    };
    let catalog = load("en", json!([{"op":"plural","name":"count","kind":"cardinal","offset":1,"options":{
        "other":[{"op":"pound"},{"op":"text","value":" / "},
            {"op":"select","name":"mode","options":{"other":[
                {"op":"text","value":"literal # "},
                {"op":"plural","name":"inner","kind":"cardinal","offset":2,"options":{"other":[{"op":"pound"}]}}
            ]}}, {"op":"text","value":" / "},{"op":"pound"}]
    }}]), NESTED).unwrap();
    assert_eq!(
        catalog
            .render(
                "message",
                &[
                    ("count", "5".into()),
                    ("inner", "4".into()),
                    ("mode", "unknown".into())
                ]
            )
            .unwrap(),
        "4 / literal # 2 / 4"
    );
}

#[test]
fn invalid_plural_programs_and_values_fail_explicitly() {
    for options in [
        json!({"one":[]}),
        json!({"other":[],"bogus":[]}),
        json!({"other":[],"=NaN":[]}),
        json!({"other":[],"=1":[],"=1.0":[]}),
    ] {
        assert!(matches!(
            load(
                "en",
                json!([{"op":"plural","name":"count","kind":"cardinal","offset":0,"options":options}]),
                SCHEMA
            ),
            Err(Error::Incompatible(_))
        ));
    }
    assert!(matches!(
        load("en", json!([{"op":"pound"}]), SCHEMA),
        Err(Error::Incompatible(_))
    ));
    assert!(matches!(
        load("bad--tag", category_program("cardinal"), SCHEMA),
        Err(Error::PluralRules { .. })
    ));
    let catalog = load("en", category_program("cardinal"), SCHEMA).unwrap();
    for count in [
        "",
        "many",
        "NaN",
        "inf",
        "1e3",
        "1,5",
        "1.",
        ".5",
        "170141183460469231731687303715884105728",
        "0.0000000000000000001",
    ] {
        assert!(
            matches!(render(&catalog, count), Err(Error::PluralArgument { .. })),
            "{count}"
        );
    }
    let catalog = load("en", json!([{"op":"plural","name":"count","kind":"cardinal","offset":1,"options":{"other":[{"op":"pound"}]}}]), SCHEMA).unwrap();
    assert!(matches!(
        render(&catalog, &i128::MIN.to_string()),
        Err(Error::PluralArgument { .. })
    ));
    let legacy = json!({"version":1,"fingerprint":"plural-fixture","locale":"en","messages":{"message":{"kind":"program","value":category_program("cardinal")}}});
    assert!(matches!(
        Catalog::from_bytes(&serde_json::to_vec(&legacy).unwrap(), "en", SCHEMA),
        Err(Error::FormatVersion {
            expected: 2,
            actual: 1
        })
    ));
}

#[test]
fn cached_rules_remain_send_sync_and_independent_across_threads() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<Catalog>();
    let english = load("en", category_program("cardinal"), SCHEMA).unwrap();
    let russian = load("ru", category_program("cardinal"), SCHEMA).unwrap();
    std::thread::scope(|scope| {
        scope.spawn(|| assert_eq!(render(&english, "2").unwrap(), "other"));
        scope.spawn(|| assert_eq!(render(&russian, "2").unwrap(), "few"));
    });
}

#[test]
fn validated_decimal_counts_preserve_visible_digits_and_reject_non_numbers() {
    use palamedes_i18n::PluralNumber;
    let catalog = load("en", category_program("cardinal"), SCHEMA).unwrap();
    for (input, category) in [("1", "one"), ("1.0", "other"), ("1.00", "other")] {
        let count: PluralNumber = input.parse().unwrap();
        assert_eq!(count.to_string(), input);
        assert_eq!(
            catalog
                .render("message", &[("count", count.to_string())])
                .unwrap(),
            category
        );
    }
    for invalid in [
        "drei",
        "",
        "NaN",
        "inf",
        "1e3",
        "1.0000000000000000000",
        "170141183460469231731687303715884105728",
    ] {
        assert!(invalid.parse::<PluralNumber>().is_err(), "{invalid}");
    }
}

#[test]
fn external_data_cannot_turn_a_display_argument_into_a_plural_operand() {
    const DISPLAY: Schema = Schema {
        fingerprint: "plural-fixture",
        messages: &[MessageSpec {
            id: "message",
            arguments: &["count"],
            plural_arguments: &[],
            literal: false,
        }],
    };
    assert!(
        matches!(load("en", category_program("cardinal"), DISPLAY), Err(Error::Incompatible(message)) if message.contains("plural argument kind mismatch"))
    );
    // A translation may use a simpler form without weakening the caller's numeric contract.
    let catalog = load("en", json!([{"op":"argument", "name":"count"}]), SCHEMA).unwrap();
    assert_eq!(render(&catalog, "2").unwrap(), "2");
}
