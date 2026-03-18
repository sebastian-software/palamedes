use std::collections::HashMap;

use oxc_ast::ast::{
    Argument, Expression, JSXAttributeValue, JSXChild, JSXExpression, JSXOpeningElement,
    ObjectExpression, ObjectPropertyKind, TemplateLiteral,
};

pub(super) fn identifier_name<'a>(expr: &'a Expression<'a>) -> Option<&'a str> {
    match expr.without_parentheses() {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        _ => None,
    }
}

pub(super) fn string_value(expr: &Expression<'_>) -> Option<String> {
    match expr.without_parentheses() {
        Expression::StringLiteral(literal) => Some(literal.value.to_string()),
        Expression::TemplateLiteral(template) => {
            template.single_quasi().map(|value| value.to_string())
        }
        _ => None,
    }
}

pub(super) fn extract_object_properties(object: &ObjectExpression<'_>) -> HashMap<String, String> {
    let mut properties = HashMap::new();

    for property in &object.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            continue;
        };
        let Some(key) = property.key.static_name() else {
            continue;
        };
        let Some(value) = string_value(&property.value) else {
            continue;
        };
        properties.insert(key.into_owned(), value);
    }

    properties
}

pub(super) fn extract_choice_options(object: &ObjectExpression<'_>) -> Vec<(String, String)> {
    let mut options = Vec::new();

    for property in &object.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            continue;
        };
        let Some(key) = property.key.static_name() else {
            continue;
        };
        let Some(value) = string_value(&property.value) else {
            continue;
        };

        let normalized_key = if let Some(exact) = key.strip_prefix('_') {
            format!("={exact}")
        } else {
            key.into_owned()
        };
        options.push((normalized_key, value));
    }

    options
}

pub(super) fn jsx_attribute_string_value(value: &JSXAttributeValue<'_>) -> Option<String> {
    match value {
        JSXAttributeValue::StringLiteral(literal) => Some(literal.value.to_string()),
        JSXAttributeValue::ExpressionContainer(container) => {
            jsx_expression_string_value(&container.expression)
        }
        _ => None,
    }
}

fn jsx_expression_string_value(expr: &JSXExpression<'_>) -> Option<String> {
    match expr {
        JSXExpression::StringLiteral(literal) => Some(literal.value.to_string()),
        JSXExpression::TemplateLiteral(template) => {
            template.single_quasi().map(|value| value.to_string())
        }
        _ => None,
    }
}

pub(super) fn jsx_attributes(opening_element: &JSXOpeningElement<'_>) -> HashMap<String, String> {
    let mut attrs = HashMap::new();

    for attr in &opening_element.attributes {
        let Some(attr) = attr.as_attribute() else {
            continue;
        };
        let key = attr.name.get_identifier().name.to_string();
        let Some(value) = attr.value.as_ref().and_then(jsx_attribute_string_value) else {
            continue;
        };
        attrs.insert(key, value);
    }

    attrs
}

pub(super) fn extract_jsx_value_name(opening_element: &JSXOpeningElement<'_>) -> Option<String> {
    for attr in &opening_element.attributes {
        let Some(attr) = attr.as_attribute() else {
            continue;
        };
        if attr.name.get_identifier().name != "value" {
            continue;
        }
        let Some(JSXAttributeValue::ExpressionContainer(container)) = attr.value.as_ref() else {
            continue;
        };

        return jsx_expression_name(&container.expression);
    }

    None
}

pub(super) fn jsx_expression_name(expr: &JSXExpression<'_>) -> Option<String> {
    match expr {
        JSXExpression::Identifier(identifier) => Some(identifier.name.to_string()),
        JSXExpression::StaticMemberExpression(member) => Some(member.property.name.to_string()),
        JSXExpression::ComputedMemberExpression(member) => {
            member.static_property_name().map(|name| name.to_string())
        }
        JSXExpression::ParenthesizedExpression(expr) => expression_name(&expr.expression),
        _ => None,
    }
}

pub(super) fn extract_choice_options_from_jsx(
    opening_element: &JSXOpeningElement<'_>,
) -> Vec<(String, String)> {
    let mut options = Vec::new();

    for attr in &opening_element.attributes {
        let Some(attr) = attr.as_attribute() else {
            continue;
        };
        let key = attr.name.get_identifier().name.to_string();
        if matches!(
            key.as_str(),
            "id" | "message" | "comment" | "context" | "value" | "offset"
        ) {
            continue;
        }
        let Some(value) = attr.value.as_ref().and_then(jsx_attribute_string_value) else {
            continue;
        };

        if let Some(exact) = key.strip_prefix('_') {
            options.push((format!("={exact}"), value));
        } else {
            options.push((key, value));
        }
    }

    options
}

pub(super) fn clean_jsx_text(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut last_was_whitespace = false;

    for ch in text.chars() {
        if ch.is_whitespace() {
            if !last_was_whitespace {
                result.push(' ');
                last_was_whitespace = true;
            }
        } else {
            result.push(ch);
            last_was_whitespace = false;
        }
    }

    result
}

pub(super) fn opening_element_to_component(
    opening_element: &JSXOpeningElement<'_>,
    source: &str,
) -> String {
    let start = opening_element.span.start as usize;
    let end = opening_element.span.end as usize;
    let markup = &source[start..end];

    if markup.trim_end().ends_with("/>") {
        return markup.to_string();
    }

    if let Some(prefix) = markup.strip_suffix('>') {
        format!("{prefix} />")
    } else {
        format!("{markup} />")
    }
}

pub(super) fn extract_jsx_children_parts(
    children: &[JSXChild<'_>],
    source: &str,
    next_component_index: &mut usize,
) -> (String, Vec<String>, Vec<String>) {
    let mut parts = Vec::new();
    let mut values = Vec::new();
    let mut components = Vec::new();

    for child in children {
        match child {
            JSXChild::Text(text) => {
                let value = clean_jsx_text(text.value.as_str());
                if !value.is_empty() {
                    parts.push(value);
                }
            }
            JSXChild::ExpressionContainer(container) => match &container.expression {
                JSXExpression::StringLiteral(literal) => parts.push(literal.value.to_string()),
                expr => {
                    if let Some(name) = jsx_expression_name(expr) {
                        parts.push(format!("{{{name}}}"));
                        values.push(name);
                    }
                }
            },
            JSXChild::Element(element) => {
                let current_index = *next_component_index;
                *next_component_index += 1;

                let (inner_message, inner_values, inner_components) =
                    extract_jsx_children_parts(&element.children, source, next_component_index);
                parts.push(format!(
                    "<{current_index}>{inner_message}</{current_index}>"
                ));
                values.extend(inner_values);
                components.push(opening_element_to_component(
                    &element.opening_element,
                    source,
                ));
                components.extend(inner_components);
            }
            JSXChild::Fragment(fragment) => {
                let (inner_message, inner_values, inner_components) =
                    extract_jsx_children_parts(&fragment.children, source, next_component_index);
                if !inner_message.is_empty() {
                    parts.push(inner_message);
                }
                values.extend(inner_values);
                components.extend(inner_components);
            }
            JSXChild::Spread(_) => {}
        }
    }

    (parts.join("").trim().to_string(), values, components)
}

pub(super) fn expression_name(expr: &Expression<'_>) -> Option<String> {
    let expr = expr.without_parentheses();

    if let Expression::Identifier(identifier) = expr {
        return Some(identifier.name.to_string());
    }

    if let Some(member) = expr.as_member_expression() {
        return member.static_property_name().map(ToString::to_string);
    }

    None
}

pub(super) fn template_to_message(template: &TemplateLiteral<'_>) -> (String, Option<Vec<String>>) {
    let mut message = String::new();
    let mut values = Vec::new();

    for (index, quasi) in template.quasis.iter().enumerate() {
        if let Some(value) = quasi.value.cooked {
            message.push_str(value.as_str());
        } else {
            message.push_str(quasi.value.raw.as_str());
        }

        if let Some(expr) = template.expressions.get(index) {
            let name = expression_name(expr).unwrap_or_else(|| index.to_string());
            message.push('{');
            message.push_str(&name);
            message.push('}');
            values.push(name);
        }
    }

    (
        message,
        if values.is_empty() {
            None
        } else {
            Some(values)
        },
    )
}

pub(super) fn build_icu_message(
    format: &str,
    value_name: &str,
    options: &[(String, String)],
    offset: Option<&str>,
) -> String {
    let option_parts = options
        .iter()
        .map(|(key, value)| format!("{key} {{{value}}}"))
        .collect::<Vec<_>>()
        .join(" ");
    let offset_part = offset
        .map(|value| format!(" offset:{value}"))
        .unwrap_or_default();

    format!("{{{value_name}, {format},{offset_part} {option_parts}}}")
}

pub(super) fn escape_string(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
}

pub(super) fn first_argument_object<'a>(
    call: &'a oxc_ast::ast::CallExpression<'a>,
) -> Option<&'a ObjectExpression<'a>> {
    let first_arg = call.arguments.first()?;
    let Argument::ObjectExpression(object) = first_arg else {
        return None;
    };
    Some(object)
}
