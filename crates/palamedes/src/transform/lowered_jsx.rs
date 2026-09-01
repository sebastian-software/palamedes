use std::collections::HashMap;

use oxc_ast::ast::{
    Argument, CallExpression, Expression, ObjectExpression, ObjectProperty, ObjectPropertyKind,
};
use oxc_ast_visit::{walk, Visit};
use oxc_span::GetSpan;

use crate::choice::{
    expression_offset_value, invalid_choice_option, invalid_offset, is_plural_format,
    normalize_choice_option_key,
};
use crate::descriptor::{descriptor_property_value, unsupported_macro_syntax};
use crate::error::{PalamedesError, PalamedesResult};
use crate::icu_text::escape_icu_literal;
use crate::jsx_message::{join_jsx_message_parts, JsxMessagePart};
use crate::placeholder_name::expression_name;
use crate::source::DiagnosticLocation;
use crate::source_message::{lower_template, make_unique_value_name};

use super::imports::{ImportCollector, RemixJsxBinding};
use super::messages::{ExtractedChoiceOptions, ValueBinding};

pub(super) struct LoweredTrans {
    pub components: Vec<ValueBinding>,
    pub message: String,
    pub values: Vec<ValueBinding>,
}

pub(super) fn trans_from_call(
    call: &CallExpression<'_>,
    source: &str,
    imports: &ImportCollector,
    macro_name: &str,
    location: &(impl DiagnosticLocation + ?Sized),
) -> PalamedesResult<LoweredTrans> {
    let props = props_object(call, macro_name, location)?;
    reject_spread_properties(props, macro_name, location)?;
    if descriptor_property_value(props, "id").is_some() {
        return Err(PalamedesError::ExplicitMessageIdsUnsupported);
    }

    let explicit_message = static_string_property(props, "message", macro_name, location)?;
    let children = descriptor_property_value(props, "children");
    let mut state = LoweringState::default();
    let lowered = if let Some(children) = children {
        state.lower_children(children, source, imports, macro_name, location)?
    } else {
        LoweredChildren::default()
    };
    let message = explicit_message
        .or_else(|| (!lowered.message.is_empty()).then_some(lowered.message))
        .ok_or_else(|| {
            unsupported_macro_syntax(
                macro_name,
                location,
                "the lowered macro must contain a static `message` or `children` property",
            )
        })?;

    Ok(LoweredTrans {
        components: lowered.components,
        message,
        values: lowered.values,
    })
}

pub(super) fn choice_from_call(
    call: &CallExpression<'_>,
    source: &str,
    format: &str,
    macro_name: &str,
    location: &(impl DiagnosticLocation + ?Sized),
) -> PalamedesResult<(ValueBinding, ExtractedChoiceOptions)> {
    let props = props_object(call, macro_name, location)?;
    reject_spread_properties(props, macro_name, location)?;
    if descriptor_property_value(props, "id").is_some() {
        return Err(PalamedesError::ExplicitMessageIdsUnsupported);
    }

    let value = descriptor_property_value(props, "value").ok_or_else(|| {
        unsupported_macro_syntax(
            macro_name,
            location,
            "the lowered choice macro requires a static `value` property",
        )
    })?;
    let mut used_value_names = HashMap::new();
    let value_binding = expression_binding(
        value,
        source,
        &mut used_value_names,
        "choice value",
        Some("value"),
    )?;
    let mut options = Vec::new();
    let mut values = Vec::new();
    let mut offset = None;

    for property in object_properties(props) {
        let Some(key) = property.key.static_name() else {
            return Err(unsupported_macro_syntax(
                macro_name,
                location,
                "lowered choice properties must use static names",
            ));
        };
        let key = key.into_owned();
        if matches!(
            key.as_str(),
            "id" | "message" | "comment" | "context" | "value" | "children"
        ) {
            continue;
        }
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
        let (option, option_values) = match property.value.without_parentheses() {
            Expression::StringLiteral(literal) => {
                (escape_icu_literal(literal.value.as_str()), Vec::new())
            }
            Expression::TemplateLiteral(template) => {
                let (message, values) = lower_template(
                    template,
                    source,
                    "choice option template expression",
                    &mut used_value_names,
                    escape_icu_literal,
                )?;
                (
                    message,
                    values
                        .into_iter()
                        .map(|value| ValueBinding {
                            expression: value.expression,
                            name: value.name,
                        })
                        .collect(),
                )
            }
            _ => {
                return Err(unsupported_macro_syntax(
                    macro_name,
                    location,
                    format!(
                        "the lowered choice option `{key}` must be a string literal or template literal"
                    ),
                ));
            }
        };
        options.push((normalized_key, option));
        append_unique(&mut values, option_values);
    }

    if options.is_empty() {
        return Err(unsupported_macro_syntax(
            macro_name,
            location,
            "the lowered choice macro must contain at least one static option",
        ));
    }

    Ok((
        value_binding,
        ExtractedChoiceOptions {
            options,
            values,
            offset,
        },
    ))
}

pub(super) fn rendered_call_with_props(
    call: &CallExpression<'_>,
    first_argument: &str,
    properties: &[String],
    source: &str,
) -> String {
    let callee = expression_source(&call.callee, source);
    let props = format!("{{ {} }}", properties.join(", "));
    let trailing = call
        .arguments
        .iter()
        .skip(2)
        .map(|argument| span_source(argument.span(), source))
        .collect::<Vec<_>>();
    if trailing.is_empty() {
        format!("{callee}({first_argument}, {props})")
    } else {
        format!(
            "{callee}({first_argument}, {props}, {})",
            trailing.join(", ")
        )
    }
}

pub(super) fn props_object<'a>(
    call: &'a CallExpression<'a>,
    macro_name: &str,
    location: &(impl DiagnosticLocation + ?Sized),
) -> PalamedesResult<&'a ObjectExpression<'a>> {
    let Some(Argument::ObjectExpression(props)) = call.arguments.get(1) else {
        return Err(unsupported_macro_syntax(
            macro_name,
            location,
            "the lowered JSX helper must receive an object-literal props argument",
        ));
    };
    Ok(props)
}

fn reject_spread_properties(
    object: &ObjectExpression<'_>,
    macro_name: &str,
    location: &(impl DiagnosticLocation + ?Sized),
) -> PalamedesResult<()> {
    if object
        .properties
        .iter()
        .any(|property| matches!(property, ObjectPropertyKind::SpreadProperty(_)))
    {
        return Err(unsupported_macro_syntax(
            macro_name,
            location,
            "spread properties in lowered JSX props cannot be transformed statically",
        ));
    }
    Ok(())
}

fn object_properties<'a, 'b>(
    object: &'b ObjectExpression<'a>,
) -> impl Iterator<Item = &'b ObjectProperty<'a>> {
    object.properties.iter().filter_map(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        Some(property.as_ref())
    })
}

fn static_string_property(
    object: &ObjectExpression<'_>,
    name: &str,
    macro_name: &str,
    location: &(impl DiagnosticLocation + ?Sized),
) -> PalamedesResult<Option<String>> {
    let Some(value) = descriptor_property_value(object, name) else {
        return Ok(None);
    };
    let value = match value.without_parentheses() {
        Expression::StringLiteral(literal) => Some(literal.value.to_string()),
        Expression::TemplateLiteral(template) => {
            template.single_quasi().map(|value| value.to_string())
        }
        _ => None,
    }
    .ok_or_else(|| {
        unsupported_macro_syntax(
            macro_name,
            location,
            format!(
                "the lowered `{name}` property must be a string literal or expression-free template literal"
            ),
        )
    })?;
    Ok(Some(value))
}

#[derive(Default)]
struct LoweringState {
    next_component_index: usize,
    used_value_names: HashMap<String, String>,
}

#[derive(Default)]
struct LoweredChildren {
    components: Vec<ValueBinding>,
    message: String,
    values: Vec<ValueBinding>,
}

impl LoweringState {
    fn lower_children(
        &mut self,
        expression: &Expression<'_>,
        source: &str,
        imports: &ImportCollector,
        macro_name: &str,
        location: &(impl DiagnosticLocation + ?Sized),
    ) -> PalamedesResult<LoweredChildren> {
        let mut parts = Vec::new();
        let mut values = Vec::new();
        let mut components = Vec::new();
        self.push_expression(
            expression,
            source,
            imports,
            macro_name,
            location,
            &mut parts,
            &mut values,
            &mut components,
        )?;
        let joined = join_jsx_message_parts(&parts);
        Ok(LoweredChildren {
            components,
            message: joined.message,
            values,
        })
    }

    #[allow(clippy::too_many_arguments)]
    fn push_expression(
        &mut self,
        expression: &Expression<'_>,
        source: &str,
        imports: &ImportCollector,
        macro_name: &str,
        location: &(impl DiagnosticLocation + ?Sized),
        parts: &mut Vec<JsxMessagePart>,
        values: &mut Vec<ValueBinding>,
        components: &mut Vec<ValueBinding>,
    ) -> PalamedesResult<()> {
        let authored_expression = expression;
        match expression.without_parentheses() {
            Expression::StringLiteral(literal) => {
                let text = escape_icu_literal(literal.value.as_str());
                if !text.is_empty() {
                    parts.push(JsxMessagePart::Text(text));
                }
            }
            Expression::ArrayExpression(array) => {
                for element in &array.elements {
                    let Some(expression) = element.as_expression() else {
                        return Err(unsupported_macro_syntax(
                            macro_name,
                            location,
                            "spread elements and holes in lowered JSX children are unsupported",
                        ));
                    };
                    self.push_expression(
                        expression, source, imports, macro_name, location, parts, values,
                        components,
                    )?;
                }
            }
            Expression::CallExpression(call) if is_remix_jsx_call(call, imports) => {
                self.push_element(
                    call, source, imports, macro_name, location, parts, values, components,
                )?;
            }
            _ => {
                if contains_macro_reference(authored_expression, imports) {
                    return Err(PalamedesError::NestedMessageMacro {
                        location: location.format(),
                    });
                }
                let binding = expression_binding(
                    authored_expression,
                    source,
                    &mut self.used_value_names,
                    "lowered JSX expression",
                    None,
                )?;
                parts.push(JsxMessagePart::ValuePlaceholder(format!(
                    "{{{}}}",
                    binding.name
                )));
                push_unique(values, binding);
            }
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn push_element(
        &mut self,
        call: &CallExpression<'_>,
        source: &str,
        imports: &ImportCollector,
        macro_name: &str,
        location: &(impl DiagnosticLocation + ?Sized),
        parts: &mut Vec<JsxMessagePart>,
        values: &mut Vec<ValueBinding>,
        components: &mut Vec<ValueBinding>,
    ) -> PalamedesResult<()> {
        let Some(element_type) = call.arguments.first().and_then(Argument::as_expression) else {
            return Err(unsupported_macro_syntax(
                macro_name,
                location,
                "the lowered JSX helper requires a static element type",
            ));
        };
        if is_macro_reference(element_type, imports) {
            return Err(PalamedesError::NestedMessageMacro {
                location: location.format(),
            });
        }
        let props = props_object(call, macro_name, location)?;
        reject_spread_properties(props, macro_name, location)?;
        let children = descriptor_property_value(props, "children");

        if is_remix_fragment(element_type, imports) {
            if let Some(children) = children {
                self.push_expression(
                    children, source, imports, macro_name, location, parts, values, components,
                )?;
            }
            return Ok(());
        }
        if !is_static_element_type(element_type) {
            return Err(unsupported_macro_syntax(
                macro_name,
                location,
                "the lowered JSX element type must be an intrinsic tag or a statically named component",
            ));
        }

        let component_name = self.next_component_index.to_string();
        self.next_component_index += 1;
        let inner = if let Some(children) = children {
            self.lower_children(children, source, imports, macro_name, location)?
        } else {
            LoweredChildren::default()
        };
        let is_empty = inner.message.is_empty();
        let placeholder = if is_empty {
            format!("<{component_name}/>")
        } else {
            format!("<{component_name}>{}</{component_name}>", inner.message)
        };
        parts.push(JsxMessagePart::ComponentPlaceholder {
            value: placeholder,
            is_empty,
        });
        append_unique(values, inner.values);

        let properties = object_properties(props)
            .filter(|property| property.key.static_name().as_deref() != Some("children"))
            .map(|property| {
                if contains_macro_reference(&property.value, imports) {
                    return Err(unsupported_macro_syntax(
                        macro_name,
                        location,
                        "macros nested in lowered non-child props cannot be transformed safely",
                    ));
                }
                Ok(span_source(property.span, source))
            })
            .collect::<PalamedesResult<Vec<_>>>()?;
        components.push(ValueBinding {
            expression: rendered_call_with_props(
                call,
                &expression_source(element_type, source),
                &properties,
                source,
            ),
            name: component_name,
        });
        components.extend(inner.components);
        Ok(())
    }
}

fn is_remix_jsx_call(call: &CallExpression<'_>, imports: &ImportCollector) -> bool {
    let Expression::Identifier(callee) = call.callee.without_parentheses() else {
        return false;
    };
    imports.remix_jsx_binding_at(callee.name.as_str(), (callee.span.start, callee.span.end))
        == Some(RemixJsxBinding::Helper)
}

fn is_remix_fragment(expression: &Expression<'_>, imports: &ImportCollector) -> bool {
    let Expression::Identifier(identifier) = expression.without_parentheses() else {
        return false;
    };
    imports.remix_jsx_binding_at(
        identifier.name.as_str(),
        (identifier.span.start, identifier.span.end),
    ) == Some(RemixJsxBinding::Fragment)
}

fn is_macro_reference(expression: &Expression<'_>, imports: &ImportCollector) -> bool {
    let Expression::Identifier(identifier) = expression.without_parentheses() else {
        return false;
    };
    imports
        .macro_at(
            identifier.name.as_str(),
            (identifier.span.start, identifier.span.end),
        )
        .is_some()
}

fn contains_macro_reference(expression: &Expression<'_>, imports: &ImportCollector) -> bool {
    let mut finder = MacroReferenceFinder {
        found: false,
        imports,
    };
    finder.visit_expression(expression);
    finder.found
}

struct MacroReferenceFinder<'a> {
    found: bool,
    imports: &'a ImportCollector,
}

impl<'a> Visit<'a> for MacroReferenceFinder<'_> {
    fn visit_identifier_reference(&mut self, identifier: &oxc_ast::ast::IdentifierReference<'a>) {
        if self.found {
            return;
        }
        self.found = self
            .imports
            .macro_at(
                identifier.name.as_str(),
                (identifier.span.start, identifier.span.end),
            )
            .is_some();
        if !self.found {
            walk::walk_identifier_reference(self, identifier);
        }
    }
}

fn is_static_element_type(expression: &Expression<'_>) -> bool {
    match expression.without_parentheses() {
        Expression::StringLiteral(_)
        | Expression::Identifier(_)
        | Expression::StaticMemberExpression(_) => true,
        Expression::ComputedMemberExpression(member) => member.static_property_name().is_some(),
        _ => false,
    }
}

fn expression_binding(
    expression: &Expression<'_>,
    source: &str,
    used_value_names: &mut HashMap<String, String>,
    syntax: &'static str,
    fallback_name: Option<&str>,
) -> PalamedesResult<ValueBinding> {
    let preferred_name = expression_name(expression)
        .or_else(|| fallback_name.map(str::to_string))
        .ok_or(PalamedesError::UnnamedPlaceholder { syntax })?;
    let expression = expression_source(expression, source);
    let name = make_unique_value_name(preferred_name, &expression, used_value_names);
    Ok(ValueBinding { expression, name })
}

fn expression_source(expression: &Expression<'_>, source: &str) -> String {
    span_source(expression.span(), source)
}

fn span_source(span: oxc_span::Span, source: &str) -> String {
    source
        .get(span.start as usize..span.end as usize)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn push_unique(values: &mut Vec<ValueBinding>, value: ValueBinding) {
    if !values.iter().any(|existing| existing == &value) {
        values.push(value);
    }
}

fn append_unique(values: &mut Vec<ValueBinding>, incoming: Vec<ValueBinding>) {
    for value in incoming {
        push_unique(values, value);
    }
}
