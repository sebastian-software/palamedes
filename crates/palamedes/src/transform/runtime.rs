use ferrocat::compiled_key;
use oxc_ast::ast::{CallExpression, JSXElement, ObjectExpression, TemplateLiteral};

use crate::error::{PalamedesError, PalamedesResult};

use super::messages::{
    build_icu_message, escape_string, expression_binding, extract_choice_options,
    extract_choice_options_from_jsx, extract_jsx_children_parts, extract_jsx_value_binding,
    extract_object_properties, first_argument_object, jsx_attributes, template_to_message,
    ValueBinding,
};
use super::NativeTransformOptions;

pub(super) fn transform_tagged_template(
    template: &TemplateLiteral<'_>,
    source: &str,
    options: &NativeTransformOptions,
) -> Option<(String, String)> {
    let (message, values) = template_to_message(template, source);
    if message.is_empty() {
        return None;
    }

    let lookup_key = compiled_key(&message, None);
    Some((
        build_runtime_call(
            &lookup_key,
            Some(&message),
            values.as_deref(),
            None,
            None,
            options,
        ),
        lookup_key,
    ))
}

pub(super) fn transform_descriptor_call(
    call: &CallExpression<'_>,
    macro_name: &str,
    options: &NativeTransformOptions,
) -> PalamedesResult<Option<(String, String)>> {
    let Some(object) = first_argument_object(call) else {
        return Ok(None);
    };

    transform_descriptor_object(object, macro_name, options)
}

fn transform_descriptor_object(
    object: &ObjectExpression<'_>,
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
        Ok(Some((
            build_runtime_call(
                &lookup_key,
                Some(&message),
                None,
                context.as_deref(),
                comment.as_deref(),
                options,
            ),
            lookup_key,
        )))
    }
}

pub(super) fn transform_choice_call(
    call: &CallExpression<'_>,
    source: &str,
    macro_name: &str,
    options: &NativeTransformOptions,
) -> Option<(String, String)> {
    let value_arg = call.arguments.first()?;
    let options_arg = call.arguments.get(1)?;

    let value_expr = value_arg.as_expression()?;
    let oxc_ast::ast::Argument::ObjectExpression(choice_object) = options_arg else {
        return None;
    };

    let mut used_value_names = std::collections::HashMap::new();
    let value_binding = expression_binding(value_expr, source, 0, &mut used_value_names);
    let value_name = value_binding.name.clone();
    let choice_options = extract_choice_options(choice_object);

    if choice_options.is_empty() {
        return None;
    }

    let format = if macro_name == "selectOrdinal" {
        "selectordinal"
    } else {
        macro_name
    };
    let message = build_icu_message(format, &value_name, &choice_options, None);
    let lookup_key = compiled_key(&message, None);
    let values = [value_binding];
    Some((
        build_runtime_call(
            &lookup_key,
            Some(&message),
            Some(&values),
            None,
            None,
            options,
        ),
        lookup_key,
    ))
}

pub(super) fn transform_trans_element(
    element: &JSXElement<'_>,
    source: &str,
) -> PalamedesResult<Option<(String, String)>> {
    let attrs = jsx_attributes(&element.opening_element);
    if attrs.contains_key("id") {
        return Err(PalamedesError::ExplicitMessageIdsUnsupported);
    }
    let context = attrs.get("context").cloned();

    let mut next_component_index = 0usize;
    let (children_message, values, components) =
        extract_jsx_children_parts(&element.children, source, &mut next_component_index);
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
        format!("message=\"{}\"", escape_string(&message)),
    ];

    if !components.is_empty() {
        let components_prop = components
            .iter()
            .enumerate()
            .map(|(index, component)| format!("{index}: {component}"))
            .collect::<Vec<_>>()
            .join(", ");
        attrs.push(format!("components={{{{ {components_prop} }}}}"));
    }

    if !values.is_empty() {
        attrs.push(format!("values={{{{ {} }}}}", render_value_bindings(&values)));
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
    let Some(value_binding) = extract_jsx_value_binding(&element.opening_element, source) else {
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
    let runtime_import_name = options.runtime_import_name.as_deref().unwrap_or("getI18n");
    let descriptor = build_runtime_descriptor(message, context, comment, options);
    let values_text = values
        .filter(|values| !values.is_empty())
        .map(|values| format!("{{ {} }}", render_value_bindings(values)));

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
