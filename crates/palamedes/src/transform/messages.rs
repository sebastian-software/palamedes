use std::collections::HashMap;

use oxc_ast::ast::{
    Argument, Expression, JSXChild, JSXOpeningElement, ObjectExpression, TemplateLiteral,
};
use oxc_span::GetSpan;

use crate::error::PalamedesResult;
use crate::icu_text::escape_icu_literal;
use crate::placeholder_name::expression_name;
use crate::source::DiagnosticLocation;
use crate::source_message::{
    build_icu_message as shared_build_icu_message, expression_source as shared_expression_source,
    jsx_attributes as shared_jsx_attributes,
    lower_choice_options_from_jsx as shared_lower_choice_options_from_jsx,
    lower_choice_options_from_object, lower_jsx_children, lower_jsx_choice_value_binding,
    lower_template, make_unique_value_name,
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
    location: &(impl DiagnosticLocation + ?Sized),
) -> PalamedesResult<ExtractedChoiceOptions> {
    let lowered = lower_choice_options_from_object(
        object,
        source,
        used_value_names,
        format,
        macro_name,
        location,
        escape_icu_literal,
    )?;

    Ok(ExtractedChoiceOptions {
        options: lowered.options,
        values: lowered
            .values
            .into_iter()
            .map(|value| ValueBinding {
                expression: value.expression,
                name: value.name,
            })
            .collect(),
        offset: lowered.offset,
    })
}

pub(super) fn extract_jsx_value_binding(
    opening_element: &JSXOpeningElement<'_>,
    source: &str,
    used_value_names: &mut HashMap<String, String>,
) -> PalamedesResult<Option<ValueBinding>> {
    Ok(
        lower_jsx_choice_value_binding(opening_element, source, used_value_names).map(|value| {
            ValueBinding {
                expression: value.expression,
                name: value.name,
            }
        }),
    )
}

pub(super) fn extract_choice_options_from_jsx(
    opening_element: &JSXOpeningElement<'_>,
    source: &str,
    used_value_names: &mut HashMap<String, String>,
    format: &str,
    macro_name: &str,
    location: &(impl DiagnosticLocation + ?Sized),
) -> PalamedesResult<ExtractedChoiceOptions> {
    let lowered = shared_lower_choice_options_from_jsx(
        opening_element,
        source,
        used_value_names,
        format,
        macro_name,
        location,
        escape_icu_literal,
    )?;

    Ok(ExtractedChoiceOptions {
        options: lowered.options,
        values: lowered
            .values
            .into_iter()
            .map(|value| ValueBinding {
                expression: value.expression,
                name: value.name,
            })
            .collect(),
        offset: lowered.offset,
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
        .replace('\r', "\\r")
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
