use std::collections::HashMap;

use oxc_ast::ast::{
    Argument, Expression, JSXAttributeValue, JSXChild, JSXExpression, JSXOpeningElement,
    ObjectExpression, ObjectPropertyKind, TemplateLiteral,
};
use oxc_span::GetSpan;

use crate::choice::{
    expression_offset_value, invalid_choice_option, invalid_offset, is_plural_format,
    jsx_offset_value, normalize_choice_option_key,
};
use crate::error::PalamedesResult;
use crate::icu_text::escape_icu_literal;
use crate::jsx_entities::decode_jsx_entities;
use crate::placeholder_name::{expression_name, jsx_expression_name};
use crate::source_message::{
    build_icu_message as shared_build_icu_message, expression_source as shared_expression_source,
    jsx_attributes as shared_jsx_attributes, jsx_expression_source as shared_jsx_expression_source,
    lower_jsx_children, lower_template, make_unique_value_name,
};

use super::Replacement;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ValueBinding {
    pub expression: String,
    pub name: String,
}

pub(super) struct ExtractedChoiceOptions {
    pub options: Vec<(String, String)>,
    pub values: Vec<ValueBinding>,
    pub offset: Option<String>,
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
    format: &str,
    macro_name: &str,
    location: &str,
) -> PalamedesResult<ExtractedChoiceOptions> {
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
                (escape_icu_literal(literal.value.as_str()), Vec::new())
            }
            Expression::TemplateLiteral(template) => template_to_message_with_state(
                template,
                source,
                "choice option template expression",
                used_value_names,
            )?,
            _ => continue,
        };

        options.push((normalized_key, value));
        append_unique_bindings(&mut values, option_values);
    }

    Ok(ExtractedChoiceOptions {
        options,
        values,
        offset,
    })
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

pub(super) fn extract_choice_options_from_jsx(
    opening_element: &JSXOpeningElement<'_>,
    source: &str,
    used_value_names: &mut HashMap<String, String>,
    format: &str,
    macro_name: &str,
    location: &str,
) -> PalamedesResult<ExtractedChoiceOptions> {
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
                escape_icu_literal(&decode_jsx_entities(literal.value.as_str())),
                Vec::new(),
            ),
            JSXAttributeValue::ExpressionContainer(container) => match &container.expression {
                JSXExpression::StringLiteral(literal) => {
                    (escape_icu_literal(literal.value.as_str()), Vec::new())
                }
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

        options.push((normalized_key, value));
        append_unique_bindings(&mut values, option_values);
    }

    Ok(ExtractedChoiceOptions {
        options,
        values,
        offset,
    })
}

pub(super) fn opening_element_to_component(
    opening_element: &JSXOpeningElement<'_>,
    source: &str,
    replacements: &[Replacement],
) -> String {
    let start = opening_element.span.start as usize;
    let end = opening_element.span.end as usize;
    let markup = source_range_with_replacements(source, start, end, replacements);

    if markup.trim_end().ends_with("/>") {
        return markup;
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
    replacements: &[Replacement],
) -> String {
    let start = opening_element.span.start as usize;
    let end = opening_element.span.end as usize;
    let markup = source_range_with_replacements(source, start, end, replacements)
        .trim()
        .to_string();
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

fn source_range_with_replacements(
    source: &str,
    start: usize,
    end: usize,
    replacements: &[Replacement],
) -> String {
    let mut text = source[start..end].to_string();
    let mut contained = replacements
        .iter()
        .filter(|replacement| replacement.start >= start && replacement.end <= end)
        .collect::<Vec<_>>();
    contained.sort_by(|left, right| right.start.cmp(&left.start).then(right.end.cmp(&left.end)));
    debug_assert!(
        contained
            .windows(2)
            .all(|pair| pair[0].start >= pair[1].end),
        "component source replacements must not overlap"
    );

    for replacement in contained {
        text.replace_range(
            replacement.start - start..replacement.end - start,
            &replacement.text,
        );
    }

    text
}

pub(super) fn extract_jsx_children_parts(
    children: &[JSXChild<'_>],
    source: &str,
    solid_wrappers: bool,
    replacements: &[Replacement],
) -> PalamedesResult<(String, Vec<ValueBinding>, Vec<ValueBinding>)> {
    let lowered = lower_jsx_children(children, source, escape_icu_literal, |opening_element| {
        if solid_wrappers {
            opening_element_to_component_wrapper(opening_element, source, replacements)
        } else {
            opening_element_to_component(opening_element, source, replacements)
        }
    })?;

    Ok((
        lowered.message,
        lowered
            .values
            .into_iter()
            .map(|value| ValueBinding {
                expression: value.expression,
                name: value.name,
            })
            .collect(),
        lowered
            .components
            .into_iter()
            .map(|value| ValueBinding {
                expression: value.expression,
                name: value.name,
            })
            .collect(),
    ))
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

pub(super) fn expression_source(expr: &Expression<'_>, source: &str) -> String {
    shared_expression_source(expr, source).unwrap_or_default()
}

pub(super) fn jsx_attributes(
    opening_element: &JSXOpeningElement<'_>,
) -> std::collections::BTreeMap<String, String> {
    shared_jsx_attributes(opening_element)
}

pub(super) fn choice_expression_binding(
    expr: &Expression<'_>,
    source: &str,
    used_value_names: &mut HashMap<String, String>,
) -> ValueBinding {
    let preferred_name =
        expression_name(expr).unwrap_or_else(|| CHOICE_VALUE_FALLBACK_NAME.to_string());
    let expression =
        shared_expression_source(expr, source).unwrap_or_else(|| preferred_name.clone());
    let name = make_unique_value_name(preferred_name, &expression, used_value_names);

    ValueBinding { expression, name }
}

pub(super) fn choice_jsx_value_binding(
    expr: &JSXExpression<'_>,
    source: &str,
    used_value_names: &mut HashMap<String, String>,
) -> ValueBinding {
    let expression = shared_jsx_expression_source(expr, source).unwrap_or_default();
    let preferred_name =
        jsx_expression_name(expr).unwrap_or_else(|| CHOICE_VALUE_FALLBACK_NAME.to_string());
    let name = make_unique_value_name(preferred_name, &expression, used_value_names);

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
    let (message, values) = lower_template(
        template,
        source,
        syntax,
        used_value_names,
        escape_icu_literal,
    )?;
    Ok((
        message,
        values
            .into_iter()
            .map(|value| ValueBinding {
                expression: value.expression,
                name: value.name,
            })
            .collect(),
    ))
}

pub(super) fn build_icu_message(
    format: &str,
    value_name: &str,
    options: &[(String, String)],
    offset: Option<&str>,
) -> String {
    shared_build_icu_message(format, value_name, options, offset)
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
