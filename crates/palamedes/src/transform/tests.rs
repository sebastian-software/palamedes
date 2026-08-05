use super::{
    transform_macros as transform_macros_raw, NativeTransformOptions, NativeTransformResult,
    ServerFunctionTransformOptions,
};
use crate::error::PalamedesResult;
use crate::icu_text::compiled_message_key;
use crate::test_support::scope_macro_test_source;
use ferrocat::compiled_key;

fn transform_macros(
    source: &str,
    filename: &str,
    options: Option<NativeTransformOptions>,
) -> PalamedesResult<NativeTransformResult> {
    let scoped_source = scope_macro_test_source(source, filename);
    let mut options = options.unwrap_or_default();
    // Most transform fixtures assert the authored fallback spelling. Keep it
    // explicitly so the tests stay focused while production-default behavior
    // is covered by dedicated cases below.
    if options.keep_source_fallbacks.is_none() && options.strip_message_field.is_none() {
        options.keep_source_fallbacks = Some(true);
    }
    let mut result = transform_macros_raw(&scoped_source, filename, Some(options))?;

    if let Some(map) = result.map.as_mut() {
        map.sources_content = Some(vec![Some(source.to_string())]);
    }

    Ok(result)
}

fn server_function_options() -> NativeTransformOptions {
    NativeTransformOptions {
        server_functions: Some(ServerFunctionTransformOptions {
            initializer_module: "@/i18n/server-action".to_string(),
            initializer_export: "initServerActionI18n".to_string(),
        }),
        keep_source_fallbacks: Some(true),
        ..NativeTransformOptions::default()
    }
}

#[test]
fn instruments_inline_server_functions_without_macros() {
    let source = r#"export function Component() {
  return async function save() {
    "use server";
    await persist();
  };
}
"#;
    let result = transform_macros_raw(source, "action.ts", Some(server_function_options()))
        .expect("inline Server Function should be instrumented");

    assert!(result.has_changed);
    assert_eq!(
        result.code.matches("from \"@/i18n/server-action\"").count(),
        1
    );
    assert!(result.code.contains(
        "\"use server\";\n  await __palamedesServerFunctionInitializer();\n    await persist();"
    ));
}

#[test]
fn instruments_only_exported_async_functions_in_server_modules() {
    let source = r#""use server";

export async function save() { await persist(); }
export const remove = async () => destroy();
async function renamed() { await rename(); }
export { renamed as renameAction };
const hidden = async () => hide();
export function syncFunction() {}
"#;
    let result = transform_macros_raw(source, "actions.ts", Some(server_function_options()))
        .expect("server module exports should be instrumented");

    assert_eq!(
        result
            .code
            .matches("await __palamedesServerFunctionInitializer();")
            .count(),
        3
    );
    assert!(result.code.contains(
        "export const remove = async () => {\n  await __palamedesServerFunctionInitializer();\n  return destroy();\n};"
    ));
    assert!(result.code.contains("const hidden = async () => hide();"));
    assert!(result.code.contains("export function syncFunction() {}"));
}

#[test]
fn instruments_async_functions_exported_by_default_identifier() {
    let source = r#""use server";
async function save() { await persist(); }
export default save;
"#;
    let result = transform_macros_raw(source, "actions.ts", Some(server_function_options()))
        .expect("default-exported local Server Function should be instrumented");

    assert_eq!(
        result
            .code
            .matches("await __palamedesServerFunctionInitializer();")
            .count(),
        1
    );
}

#[test]
fn imports_the_initializer_once_and_avoids_authored_bindings() {
    let source = r#""use server";
const __palamedesServerFunctionInitializer = "occupied";
export async function first() {}
export async function second() {}
"#;
    let result = transform_macros_raw(source, "actions.ts", Some(server_function_options()))
        .expect("initializer alias should avoid collisions");

    assert_eq!(
        result.code.matches("from \"@/i18n/server-action\"").count(),
        1
    );
    assert!(result
        .code
        .contains("import { initServerActionI18n as __palamedesServerFunctionInitializer2 }"));
    assert_eq!(
        result
            .code
            .matches("await __palamedesServerFunctionInitializer2();")
            .count(),
        2
    );
}

#[test]
fn rejects_eager_macros_in_server_function_parameter_defaults() {
    for source in [
        r#"import { t } from "@palamedes/core/macro";
export async function save(message = t`Fallback`) { "use server"; return message; }
"#,
        r#"import { t } from "@palamedes/core/macro";
export async function save({ nested: { message = t`Fallback` } } = {}) { "use server"; return message; }
"#,
    ] {
        let error = transform_macros_raw(source, "action.ts", Some(server_function_options()))
            .expect_err("eager parameter macro must fail");
        let message = error.to_string();
        assert!(message.contains(
            "Eager Palamedes macro in a Server Function parameter initializer executes before request i18n initialization"
        ));
        assert!(message.contains("Move the default into the function body"));
        assert!(message.contains("if (value === undefined)"));
    }
}

#[test]
fn permits_deferred_macros_inside_parameter_callbacks() {
    let source = r#"import { t } from "@palamedes/core/macro";
export async function save(format = () => t`Fallback`) { "use server"; return format(); }
"#;
    let result = transform_macros_raw(source, "action.ts", Some(server_function_options()))
        .expect("a callback default does not run the macro before initialization");

    assert!(result.has_changed);
    assert!(result
        .code
        .contains("await __palamedesServerFunctionInitializer();"));
    assert!(result.code.contains("getI18n()._("));
}

#[test]
fn combines_concise_server_action_and_macro_transforms() {
    let source = r#""use server";
import { t } from "@palamedes/core/macro";
export const label = async () => t`Saved`;
"#;
    let result = transform_macros_raw(source, "actions.ts", Some(server_function_options()))
        .expect("overlapping concise arrow and macro transforms should compose");

    assert!(result
        .code
        .contains("await __palamedesServerFunctionInitializer();"));
    assert!(result.code.contains("return getI18n()._("));
    assert!(!result.code.contains("@palamedes/core/macro"));
}

#[test]
fn leaves_server_functions_unchanged_without_opt_in() {
    let source = r#"export async function save() { "use server"; await persist(); }
"#;
    let result = transform_macros_raw(source, "action.ts", None)
        .expect("unconfigured transform should leave Server Functions alone");

    assert!(!result.has_changed);
    assert_eq!(result.code, source);
}

#[test]
fn rejects_invalid_server_function_initializer_exports() {
    let error = transform_macros_raw(
        r#"export async function save() { "use server"; }"#,
        "action.ts",
        Some(NativeTransformOptions {
            server_functions: Some(ServerFunctionTransformOptions {
                initializer_module: "./i18n".to_string(),
                initializer_export: "init();".to_string(),
            }),
            ..NativeTransformOptions::default()
        }),
    )
    .expect_err("invalid generated import syntax must be rejected");

    assert!(error
        .to_string()
        .contains("Invalid Server Function initializer import"));
}

#[test]
fn rejects_eager_translation_macros_outside_functions() {
    let cases = [
        (
            r#"import { t as translate } from "@palamedes/core/macro";
const message = translate`Hello`;
"#,
            "test.ts",
            "t",
        ),
        (
            r##"import { plural } from "@palamedes/core/macro";
const message = plural(count, { one: "# item", other: "# items" });
"##,
            "test.ts",
            "plural",
        ),
        (
            r#"import { Select as Choice } from "@palamedes/react/macro";
const message = <Choice value={gender} other="They" />;
"#,
            "test.tsx",
            "Select",
        ),
        (
            r#"import { t } from "@palamedes/core/macro";
class Formatter { label = t`Hello`; }
"#,
            "test.ts",
            "t",
        ),
    ];

    for (source, filename, macro_name) in cases {
        let error = transform_macros_raw(source, filename, None)
            .expect_err("top-level eager translation macros must fail");
        let message = error.to_string();
        assert!(message.contains(&format!(
            "Translation macro `{macro_name}` must be used inside a function"
        )));
        assert!(message.contains(filename));
    }
}

#[test]
fn accepts_translation_macros_in_deferred_scopes_and_trans_at_module_scope() {
    let source = r##"import { plural, t } from "@palamedes/core/macro";
import { Plural, Trans } from "@palamedes/react/macro";

const safe = <Trans>Rendered later</Trans>;
function declaration() { return t`Function`; }
const arrow = () => t`Arrow`;
const object = { method() { return t`Method`; } };
class Formatter { method() { return t`Class method`; } }
items.map(() => t`Callback`);
function Component() {
  return <Plural value={count} one="# item" other="# items" />;
}
function choices() {
  return plural(count, { one: "# item", other: "# items" });
}
"##;

    let result = transform_macros_raw(
        source,
        "test.tsx",
        Some(NativeTransformOptions {
            keep_source_fallbacks: Some(true),
            ..NativeTransformOptions::default()
        }),
    )
    .expect("function-scoped macros and top-level Trans should succeed");

    assert!(result.has_changed);
    assert!(result.code.contains("Rendered later"));
    assert!(result.code.contains("Class method"));
}

#[test]
fn transforms_tagged_templates() {
    let result = transform_macros(
        "import { t } from \"@palamedes/core/macro\";\nconst msg = t`Hello ${name}`;\n",
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
        vec![compiled_message_key("Hello {name}", None)]
    );

    let map = result
        .map
        .expect("changed transform should include a source map");
    assert_eq!(map.file.as_deref(), Some("test.ts"));
    assert_eq!(map.sources, vec!["test.ts"]);
    assert_eq!(
        map.sources_content,
        Some(vec![Some(
            "import { t } from \"@palamedes/core/macro\";\nconst msg = t`Hello ${name}`;\n"
                .to_string()
        )])
    );
    assert!(!map.mappings.is_empty());
    assert!(map.names.is_empty());
}

#[test]
fn aliases_injected_runtime_import_when_local_name_is_taken_by_another_module() {
    let source = r#"import { t } from "@palamedes/core/macro";
import { getI18n } from "@palamedes/runtime";

const locale = getI18n().locale;
const msg = t`Hello`;
"#;

    let result = transform_macros(
        source,
        "test.ts",
        Some(NativeTransformOptions {
            runtime_module: Some("@acme/custom-runtime".to_string()),
            ..NativeTransformOptions::default()
        }),
    )
    .expect("transform should avoid runtime import collisions");

    assert!(result.has_changed);
    assert!(result
        .code
        .contains(r#"import { getI18n as __palamedesGetI18n } from "@acme/custom-runtime";"#));
    assert!(result
        .code
        .contains(r#"import { getI18n } from "@palamedes/runtime";"#));
    assert!(result.code.contains(r#"__palamedesGetI18n()._("#));
    assert!(result.code.contains("const locale = getI18n().locale;"));
}

#[test]
fn aliases_injected_runtime_import_for_default_and_namespace_imports() {
    for conflicting_import in [
        r#"import getI18n from "./imperative-runtime";"#,
        r#"import * as getI18n from "./imperative-runtime";"#,
    ] {
        let source = format!(
            r#"import {{ t }} from "@palamedes/core/macro";
{conflicting_import}

const msg = t`Hello`;
"#
        );

        let result = transform_macros(
            &source,
            "test.ts",
            Some(NativeTransformOptions {
                runtime_module: Some("@acme/custom-runtime".to_string()),
                ..NativeTransformOptions::default()
            }),
        )
        .expect("transform should avoid all import binding collisions");

        assert!(result
            .code
            .contains(r#"import { getI18n as __palamedesGetI18n } from "@acme/custom-runtime";"#));
        assert!(result.code.contains(conflicting_import));
        assert!(result.code.contains(r#"__palamedesGetI18n()._("#));
    }
}

#[test]
fn aliases_runtime_import_when_nested_binding_would_shadow_generated_calls() {
    let source = r#"import { t } from "@palamedes/core/macro";

function greeting(getI18n: () => string) {
  const local = getI18n();
  return `${local}: ${t`Hello`}`;
}
"#;

    let result = transform_macros(source, "test.ts", None)
        .expect("transform should avoid nested runtime getter shadowing");

    assert!(result
        .code
        .contains(r#"import { getI18n as __palamedesGetI18n } from "@palamedes/runtime";"#));
    assert!(result.code.contains(r#"__palamedesGetI18n()._("#));
    assert!(result.code.contains("const local = getI18n();"));
}

#[test]
fn generates_runtime_alias_not_used_by_existing_bindings_or_references() {
    let source = r#"import { t } from "@palamedes/core/macro";
import { getI18n } from "@palamedes/runtime";

const __palamedesGetI18n = "occupied";
console.log(__palamedesGetI18n2);
const msg = t`Hello`;
"#;

    let result = transform_macros(
        source,
        "test.ts",
        Some(NativeTransformOptions {
            runtime_module: Some("@acme/custom-runtime".to_string()),
            ..NativeTransformOptions::default()
        }),
    )
    .expect("transform should generate a globally unused runtime alias");

    assert!(result
        .code
        .contains(r#"import { getI18n as __palamedesGetI18n3 } from "@acme/custom-runtime";"#));
    assert!(result.code.contains(r#"__palamedesGetI18n3()._("#));
    assert!(result.code.contains("console.log(__palamedesGetI18n2);"));
}

#[test]
fn reuses_matching_runtime_import_when_it_is_not_shadowed() {
    let source = r#"import { t } from "@palamedes/core/macro";
import { getI18n } from "@acme/custom-runtime";

const msg = t`Hello`;
"#;

    let result = transform_macros(
        source,
        "test.ts",
        Some(NativeTransformOptions {
            runtime_module: Some("@acme/custom-runtime".to_string()),
            ..NativeTransformOptions::default()
        }),
    )
    .expect("transform should reuse the matching runtime import");

    assert_eq!(
        result
            .code
            .matches(r#"from "@acme/custom-runtime""#)
            .count(),
        1
    );
    assert!(!result.code.contains("__palamedesGetI18n"));
    assert!(result.code.contains(r#"getI18n()._("#));
}

#[test]
fn aliases_matching_runtime_import_when_nested_binding_shadows_it() {
    let source = r#"import { t } from "@palamedes/core/macro";
import { getI18n } from "@palamedes/runtime";

function greeting(getI18n: () => string) {
  const local = getI18n();
  return `${local}: ${t`Hello`}`;
}
"#;

    let result = transform_macros(source, "test.ts", None)
        .expect("transform should avoid shadowing a matching runtime import");

    assert!(result
        .code
        .contains(r#"import { getI18n as __palamedesGetI18n } from "@palamedes/runtime";"#));
    assert_eq!(
        result.code.matches(r#"from "@palamedes/runtime""#).count(),
        2
    );
    assert!(result.code.contains(r#"__palamedesGetI18n()._("#));
    assert!(result.code.contains("const local = getI18n();"));
}

#[test]
fn does_not_reuse_different_export_aliased_to_runtime_import_name() {
    let source = r#"import { t } from "@palamedes/core/macro";
import { createI18n as getI18n } from "@palamedes/runtime";

const msg = t`Hello`;
"#;

    let result = transform_macros(source, "test.ts", None)
        .expect("transform should import the configured runtime export");

    assert!(result
        .code
        .contains(r#"import { getI18n as __palamedesGetI18n } from "@palamedes/runtime";"#));
    assert!(result.code.contains(r#"__palamedesGetI18n()._("#));
    assert!(result
        .code
        .contains(r#"import { createI18n as getI18n } from "@palamedes/runtime";"#));
}

#[test]
fn unchanged_transform_has_no_source_map() {
    let result = transform_macros("const msg = \"Hello\";\n", "test.ts", None)
        .expect("transform should succeed");

    assert!(!result.has_changed);
    assert!(result.map.is_none());
}

#[test]
fn transforms_after_non_ascii_source_text() {
    let source = "import { Trans } from \"@palamedes/react/macro\";\nconst x = \"äöü\";\nconst y = <Trans>Hallo Welt</Trans>;\n";
    let result = transform_macros(source, "test.tsx", None).expect("transform should succeed");

    assert!(result.has_changed);
    assert!(result.code.contains("const x = \"äöü\";"));
    assert!(result.code.contains("message={\"Hallo Welt\"}"));

    let map = result
        .map
        .expect("changed transform should include a source map");
    assert_eq!(map.file.as_deref(), Some("test.tsx"));
    assert_eq!(map.sources, vec!["test.tsx"]);
    assert_eq!(map.sources_content, Some(vec![Some(source.to_string())]));
    assert!(!map.mappings.is_empty());
}

#[test]
fn preserves_member_expression_values_in_tagged_templates() {
    let result = transform_macros(
        "import { t } from \"@palamedes/core/macro\";\nconst msg = t`Locale ${resolved.locale}`;\n",
        "test.ts",
        None,
    )
    .expect("transform should succeed");

    assert!(result.code.contains("message: \"Locale {locale}\""));
    assert!(result.code.contains("{ locale: resolved.locale }"));
}

#[test]
fn transforms_interpolated_descriptor_templates() {
    let source = r#"import { t } from "@palamedes/core/macro";
const message = t({
  message: `Descriptor ${name}`,
  context: "probe context",
});
"#;
    let result = transform_macros(source, "test.ts", None).expect("transform should succeed");

    assert!(result.code.contains("message: \"Descriptor {name}\""));
    assert!(result.code.contains("{ name }"));
    assert!(result.code.contains("context: \"probe context\""));
    assert!(!result.code.contains("@palamedes/core/macro"));
    assert!(!result.code.contains("t({"));
    assert_eq!(
        result.compiled_ids,
        vec![compiled_message_key(
            "Descriptor {name}",
            Some("probe context")
        )]
    );
}

#[test]
fn merges_interpolated_descriptor_values_with_explicit_values() {
    let result = transform_macros(
        r#"import { t } from "@palamedes/core/macro";
const message = t({ message: `Hello ${name}, you have {count}` }, { count });
"#,
        "test.ts",
        None,
    )
    .expect("transform should succeed");

    assert!(result
        .code
        .contains("message: \"Hello {name}, you have {count}\""));
    assert!(result.code.contains("{ name, count }"));
}

#[test]
fn rejects_missing_icu_values_in_interpolated_descriptor_templates() {
    let error = transform_macros(
        r#"import { t } from "@palamedes/core/macro";
const message = t({ message: `Hello ${name}, you have {count}` });
"#,
        "test.ts",
        None,
    )
    .expect_err("implicit template values must validate all message placeholders");

    let message = error.to_string();
    assert!(message.contains("Missing value(s): count"));
    assert!(message.contains("extra value(s): none"));
}

#[test]
fn rejects_removed_deferred_macro_imports_before_removing_shared_imports() {
    for macro_name in ["msg", "defineMessage"] {
        let source = format!(
            r#"import {{ t, {macro_name} as deferred }} from "@palamedes/core/macro";
const valid = t`Hello`;
"#
        );
        let error = transform_macros(&source, "test.ts", None)
            .expect_err("removed deferred macro imports must fail");

        let message = error.to_string();
        assert!(message.contains(&format!(
            "Unsupported `{macro_name}` macro usage at test.ts:1:1"
        )));
        assert!(message.contains("deferred message macro has been removed"));
    }
}

#[test]
fn rejects_untransformable_macro_calls_before_removing_imports() {
    let error = transform_macros(
        r#"import { t } from "@palamedes/core/macro";
const valid = t`Hello`;
const broken = t({ message });
"#,
        "test.ts",
        None,
    )
    .expect_err("untransformable macros must fail the module");

    let message = error.to_string();
    assert!(message.contains("Unsupported `t` macro usage at test.ts:3:16"));
    assert!(message.contains("must be a string literal or template literal"));
}

#[test]
fn transforms_plural_choice_macros() {
    let result = transform_macros(
        "import { plural } from \"@palamedes/core/macro\";\nconst msg = plural(count, { one: \"# item\", other: \"# items\" });\n",
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
fn transforms_plural_choice_branch_interpolations() {
    let result = transform_macros(
        r##"import { plural } from "@palamedes/core/macro";
const msg = plural(count, {
  one: `# item will be archived because ${planLabel} allows a maximum of ${max}`,
  other: `# items will be archived because ${planLabel} allows a maximum of ${max}`,
});
"##,
        "test.ts",
        None,
    )
    .expect("transform should succeed");

    assert!(result.code.contains(
        "message: \"{count, plural, one {# item will be archived because {planLabel} allows a maximum of {max}} other {# items will be archived because {planLabel} allows a maximum of {max}}}\""
    ));
    assert!(result.code.contains("{ count, planLabel, max }"));
}

#[test]
fn transforms_plural_choice_with_signal_accessor() {
    let result = transform_macros(
        "import { plural } from \"@palamedes/core/macro\";\nconst msg = plural(count(), { one: \"# item\", other: \"# items\" });\n",
        "test.ts",
        None,
    )
    .expect("transform should succeed");

    // A reactive signal read keeps its accessor name instead of falling back to
    // the generic "value" placeholder.
    assert!(result
        .code
        .contains("message: \"{count, plural, one {# item} other {# items}}\""));
    assert!(result.code.contains("{ count: count() }"));
    assert!(!result.code.contains("{value, plural"));
}

#[test]
fn extractor_and_transform_share_zero_argument_accessor_names() {
    let source = r##"import { plural, t } from "@palamedes/core/macro";
import { Plural, Trans } from "@palamedes/react/macro";

const tagged = t`You have ${count()} items`;
const rich = <Trans>There are {props.quantity()} tasks</Trans>;
const choice = plural(count(), { one: "# item", other: "# items" });
const richChoice = <Plural value={props.quantity()} one="# task" other="# tasks" />;
"##;
    let scoped_source = scope_macro_test_source(source, "test.tsx");
    let extracted = crate::extract::extract_messages(&scoped_source, "test.tsx")
        .expect("zero-argument accessors should extract");
    let transformed = transform_macros(source, "test.tsx", None)
        .expect("zero-argument accessors should transform");
    let extracted_ids = extracted
        .iter()
        .map(|message| compiled_message_key(&message.message, message.context.as_deref()))
        .collect::<Vec<_>>();

    assert_eq!(transformed.compiled_ids, extracted_ids);
}

#[test]
fn extractor_preserves_source_apostrophes_while_transform_escapes_runtime_text() {
    let source = r##"import { plural, t } from "@palamedes/core/macro";
import { Trans } from "@palamedes/react/macro";

const tagged = t`L'${title} est prêt`;
const rich = <Trans>l'{item}</Trans>;
const choice = plural(count, { one: "'#' don't item", other: "# don't items" });
const plain = t`don't`;
const doubled = t`client''s l''été`;
"##;
    let scoped_source = scope_macro_test_source(source, "test.tsx");
    let extracted = crate::extract::extract_messages(&scoped_source, "test.tsx")
        .expect("apostrophe messages should extract");
    let transformed =
        transform_macros(source, "test.tsx", None).expect("apostrophe messages should transform");

    // Catalog identities preserve natural and already doubled apostrophes.
    // Only a literal/placeholder boundary needs escaping in persisted ICU.
    assert_eq!(
        extracted
            .iter()
            .map(|message| message.message.as_str())
            .collect::<Vec<_>>(),
        vec![
            "L''{title} est prêt",
            "l''{item}",
            "{count, plural, one {''#' don't item} other {# don't items}}",
            "don't",
            "client''s l''été",
        ]
    );

    // Runtime messages may use stricter apostrophe escaping, but policy-aware
    // key derivation still maps both spellings to the same compiled ids.
    let extracted_ids = extracted
        .iter()
        .map(|message| compiled_message_key(&message.message, message.context.as_deref()))
        .collect::<Vec<_>>();
    assert_eq!(transformed.compiled_ids, extracted_ids);
    for runtime_message in [
        "L''{title} est prêt",
        "l''{item}",
        "{count, plural, one {''#'' don''t item} other {# don''t items}}",
        "don''t",
        "client''s l''été",
    ] {
        assert!(
            transformed.code.contains(runtime_message),
            "transform output should embed {:?}",
            runtime_message
        );
    }
}

#[test]
fn descriptor_string_literals_stay_raw_icu_on_both_sides() {
    // Descriptor string literals are the raw-ICU authoring surface: authors
    // write placeholders and ICU quoting themselves, so neither side may
    // escape apostrophes there. Template-literal descriptors are authored
    // text and go through the shared escaping instead.
    let source = r##"import { t } from "@palamedes/core/macro";

const quoted = t({ message: "L'{title} est prêt" }, { title });
const doubled = t({ message: "It''s {name}" }, { name });
const authored = t({ message: `l'${item}` });
"##;
    let scoped_source = scope_macro_test_source(source, "test.ts");
    let extracted = crate::extract::extract_messages(&scoped_source, "test.ts")
        .expect("descriptor messages should extract");
    let transformed =
        transform_macros(source, "test.ts", None).expect("descriptor messages should transform");

    assert_eq!(
        extracted
            .iter()
            .map(|message| message.message.as_str())
            .collect::<Vec<_>>(),
        vec!["L'{title} est prêt", "It''s {name}", "l''{item}"]
    );

    // The embedded runtime message stays byte-identical to the authored text.
    for message in &extracted {
        assert!(
            transformed
                .code
                .contains(&format!("message: \"{}\"", message.message)),
            "transform output should embed {:?} verbatim",
            message.message
        );
    }

    let extracted_ids = extracted
        .iter()
        .map(|message| compiled_message_key(&message.message, message.context.as_deref()))
        .collect::<Vec<_>>();
    assert_eq!(transformed.compiled_ids, extracted_ids);

    // Raw and canonical spellings of the same message have to reach the same
    // lookup key, because catalog compilation canonicalizes before it hashes.
    assert_eq!(
        transformed.compiled_ids[0],
        compiled_key("L'{title} est prêt'", None),
        "the raw descriptor key must be the canonical-form hash"
    );
    assert_ne!(
        transformed.compiled_ids[0],
        compiled_key("L'{title} est prêt", None),
        "hashing the raw text is what made descriptor lookups unreachable"
    );
    // Already-escaped authored text is a canonicalization fixed point, so those
    // ids are unchanged.
    assert_eq!(
        transformed.compiled_ids[1],
        compiled_key("It''s {name}", None)
    );
    assert_eq!(transformed.compiled_ids[2], compiled_key("l''{item}", None));
}

#[test]
fn transforms_select_ordinal_choice_macros() {
    let result = transform_macros(
        "import { selectOrdinal } from \"@palamedes/core/macro\";\nconst msg = selectOrdinal(count, { one: \"#st\", other: \"#th\" });\n",
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
        "import { Trans } from \"@palamedes/react/macro\";\nconst el = <Trans>Hello {name}</Trans>;\n",
        "test.tsx",
        None,
    )
    .expect("transform should succeed");

    assert!(result
        .code
        .contains("import { Trans } from \"@palamedes/react/compiled\";"));
    assert!(result.code.contains("<Trans id=\""));
    assert!(result.code.contains("message={\"Hello {name}\"}"));
    assert!(result.code.contains("values={{ name }}"));
    assert!(!result.code.contains("@palamedes/runtime"));
}

#[test]
fn ignores_jsx_comments_inside_trans() {
    let result = transform_macros(
        "import { Trans } from \"@palamedes/react/macro\";\nconst el = <Trans>Hello {/* translator note */} world</Trans>;\n",
        "test.tsx",
        None,
    )
    .expect("JSX comments should be ignored");

    assert!(result.code.contains("message={\"Hello world\"}"));
    assert!(!result.code.contains("translator note"));
    assert!(!result.code.contains("values="));
}

#[test]
fn transforms_solid_trans_jsx_macro() {
    let result = transform_macros(
        "import { Trans } from \"@palamedes/solid/macro\";\nconst el = <Trans>Hello <strong>{name}</strong></Trans>;\n",
        "test.tsx",
        None,
    )
    .expect("transform should succeed");

    assert!(result
        .code
        .contains("import { Trans } from \"@palamedes/solid/compiled\";"));
    assert!(result.code.contains("<Trans id=\""));
    assert!(result.code.contains("message={\"Hello <0>{name}</0>\"}"));
    assert!(result
        .code
        .contains("components={{ 0: (children) => <strong>{children}</strong> }}"));
}

#[test]
fn deduplicates_same_tag_component_placeholders() {
    let result = transform_macros(
        "import { Trans } from \"@palamedes/react/macro\";\nconst el = <Trans>Accept <a href=\"/terms\">terms</a> and <a href=\"/privacy\">privacy</a></Trans>;\n",
        "test.tsx",
        None,
    )
    .expect("transform should succeed");

    assert!(result
        .code
        .contains("message={\"Accept <0>terms</0> and <1>privacy</1>\"}"));
    assert!(result
        .code
        .contains("components={{ 0: <a href=\"/terms\" />, 1: <a href=\"/privacy\" /> }}"));
}

#[test]
fn deduplicates_same_tag_component_placeholders_with_identical_markup() {
    let result = transform_macros(
        "import { Trans } from \"@palamedes/react/macro\";\nconst el = <Trans><strong>A</strong> and <strong>B</strong></Trans>;\n",
        "test.tsx",
        None,
    )
    .expect("transform should succeed");

    assert!(result.code.contains("message={\"<0>A</0> and <1>B</1>\"}"));
    assert!(result
        .code
        .contains("components={{ 0: <strong />, 1: <strong /> }}"));
}

#[test]
fn trans_jsx_macro_uses_self_closing_empty_component_placeholders() {
    let result = transform_macros(
        "import { Trans } from \"@palamedes/react/macro\";\nconst el = <Trans>I agree to the <a href={COMMERCIAL_TERMS_URL}>Commercial Terms <ExternalLink className=\"inline\" /></a></Trans>;\n",
        "test.tsx",
        None,
    )
    .expect("transform should succeed");

    assert!(result
        .code
        .contains("message={\"I agree to the <0>Commercial Terms<1/></0>\"}"));
    assert!(result
        .code
        .contains("components={{ 0: <a href={COMMERCIAL_TERMS_URL} />, 1: <ExternalLink className=\"inline\" /> }}"));
}

#[test]
fn trans_jsx_macro_preserves_inline_space_before_empty_component_placeholders_with_trailing_text() {
    let result = transform_macros(
        "import { Trans } from \"@palamedes/react/macro\";\nconst el = <Trans>Foo <Icon /> bar</Trans>;\n",
        "test.tsx",
        None,
    )
    .expect("transform should succeed");

    assert!(result.code.contains("message={\"Foo <0/> bar\"}"));
}

#[test]
fn normalizes_trans_jsx_placeholder_boundary_whitespace() {
    let result = transform_macros(
        "import { Trans } from \"@palamedes/react/macro\";\nconst el = <Trans>Reach out to your {\" \"}<a href=\"/advisor\">advisor</a>{\" \"} for help.</Trans>;\n",
        "test.tsx",
        None,
    )
    .expect("transform should succeed");

    assert!(result
        .code
        .contains("message={\"Reach out to your <0>advisor</0> for help.\"}"));
}

#[test]
fn normalizes_trans_jsx_placeholder_before_punctuation() {
    let result = transform_macros(
        "import { Trans } from \"@palamedes/react/macro\";\nconst el = <Trans>Delete {\" \"}<strong>{selectedProjectName}</strong> ? This action cannot be undone.</Trans>;\nconst tailored = <Trans>\n  Tailored to your {volume} MWh of annual electricity use in {countryName}\n  .\n</Trans>;\nconst literalBraces = <Trans>{\"{name}\"} .</Trans>;\n",
        "test.tsx",
        None,
    )
    .expect("transform should succeed");

    assert!(result.code.contains(
        "message={\"Delete <0>{selectedProjectName}</0>? This action cannot be undone.\"}"
    ));
    assert!(result.code.contains(
        "message={\"Tailored to your {volume} MWh of annual electricity use in {countryName}.\"}"
    ));
    assert!(result.code.contains("message={\"{name} .\"}"));
}

#[test]
fn preserves_trans_jsx_leading_separator_spacing() {
    let result = transform_macros(
        "import { Trans } from \"@palamedes/react/macro\";\nconst price = <Trans> · ${priceFormatted}/MWh</Trans>;\nconst manager = <Trans> — no manager</Trans>;\n",
        "test.tsx",
        None,
    )
    .expect("transform should succeed");

    assert!(result
        .code
        .contains("message={\" · ${priceFormatted}/MWh\"}"));
    assert!(result.code.contains("message={\" — no manager\"}"));
}

#[test]
fn preserves_use_client_directive_before_injected_imports() {
    let result = transform_macros(
        "\"use client\";\nimport { Trans } from \"@palamedes/react/macro\";\nconst el = <Trans>Hello</Trans>;\n",
        "test.tsx",
        None,
    )
    .expect("transform should succeed");

    let first_import = result
        .code
        .find("import { Trans } from \"@palamedes/react/compiled\";")
        .expect("trans import should be injected");
    let directive = result
        .code
        .find("\"use client\";")
        .expect("use client directive should remain");

    assert!(directive < first_import);
    assert!(result.code.starts_with("\"use client\";\n"));
}

#[test]
fn transforms_plural_jsx_macro() {
    let result = transform_macros(
        "import { Plural } from \"@palamedes/react/macro\";\nconst el = <Plural value={count} one=\"# item\" other=\"# items\" />;\n",
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
fn transforms_plural_offsets_from_calls_and_jsx() {
    let result = transform_macros(
        r##"import { plural } from "@palamedes/core/macro";
import { Plural } from "@palamedes/react/macro";
const call = plural(count, { offset: 1, one: "# item", other: "# items" });
const stringCall = plural(count, { offset: "2", one: "# item", other: "# items" });
const jsx = <Plural value={count} offset={1} one="# item" other="# items" />;
"##,
        "test.tsx",
        None,
    )
    .expect("static plural offsets should transform");

    assert!(result
        .code
        .contains("message: \"{count, plural, offset:1 one {# item} other {# items}}\""));
    assert!(result
        .code
        .contains("message: \"{count, plural, offset:2 one {# item} other {# items}}\""));
    assert_eq!(
        result
            .code
            .matches("message: \"{count, plural, offset:1 one {# item} other {# items}}\"")
            .count(),
        2
    );
}

#[test]
fn rejects_invalid_plural_offsets_and_categories() {
    let cases = [
        r##"import { plural } from "@palamedes/core/macro";
const message = plural(count, { offset: dynamicOffset, one: "# item", other: "# items" });
"##,
        r##"import { plural } from "@palamedes/core/macro";
const message = plural(count, { invalid: "broken", other: "# items" });
"##,
        r##"import { Plural } from "@palamedes/react/macro";
const message = <Plural value={count} offset={-1} one="# item" other="# items" />;
"##,
    ];

    for source in cases {
        let error = transform_macros(source, "test.tsx", None)
            .expect_err("invalid plural metadata should fail");
        assert!(error.to_string().contains("Unsupported"));
    }
}

#[test]
fn transforms_plural_jsx_branch_interpolations() {
    let result = transform_macros(
        r##"import { Plural } from "@palamedes/react/macro";
const el = <Plural
  value={count}
  one={`# item will be archived because ${planLabel} allows a maximum of ${max}`}
  other={`# items will be archived because ${planLabel} allows a maximum of ${max}`}
/>;
"##,
        "test.tsx",
        None,
    )
    .expect("transform should succeed");

    assert!(result.code.contains(
        "message: \"{count, plural, one {# item will be archived because {planLabel} allows a maximum of {max}} other {# items will be archived because {planLabel} allows a maximum of {max}}}\""
    ));
    assert!(result.code.contains("{ count, planLabel, max }"));
}

#[test]
fn strips_message_field_when_requested() {
    let result = transform_macros(
        "import { t } from \"@palamedes/core/macro\";\nconst msg = t({ message: \"Hello\", comment: \"Greeting\" });\n",
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
fn strips_source_fallbacks_by_default_from_calls_and_trans() {
    let result = transform_macros_raw(
        r#"import { t } from "@palamedes/core/macro";
import { Trans } from "@palamedes/react/macro";
function View() { return <><span>{t`Hello`}</span><Trans>Rich text</Trans></>; }
"#,
        "test.tsx",
        None,
    )
    .expect("default transform should succeed");

    assert!(result.code.contains("getI18n()._(\""));
    assert!(result.code.contains("<Trans id=\""));
    assert!(!result.code.contains("message: \"Hello\""));
    assert!(!result.code.contains("message={\"Rich text\"}"));
}

#[test]
fn keeps_source_fallbacks_when_requested() {
    let result = transform_macros_raw(
        r#"import { t } from "@palamedes/core/macro";
import { Trans } from "@palamedes/react/macro";
function View() { return <><span>{t`Hello`}</span><Trans>Rich text</Trans></>; }
"#,
        "test.tsx",
        Some(NativeTransformOptions {
            keep_source_fallbacks: Some(true),
            ..NativeTransformOptions::default()
        }),
    )
    .expect("fallback-preserving transform should succeed");

    assert!(result.code.contains("message: \"Hello\""));
    assert!(result.code.contains("message={\"Rich text\"}"));
}

#[test]
fn honors_explicit_legacy_strip_message_field_values() {
    let source = r#"import { t } from "@palamedes/core/macro";
function message() { return t`Hello`; }
"#;
    let stripped = transform_macros_raw(
        source,
        "test.ts",
        Some(NativeTransformOptions {
            strip_message_field: Some(true),
            ..NativeTransformOptions::default()
        }),
    )
    .expect("legacy strip transform");
    let kept = transform_macros_raw(
        source,
        "test.ts",
        Some(NativeTransformOptions {
            strip_message_field: Some(false),
            ..NativeTransformOptions::default()
        }),
    )
    .expect("legacy keep transform");
    let positive_option_wins = transform_macros_raw(
        source,
        "test.ts",
        Some(NativeTransformOptions {
            keep_source_fallbacks: Some(false),
            strip_message_field: Some(false),
            ..NativeTransformOptions::default()
        }),
    )
    .expect("positive option precedence transform");

    assert!(!stripped.code.contains("message: \"Hello\""));
    assert!(kept.code.contains("message: \"Hello\""));
    assert!(!positive_option_wins.code.contains("message: \"Hello\""));
}

#[test]
fn trans_jsx_macro_escapes_double_quotes_in_message_attribute() {
    let result = transform_macros(
        "import { Trans } from \"@palamedes/react/macro\";\nconst el = <Trans>Upload settlement data file with \"3Degrees Audit Summary\" tab</Trans>;\n",
        "test.tsx",
        None,
    )
    .expect("transform should succeed");

    assert!(result.code.contains(
        "message={\"Upload settlement data file with \\\"3Degrees Audit Summary\\\" tab\"}"
    ));
    assert!(!result
        .code
        .contains("message=\"Upload settlement data file with \\\""));
}

#[test]
fn trans_jsx_macro_decodes_entities_before_deriving_message_id() {
    let result = transform_macros(
        "import { Trans } from \"@palamedes/react/macro\";\nconst el = <Trans>Green-e&reg; applies to US &amp; Canada only</Trans>;\n",
        "test.tsx",
        None,
    )
    .expect("transform should succeed");
    let message = "Green-e® applies to US & Canada only";

    assert!(result
        .code
        .contains("message={\"Green-e® applies to US & Canada only\"}"));
    assert!(result
        .code
        .contains(&format!("id=\"{}\"", compiled_message_key(message, None))));
    assert_eq!(
        result.compiled_ids,
        vec![compiled_message_key(message, None)]
    );
}

#[test]
fn trans_jsx_macro_decodes_message_attribute_entities() {
    let result = transform_macros(
        "import { Trans } from \"@palamedes/react/macro\";\nconst el = <Trans message=\"Decision &quot;Model&quot; &#x26; review\" />;\n",
        "test.tsx",
        None,
    )
    .expect("transform should succeed");
    let message = "Decision \"Model\" & review";

    assert!(result
        .code
        .contains("message={\"Decision \\\"Model\\\" & review\"}"));
    assert_eq!(
        result.compiled_ids,
        vec![compiled_message_key(message, None)]
    );
}

#[test]
fn trans_jsx_macro_keeps_expression_string_entities_raw() {
    let result = transform_macros(
        "import { Trans } from \"@palamedes/react/macro\";\nconst child = <Trans>{\"A &amp; B\"}</Trans>;\nconst attr = <Trans message={\"Literal &amp; Value\"} />;\n",
        "test.tsx",
        None,
    )
    .expect("transform should succeed");
    let child_message = "A &amp; B";
    let attr_message = "Literal &amp; Value";

    assert!(result.code.contains("message={\"A &amp; B\"}"));
    assert!(result.code.contains("message={\"Literal &amp; Value\"}"));
    assert_eq!(
        result.compiled_ids,
        vec![
            compiled_message_key(child_message, None),
            compiled_message_key(attr_message, None)
        ]
    );
}

#[test]
fn choice_jsx_macro_decodes_option_attribute_entities() {
    let result = transform_macros(
        "import { Plural } from \"@palamedes/react/macro\";\nconst el = <Plural value={count} one=\"# item &amp; fee\" other=\"# items &amp; fees\" />;\n",
        "test.tsx",
        None,
    )
    .expect("transform should succeed");

    assert!(result
        .code
        .contains("message: \"{count, plural, one {# item & fee} other {# items & fees}}\""));
}

#[test]
fn wraps_choice_jsx_macro_when_used_as_jsx_child() {
    let result = transform_macros(
        "import { Plural } from \"@palamedes/react/macro\";\nfunction Demo({ totalRows }) { return <p><Plural value={totalRows} one=\"# row\" other=\"# rows\" /></p>; }\n",
        "test.tsx",
        None,
    )
    .expect("transform should succeed");

    assert!(result.code.contains("<p>{getI18n()._(\""));
    assert!(result
        .code
        .contains("message: \"{totalRows, plural, one {# row} other {# rows}}\""));
    assert!(result.code.contains(")}</p>"));
}

#[test]
fn rejects_nested_jsx_message_macros() {
    let error = transform_macros(
        "import { Plural, Trans } from \"@palamedes/react/macro\";\nconst el = <Trans><Plural value={contractCount} one=\"# contract\" other=\"# contracts\" /> ({capacityMW} MW)</Trans>;\n",
        "test.tsx",
        None,
    )
    .expect_err("nested message macros should fail");
    let message = error.to_string();

    assert!(message.contains("Nested i18n macro is not extractable as a single message"));
    assert!(message.contains("test.tsx:2:"));
    assert!(message.contains("Move the full sentence into <Plural> branches"));
}

#[test]
fn rejects_nested_jsx_message_macros_inside_conditional_and_logical_expressions() {
    for source in [
        "import { Plural, Trans } from \"@palamedes/react/macro\";\nconst el = <Trans>{showCount ? <Plural value={count} one=\"one\" other=\"other\" /> : null}</Trans>;\n",
        "import { Plural, Trans } from \"@palamedes/react/macro\";\nconst el = <Trans>{showCount && <Plural value={count} one=\"one\" other=\"other\" />}</Trans>;\n",
    ] {
        let error = transform_macros(source, "test.tsx", None)
            .expect_err("nested message macros in JSX expressions should fail");
        let message = error.to_string();

        assert!(message.contains("Nested i18n macro is not extractable as a single message"));
        assert!(!message.contains("stable placeholder name"));
    }
}

#[test]
fn rejects_nested_jsx_message_macros_inside_map_callbacks() {
    let error = transform_macros(
        "import { Plural, Trans } from \"@palamedes/react/macro\";\nconst el = <Trans>{items.map((item) => <Plural value={item.count} one=\"one\" other=\"other\" />)}</Trans>;\n",
        "test.tsx",
        None,
    )
    .expect_err("nested message macros in map callbacks should fail");
    let message = error.to_string();

    assert!(message.contains("Nested i18n macro is not extractable as a single message"));
    assert!(!message.contains("stable placeholder name"));
}

#[test]
fn transforms_nested_jsx_message_macros_inside_render_prop_attributes() {
    let result = transform_macros(
        "import { Plural, Trans } from \"@palamedes/react/macro\";\nconst el = <Trans><List renderItem={() => <Plural value={count} one=\"one\" other=\"other\" />} /></Trans>;\n",
        "test.tsx",
        None,
    )
    .expect("nested message macros in render prop attributes should transform");

    assert!(result.code.contains("message={\"<0/>\"}"));
    assert!(result.code.contains("renderItem={() => getI18n()._(\""));
    assert!(!result.code.contains("<Plural"));
}

#[test]
fn transforms_trans_macros_inside_component_attributes() {
    for module in ["react", "solid"] {
        let source = format!(
            "import {{ Trans }} from \"@palamedes/{module}/macro\";\nconst el = <Trans>Click <Button title={{<Trans>Tooltip</Trans>}} description={{<Trans>Details</Trans>}} /> now</Trans>;\n"
        );
        let result = transform_macros(&source, "test.tsx", None)
            .expect("Trans macros in component attributes should transform");

        assert!(result.code.contains("message={\"Click <0/> now\"}"));
        assert!(result.code.contains("title={<Trans id=\""));
        assert!(result.code.contains("message={\"Tooltip\"}"));
        assert!(result.code.contains("description={<Trans id=\""));
        assert!(result.code.contains("message={\"Details\"}"));
        assert_eq!(result.code.matches("<Trans id=").count(), 3);
        assert_eq!(result.compiled_ids.len(), 3);
        assert!(!result.code.contains(&format!("@palamedes/{module}/macro")));
    }
}

#[test]
fn rejects_component_attribute_macros_inside_trans_expression_children() {
    let error = transform_macros(
        "import { Trans } from \"@palamedes/react/macro\";\nconst el = <Trans>{cond && <Button title={<Trans>Tooltip</Trans>} />}</Trans>;\n",
        "test.tsx",
        None,
    )
    .expect_err("complex JSX child expressions should remain unsupported");

    assert!(error.to_string().contains("stable placeholder name"));
}

#[test]
fn keeps_choice_jsx_macro_as_expression_outside_jsx_children() {
    let result = transform_macros(
        "import { Plural } from \"@palamedes/react/macro\";\nconst el = <Plural value={count} one=\"# item\" other=\"# items\" />;\n",
        "test.tsx",
        None,
    )
    .expect("transform should succeed");

    assert!(result.code.contains("const el = getI18n()._(\""));
    assert!(!result.code.contains("const el = {getI18n()._(\""));
}

#[test]
fn keeps_choice_jsx_macro_as_expression_in_jsx_attribute_container() {
    let result = transform_macros(
        "import { Plural } from \"@palamedes/react/macro\";\nconst el = <Summary label={<Plural value={count} one=\"# item\" other=\"# items\" />} />;\n",
        "test.tsx",
        None,
    )
    .expect("transform should succeed");

    assert!(result.code.contains("label={getI18n()._(\""));
    assert!(!result.code.contains("label={{getI18n()._(\""));
}

#[test]
fn keeps_choice_jsx_macro_as_expression_in_jsx_child_expression_container() {
    let result = transform_macros(
        "import { Plural } from \"@palamedes/react/macro\";\nconst el = <Summary>{show && <Plural value={count} one=\"# item\" other=\"# items\" />}</Summary>;\n",
        "test.tsx",
        None,
    )
    .expect("transform should succeed");

    assert!(result.code.contains("{show && getI18n()._(\""));
    assert!(!result.code.contains("{show && {getI18n()._(\""));
}

#[test]
fn keeps_choice_jsx_macro_as_expression_in_jsx_ternary_branch() {
    let result = transform_macros(
        "import { Plural, Trans } from \"@palamedes/react/macro\";\nfunction ResultCount({ filtered, total }: { filtered: number; total: number }) {\n  return <p>{filtered !== total ? (<Trans>Showing {filtered} of {total} items</Trans>) : (<Plural one=\"# item\" other=\"# items\" value={total} />)}</p>;\n}\n",
        "test.tsx",
        None,
    )
    .expect("transform should succeed");

    assert!(result.code.contains(": (getI18n()._(\""));
    assert!(!result.code.contains(": ({getI18n()._(\""));
    assert!(!result.code.contains(": ({{getI18n()._(\""));
}

#[test]
fn keeps_choice_jsx_macro_as_expression_in_nested_jsx_ternary_branch() {
    let result = transform_macros(
        "import { Plural, Trans } from \"@palamedes/react/macro\";\nfunction ResultCount({ shownCount, totalCount, quickSearch }) {\n  return (\n    <section>\n      <header>\n        <Trans>Marketplace</Trans>\n      </header>\n      <button>\n        <Trans>Buy now</Trans>\n      </button>\n      <p>\n        {quickSearch.trim() && shownCount !== totalCount ? (\n          <Trans>\n            Showing {shownCount} of {totalCount} products\n          </Trans>\n        ) : (\n          <Plural one=\"# product\" other=\"# products\" value={shownCount} />\n        )}\n      </p>\n    </section>\n  );\n}\n",
        "test.tsx",
        None,
    )
    .expect("transform should succeed");

    assert!(result.code.contains("<Trans id=\""));
    assert!(result.code.contains(") : (\n          getI18n()._(\""));
    assert!(!result.code.contains(") : (\n          {getI18n()._(\""));
}

#[test]
fn accepts_getter_call_choice_jsx_value_names() {
    let result = transform_macros(
        "import { Plural } from \"@palamedes/react/macro\";\nconst el = <Plural value={getDemand()} one=\"# unit\" other=\"# units\" />;\n",
        "test.tsx",
        None,
    )
    .expect("transform should accept the same getter value names as extraction");

    assert!(result
        .code
        .contains("message: \"{demand, plural, one {# unit} other {# units}}\""));
    assert!(result.code.contains("{ demand: getDemand() }"));
}

#[test]
fn rejects_explicit_ids() {
    let error = transform_macros(
        "import { t } from \"@palamedes/core/macro\";\nconst msg = t({ id: \"greeting\", message: \"Hello\" });\n",
        "test.ts",
        None,
    )
    .expect_err("explicit ids should fail");

    assert!(error.to_string().contains("Explicit message ids"));
}

#[test]
fn descriptor_call_forwards_values_object() {
    let result = transform_macros(
        "import { t } from \"@palamedes/core/macro\";\nconst msg = t({ message: \"Hello {name}\" }, { name });\n",
        "test.ts",
        None,
    )
    .expect("transform should succeed");

    assert!(result.code.contains("message: \"Hello {name}\""));
    assert!(result.code.contains(", { name },"));
}

#[test]
fn descriptor_call_validates_placeholders_inside_choice_bodies() {
    let result = transform_macros(
        "import { t } from \"@palamedes/core/macro\";\nconst msg = t({ message: \"{count, plural, one {{name} item} other {{name} items}}\" }, { count, name });\n",
        "test.ts",
        None,
    )
    .expect("choice body placeholders should validate");

    assert!(result.code.contains(", { count, name },"));
}

#[test]
fn descriptor_call_preserves_empty_values_object() {
    let result = transform_macros(
        "import { t } from \"@palamedes/core/macro\";\nconst msg = t({ message: \"Hello\" }, {});\n",
        "test.ts",
        None,
    )
    .expect("empty values object should succeed");

    assert!(result.code.contains(", {},"));
}

#[test]
fn descriptor_call_rejects_missing_values() {
    let error = transform_macros(
        "import { t } from \"@palamedes/core/macro\";\nconst msg = t({ message: \"Hello {name}\" }, { naem: user.name });\n",
        "test.ts",
        None,
    )
    .expect_err("placeholder mismatch should fail");

    assert!(error.to_string().contains("Missing value(s): name"));
}

#[test]
fn descriptor_call_rejects_missing_values_from_empty_object() {
    let error = transform_macros(
        "import { t } from \"@palamedes/core/macro\";\nconst msg = t({ message: \"Hello {name}\" }, {});\n",
        "test.ts",
        None,
    )
    .expect_err("empty values object should still validate placeholders");

    assert!(error.to_string().contains("Missing value(s): name"));
}

#[test]
fn descriptor_call_rejects_extra_values() {
    let error = transform_macros(
        "import { t } from \"@palamedes/core/macro\";\nconst msg = t({ message: \"Hello\" }, { name });\n",
        "test.ts",
        None,
    )
    .expect_err("extra values should fail");

    assert!(error.to_string().contains("extra value(s): name"));
}

#[test]
fn rejects_unnamed_template_placeholders() {
    let error = transform_macros(
        "import { t } from \"@palamedes/core/macro\";\nconst msg = t`Hello ${firstName + lastName}`;\n",
        "test.ts",
        None,
    )
    .expect_err("unnamed placeholders should fail");

    assert!(error.to_string().contains("stable placeholder name"));
}

#[test]
fn rejects_unnamed_jsx_placeholders() {
    let error = transform_macros(
        "import { Trans } from \"@palamedes/react/macro\";\nconst el = <Trans>Hello {firstName + lastName}</Trans>;\n",
        "test.tsx",
        None,
    )
    .expect_err("unnamed placeholders should fail");

    assert!(error.to_string().contains("stable placeholder name"));
}

#[test]
fn accepts_computed_defaulted_and_literal_choice_values() {
    let result = transform_macros(
        "import { plural } from \"@palamedes/core/macro\";\nconst computed = plural(periodCounts[period] ?? 0, { one: \"# entry\", other: \"# entries\" });\nconst literal = plural(21, { one: \"# month\", other: \"# months\" });\n",
        "test.ts",
        None,
    )
    .expect("choice values should support fallback placeholder names");

    assert!(result
        .code
        .contains("message: \"{period, plural, one {# entry} other {# entries}}\""));
    assert!(result
        .code
        .contains("{ period: periodCounts[period] ?? 0 }"));
    assert!(result
        .code
        .contains("message: \"{value, plural, one {# month} other {# months}}\""));
    assert!(result.code.contains("{ value: 21 }"));
}

#[test]
fn accepts_defaulted_jsx_choice_values() {
    let result = transform_macros(
        "import { Plural } from \"@palamedes/react/macro\";\nconst el = <Plural value={node.locationCount ?? 0} one=\"# location\" other=\"# locations\" />;\n",
        "test.tsx",
        None,
    )
    .expect("JSX choice values should support fallback placeholder names");

    assert!(result
        .code
        .contains("message: \"{locationCount, plural, one {# location} other {# locations}}\""));
    assert!(result
        .code
        .contains("{ locationCount: node.locationCount ?? 0 }"));
}
