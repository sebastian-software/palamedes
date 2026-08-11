//! Shared lowering helpers for authored JavaScript and JSX messages.
//!
//! Extraction owns catalog identity while transformation owns generated runtime
//! bindings. Both must derive the same names and source expressions.

use std::collections::{BTreeMap, HashMap};

use oxc_ast::ast::{Expression, JSXAttributeValue, JSXExpression, JSXOpeningElement};
use oxc_span::GetSpan;

use crate::jsx_entities::decode_jsx_entities;

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
