use super::{transform_macros, NativeTransformOptions};
use ferrocat::compiled_key;

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
        vec![compiled_key("Hello {name}", None)]
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
fn transforms_define_message_without_runtime_import() {
    let result = transform_macros(
        "import { defineMessage } from \"@palamedes/core/macro\";\nconst msg = defineMessage({ message: \"Hello\" });\n",
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
        .contains("import { Trans } from \"@palamedes/react\";"));
    assert!(result.code.contains("<Trans id=\""));
    assert!(result.code.contains("message={\"Hello {name}\"}"));
    assert!(result.code.contains("values={{ name }}"));
    assert!(!result.code.contains("@palamedes/runtime"));
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
        .contains("import { Trans } from \"@palamedes/solid\";"));
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
        .find("import { Trans } from \"@palamedes/react\";")
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
        .contains(&format!("id=\"{}\"", compiled_key(message, None))));
    assert_eq!(result.compiled_ids, vec![compiled_key(message, None)]);
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
    assert_eq!(result.compiled_ids, vec![compiled_key(message, None)]);
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
            compiled_key(child_message, None),
            compiled_key(attr_message, None)
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
fn rejects_unnamed_choice_value_placeholders() {
    let error = transform_macros(
        "import { plural } from \"@palamedes/core/macro\";\nconst msg = plural(count + 1, { one: \"# item\", other: \"# items\" });\n",
        "test.ts",
        None,
    )
    .expect_err("unnamed choice value should fail");

    assert!(error.to_string().contains("stable placeholder name"));
}
