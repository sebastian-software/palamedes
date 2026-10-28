use oxc_ast::ast::{CallExpression, Expression, JSXElement, ObjectExpression, TemplateLiteral};

use crate::descriptor::{
    DescriptorValues, descriptor_property_value, descriptor_static_property,
    resolve_descriptor_values, unsupported_macro_syntax,
};
use crate::error::{PalamedesError, PalamedesResult};
use crate::icu_text::compiled_message_key;
use crate::source::DiagnosticLocation;
use crate::source_macros::MacroImports;
use crate::source_message::{ValueNames, check_lowered_message, reject_jsx_choice_spread};

use super::NativeTransformOptions;
use super::imports::ImportCollector;
use super::lowered_jsx::{
    choice_from_call, props_object, rendered_call_with_props, trans_from_call,
};
use super::messages::{
    ValueBinding, append_unique_bindings, build_icu_message, choice_expression_binding,
    escape_string, extract_choice_options, extract_choice_options_from_jsx,
    extract_jsx_children_parts, extract_jsx_value_binding, first_argument_object, jsx_attributes,
    template_to_message,
};

pub(super) fn transform_tagged_template(
    template: &TemplateLiteral<'_>,
    source: &str,
    macros: &MacroImports,
    location: &(impl DiagnosticLocation + ?Sized),
    options: &NativeTransformOptions,
) -> PalamedesResult<Option<(String, String)>> {
    let (message, values) = template_to_message(template, source, macros)?;
    if message.is_empty() {
        return Ok(None);
    }
    check_bindings(
        &message,
        values.as_deref().unwrap_or_default(),
        &[],
        "t",
        location,
    )?;

    let lookup_key = compiled_message_key(&message, None);
    Ok(Some((
        build_runtime_call(
            &lookup_key,
            Some(&message),
            values.as_deref(),
            None,
            None,
            options,
        ),
        lookup_key,
    )))
}

pub(super) fn transform_descriptor_call(
    call: &CallExpression<'_>,
    source: &str,
    macros: &MacroImports,
    macro_name: &str,
    location: &(impl DiagnosticLocation + ?Sized),
    options: &NativeTransformOptions,
) -> PalamedesResult<Option<(String, String)>> {
    let Some(object) = first_argument_object(call) else {
        return Err(unsupported_macro_syntax(
            macro_name,
            location,
            "the first argument must be a descriptor object",
        ));
    };

    transform_descriptor_object(call, object, source, macros, macro_name, location, options)
}

fn transform_descriptor_object(
    call: &CallExpression<'_>,
    object: &ObjectExpression<'_>,
    source: &str,
    macros: &MacroImports,
    macro_name: &str,
    location: &(impl DiagnosticLocation + ?Sized),
    options: &NativeTransformOptions,
) -> PalamedesResult<Option<(String, String)>> {
    if descriptor_property_value(object, "id").is_some() {
        return Err(PalamedesError::ExplicitMessageIdsUnsupported);
    }

    let Some(message_expression) = descriptor_property_value(object, "message") else {
        return Err(unsupported_macro_syntax(
            macro_name,
            location,
            "the descriptor must contain a static `message` property",
        ));
    };

    // Descriptor string literals are the raw-ICU authoring surface: the author
    // owns the quoting, so the text is embedded verbatim. Only the lookup key
    // is derived from its canonical form, to match the compiled catalog.
    let (message, implicit_values, template) = match message_expression.without_parentheses() {
        Expression::StringLiteral(literal) => (literal.value.to_string(), Vec::new(), false),
        Expression::TemplateLiteral(template) => {
            let (message, values) = template_to_message(template, source, macros)?;
            let values = values.unwrap_or_default();
            check_bindings(&message, &values, &[], macro_name, location)?;
            (message, values, true)
        }
        _ => {
            return Err(unsupported_macro_syntax(
                macro_name,
                location,
                "the descriptor `message` must be a string literal or template literal",
            ));
        }
    };
    let context = descriptor_static_property(object, "context", macro_name, location)?;
    let comment = descriptor_static_property(object, "comment", macro_name, location)?;

    let lookup_key = compiled_message_key(&message, context.as_deref());
    let values_text = match resolve_descriptor_values(
        call,
        source,
        &message,
        template,
        implicit_values,
        macro_name,
        location,
    )? {
        DescriptorValues::None => None,
        DescriptorValues::Bindings(bindings) => Some(render_values_object(&bindings)),
        DescriptorValues::Raw(values) => Some(values),
    };
    Ok(Some((
        build_runtime_call_with_values_text(
            &lookup_key,
            Some(&message),
            values_text.as_deref(),
            context.as_deref(),
            comment.as_deref(),
            options,
        ),
        lookup_key,
    )))
}

pub(super) fn transform_choice_call(
    call: &CallExpression<'_>,
    source: &str,
    macros: &MacroImports,
    macro_name: &str,
    location: &(impl DiagnosticLocation + ?Sized),
    options: &NativeTransformOptions,
) -> PalamedesResult<Option<(String, String)>> {
    let Some(value_arg) = call.arguments.first() else {
        return Ok(None);
    };
    let Some(options_arg) = call.arguments.get(1) else {
        return Ok(None);
    };

    let Some(value_expr) = value_arg.as_expression() else {
        return Ok(None);
    };
    let oxc_ast::ast::Argument::ObjectExpression(choice_object) = options_arg else {
        return Ok(None);
    };

    let mut used_value_names = ValueNames::default();
    let value_binding = choice_expression_binding(value_expr, source, &mut used_value_names);
    let value_name = value_binding.name.clone();
    let format = if macro_name == "selectOrdinal" {
        "selectordinal"
    } else {
        macro_name
    };
    let extracted_options = extract_choice_options(
        choice_object,
        source,
        macros,
        &mut used_value_names,
        format,
        macro_name,
        location,
    )?;

    if extracted_options.options.is_empty() {
        return Ok(None);
    }

    let message = build_icu_message(
        format,
        &value_name,
        &extracted_options.options,
        extracted_options.offset.as_deref(),
    );
    let lookup_key = compiled_message_key(&message, None);
    let mut values = vec![value_binding];
    append_unique_bindings(&mut values, extracted_options.values);
    check_bindings(&message, &values, &[], macro_name, location)?;
    Ok(Some((
        build_runtime_call(
            &lookup_key,
            Some(&message),
            Some(values.as_slice()),
            None,
            None,
            options,
        ),
        lookup_key,
    )))
}

pub(super) fn transform_trans_element(
    element: &JSXElement<'_>,
    source: &str,
    macros: &MacroImports,
    jsx_runtime_module: &str,
    replacements: &[super::Replacement],
    location: &(impl DiagnosticLocation + ?Sized),
    options: &NativeTransformOptions,
) -> PalamedesResult<Option<(String, String)>> {
    let attrs = jsx_attributes(&element.opening_element);
    if attrs.contains_key("id") {
        return Err(PalamedesError::ExplicitMessageIdsUnsupported);
    }
    let context = attrs.get("context").cloned();
    let solid_wrappers = jsx_runtime_module == "@palamedes/solid";

    let (children_message, values, components) = extract_jsx_children_parts(
        &element.children,
        source,
        macros,
        solid_wrappers,
        replacements,
    )?;
    if !attrs.contains_key("message") {
        check_bindings(&children_message, &values, &components, "Trans", location)?;
    }
    let message = attrs
        .get("message")
        .cloned()
        .or_else(|| (!children_message.is_empty()).then_some(children_message));
    let Some(message) = message else {
        return Ok(None);
    };
    let lookup_key = compiled_message_key(&message, context.as_deref());

    let mut attrs = vec![format!("id=\"{}\"", escape_string(&lookup_key))];
    if options.include_source_metadata() {
        attrs.push(format!("message={{\"{}\"}}", escape_string(&message)));
    }

    // Values come first so they are evaluated in source order before any
    // component props, which can call functions that change those values.
    if !values.is_empty() {
        attrs.push(format!(
            "values={{{{ {} }}}}",
            render_value_bindings(&values)
        ));
    }

    if !components.is_empty() {
        let components_prop = render_value_bindings(&components);
        attrs.push(format!("components={{{{ {components_prop} }}}}"));
    }

    Ok(Some((format!("<Trans {} />", attrs.join(" ")), lookup_key)))
}

pub(super) fn transform_lowered_trans_call(
    call: &CallExpression<'_>,
    source: &str,
    imports: &ImportCollector,
    macro_name: &str,
    location: &(impl DiagnosticLocation + ?Sized),
    options: &NativeTransformOptions,
) -> PalamedesResult<Option<(String, String)>> {
    let lowered = trans_from_call(call, source, imports, macro_name, location)?;
    if !lowered.explicit_message {
        check_bindings(
            &lowered.message,
            &lowered.values,
            &lowered.components,
            macro_name,
            location,
        )?;
    }
    let props = props_object(call, macro_name, location)?;
    let context = descriptor_static_property(props, "context", macro_name, location)?;
    let lookup_key = compiled_message_key(&lowered.message, context.as_deref());
    let mut properties = vec![format!("id: \"{}\"", escape_string(&lookup_key))];
    if options.include_source_metadata() {
        properties.push(format!("message: \"{}\"", escape_string(&lowered.message)));
    }
    // Values come first, as in authored `<Trans>`.
    if !lowered.values.is_empty() {
        properties.push(format!(
            "values: {{ {} }}",
            render_value_bindings(&lowered.values)
        ));
    }
    if !lowered.components.is_empty() {
        properties.push(format!(
            "components: {{ {} }}",
            render_value_bindings(&lowered.components)
        ));
    }

    Ok(Some((
        rendered_call_with_props(call, "__palamedesTrans", &properties, source),
        lookup_key,
    )))
}

pub(super) fn transform_lowered_choice_call(
    call: &CallExpression<'_>,
    source: &str,
    macros: &MacroImports,
    macro_name: &str,
    location: &(impl DiagnosticLocation + ?Sized),
    options: &NativeTransformOptions,
) -> PalamedesResult<Option<(String, String)>> {
    let format = match macro_name {
        "Plural" => "plural",
        "Select" => "select",
        "SelectOrdinal" => "selectordinal",
        _ => return Ok(None),
    };
    let (value_binding, extracted_options) =
        choice_from_call(call, source, macros, format, macro_name, location)?;
    let props = props_object(call, macro_name, location)?;
    let context = descriptor_static_property(props, "context", macro_name, location)?;
    let comment = descriptor_static_property(props, "comment", macro_name, location)?;
    let message = build_icu_message(
        format,
        &value_binding.name,
        &extracted_options.options,
        extracted_options.offset.as_deref(),
    );
    let lookup_key = compiled_message_key(&message, context.as_deref());
    let mut values = vec![value_binding];
    append_unique_bindings(&mut values, extracted_options.values);
    check_bindings(&message, &values, &[], macro_name, location)?;
    Ok(Some((
        build_runtime_call(
            &lookup_key,
            Some(&message),
            Some(values.as_slice()),
            context.as_deref(),
            comment.as_deref(),
            options,
        ),
        lookup_key,
    )))
}

pub(super) fn transform_choice_jsx_element(
    element: &JSXElement<'_>,
    source: &str,
    macros: &MacroImports,
    macro_name: &str,
    location: &(impl DiagnosticLocation + ?Sized),
    options: &NativeTransformOptions,
) -> PalamedesResult<Option<(String, String)>> {
    let attrs = jsx_attributes(&element.opening_element);
    if attrs.contains_key("id") {
        return Err(PalamedesError::ExplicitMessageIdsUnsupported);
    }
    let context = attrs.get("context").cloned();
    let comment = attrs.get("comment").cloned();
    reject_jsx_choice_spread(&element.opening_element, macro_name, location)?;
    let mut used_value_names = ValueNames::default();
    let Some(value_binding) =
        extract_jsx_value_binding(&element.opening_element, source, &mut used_value_names)?
    else {
        return Ok(None);
    };
    let value_name = value_binding.name.clone();
    let format = match macro_name {
        "Plural" => "plural",
        "Select" => "select",
        "SelectOrdinal" => "selectordinal",
        _ => return Ok(None),
    };
    let extracted_options = extract_choice_options_from_jsx(
        &element.opening_element,
        source,
        macros,
        &mut used_value_names,
        format,
        macro_name,
        location,
    )?;

    if extracted_options.options.is_empty() {
        return Ok(None);
    }

    let message = build_icu_message(
        format,
        &value_name,
        &extracted_options.options,
        extracted_options.offset.as_deref(),
    );
    let lookup_key = compiled_message_key(&message, context.as_deref());
    let mut values = vec![value_binding];
    append_unique_bindings(&mut values, extracted_options.values);
    check_bindings(&message, &values, &[], macro_name, location)?;
    Ok(Some((
        build_runtime_call(
            &lookup_key,
            Some(&message),
            Some(values.as_slice()),
            context.as_deref(),
            comment.as_deref(),
            options,
        ),
        lookup_key,
    )))
}

/// Rejects a lowered message that references values or components the
/// transform does not generate.
fn check_bindings(
    message: &str,
    values: &[ValueBinding],
    components: &[ValueBinding],
    macro_name: &str,
    location: &(impl DiagnosticLocation + ?Sized),
) -> PalamedesResult<()> {
    check_lowered_message(
        message,
        values.iter().map(|value| value.name.as_str()),
        components.iter().map(|component| component.name.as_str()),
        macro_name,
        location,
    )
}

fn build_runtime_call(
    lookup_key: &str,
    message: Option<&str>,
    values: Option<&[ValueBinding]>,
    context: Option<&str>,
    comment: Option<&str>,
    options: &NativeTransformOptions,
) -> String {
    let values_text = values
        .filter(|values| !values.is_empty())
        .map(|values| format!("{{ {} }}", render_value_bindings(values)));

    build_runtime_call_with_values_text(
        lookup_key,
        message,
        values_text.as_deref(),
        context,
        comment,
        options,
    )
}

fn build_runtime_call_with_values_text(
    lookup_key: &str,
    message: Option<&str>,
    values_text: Option<&str>,
    context: Option<&str>,
    comment: Option<&str>,
    options: &NativeTransformOptions,
) -> String {
    let runtime_import_name = options.runtime_import_name.as_deref().unwrap_or("getI18n");
    let descriptor = build_runtime_descriptor(message, context, comment, options);

    match (values_text, descriptor) {
        (None, None) => format!(
            "{runtime_import_name}()._(\"{}\")",
            escape_string(lookup_key)
        ),
        (Some(values), None) => {
            format!(
                "{runtime_import_name}()._(\"{}\", {values})",
                escape_string(lookup_key)
            )
        }
        (None, Some(descriptor)) => format!(
            "{runtime_import_name}()._(\"{}\", undefined, {descriptor})",
            escape_string(lookup_key)
        ),
        (Some(values), Some(descriptor)) => format!(
            "{runtime_import_name}()._(\"{}\", {values}, {descriptor})",
            escape_string(lookup_key)
        ),
    }
}

fn render_value_bindings(values: &[ValueBinding]) -> String {
    values
        .iter()
        .map(|binding| {
            if binding.name == binding.expression {
                binding.name.clone()
            } else {
                format!("{}: {}", binding.name, binding.expression)
            }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn render_values_object(values: &[ValueBinding]) -> String {
    if values.is_empty() {
        "{}".to_string()
    } else {
        format!("{{ {} }}", render_value_bindings(values))
    }
}

fn build_runtime_descriptor(
    message: Option<&str>,
    context: Option<&str>,
    comment: Option<&str>,
    options: &NativeTransformOptions,
) -> Option<String> {
    let mut parts = Vec::new();

    if let Some(message) = message
        && options.include_source_metadata()
    {
        parts.push(format!("message: \"{}\"", escape_string(message)));
    }

    if let Some(context) = context
        && !options.strip_non_essential_props.unwrap_or(false)
    {
        parts.push(format!("context: \"{}\"", escape_string(context)));
    }

    if let Some(comment) = comment
        && !options.strip_non_essential_props.unwrap_or(false)
    {
        parts.push(format!("comment: \"{}\"", escape_string(comment)));
    }

    (!parts.is_empty()).then(|| format!("{{ {} }}", parts.join(", ")))
}
