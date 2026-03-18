use super::{transform_macros, NativeTransformOptions};
use ferrocat::compiled_key;

#[test]
fn transforms_tagged_templates() {
    let result = transform_macros(
        "import { t } from \"@lingui/macro\";\nconst msg = t`Hello ${name}`;\n",
        "test.ts",
        None,
    )
    .expect("transform should succeed");

    assert!(result.code.contains("getI18n()._(\""));
    assert!(result.code.contains("message: \"Hello {name}\""));
    assert!(result.code.contains("{ name }"));
    assert!(result
        .code
        .contains("import { getI18n } from \"@palamedes/runtime\";"));
    assert_eq!(
        result.compiled_ids,
        vec![compiled_key("Hello {name}", None)]
    );
}

#[test]
fn transforms_define_message_without_runtime_import() {
    let result = transform_macros(
        "import { defineMessage } from \"@lingui/macro\";\nconst msg = defineMessage({ message: \"Hello\" });\n",
        "test.ts",
        None,
    )
    .expect("transform should succeed");

    assert!(result.code.contains("id:"));
    assert!(result.code.contains("message: \"Hello\""));
    assert!(!result.code.contains("getI18n()._("));
    assert_eq!(result.compiled_ids, vec![compiled_key("Hello", None)]);
}

#[test]
fn transforms_plural_choice_macros() {
    let result = transform_macros(
        "import { plural } from \"@lingui/macro\";\nconst msg = plural(count, { one: \"# item\", other: \"# items\" });\n",
        "test.ts",
        None,
    )
    .expect("transform should succeed");

    assert!(result.code.contains("getI18n()._(\""));
    assert!(result
        .code
        .contains("message: \"{count, plural, one {# item} other {# items}}\""));
    assert!(result.code.contains("{ count }"));
}

#[test]
fn transforms_select_ordinal_choice_macros() {
    let result = transform_macros(
        "import { selectOrdinal } from \"@lingui/macro\";\nconst msg = selectOrdinal(count, { one: \"#st\", other: \"#th\" });\n",
        "test.ts",
        None,
    )
    .expect("transform should succeed");

    assert!(result.code.contains("getI18n()._(\""));
    assert!(result
        .code
        .contains("message: \"{count, selectordinal, one {#st} other {#th}}\""));
    assert!(result.code.contains("{ count }"));
}

#[test]
fn transforms_trans_jsx_macro() {
    let result = transform_macros(
        "import { Trans } from \"@lingui/react/macro\";\nconst el = <Trans>Hello {name}</Trans>;\n",
        "test.tsx",
        None,
    )
    .expect("transform should succeed");

    assert!(result
        .code
        .contains("import { Trans } from \"@lingui/react\";"));
    assert!(result.code.contains("<Trans id=\""));
    assert!(result.code.contains("message=\"Hello {name}\""));
    assert!(result.code.contains("values={{ name }}"));
    assert!(!result.code.contains("@palamedes/runtime"));
}

#[test]
fn transforms_plural_jsx_macro() {
    let result = transform_macros(
        "import { Plural } from \"@lingui/react/macro\";\nconst el = <Plural value={count} one=\"# item\" other=\"# items\" />;\n",
        "test.tsx",
        None,
    )
    .expect("transform should succeed");

    assert!(result.code.contains("getI18n()._(\""));
    assert!(result
        .code
        .contains("message: \"{count, plural, one {# item} other {# items}}\""));
    assert!(result.code.contains("{ count }"));
}

#[test]
fn strips_message_field_when_requested() {
    let result = transform_macros(
        "import { t } from \"@lingui/macro\";\nconst msg = t({ message: \"Hello\", comment: \"Greeting\" });\n",
        "test.ts",
        Some(NativeTransformOptions {
            strip_message_field: Some(true),
            ..NativeTransformOptions::default()
        }),
    )
    .expect("transform should succeed");

    assert!(!result.code.contains("message:"));
    assert!(result.code.contains("comment: \"Greeting\""));
}

#[test]
fn rejects_explicit_ids() {
    let error = transform_macros(
        "import { t } from \"@lingui/macro\";\nconst msg = t({ id: \"greeting\", message: \"Hello\" });\n",
        "test.ts",
        None,
    )
    .expect_err("explicit ids should fail");

    assert!(error.to_string().contains("Explicit message ids"));
}
