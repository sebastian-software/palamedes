use ferrocat::compiled_key;
use std::collections::BTreeSet;

use oxc_ast::ast::{
    Argument, CallExpression, Expression, JSXElement, ObjectExpression, ObjectPropertyKind,
    TemplateLiteral,
};
use oxc_span::GetSpan;

use crate::descriptor::{
    descriptor_property_value, descriptor_static_property, unsupported_macro_syntax,
};
use crate::error::{PalamedesError, PalamedesResult};

use super::messages::{
    append_unique_bindings, build_icu_message, choice_expression_binding, escape_string,
    expression_source, extract_choice_options, extract_choice_options_from_jsx,
    extract_jsx_children_parts, extract_jsx_value_binding, first_argument_object, jsx_attributes,
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
    location: &str,
    options: &NativeTransformOptions,
) -> PalamedesResult<Option<(String, String)>> {
    let Some(object) = first_argument_object(call) else {
        return Err(unsupported_macro_syntax(
            macro_name,
            location,
            "the first argument must be a descriptor object",
        ));
    };

    transform_descriptor_object(call, object, source, macro_name, location, options)
}

fn transform_descriptor_object(
    call: &CallExpression<'_>,
    object: &ObjectExpression<'_>,
    source: &str,
    macro_name: &str,
    location: &str,
    options: &NativeTransformOptions,
) -> PalamedesResult<Option<(String, String)>> {
    if descriptor_property_value(object, "id").is_some() {
        return Err(PalamedesError::ExplicitMessageIdsUnsupported);
    }

    let Some(message_expression) = descriptor_property_value(object, "message") else {
        return Err(unsupported_macro_syntax(
            macro_name,
            location,
            "the descriptor must contain a static `message` property",
        ));
    };

    let (message, implicit_values) = match message_expression.without_parentheses() {
        Expression::StringLiteral(literal) => (literal.value.to_string(), Vec::new()),
        Expression::TemplateLiteral(template) => {
            let (message, values) = template_to_message(template, source)?;
            (message, values.unwrap_or_default())
        }
        _ => {
            return Err(unsupported_macro_syntax(
                macro_name,
                location,
                "the descriptor `message` must be a string literal or template literal",
            ));
        }
    };
    let context = descriptor_static_property(object, "context", macro_name, location)?;
    let comment = descriptor_static_property(object, "comment", macro_name, location)?;

    let lookup_key = compiled_key(&message, context.as_deref());
    let values_text = descriptor_values_argument(
        call,
        source,
        &message,
        implicit_values,
        macro_name,
        location,
    )?;
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

enum DescriptorValues {
    Bindings(Vec<ValueBinding>),
    Raw(String),
}

fn descriptor_values_argument(
    call: &CallExpression<'_>,
    source: &str,
    message: &str,
    implicit_values: Vec<ValueBinding>,
    macro_name: &str,
    location: &str,
) -> PalamedesResult<Option<String>> {
    let Some(argument) = call.arguments.get(1) else {
        if implicit_values.is_empty() {
            return Ok(None);
        }
        validate_message_values(message, &implicit_values)?;
        return Ok(Some(render_values_object(&implicit_values)));
    };

    match extract_descriptor_values(argument, source) {
        DescriptorValues::Bindings(explicit_values) => {
            let bindings = merge_descriptor_values(
                implicit_values,
                explicit_values,
                macro_name,
                location,
            )?;
            validate_message_values(message, &bindings)?;
            Ok(Some(render_values_object(&bindings)))
        }
        DescriptorValues::Raw(source) if implicit_values.is_empty() => Ok(Some(source)),
        DescriptorValues::Raw(_) => Err(unsupported_macro_syntax(
            macro_name,
            location,
            "interpolated descriptor templates can only be combined with an object-literal values argument",
        )),
    }
}

fn merge_descriptor_values(
    mut implicit_values: Vec<ValueBinding>,
    explicit_values: Vec<ValueBinding>,
    macro_name: &str,
    location: &str,
) -> PalamedesResult<Vec<ValueBinding>> {
    for binding in explicit_values {
        if let Some(existing) = implicit_values
            .iter()
            .find(|existing| existing.name == binding.name)
        {
            if existing.expression == binding.expression {
                continue;
            }
            return Err(unsupported_macro_syntax(
                macro_name,
                location,
                format!(
                    "the explicit value `{}` conflicts with the expression captured by the message template",
                    binding.name
                ),
            ));
        }
        implicit_values.push(binding);
    }
    Ok(implicit_values)
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
    let extracted_options = extract_choice_options(choice_object, source, &mut used_value_names)?;

    if extracted_options.options.is_empty() {
        return Ok(None);
    }

    let format = if macro_name == "selectOrdinal" {
        "selectordinal"
    } else {
        macro_name
    };
    let message = build_icu_message(format, &value_name, &extracted_options.options, None);
    let lookup_key = compiled_key(&message, None);
    let mut values = vec![value_binding];
    append_unique_bindings(&mut values, extracted_options.values);
    Ok(Some((
        build_runtime_call(
            &lookup_key,
            Some(&message),
            Some(values.as_slice()),
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
    let mut used_value_names = std::collections::HashMap::new();
    let Some(value_binding) =
        extract_jsx_value_binding(&element.opening_element, source, &mut used_value_names)?
    else {
        return Ok(None);
    };
    let value_name = value_binding.name.clone();
    let extracted_options =
        extract_choice_options_from_jsx(&element.opening_element, source, &mut used_value_names)?;

    if extracted_options.options.is_empty() {
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
        &extracted_options.options,
        attrs.get("offset").map(String::as_str),
    );
    let lookup_key = compiled_key(&message, context.as_deref());
    let mut values = vec![value_binding];
    append_unique_bindings(&mut values, extracted_options.values);
    Ok(Some((
        build_runtime_call(
            &lookup_key,
            Some(&message),
            Some(values.as_slice()),
            context.as_deref(),
            comment.as_deref(),
            options,
        ),
        lookup_key,
    )))
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
