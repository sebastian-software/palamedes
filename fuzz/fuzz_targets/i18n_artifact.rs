#![no_main]

use std::str::FromStr as _;

use libfuzzer_sys::fuzz_target;
use palamedes_i18n::{
    Catalog, CatalogArtifact, Message, MessageSpec, PluralNumber, Schema, format_argument,
    plural_arguments, validate_program,
};

const MAX_INPUT_BYTES: usize = 32 * 1024;

const MIXED_MESSAGES: &[MessageSpec] = &[
    MessageSpec {
        id: "lit",
        arguments: &[],
        plural_arguments: &[],
        literal: true,
    },
    MessageSpec {
        id: "msg",
        arguments: &["count", "gender", "name"],
        plural_arguments: &["count"],
        literal: false,
    },
];

const PLURAL_MESSAGES: &[MessageSpec] = &[MessageSpec {
    id: "p",
    arguments: &["count"],
    plural_arguments: &["count"],
    literal: false,
}];

const ARG_MESSAGES: &[MessageSpec] = &[MessageSpec {
    id: "m",
    arguments: &["name"],
    plural_arguments: &[],
    literal: false,
}];

const SCHEMAS: &[Schema] = &[
    Schema {
        fingerprint: "fuzz-mixed",
        messages: MIXED_MESSAGES,
    },
    Schema {
        fingerprint: "fuzz-plural",
        messages: PLURAL_MESSAGES,
    },
    Schema {
        fingerprint: "fuzz-arg",
        messages: ARG_MESSAGES,
    },
];

const SAMPLE_COUNTS: &[&str] = &[
    "0",
    "1",
    "1.0",
    "2",
    "5",
    "-1",
    "+0.00",
    "1.000000000000000000",
    "100000000000000000000",
    "not-a-number",
    "",
];

fn exercise_catalog(catalog: &Catalog, schema: Schema, dynamic_arg: &str) {
    let _ = catalog.locale();
    for spec in schema.messages {
        let _ = catalog.literal(spec.id);

        // Exercise invalid argument count / duplicate argument error paths.
        let _ = catalog.render(spec.id, &[]);

        for count_str in SAMPLE_COUNTS
            .iter()
            .copied()
            .chain(std::iter::once(dynamic_arg))
        {
            let count_value = match PluralNumber::from_str(count_str) {
                Ok(parsed) => format_argument::<true, _>(&parsed),
                Err(_) => count_str.to_owned(),
            };
            let args: Vec<(&str, String)> = spec
                .arguments
                .iter()
                .map(|&name| {
                    let value = if spec.plural_arguments.contains(&name) {
                        count_value.clone()
                    } else if name == "gender" {
                        format_argument::<false, _>(&dynamic_arg)
                    } else {
                        format_argument::<false, _>(&"{name} #")
                    };
                    (name, value)
                })
                .collect();
            let _ = catalog.render(spec.id, &args);
        }
    }
    let _ = catalog.literal("missing-id");
    let _ = catalog.render("missing-id", &[]);
}

fuzz_target!(|data: &[u8]| {
    if data.len() > MAX_INPUT_BYTES {
        return;
    }

    // Split optional NUL-delimited dynamic argument payload from artifact JSON bytes.
    let (artifact_bytes, dynamic_bytes) = match data.iter().position(|&b| b == 0) {
        Some(pos) => (&data[..pos], &data[pos + 1..]),
        None => (data, data),
    };

    // 1. Direct PluralNumber::from_str fuzzing over raw UTF-8 and line tokens.
    let dynamic_arg = std::str::from_utf8(dynamic_bytes).unwrap_or("1");
    if let Ok(number) = PluralNumber::from_str(dynamic_arg) {
        let _ = format_argument::<true, _>(&number);
    }
    if let Ok(full_str) = std::str::from_utf8(data) {
        for token in full_str.split_whitespace().take(16) {
            if let Ok(number) = PluralNumber::from_str(token) {
                let _ = format_argument::<true, _>(&number);
            }
        }
    }

    // 2. Direct CatalogArtifact deserialization + program validation on arbitrary JSON.
    if let Ok(artifact) = serde_json::from_slice::<CatalogArtifact>(artifact_bytes) {
        for message in artifact.messages.values() {
            if let Message::Program(program) = message {
                let _ = validate_program(program);
                let _ = plural_arguments(program);
            }
        }
        // Also try loading against each schema with the artifact's own declared locale
        // (exercises CLDR plural rule loading on arbitrary locale tags).
        for &schema in SCHEMAS {
            if let Ok(catalog) = Catalog::from_bytes(artifact_bytes, &artifact.locale, schema) {
                exercise_catalog(&catalog, schema, dynamic_arg);
            }
        }
    }

    // 3. Catalog::from_bytes with fixed known locales and static schemas.
    for locale in ["en", "pl", "ar"] {
        for &schema in SCHEMAS {
            if let Ok(catalog) = Catalog::from_bytes(artifact_bytes, locale, schema) {
                exercise_catalog(&catalog, schema, dynamic_arg);
            }
        }
    }
});
