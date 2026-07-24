use oxc_ast::ast::{CallExpression, Expression, JSXExpression};

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

fn call_expression_name(call: &CallExpression<'_>) -> Option<String> {
    let callee = call.callee_name()?;
    getter_name(callee).or_else(|| call.arguments.is_empty().then(|| callee.to_string()))
}

pub(crate) fn expression_name(expr: &Expression<'_>) -> Option<String> {
    match expr.without_parentheses() {
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

pub(crate) fn jsx_expression_name(expr: &JSXExpression<'_>) -> Option<String> {
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
