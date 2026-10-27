//! Shared lowering helpers for authored JavaScript and JSX messages.
//!
//! Extraction owns catalog identity while transformation owns generated runtime
//! bindings. Both must derive the same names and source expressions.

use std::collections::{BTreeMap, HashMap};

use oxc_ast::ast::{
    Expression, JSXAttributeValue, JSXChild, JSXElement, JSXExpression, JSXOpeningElement,
    ObjectExpression, ObjectPropertyKind, TemplateLiteral,
};
use oxc_span::GetSpan;

use crate::choice::{
    expression_offset_value, invalid_choice_option, invalid_offset, is_plural_format,
    jsx_offset_value, normalize_choice_option_key,
};
use crate::error::{PalamedesError, PalamedesResult};
use crate::jsx_entities::decode_jsx_entities;
use crate::jsx_message::{JsxMessagePart, clean_jsx_text, join_jsx_message_parts};
use crate::placeholder_name::{expression_name, jsx_expression_name};
use crate::source::{DiagnosticLocation, SourceLocator};

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
                return Err(nested_macro_placeholder(expr, source)
                    .unwrap_or(PalamedesError::UnnamedPlaceholder { syntax }));
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

/// Message macros that only make sense as complete sentences.
const NESTABLE_MESSAGE_MACROS: [&str; 4] = ["t", "plural", "select", "selectOrdinal"];

/// Explains a placeholder that is itself a message macro.
///
/// The generic unnamed-placeholder advice ("extract it into a variable")
/// would turn `${plural(...)}` into a sentence fragment, so nested macros get
/// their own error pointing at full-sentence branches. Matching the callee
/// name is enough here: any call with arguments has no stable placeholder
/// name, so only the wording of an existing error changes.
fn nested_macro_placeholder(expr: &Expression<'_>, source: &str) -> Option<PalamedesError> {
    let (name, start) = nested_message_macro_call(expr)?;
    let (line, column) = SourceLocator::new(source).location(start as usize);
    Some(PalamedesError::NestedMacroPlaceholder {
        macro_name: name.to_owned(),
        line,
        column,
    })
}

/// Returns the name and start offset of a `t`, `plural`, `select`, or
/// `selectOrdinal` call or tagged template.
fn nested_message_macro_call<'a>(expr: &'a Expression<'_>) -> Option<(&'a str, u32)> {
    let (name, start) = match expr.without_parentheses() {
        Expression::CallExpression(call) => (call.callee_name()?, call.span.start),
        Expression::TaggedTemplateExpression(tagged) => match tagged.tag.without_parentheses() {
            Expression::Identifier(identifier) => (identifier.name.as_str(), tagged.span.start),
            _ => return None,
        },
        _ => return None,
    };
    NESTABLE_MESSAGE_MACROS
        .contains(&name)
        .then_some((name, start))
}

/// JSX message macros that cannot appear inside another message.
const NESTABLE_JSX_MESSAGE_MACROS: [&str; 4] = ["Trans", "Plural", "Select", "SelectOrdinal"];

fn is_nested_jsx_message_macro(element: &JSXElement<'_>) -> bool {
    element
        .opening_element
        .name
        .get_identifier_name()
        .is_some_and(|name| NESTABLE_JSX_MESSAGE_MACROS.contains(&name.as_str()))
}

/// Lowers one choice branch. Only string and template literals are messages;
/// anything else would vanish from the catalog, so it fails at the branch.
fn lower_choice_branch(
    key: &str,
    value: &Expression<'_>,
    source: &str,
    used_value_names: &mut HashMap<String, String>,
    macro_name: &str,
    location: &(impl DiagnosticLocation + ?Sized),
    escape_literal: impl Fn(&str) -> String + Copy,
) -> PalamedesResult<(String, Vec<SourceValue>)> {
    match value.without_parentheses() {
        Expression::StringLiteral(literal) => {
            Ok((escape_literal(literal.value.as_str()), Vec::new()))
        }
        Expression::TemplateLiteral(template) => lower_template(
            template,
            source,
            "choice option template expression",
            used_value_names,
            escape_literal,
        ),
        value => Err(unsupported_choice_branch(key, value, macro_name, location)),
    }
}

fn unsupported_choice_branch(
    key: &str,
    value: &Expression<'_>,
    macro_name: &str,
    location: &(impl DiagnosticLocation + ?Sized),
) -> PalamedesError {
    let nested_start = match value {
        Expression::JSXElement(element) if is_nested_jsx_message_macro(element) => {
            Some(element.span.start)
        }
        _ => nested_message_macro_call(value).map(|(_, start)| start),
    };
    if let Some(start) = nested_start {
        return PalamedesError::NestedMessageMacro {
            location: location.format_offset(start as usize),
            branch: Some(key.to_owned()),
        };
    }

    let kind = match value {
        Expression::Identifier(_) => "an identifier",
        Expression::StaticMemberExpression(_)
        | Expression::ComputedMemberExpression(_)
        | Expression::PrivateFieldExpression(_) => "a member expression",
        Expression::JSXElement(_) => "a JSX element",
        Expression::JSXFragment(_) => "a JSX fragment",
        Expression::CallExpression(_) | Expression::NewExpression(_) => "a function call",
        Expression::TaggedTemplateExpression(_) => "a tagged template",
        Expression::ConditionalExpression(_) | Expression::LogicalExpression(_) => {
            "a conditional expression"
        }
        Expression::NumericLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::BooleanLiteral(_)
        | Expression::NullLiteral(_) => "a non-string literal",
        _ => "a dynamic expression",
    };
    unsupported_choice_branch_at(key, kind, macro_name, location, value.span().start)
}

fn unsupported_choice_branch_at(
    key: &str,
    kind: &str,
    macro_name: &str,
    location: &(impl DiagnosticLocation + ?Sized),
    start: u32,
) -> PalamedesError {
    PalamedesError::UnsupportedMacroSyntax {
        macro_name: macro_name.to_owned(),
        location: location.format_offset(start as usize),
        detail: format!(
            "the `{key}` branch is {kind}; every choice branch must be a string literal or template literal"
        ),
    }
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
        let (value, option_values) = lower_choice_branch(
            &key,
            &property.value,
            source,
            used_value_names,
            macro_name,
            location,
            escape_literal,
        )?;

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
            // `key` is React's list key (react/jsx-key), not a branch.
            "id" | "message" | "comment" | "context" | "value" | "key"
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
        let unsupported = |kind: &str, start: u32| {
            unsupported_choice_branch_at(&key, kind, macro_name, location, start)
        };
        let (value, option_values) = match attr.value.as_ref() {
            None => return Err(unsupported("missing a value", attr.span.start)),
            Some(JSXAttributeValue::StringLiteral(literal)) => (
                escape_literal(&decode_jsx_entities(literal.value.as_str())),
                Vec::new(),
            ),
            Some(JSXAttributeValue::ExpressionContainer(container)) => {
                let Some(expression) = container.expression.as_expression() else {
                    return Err(unsupported("empty", container.span.start));
                };
                lower_choice_branch(
                    &key,
                    expression,
                    source,
                    used_value_names,
                    macro_name,
                    location,
                    escape_literal,
                )?
            }
            Some(JSXAttributeValue::Element(element)) => {
                if is_nested_jsx_message_macro(element) {
                    return Err(PalamedesError::NestedMessageMacro {
                        location: location.format_offset(element.span.start as usize),
                        branch: Some(key.clone()),
                    });
                }
                return Err(unsupported("a JSX element", element.span.start));
            }
            Some(JSXAttributeValue::Fragment(fragment)) => {
                return Err(unsupported("a JSX fragment", fragment.span.start));
            }
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
                        return Err(expr
                            .as_expression()
                            .and_then(|expr| nested_macro_placeholder(expr, source))
                            .unwrap_or(PalamedesError::UnnamedPlaceholder {
                                syntax: "JSX expression",
                            }));
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

#[cfg(test)]
mod choice_branch_tests {
    //! Choice branches are lowered once and shared by extraction, the
    //! transform, and the runtime macro manifest. A branch the lowering cannot
    //! read must fail loudly in every consumer instead of disappearing from the
    //! message (#1372).

    use crate::error::PalamedesError;
    use crate::extract::extract_messages;
    use crate::{NativeTransformOptions, transform_macros};

    const FILENAME: &str = "view.tsx";
    const BODY_LINE: usize = 4;
    const BODY_COLUMN: usize = "  return ".len() + 1;

    enum Expected {
        Unsupported {
            macro_name: &'static str,
            kind: &'static str,
        },
        Nested,
    }

    struct Case {
        body: &'static str,
        key: &'static str,
        at: &'static str,
        expected: Expected,
    }

    fn module(body: &str) -> String {
        format!(
            "import {{ plural, select, selectOrdinal, t }} from \"@palamedes/core/macro\";\nimport {{ Plural, Select, SelectOrdinal, Trans }} from \"@palamedes/react/macro\";\nexport function view(count: number, gender: string, name: string, label: string, labels: {{ one: string }}) {{\n  return {body};\n}}\n"
        )
    }

    fn unsupported_cases() -> Vec<Case> {
        vec![
            Case {
                body: r##"plural(count, { one: ONE, other: "# items" })"##,
                key: "one",
                at: "ONE",
                expected: Expected::Unsupported {
                    macro_name: "plural",
                    kind: "an identifier",
                },
            },
            Case {
                body: r##"plural(count, { _0: t`nothing`, other: "# items" })"##,
                key: "_0",
                at: "t`nothing`",
                expected: Expected::Nested,
            },
            Case {
                body: r##"plural(count, { one: t({ message: "one item" }), other: "# items" })"##,
                key: "one",
                at: "t({",
                expected: Expected::Nested,
            },
            Case {
                body: r##"select(gender, { male: "he", female: "she", other: plural(count, { one: "# item", other: "# items" }) })"##,
                key: "other",
                at: "plural(count, { one",
                expected: Expected::Nested,
            },
            Case {
                body: r##"selectOrdinal(count, { one: select(gender, { male: "his", other: "their" }), other: "#th" })"##,
                key: "one",
                at: "select(gender",
                expected: Expected::Nested,
            },
            Case {
                body: r##"plural(count, { one: <b>one item</b>, other: "# items" })"##,
                key: "one",
                at: "<b>",
                expected: Expected::Unsupported {
                    macro_name: "plural",
                    kind: "a JSX element",
                },
            },
            Case {
                body: r##"plural(count, { one: labels.one, other: "# items" })"##,
                key: "one",
                at: "labels.one",
                expected: Expected::Unsupported {
                    macro_name: "plural",
                    kind: "a member expression",
                },
            },
            Case {
                body: r##"<Plural value={count} one={<b>one item</b>} other="# items" />"##,
                key: "one",
                at: "<b>",
                expected: Expected::Unsupported {
                    macro_name: "Plural",
                    kind: "a JSX element",
                },
            },
            Case {
                body: r##"<Plural value={count} one=<b>one item</b> other="# items" />"##,
                key: "one",
                at: "<b>",
                expected: Expected::Unsupported {
                    macro_name: "Plural",
                    kind: "a JSX element",
                },
            },
            Case {
                body: r##"<Select value={gender} male={label} other="they" />"##,
                key: "male",
                at: "label}",
                expected: Expected::Unsupported {
                    macro_name: "Select",
                    kind: "an identifier",
                },
            },
            Case {
                body: r##"<Select value={gender} male other="they" />"##,
                key: "male",
                at: "male",
                expected: Expected::Unsupported {
                    macro_name: "Select",
                    kind: "missing a value",
                },
            },
            Case {
                body: r##"<Plural value={count} one={<Trans>one item</Trans>} other="# items" />"##,
                key: "one",
                at: "<Trans>",
                expected: Expected::Nested,
            },
            Case {
                body: r##"<Plural value={count} _0=<Trans>no items</Trans> other="# items" />"##,
                key: "_0",
                at: "<Trans>",
                expected: Expected::Nested,
            },
            Case {
                body: r##"<Plural value={count} _0={t`nothing`} other="# items" />"##,
                key: "_0",
                at: "t`nothing`",
                expected: Expected::Nested,
            },
            Case {
                body: r##"<Select value={gender} male="he" other={plural(count, { one: "# item", other: "# items" })} />"##,
                key: "other",
                at: "plural(",
                expected: Expected::Nested,
            },
            Case {
                body: r##"<SelectOrdinal value={count} one={labels.one} other="#th" />"##,
                key: "one",
                at: "labels.one",
                expected: Expected::Unsupported {
                    macro_name: "SelectOrdinal",
                    kind: "a member expression",
                },
            },
        ]
    }

    fn branch_error_mismatch(case: &Case, error: &PalamedesError) -> Option<String> {
        let column = BODY_COLUMN + case.body.find(case.at).expect("case anchor");
        let location = format!("{FILENAME}:{BODY_LINE}:{column}");
        let key = case.key;
        let matched = match case.expected {
            Expected::Unsupported { macro_name, kind } => matches!(
                error,
                PalamedesError::UnsupportedMacroSyntax {
                    macro_name: actual_macro,
                    location: actual_location,
                    detail,
                } if actual_macro == macro_name
                    && *actual_location == location
                    && detail.contains(&format!("`{key}` branch"))
                    && detail.contains(kind)
            ),
            Expected::Nested => {
                matches!(
                    error,
                    PalamedesError::NestedMessageMacro {
                        location: actual_location,
                        branch: Some(branch),
                    } if *actual_location == location && branch == key
                ) && error
                    .to_string()
                    .contains(&format!("in the `{key}` branch"))
            }
        };
        (!matched).then(|| {
            let expected = match case.expected {
                Expected::Unsupported { kind, .. } => format!("UnsupportedMacroSyntax ({kind})"),
                Expected::Nested => "NestedMessageMacro".to_owned(),
            };
            format!("expected {expected} for `{key}` at {location}, got: {error}")
        })
    }

    fn assert_every_case_fails(
        consumer: &str,
        run: impl Fn(&str) -> Result<String, PalamedesError>,
    ) {
        let failures = unsupported_cases()
            .iter()
            .filter_map(|case| {
                let mismatch = match run(&module(case.body)) {
                    Ok(output) => Some(format!("succeeded with {output}")),
                    Err(error) => branch_error_mismatch(case, &error),
                };
                mismatch.map(|mismatch| format!("{consumer} `{}`: {mismatch}", case.body))
            })
            .collect::<Vec<_>>();
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }

    #[test]
    fn extraction_rejects_choice_branches_that_are_not_literals() {
        assert_every_case_fails("extraction", |source| {
            extract_messages(source, FILENAME).map(|messages| {
                format!(
                    "{:?}",
                    messages
                        .iter()
                        .map(|message| &message.message)
                        .collect::<Vec<_>>()
                )
            })
        });
    }

    #[test]
    fn transform_rejects_choice_branches_that_are_not_literals() {
        assert_every_case_fails("transform", |source| {
            transform_macros(source, FILENAME, None).map(|result| result.code)
        });
    }

    #[test]
    fn key_is_a_reserved_attribute_not_a_branch() {
        for key in [
            "key={item.id}",
            "key={`row-${index}`}",
            "key={ids[index]}",
            "key={getKey(item)}",
            "key={item}",
            "key=\"static\"",
        ] {
            for (element, message) in [
                (
                    format!("<Plural {key} value={{count}} one=\"# item\" other=\"# items\" />"),
                    "{count, plural, one {# item} other {# items}}",
                ),
                (
                    format!("<Select value={{gender}} {key} male=\"he\" other=\"they\" />"),
                    "{gender, select, male {he} other {they}}",
                ),
                (
                    format!("<SelectOrdinal value={{count}} one=\"#st\" other=\"#th\" {key} />"),
                    "{count, selectordinal, one {#st} other {#th}}",
                ),
            ] {
                let body = format!("[ids, getKey].map((item, index) => {element})");
                let source = module(&body);
                let extracted = extract_messages(&source, FILENAME)
                    .unwrap_or_else(|error| panic!("extraction for `{element}` failed: {error}"));
                assert_eq!(
                    extracted
                        .iter()
                        .map(|record| record.message.as_str())
                        .collect::<Vec<_>>(),
                    [message],
                    "extraction for `{element}`"
                );

                let options = NativeTransformOptions {
                    keep_source_fallbacks: Some(true),
                    ..NativeTransformOptions::default()
                };
                let transformed = transform_macros(&source, FILENAME, Some(options))
                    .unwrap_or_else(|error| panic!("transform for `{element}` failed: {error}"));
                assert!(
                    transformed
                        .code
                        .contains(&format!("message: \"{message}\"")),
                    "transform for `{element}` should embed {message}:\n{}",
                    transformed.code
                );
            }
        }
    }

    #[test]
    fn literal_choice_branches_keep_extracting_and_transforming() {
        for (body, message) in [
            (
                r##"plural(count, { one: ("# item"), other: `# items for ${name}` })"##,
                "{count, plural, one {# item} other {# items for {name}}}",
            ),
            (
                r##"<Plural value={count} one={"# item"} other={`# items for ${name}`} />"##,
                "{count, plural, one {# item} other {# items for {name}}}",
            ),
            (
                r##"<Plural value={count} _0="no items" one={`# item`} other="# items" />"##,
                "{count, plural, =0 {no items} one {# item} other {# items}}",
            ),
            (
                r##"<Select value={gender} male={("he")} other="they" />"##,
                "{gender, select, male {he} other {they}}",
            ),
        ] {
            let source = module(body);
            let extracted = extract_messages(&source, FILENAME)
                .unwrap_or_else(|error| panic!("extraction for `{body}` failed: {error}"));
            assert_eq!(
                extracted
                    .iter()
                    .map(|record| record.message.as_str())
                    .collect::<Vec<_>>(),
                [message],
                "extraction for `{body}`"
            );

            let options = NativeTransformOptions {
                keep_source_fallbacks: Some(true),
                ..NativeTransformOptions::default()
            };
            let transformed = transform_macros(&source, FILENAME, Some(options))
                .unwrap_or_else(|error| panic!("transform for `{body}` failed: {error}"));
            assert!(
                transformed
                    .code
                    .contains(&format!("message: \"{message}\"")),
                "transform for `{body}` should embed {message}:\n{}",
                transformed.code
            );
        }
    }
}
