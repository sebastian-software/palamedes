use std::collections::BTreeSet;

use oxc_ast::ast::{Argument, CallExpression, Expression, ObjectExpression, ObjectPropertyKind};
use oxc_span::GetSpan;

use crate::error::{PalamedesError, PalamedesResult};
use crate::icu_text::canonicalize_runtime_icu;
use crate::source::DiagnosticLocation;
use crate::source_message::{SourceValue, expression_source};

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
    location: &(impl DiagnosticLocation + ?Sized),
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
    location: &(impl DiagnosticLocation + ?Sized),
    detail: impl Into<String>,
) -> PalamedesError {
    PalamedesError::UnsupportedMacroSyntax {
        macro_name: macro_name.to_string(),
        location: location.format(),
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

/// Values a descriptor call passes to the runtime, after the template
/// interpolations and the explicit values argument are combined.
pub(crate) enum DescriptorValues {
    /// No values argument and no template interpolation.
    None,
    /// Named values: template interpolations first, then explicit values.
    Bindings(Vec<SourceValue>),
    /// A values argument that is not a static object literal, as written.
    Raw(String),
}

/// Combines a descriptor's template interpolations with its values argument
/// and checks them against the message placeholders.
///
/// Extraction (and with it lint) and the transform share this check, so a
/// descriptor the transform rejects already fails extraction with the same
/// located error. `template` marks a template-literal `message`: its text is
/// authored literal text whose braces never name a value, so a mismatch there
/// points to the string `message` form that takes raw ICU.
pub(crate) fn resolve_descriptor_values(
    call: &CallExpression<'_>,
    source: &str,
    message: &str,
    template: bool,
    implicit_values: Vec<SourceValue>,
    macro_name: &str,
    location: &(impl DiagnosticLocation + ?Sized),
) -> PalamedesResult<DescriptorValues> {
    let Some(argument) = call.arguments.get(1) else {
        if implicit_values.is_empty() {
            return Ok(DescriptorValues::None);
        }
        check_message_values(message, &implicit_values, template, macro_name, location)?;
        return Ok(DescriptorValues::Bindings(implicit_values));
    };

    match static_values(argument, source) {
        Some(explicit_values) => {
            let bindings =
                merge_descriptor_values(implicit_values, explicit_values, macro_name, location)?;
            check_message_values(message, &bindings, template, macro_name, location)?;
            Ok(DescriptorValues::Bindings(bindings))
        }
        None if implicit_values.is_empty() => {
            let span = argument.span();
            Ok(DescriptorValues::Raw(
                source[span.start as usize..span.end as usize].to_owned(),
            ))
        }
        None => Err(unsupported_macro_syntax(
            macro_name,
            location,
            format!(
                "interpolated descriptor templates can only be combined with an object-literal values argument. {RAW_ICU_HINT}"
            ),
        )),
    }
}

const RAW_ICU_HINT: &str = "To pass values separately, write a string `message` with ICU placeholders instead, for example t({ message: \"Hello {name}\" }, values).";

const TEMPLATE_BRACES_HINT: &str = "Braces in template-literal text are literal text, not ICU arguments; interpolate with `${…}`, or write raw ICU in a string `message`, for example t({ message: \"{n, plural, one {# item} other {# items}}\" }, { n }).";

/// Reads a static object-literal values argument; `None` for any other shape.
fn static_values(argument: &Argument<'_>, source: &str) -> Option<Vec<SourceValue>> {
    let Argument::ObjectExpression(object) = argument else {
        return None;
    };
    object
        .properties
        .iter()
        .map(|property| {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                return None;
            };
            Some(SourceValue {
                name: property.key.static_name()?.into_owned(),
                expression: expression_source(&property.value, source).unwrap_or_default(),
            })
        })
        .collect()
}

fn merge_descriptor_values(
    mut implicit_values: Vec<SourceValue>,
    explicit_values: Vec<SourceValue>,
    macro_name: &str,
    location: &(impl DiagnosticLocation + ?Sized),
) -> PalamedesResult<Vec<SourceValue>> {
    for binding in explicit_values {
        if let Some(existing) = implicit_values
            .iter()
            .find(|existing| existing.name == binding.name)
        {
            if existing.expression == binding.expression {
                continue;
            }
            return Err(unsupported_macro_syntax(
                macro_name,
                location,
                format!(
                    "the explicit value `{}` conflicts with the expression captured by the message template",
                    binding.name
                ),
            ));
        }
        implicit_values.push(binding);
    }
    Ok(implicit_values)
}

fn check_message_values(
    message: &str,
    values: &[SourceValue],
    template: bool,
    macro_name: &str,
    location: &(impl DiagnosticLocation + ?Sized),
) -> PalamedesResult<()> {
    // Catalog compilation applies the runtime apostrophe policy to both raw
    // string descriptors and authored templates. Validate the same argument
    // set without changing the persisted source spelling or lookup identity.
    let placeholders = collect_message_placeholders(&canonicalize_runtime_icu(message));
    let value_names = values
        .iter()
        .map(|binding| binding.name.clone())
        .collect::<BTreeSet<_>>();
    let missing = placeholders
        .difference(&value_names)
        .cloned()
        .collect::<Vec<_>>();
    let extra = value_names
        .difference(&placeholders)
        .cloned()
        .collect::<Vec<_>>();

    if missing.is_empty() && extra.is_empty() {
        return Ok(());
    }

    let mut detail = format!(
        "the values do not match the message placeholders. Missing value(s): {}; extra value(s): {}.",
        format_names(&missing),
        format_names(&extra)
    );
    if template && !extra.is_empty() {
        detail.push(' ');
        detail.push_str(TEMPLATE_BRACES_HINT);
    }
    Err(unsupported_macro_syntax(macro_name, location, detail))
}

fn collect_message_placeholders(message: &str) -> BTreeSet<String> {
    if let Ok(metadata) = ferrocat::derive_message_metadata_from_icu(message, None) {
        return metadata
            .args
            .into_keys()
            .filter(|name| is_placeholder_name(name.as_str()))
            .collect();
    }

    collect_message_placeholders_from_braces(message)
}

fn collect_message_placeholders_from_braces(message: &str) -> BTreeSet<String> {
    let mut placeholders = BTreeSet::new();
    let mut index = 0usize;

    while let Some(relative_start) = message[index..].find('{') {
        let start = index + relative_start + 1;
        let Some(relative_end) = message[start..].find([',', '}']) else {
            break;
        };
        let end = start + relative_end;
        let name = message[start..end].trim();
        if is_placeholder_name(name) {
            placeholders.insert(name.to_string());
        }
        index = end + 1;
    }

    placeholders
}

/// Whether an ICU argument name can be a JavaScript value name.
///
/// Extraction names placeholders after JavaScript identifiers, so this accepts
/// the same set: Unicode `ID_Start`/`ID_Continue` plus `$` and `_`, as in
/// `café` or `größe`. Numeric ICU arguments such as `{0}` are not value names.
fn is_placeholder_name(name: &str) -> bool {
    oxc_syntax::identifier::is_identifier_name(name)
}

fn format_names(names: &[String]) -> String {
    if names.is_empty() {
        "none".to_string()
    } else {
        names.join(", ")
    }
}
