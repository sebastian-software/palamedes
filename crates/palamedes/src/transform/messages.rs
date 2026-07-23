use std::collections::HashMap;

use oxc_ast::ast::{
    Argument, CallExpression, Expression, JSXAttributeValue, JSXChild, JSXExpression,
    JSXOpeningElement, ObjectExpression, ObjectPropertyKind, TemplateLiteral,
};
use oxc_span::GetSpan;

use crate::error::{PalamedesError, PalamedesResult};
use crate::jsx_entities::decode_jsx_entities;
use crate::jsx_message::{
    clean_jsx_text, join_jsx_message_parts, JoinedJsxMessage, JsxMessagePart,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ValueBinding {
    pub expression: String,
    pub name: String,
}

pub(super) struct ExtractedChoiceOptions {
    pub options: Vec<(String, String)>,
    pub values: Vec<ValueBinding>,
}

const CHOICE_VALUE_FALLBACK_NAME: &str = "value";

pub(super) fn identifier_name<'a>(expr: &'a Expression<'a>) -> Option<&'a str> {
    match expr.without_parentheses() {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        _ => None,
    }
}

pub(super) fn extract_choice_options(
    object: &ObjectExpression<'_>,
    source: &str,
    used_value_names: &mut HashMap<String, String>,
) -> PalamedesResult<ExtractedChoiceOptions> {
    let mut options = Vec::new();
    let mut values = Vec::new();

    for property in &object.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            continue;
        };
        let Some(key) = property.key.static_name() else {
            continue;
        };
        let (value, option_values) = match property.value.without_parentheses() {
            Expression::StringLiteral(literal) => (literal.value.to_string(), Vec::new()),
            Expression::TemplateLiteral(template) => template_to_message_with_state(
                template,
                source,
                "choice option template expression",
                used_value_names,
            )?,
            _ => continue,
        };

        let normalized_key = if let Some(exact) = key.strip_prefix('_') {
            format!("={exact}")
        } else {
            key.into_owned()
        };
        options.push((normalized_key, value));
        append_unique_bindings(&mut values, option_values);
    }

    Ok(ExtractedChoiceOptions { options, values })
}

pub(super) fn jsx_attribute_string_value(value: &JSXAttributeValue<'_>) -> Option<String> {
    match value {
        JSXAttributeValue::StringLiteral(literal) => {
            Some(decode_jsx_entities(literal.value.as_str()))
        }
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

pub(super) fn extract_jsx_value_binding(
    opening_element: &JSXOpeningElement<'_>,
    source: &str,
    used_value_names: &mut HashMap<String, String>,
) -> PalamedesResult<Option<ValueBinding>> {
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

        return Ok(Some(choice_jsx_value_binding(
            &container.expression,
            source,
            used_value_names,
        )));
    }

    Ok(None)
}

pub(super) fn jsx_expression_name(expr: &JSXExpression<'_>) -> Option<String> {
    match expr {
        JSXExpression::Identifier(identifier) => Some(identifier.name.to_string()),
        JSXExpression::StaticMemberExpression(member) => Some(member.property.name.to_string()),
        JSXExpression::ComputedMemberExpression(member) => member
            .static_property_name()
            .map(|name| name.to_string())
            .or_else(|| expression_name(&member.expression)),
        JSXExpression::CallExpression(call) => call_expression_name(call),
        JSXExpression::LogicalExpression(logical) if logical.operator.is_coalesce() => {
            expression_name(&logical.left).or_else(|| expression_name(&logical.right))
        }
        JSXExpression::LogicalExpression(logical) if logical.operator.is_or() => {
            expression_name(&logical.left).or_else(|| expression_name(&logical.right))
        }
        JSXExpression::ParenthesizedExpression(expr) => expression_name(&expr.expression),
        _ => None,
    }
}

fn getter_name(name: &str) -> Option<String> {
    if !name.starts_with("get") || name.len() <= 3 {
        return None;
    }
    let suffix = &name[3..];
    let first = suffix.chars().next()?;
    first.is_ascii_uppercase().then(|| {
        let mut result = first.to_ascii_lowercase().to_string();
        result.push_str(&suffix[first.len_utf8()..]);
        result
    })
}

// Derive a placeholder name from a call expression. Prefer the unwrapped
// getter name (`getCount()` -> `count`), but fall back to the bare callee for
// argument-less accessor calls so reactive signal reads (`count()`, Solid's
// `props.quantity()`) keep their own name instead of collapsing to "value".
fn call_expression_name(call: &CallExpression<'_>) -> Option<String> {
    let callee = call.callee_name()?;
    getter_name(callee).or_else(|| call.arguments.is_empty().then(|| callee.to_string()))
}

pub(super) fn extract_choice_options_from_jsx(
    opening_element: &JSXOpeningElement<'_>,
    source: &str,
    used_value_names: &mut HashMap<String, String>,
) -> PalamedesResult<ExtractedChoiceOptions> {
    let mut options = Vec::new();
    let mut values = Vec::new();

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
        let Some(attr_value) = attr.value.as_ref() else {
            continue;
        };
        let (value, option_values) = match attr_value {
            JSXAttributeValue::StringLiteral(literal) => {
                (decode_jsx_entities(literal.value.as_str()), Vec::new())
            }
            JSXAttributeValue::ExpressionContainer(container) => match &container.expression {
                JSXExpression::StringLiteral(literal) => (literal.value.to_string(), Vec::new()),
                JSXExpression::TemplateLiteral(template) => template_to_message_with_state(
                    template,
                    source,
                    "choice option template expression",
                    used_value_names,
                )?,
                _ => continue,
            },
            _ => continue,
        };

        if let Some(exact) = key.strip_prefix('_') {
            options.push((format!("={exact}"), value));
        } else {
            options.push((key, value));
        }
        append_unique_bindings(&mut values, option_values);
    }

    Ok(ExtractedChoiceOptions { options, values })
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

pub(super) fn opening_element_to_component_wrapper(
    opening_element: &JSXOpeningElement<'_>,
    source: &str,
) -> String {
    let start = opening_element.span.start as usize;
    let end = opening_element.span.end as usize;
    let markup = source[start..end].trim().to_string();
    let name_span = opening_element.name.span();
    let name = source[name_span.start as usize..name_span.end as usize].to_string();

    let opening = if let Some(prefix) = markup.strip_suffix("/>") {
        format!("{}>", prefix.trim_end())
    } else if markup.ends_with('>') {
        markup
    } else {
        format!("{markup}>")
    };

    format!("(children) => {opening}{{children}}</{name}>")
}

pub(super) fn extract_jsx_children_parts(
    children: &[JSXChild<'_>],
    source: &str,
    solid_wrappers: bool,
) -> PalamedesResult<(String, Vec<ValueBinding>, Vec<ValueBinding>)> {
    let mut used_value_names = HashMap::<String, String>::new();
    let mut next_component_index = 0usize;

    let (joined_message, values, components) = extract_jsx_children_parts_with_state(
        children,
        source,
        solid_wrappers,
        &mut used_value_names,
        &mut next_component_index,
    )?;

    Ok((joined_message.message, values, components))
}

fn extract_jsx_children_parts_with_state(
    children: &[JSXChild<'_>],
    source: &str,
    solid_wrappers: bool,
    used_value_names: &mut HashMap<String, String>,
    next_component_index: &mut usize,
) -> PalamedesResult<(JoinedJsxMessage, Vec<ValueBinding>, Vec<ValueBinding>)> {
    let mut parts = Vec::new();
    let mut values = Vec::new();
    let mut components = Vec::new();

    for child in children {
        match child {
            JSXChild::Text(text) => {
                let value = clean_jsx_text(text.value.as_str());
                if !value.is_empty() {
                    parts.push(JsxMessagePart::Text(value));
                }
            }
            JSXChild::ExpressionContainer(container) => match &container.expression {
                JSXExpression::StringLiteral(literal) => {
                    parts.push(JsxMessagePart::Text(literal.value.to_string()));
                }
                expr => {
                    let binding =
                        jsx_value_binding(expr, source, "JSX expression", used_value_names)?;
                    parts.push(JsxMessagePart::ValuePlaceholder(format!(
                        "{{{}}}",
                        binding.name
                    )));
                    push_unique_binding(&mut values, binding);
                }
            },
            JSXChild::Element(element) => {
                let component_expression = if solid_wrappers {
                    opening_element_to_component_wrapper(&element.opening_element, source)
                } else {
                    opening_element_to_component(&element.opening_element, source)
                };
                let component_name = next_component_index.to_string();
                *next_component_index += 1;

                let (inner_message, inner_values, inner_components) =
                    extract_jsx_children_parts_with_state(
                        &element.children,
                        source,
                        solid_wrappers,
                        used_value_names,
                        next_component_index,
                    )?;
                let is_empty = inner_message.message.is_empty();
                let value = if is_empty {
                    format!("<{component_name}/>")
                } else {
                    format!(
                        "<{component_name}>{}</{component_name}>",
                        inner_message.message
                    )
                };
                parts.push(JsxMessagePart::ComponentPlaceholder { value, is_empty });
                append_unique_bindings(&mut values, inner_values);
                components.push(ValueBinding {
                    expression: component_expression,
                    name: component_name,
                });
                components.extend(inner_components);
            }
            JSXChild::Fragment(fragment) => {
                let (inner_message, inner_values, inner_components) =
                    extract_jsx_children_parts_with_state(
                        &fragment.children,
                        source,
                        solid_wrappers,
                        used_value_names,
                        next_component_index,
                    )?;
                if !inner_message.message.is_empty() {
                    parts.push(JsxMessagePart::Message {
                        value: inner_message.message,
                        ends_with_placeholder: inner_message.ends_with_placeholder,
                    });
                }
                append_unique_bindings(&mut values, inner_values);
                components.extend(inner_components);
            }
            JSXChild::Spread(_) => {
                return Err(PalamedesError::UnnamedPlaceholder {
                    syntax: "JSX spread child",
                });
            }
        }
    }

    Ok((join_jsx_message_parts(&parts), values, components))
}

fn push_unique_binding(bindings: &mut Vec<ValueBinding>, binding: ValueBinding) {
    if bindings
        .iter()
        .any(|existing| existing.name == binding.name && existing.expression == binding.expression)
    {
        return;
    }

    bindings.push(binding);
}

pub(super) fn append_unique_bindings(
    bindings: &mut Vec<ValueBinding>,
    incoming: Vec<ValueBinding>,
) {
    for binding in incoming {
        push_unique_binding(bindings, binding);
    }
}

pub(super) fn expression_name(expr: &Expression<'_>) -> Option<String> {
    let expr = expr.without_parentheses();

    match expr {
        Expression::Identifier(identifier) => Some(identifier.name.to_string()),
        Expression::StaticMemberExpression(member) => Some(member.property.name.to_string()),
        Expression::ComputedMemberExpression(member) => member
            .static_property_name()
            .map(|name| name.to_string())
            .or_else(|| expression_name(&member.expression)),
        Expression::CallExpression(call) => call_expression_name(call),
        Expression::LogicalExpression(logical) if logical.operator.is_coalesce() => {
            expression_name(&logical.left).or_else(|| expression_name(&logical.right))
        }
        Expression::LogicalExpression(logical) if logical.operator.is_or() => {
            expression_name(&logical.left).or_else(|| expression_name(&logical.right))
        }
        _ => None,
    }
}

pub(super) fn expression_source(expr: &Expression<'_>, source: &str) -> String {
    let span = expr.span();
    source[span.start as usize..span.end as usize].to_string()
}

fn make_unique_binding_name(
    preferred_name: String,
    expression: &str,
    used_value_names: &mut HashMap<String, String>,
) -> String {
    if let Some(existing_expression) = used_value_names.get(&preferred_name) {
        if existing_expression == expression {
            return preferred_name;
        }
    } else {
        used_value_names.insert(preferred_name.clone(), expression.to_string());
        return preferred_name;
    }

    let mut suffix = 1usize;
    loop {
        let candidate = format!("{preferred_name}_{suffix}");
        match used_value_names.get(&candidate) {
            Some(existing_expression) if existing_expression != expression => {
                suffix += 1;
            }
            _ => {
                used_value_names.insert(candidate.clone(), expression.to_string());
                return candidate;
            }
        }
    }
}

pub(super) fn expression_binding(
    expr: &Expression<'_>,
    source: &str,
    syntax: &'static str,
    used_value_names: &mut HashMap<String, String>,
) -> PalamedesResult<ValueBinding> {
    let expression = expression_source(expr, source);
    let Some(preferred_name) = expression_name(expr) else {
        return Err(PalamedesError::UnnamedPlaceholder { syntax });
    };
    let name = make_unique_binding_name(preferred_name, &expression, used_value_names);

    Ok(ValueBinding { expression, name })
}

pub(super) fn choice_expression_binding(
    expr: &Expression<'_>,
    source: &str,
    used_value_names: &mut HashMap<String, String>,
) -> ValueBinding {
    let expression = expression_source(expr, source);
    let preferred_name =
        expression_name(expr).unwrap_or_else(|| CHOICE_VALUE_FALLBACK_NAME.to_string());
    let name = make_unique_binding_name(preferred_name, &expression, used_value_names);

    ValueBinding { expression, name }
}

fn jsx_expression_source(expr: &JSXExpression<'_>, source: &str) -> Option<String> {
    match expr {
        JSXExpression::EmptyExpression(_) => None,
        _ => {
            let span = expr.span();
            Some(source[span.start as usize..span.end as usize].to_string())
        }
    }
}

pub(super) fn jsx_value_binding(
    expr: &JSXExpression<'_>,
    source: &str,
    syntax: &'static str,
    used_value_names: &mut HashMap<String, String>,
) -> PalamedesResult<ValueBinding> {
    let expression = jsx_expression_source(expr, source).unwrap_or_default();
    let Some(preferred_name) = jsx_expression_name(expr) else {
        return Err(PalamedesError::UnnamedPlaceholder { syntax });
    };
    let name = make_unique_binding_name(preferred_name, &expression, used_value_names);

    Ok(ValueBinding { expression, name })
}

pub(super) fn choice_jsx_value_binding(
    expr: &JSXExpression<'_>,
    source: &str,
    used_value_names: &mut HashMap<String, String>,
) -> ValueBinding {
    let expression = jsx_expression_source(expr, source).unwrap_or_default();
    let preferred_name =
        jsx_expression_name(expr).unwrap_or_else(|| CHOICE_VALUE_FALLBACK_NAME.to_string());
    let name = make_unique_binding_name(preferred_name, &expression, used_value_names);

    ValueBinding { expression, name }
}

pub(super) fn template_to_message(
    template: &TemplateLiteral<'_>,
    source: &str,
) -> PalamedesResult<(String, Option<Vec<ValueBinding>>)> {
    let mut used_value_names = HashMap::<String, String>::new();
    let (message, values) = template_to_message_with_state(
        template,
        source,
        "template expression",
        &mut used_value_names,
    )?;

    Ok((
        message,
        if values.is_empty() {
            None
        } else {
            Some(values)
        },
    ))
}

fn template_to_message_with_state(
    template: &TemplateLiteral<'_>,
    source: &str,
    syntax: &'static str,
    used_value_names: &mut HashMap<String, String>,
) -> PalamedesResult<(String, Vec<ValueBinding>)> {
    let mut message = String::new();
    let mut values = Vec::new();

    for (index, quasi) in template.quasis.iter().enumerate() {
        if let Some(value) = quasi.value.cooked {
            message.push_str(value.as_str());
        } else {
            message.push_str(quasi.value.raw.as_str());
        }

        if let Some(expr) = template.expressions.get(index) {
            let binding = expression_binding(expr, source, syntax, used_value_names)?;
            message.push('{');
            message.push_str(&binding.name);
            message.push('}');
            push_unique_binding(&mut values, binding);
        }
    }

    Ok((message, values))
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
