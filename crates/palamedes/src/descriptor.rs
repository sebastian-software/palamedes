use oxc_ast::ast::{Expression, ObjectExpression, ObjectPropertyKind};

use crate::error::{PalamedesError, PalamedesResult};

pub(crate) fn descriptor_property_value<'a>(
    object: &'a ObjectExpression<'a>,
    property_name: &str,
) -> Option<&'a Expression<'a>> {
    object.properties.iter().rev().find_map(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        (property.key.static_name().as_deref() == Some(property_name)).then_some(&property.value)
    })
}

pub(crate) fn descriptor_static_property(
    object: &ObjectExpression<'_>,
    property_name: &str,
    macro_name: &str,
    location: &str,
) -> PalamedesResult<Option<String>> {
    let Some(value) = descriptor_property_value(object, property_name) else {
        return Ok(None);
    };
    let Some(value) = static_string_value(value) else {
        return Err(unsupported_macro_syntax(
            macro_name,
            location,
            format!(
                "the descriptor `{property_name}` must be a string literal or expression-free template literal"
            ),
        ));
    };
    Ok(Some(value))
}

pub(crate) fn unsupported_macro_syntax(
    macro_name: &str,
    location: &str,
    detail: impl Into<String>,
) -> PalamedesError {
    PalamedesError::UnsupportedMacroSyntax {
        macro_name: macro_name.to_string(),
        location: location.to_string(),
        detail: detail.into(),
    }
}

fn static_string_value(expression: &Expression<'_>) -> Option<String> {
    match expression.without_parentheses() {
        Expression::StringLiteral(literal) => Some(literal.value.to_string()),
        Expression::TemplateLiteral(template) => {
            template.single_quasi().map(|value| value.to_string())
        }
        _ => None,
    }
}
