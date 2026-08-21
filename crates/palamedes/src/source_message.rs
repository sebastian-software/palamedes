//! Shared lowering helpers for authored JavaScript and JSX messages.
//!
//! Extraction owns catalog identity while transformation owns generated runtime
//! bindings. Both must derive the same names and source expressions.

use std::collections::{BTreeMap, HashMap};

use oxc_ast::ast::{
    Expression, JSXAttributeValue, JSXChild, JSXExpression, JSXOpeningElement, ObjectExpression,
    ObjectPropertyKind, TemplateLiteral,
};
use oxc_span::GetSpan;

use crate::choice::{
    expression_offset_value, invalid_choice_option, invalid_offset, is_plural_format,
    jsx_offset_value, normalize_choice_option_key,
};
use crate::error::{PalamedesError, PalamedesResult};
use crate::jsx_entities::decode_jsx_entities;
use crate::jsx_message::{clean_jsx_text, join_jsx_message_parts, JsxMessagePart};
use crate::placeholder_name::{expression_name, jsx_expression_name};
use crate::source::DiagnosticLocation;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SourceValue {
    pub(crate) expression: String,
    pub(crate) name: String,
}

pub(crate) struct LoweredJsxMessage {
    pub(crate) ends_with_placeholder: bool,
    pub(crate) message: String,
    pub(crate) values: Vec<SourceValue>,
    pub(crate) components: Vec<SourceValue>,
}

pub(crate) struct LoweredChoiceOptions {
    pub(crate) options: Vec<(String, String)>,
    pub(crate) values: Vec<SourceValue>,
    pub(crate) offset: Option<String>,
}

const CHOICE_VALUE_FALLBACK_NAME: &str = "value";

pub(crate) fn make_unique_value_name(
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
            Some(existing_expression) if existing_expression != expression => suffix += 1,
            _ => {
                used_value_names.insert(candidate.clone(), expression.to_string());
                return candidate;
            }
        }
    }
}

pub(crate) fn expression_source(expr: &Expression<'_>, source: &str) -> Option<String> {
    let span = expr.span();
    source
        .get(span.start as usize..span.end as usize)
        .map(str::trim)
        .filter(|expression| !expression.is_empty())
        .map(ToOwned::to_owned)
}

pub(crate) fn jsx_expression_source(expr: &JSXExpression<'_>, source: &str) -> Option<String> {
    match expr {
        JSXExpression::EmptyExpression(_) => None,
        _ => {
            let span = expr.span();
            source
                .get(span.start as usize..span.end as usize)
                .map(str::trim)
                .filter(|expression| !expression.is_empty())
                .map(ToOwned::to_owned)
        }
    }
}

pub(crate) fn jsx_attribute_string_value(value: &JSXAttributeValue<'_>) -> Option<String> {
    match value {
        JSXAttributeValue::StringLiteral(literal) => {
            Some(decode_jsx_entities(literal.value.as_str()))
        }
        JSXAttributeValue::ExpressionContainer(container) => match &container.expression {
            JSXExpression::StringLiteral(literal) => Some(literal.value.to_string()),
            JSXExpression::TemplateLiteral(template) => {
                template.single_quasi().map(|value| value.to_string())
            }
            _ => None,
        },
        _ => None,
    }
}

pub(crate) fn jsx_attributes(opening_element: &JSXOpeningElement<'_>) -> BTreeMap<String, String> {
    let mut attrs = BTreeMap::new();
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

pub(crate) fn lower_template(
    template: &TemplateLiteral<'_>,
    source: &str,
    syntax: &'static str,
    used_value_names: &mut HashMap<String, String>,
    escape_literal: impl Fn(&str) -> String,
) -> PalamedesResult<(String, Vec<SourceValue>)> {
    let mut message = String::new();
    let mut values = Vec::new();

    for (index, quasi) in template.quasis.iter().enumerate() {
        let literal = quasi
            .value
            .cooked
            .map(|value| value.as_str())
            .unwrap_or_else(|| quasi.value.raw.as_str());
        message.push_str(&escape_literal(literal));

        if let Some(expr) = template.expressions.get(index) {
            let Some(preferred_name) = expression_name(expr) else {
                return Err(PalamedesError::UnnamedPlaceholder { syntax });
            };
            let expression =
                expression_source(expr, source).unwrap_or_else(|| preferred_name.clone());
            let name = make_unique_value_name(preferred_name, &expression, used_value_names);
            message.push('{');
            message.push_str(&name);
            message.push('}');
            push_unique_value(&mut values, SourceValue { expression, name });
        }
    }

    Ok((message, values))
}

pub(crate) fn build_icu_message(
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

pub(crate) fn lower_choice_options_from_object(
    object: &ObjectExpression<'_>,
    source: &str,
    used_value_names: &mut HashMap<String, String>,
    format: &str,
    macro_name: &str,
    location: &(impl DiagnosticLocation + ?Sized),
    escape_literal: impl Fn(&str) -> String + Copy,
) -> PalamedesResult<LoweredChoiceOptions> {
    let mut options = Vec::new();
    let mut values = Vec::new();
    let mut offset = None;

    for property in &object.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            continue;
        };
        let Some(key) = property.key.static_name() else {
            continue;
        };
        let key = key.into_owned();
        if is_plural_format(format) && key == "offset" {
            offset = Some(
                expression_offset_value(&property.value)
                    .ok_or_else(|| invalid_offset(macro_name, location))?,
            );
            continue;
        }
        let Some(normalized_key) = normalize_choice_option_key(format, &key) else {
            return Err(invalid_choice_option(macro_name, location, &key));
        };
        let (value, option_values) = match property.value.without_parentheses() {
            Expression::StringLiteral(literal) => {
                (escape_literal(literal.value.as_str()), Vec::new())
            }
            Expression::TemplateLiteral(template) => lower_template(
                template,
                source,
                "choice option template expression",
                used_value_names,
                escape_literal,
            )?,
            _ => continue,
        };

        options.push((normalized_key, value));
        append_unique_values(&mut values, option_values);
    }

    Ok(LoweredChoiceOptions {
        options,
        values,
        offset,
    })
}

pub(crate) fn lower_jsx_choice_value_binding(
    opening_element: &JSXOpeningElement<'_>,
    source: &str,
    used_value_names: &mut HashMap<String, String>,
) -> Option<SourceValue> {
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

        let preferred_name = jsx_expression_name(&container.expression)
            .unwrap_or_else(|| CHOICE_VALUE_FALLBACK_NAME.to_string());
        let expression = jsx_expression_source(&container.expression, source)
            .unwrap_or_else(|| preferred_name.clone());
        let name = make_unique_value_name(preferred_name, &expression, used_value_names);
        return Some(SourceValue { expression, name });
    }

    None
}

pub(crate) fn lower_choice_options_from_jsx(
    opening_element: &JSXOpeningElement<'_>,
    source: &str,
    used_value_names: &mut HashMap<String, String>,
    format: &str,
    macro_name: &str,
    location: &(impl DiagnosticLocation + ?Sized),
    escape_literal: impl Fn(&str) -> String + Copy,
) -> PalamedesResult<LoweredChoiceOptions> {
    let mut options = Vec::new();
    let mut values = Vec::new();
    let mut offset = None;

    for attr in &opening_element.attributes {
        let Some(attr) = attr.as_attribute() else {
            continue;
        };
        let key = attr.name.get_identifier().name.to_string();
        if matches!(
            key.as_str(),
            "id" | "message" | "comment" | "context" | "value"
        ) {
            continue;
        }
        if is_plural_format(format) && key == "offset" {
            offset = Some(
                attr.value
                    .as_ref()
                    .and_then(jsx_offset_value)
                    .ok_or_else(|| invalid_offset(macro_name, location))?,
            );
            continue;
        }
        let Some(normalized_key) = normalize_choice_option_key(format, &key) else {
            return Err(invalid_choice_option(macro_name, location, &key));
        };
        let Some(attr_value) = attr.value.as_ref() else {
            continue;
        };
        let (value, option_values) = match attr_value {
            JSXAttributeValue::StringLiteral(literal) => (
                escape_literal(&decode_jsx_entities(literal.value.as_str())),
                Vec::new(),
            ),
            JSXAttributeValue::ExpressionContainer(container) => match &container.expression {
                JSXExpression::StringLiteral(literal) => {
                    (escape_literal(literal.value.as_str()), Vec::new())
                }
                JSXExpression::TemplateLiteral(template) => lower_template(
                    template,
                    source,
                    "choice option template expression",
                    used_value_names,
                    escape_literal,
                )?,
                _ => continue,
            },
            _ => continue,
        };

        options.push((normalized_key, value));
        append_unique_values(&mut values, option_values);
    }

    Ok(LoweredChoiceOptions {
        options,
        values,
        offset,
    })
}

pub(crate) fn lower_jsx_children(
    children: &[JSXChild<'_>],
    source: &str,
    escape_literal: fn(&str) -> String,
    component_expression: impl Fn(&JSXOpeningElement<'_>) -> String,
) -> PalamedesResult<LoweredJsxMessage> {
    let mut used_value_names = HashMap::new();
    let mut next_component_index = 0usize;

    lower_jsx_children_with_state(
        children,
        source,
        escape_literal,
        &component_expression,
        &mut used_value_names,
        &mut next_component_index,
    )
}

fn lower_jsx_children_with_state<F>(
    children: &[JSXChild<'_>],
    source: &str,
    escape_literal: fn(&str) -> String,
    component_expression: &F,
    used_value_names: &mut HashMap<String, String>,
    next_component_index: &mut usize,
) -> PalamedesResult<LoweredJsxMessage>
where
    F: Fn(&JSXOpeningElement<'_>) -> String,
{
    let mut parts = Vec::new();
    let mut values = Vec::new();
    let mut components = Vec::new();

    for child in children {
        match child {
            JSXChild::Text(text) => {
                let value = escape_literal(&clean_jsx_text(text.value.as_str()));
                if !value.is_empty() {
                    parts.push(JsxMessagePart::Text(value));
                }
            }
            JSXChild::ExpressionContainer(container) => match &container.expression {
                JSXExpression::EmptyExpression(_) => {}
                JSXExpression::StringLiteral(literal) => {
                    parts.push(JsxMessagePart::Text(escape_literal(literal.value.as_str())));
                }
                expr => {
                    let Some(preferred_name) = jsx_expression_name(expr) else {
                        return Err(PalamedesError::UnnamedPlaceholder {
                            syntax: "JSX expression",
                        });
                    };
                    let expression = jsx_expression_source(expr, source)
                        .unwrap_or_else(|| preferred_name.clone());
                    let name =
                        make_unique_value_name(preferred_name, &expression, used_value_names);
                    parts.push(JsxMessagePart::ValuePlaceholder(format!("{{{name}}}")));
                    push_unique_value(&mut values, SourceValue { expression, name });
                }
            },
            JSXChild::Element(element) => {
                let name = next_component_index.to_string();
                *next_component_index += 1;
                let inner = lower_jsx_children_with_state(
                    &element.children,
                    source,
                    escape_literal,
                    component_expression,
                    used_value_names,
                    next_component_index,
                )?;
                let is_empty = inner.message.is_empty();
                let value = if is_empty {
                    format!("<{name}/>")
                } else {
                    format!("<{name}>{}</{name}>", inner.message)
                };
                parts.push(JsxMessagePart::ComponentPlaceholder { value, is_empty });
                append_unique_values(&mut values, inner.values);
                components.push(SourceValue {
                    expression: component_expression(&element.opening_element),
                    name,
                });
                components.extend(inner.components);
            }
            JSXChild::Fragment(fragment) => {
                let inner = lower_jsx_children_with_state(
                    &fragment.children,
                    source,
                    escape_literal,
                    component_expression,
                    used_value_names,
                    next_component_index,
                )?;
                if !inner.message.is_empty() {
                    parts.push(JsxMessagePart::Message {
                        value: inner.message,
                        ends_with_placeholder: inner.ends_with_placeholder,
                    });
                }
                append_unique_values(&mut values, inner.values);
                components.extend(inner.components);
            }
            JSXChild::Spread(_) => {
                return Err(PalamedesError::UnnamedPlaceholder {
                    syntax: "JSX spread child",
                });
            }
        }
    }

    let joined = join_jsx_message_parts(&parts);
    Ok(LoweredJsxMessage {
        ends_with_placeholder: joined.ends_with_placeholder,
        message: joined.message,
        values,
        components,
    })
}

fn push_unique_value(values: &mut Vec<SourceValue>, value: SourceValue) {
    if values
        .iter()
        .any(|existing| existing.name == value.name && existing.expression == value.expression)
    {
        return;
    }

    values.push(value);
}

fn append_unique_values(values: &mut Vec<SourceValue>, incoming: Vec<SourceValue>) {
    for value in incoming {
        push_unique_value(values, value);
    }
}
