use ferrocat::compiled_key;
use std::collections::BTreeSet;

use oxc_ast::ast::{
    Argument, CallExpression, JSXElement, ObjectExpression, ObjectPropertyKind, TemplateLiteral,
};
use oxc_span::GetSpan;

use crate::error::{PalamedesError, PalamedesResult};

use super::messages::{
    build_icu_message, choice_expression_binding, escape_string, expression_source,
    extract_choice_options, extract_choice_options_from_jsx, extract_jsx_children_parts,
    extract_jsx_value_binding, extract_object_properties, first_argument_object, jsx_attributes,
    template_to_message, ValueBinding,
};
use super::NativeTransformOptions;

pub(super) fn transform_tagged_template(
    template: &TemplateLiteral<'_>,
    source: &str,
    options: &NativeTransformOptions,
) -> PalamedesResult<Option<(String, String)>> {
    let (message, values) = template_to_message(template, source)?;
    if message.is_empty() {
        return Ok(None);
    }

    let lookup_key = compiled_key(&message, None);
    Ok(Some((
        build_runtime_call(
            &lookup_key,
            Some(&message),
            values.as_deref(),
            None,
            None,
            options,
        ),
        lookup_key,
    )))
}

pub(super) fn transform_descriptor_call(
    call: &CallExpression<'_>,
    source: &str,
    macro_name: &str,
    options: &NativeTransformOptions,
) -> PalamedesResult<Option<(String, String)>> {
    let Some(object) = first_argument_object(call) else {
        return Ok(None);
    };

    transform_descriptor_object(call, object, source, macro_name, options)
}

fn transform_descriptor_object(
    call: &CallExpression<'_>,
    object: &ObjectExpression<'_>,
    source: &str,
    macro_name: &str,
    options: &NativeTransformOptions,
) -> PalamedesResult<Option<(String, String)>> {
    let props = extract_object_properties(object);
    if props.contains_key("id") {
        return Err(PalamedesError::ExplicitMessageIdsUnsupported);
    }
    let message = props.get("message").cloned();
    let context = props.get("context").cloned();
    let comment = props.get("comment").cloned();

    let Some(message) = message else {
        return Ok(None);
    };

    let message = if matches!(macro_name, "t" | "defineMessage" | "msg") {
        message
    } else {
        return Ok(None);
    };

    let lookup_key = compiled_key(&message, context.as_deref());
    let descriptor = build_message_descriptor(
        &lookup_key,
        Some(&message),
        None,
        context.as_deref(),
        comment.as_deref(),
        options,
    );

    if macro_name == "defineMessage" {
        Ok(Some((descriptor, lookup_key)))
    } else {
        let values_text = descriptor_values_argument(call, source, &message)?;
        Ok(Some((
            build_runtime_call_with_values_text(
                &lookup_key,
                Some(&message),
                values_text.as_deref(),
                context.as_deref(),
                comment.as_deref(),
                options,
            ),
            lookup_key,
        )))
    }
}

enum DescriptorValues {
    Bindings(Vec<ValueBinding>),
    Raw(String),
}

fn descriptor_values_argument(
    call: &CallExpression<'_>,
    source: &str,
    message: &str,
) -> PalamedesResult<Option<String>> {
    let Some(argument) = call.arguments.get(1) else {
        return Ok(None);
    };

    match extract_descriptor_values(argument, source) {
        DescriptorValues::Bindings(bindings) => {
            validate_message_values(message, &bindings)?;
            Ok(Some(render_values_object(&bindings)))
        }
        DescriptorValues::Raw(source) => Ok(Some(source)),
    }
}

fn extract_descriptor_values(argument: &Argument<'_>, source: &str) -> DescriptorValues {
    let Argument::ObjectExpression(object) = argument else {
        return DescriptorValues::Raw(argument_source(argument, source));
    };

    let mut bindings = Vec::new();

    for property in &object.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return DescriptorValues::Raw(argument_source(argument, source));
        };
        let Some(key) = property.key.static_name() else {
            return DescriptorValues::Raw(argument_source(argument, source));
        };

        bindings.push(ValueBinding {
            name: key.into_owned(),
            expression: expression_source(&property.value, source),
        });
    }

    DescriptorValues::Bindings(bindings)
}

fn argument_source(argument: &Argument<'_>, source: &str) -> String {
    let span = argument.span();
    source[span.start as usize..span.end as usize].to_string()
}

fn validate_message_values(message: &str, values: &[ValueBinding]) -> PalamedesResult<()> {
    let placeholders = collect_message_placeholders(message);
    let value_names = values
        .iter()
        .map(|binding| binding.name.clone())
        .collect::<BTreeSet<_>>();
    let missing = placeholders
        .difference(&value_names)
        .cloned()
        .collect::<Vec<_>>();
    let extra = value_names
        .difference(&placeholders)
        .cloned()
        .collect::<Vec<_>>();

    if missing.is_empty() && extra.is_empty() {
        return Ok(());
    }

    Err(PalamedesError::MacroValuesMismatch {
        missing: format_names(&missing),
        extra: format_names(&extra),
    })
}

fn collect_message_placeholders(message: &str) -> BTreeSet<String> {
    if let Ok(metadata) = ferrocat::derive_message_metadata_from_icu(message, None) {
        return metadata
            .args
            .into_keys()
            .filter(|name| is_placeholder_name(name.as_str()))
            .collect();
    }

    collect_message_placeholders_from_braces(message)
}

fn collect_message_placeholders_from_braces(message: &str) -> BTreeSet<String> {
    let mut placeholders = BTreeSet::new();
    let mut index = 0usize;

    while let Some(relative_start) = message[index..].find('{') {
        let start = index + relative_start + 1;
        let Some(relative_end) = message[start..].find([',', '}']) else {
            break;
        };
        let end = start + relative_end;
        let name = message[start..end].trim();
        if is_placeholder_name(name) {
            placeholders.insert(name.to_string());
        }
        index = end + 1;
    }

    placeholders
}

fn is_placeholder_name(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !(first == '_' || first == '$' || first.is_ascii_alphabetic()) {
        return false;
    }
    chars.all(|ch| ch == '_' || ch == '$' || ch.is_ascii_alphanumeric())
}

fn format_names(names: &[String]) -> String {
    if names.is_empty() {
        "none".to_string()
    } else {
        names.join(", ")
    }
}

pub(super) fn transform_choice_call(
    call: &CallExpression<'_>,
    source: &str,
    macro_name: &str,
    options: &NativeTransformOptions,
) -> PalamedesResult<Option<(String, String)>> {
    let Some(value_arg) = call.arguments.first() else {
        return Ok(None);
    };
    let Some(options_arg) = call.arguments.get(1) else {
        return Ok(None);
    };

    let Some(value_expr) = value_arg.as_expression() else {
        return Ok(None);
    };
    let oxc_ast::ast::Argument::ObjectExpression(choice_object) = options_arg else {
        return Ok(None);
    };

    let mut used_value_names = std::collections::HashMap::new();
    let value_binding = choice_expression_binding(value_expr, source, &mut used_value_names);
    let value_name = value_binding.name.clone();
    let choice_options = extract_choice_options(choice_object);

    if choice_options.is_empty() {
        return Ok(None);
    }

    let format = if macro_name == "selectOrdinal" {
        "selectordinal"
    } else {
        macro_name
    };
    let message = build_icu_message(format, &value_name, &choice_options, None);
    let lookup_key = compiled_key(&message, None);
    let values = [value_binding];
    Ok(Some((
        build_runtime_call(
            &lookup_key,
            Some(&message),
            Some(&values),
            None,
            None,
            options,
        ),
        lookup_key,
    )))
}

pub(super) fn transform_trans_element(
    element: &JSXElement<'_>,
    source: &str,
    jsx_runtime_module: &str,
) -> PalamedesResult<Option<(String, String)>> {
    let attrs = jsx_attributes(&element.opening_element);
    if attrs.contains_key("id") {
        return Err(PalamedesError::ExplicitMessageIdsUnsupported);
    }
    let context = attrs.get("context").cloned();
    let solid_wrappers = jsx_runtime_module == "@palamedes/solid";

    let (children_message, values, components) =
        extract_jsx_children_parts(&element.children, source, solid_wrappers)?;
    let message = attrs
        .get("message")
        .cloned()
        .or_else(|| (!children_message.is_empty()).then_some(children_message));
    let Some(message) = message else {
        return Ok(None);
    };
    let lookup_key = compiled_key(&message, context.as_deref());

    let mut attrs = vec![
        format!("id=\"{}\"", escape_string(&lookup_key)),
        format!("message={{\"{}\"}}", escape_string(&message)),
    ];

    if !components.is_empty() {
        let components_prop = render_value_bindings(&components);
        attrs.push(format!("components={{{{ {components_prop} }}}}"));
    }

    if !values.is_empty() {
        attrs.push(format!(
            "values={{{{ {} }}}}",
            render_value_bindings(&values)
        ));
    }

    Ok(Some((format!("<Trans {} />", attrs.join(" ")), lookup_key)))
}

pub(super) fn transform_choice_jsx_element(
    element: &JSXElement<'_>,
    source: &str,
    macro_name: &str,
    options: &NativeTransformOptions,
) -> PalamedesResult<Option<(String, String)>> {
    let attrs = jsx_attributes(&element.opening_element);
    if attrs.contains_key("id") {
        return Err(PalamedesError::ExplicitMessageIdsUnsupported);
    }
    let context = attrs.get("context").cloned();
    let comment = attrs.get("comment").cloned();
    let Some(value_binding) = extract_jsx_value_binding(&element.opening_element, source)? else {
        return Ok(None);
    };
    let value_name = value_binding.name.clone();
    let choice_options = extract_choice_options_from_jsx(&element.opening_element);

    if choice_options.is_empty() {
        return Ok(None);
    }

    let format = match macro_name {
        "Plural" => "plural",
        "Select" => "select",
        "SelectOrdinal" => "selectordinal",
        _ => return Ok(None),
    };
    let message = build_icu_message(
        format,
        &value_name,
        &choice_options,
        attrs.get("offset").map(String::as_str),
    );
    let lookup_key = compiled_key(&message, context.as_deref());
    let values = [value_binding];
    Ok(Some((
        build_runtime_call(
            &lookup_key,
            Some(&message),
            Some(&values),
            context.as_deref(),
            comment.as_deref(),
            options,
        ),
        lookup_key,
    )))
}

fn build_message_descriptor(
    lookup_key: &str,
    message: Option<&str>,
    values: Option<&[String]>,
    context: Option<&str>,
    comment: Option<&str>,
    options: &NativeTransformOptions,
) -> String {
    let mut parts = vec![format!("id: \"{}\"", escape_string(lookup_key))];

    if let Some(message) = message {
        if !options.strip_message_field.unwrap_or(false) {
            parts.push(format!("message: \"{}\"", escape_string(message)));
        }
    }

    if let Some(values) = values {
        if !values.is_empty() {
            parts.push(format!("values: {{ {} }}", values.join(", ")));
        }
    }

    if let Some(context) = context {
        if !options.strip_non_essential_props.unwrap_or(false) {
            parts.push(format!("context: \"{}\"", escape_string(context)));
        }
    }

    if let Some(comment) = comment {
        if !options.strip_non_essential_props.unwrap_or(false) {
            parts.push(format!("comment: \"{}\"", escape_string(comment)));
        }
    }

    format!("{{ {} }}", parts.join(", "))
}

fn build_runtime_call(
    lookup_key: &str,
    message: Option<&str>,
    values: Option<&[ValueBinding]>,
    context: Option<&str>,
    comment: Option<&str>,
    options: &NativeTransformOptions,
) -> String {
    let values_text = values
        .filter(|values| !values.is_empty())
        .map(|values| format!("{{ {} }}", render_value_bindings(values)));

    build_runtime_call_with_values_text(
        lookup_key,
        message,
        values_text.as_deref(),
        context,
        comment,
        options,
    )
}

fn build_runtime_call_with_values_text(
    lookup_key: &str,
    message: Option<&str>,
    values_text: Option<&str>,
    context: Option<&str>,
    comment: Option<&str>,
    options: &NativeTransformOptions,
) -> String {
    let runtime_import_name = options.runtime_import_name.as_deref().unwrap_or("getI18n");
    let descriptor = build_runtime_descriptor(message, context, comment, options);

    match (values_text, descriptor) {
        (None, None) => format!(
            "{runtime_import_name}()._(\"{}\")",
            escape_string(lookup_key)
        ),
        (Some(values), None) => {
            format!(
                "{runtime_import_name}()._(\"{}\", {values})",
                escape_string(lookup_key)
            )
        }
        (None, Some(descriptor)) => format!(
            "{runtime_import_name}()._(\"{}\", undefined, {descriptor})",
            escape_string(lookup_key)
        ),
        (Some(values), Some(descriptor)) => format!(
            "{runtime_import_name}()._(\"{}\", {values}, {descriptor})",
            escape_string(lookup_key)
        ),
    }
}

fn render_value_bindings(values: &[ValueBinding]) -> String {
    values
        .iter()
        .map(|binding| {
            if binding.name == binding.expression {
                binding.name.clone()
            } else {
                format!("{}: {}", binding.name, binding.expression)
            }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn render_values_object(values: &[ValueBinding]) -> String {
    if values.is_empty() {
        "{}".to_string()
    } else {
        format!("{{ {} }}", render_value_bindings(values))
    }
}

fn build_runtime_descriptor(
    message: Option<&str>,
    context: Option<&str>,
    comment: Option<&str>,
    options: &NativeTransformOptions,
) -> Option<String> {
    let mut parts = Vec::new();

    if let Some(message) = message {
        if !options.strip_message_field.unwrap_or(false) {
            parts.push(format!("message: \"{}\"", escape_string(message)));
        }
    }

    if let Some(context) = context {
        if !options.strip_non_essential_props.unwrap_or(false) {
            parts.push(format!("context: \"{}\"", escape_string(context)));
        }
    }

    if let Some(comment) = comment {
        if !options.strip_non_essential_props.unwrap_or(false) {
            parts.push(format!("comment: \"{}\"", escape_string(comment)));
        }
    }

    (!parts.is_empty()).then(|| format!("{{ {} }}", parts.join(", ")))
}
