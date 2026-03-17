use std::collections::HashMap;

use oxc_allocator::Allocator;
use oxc_ast::ast::{
    Argument, CallExpression, Expression, ImportDeclaration, ImportDeclarationSpecifier,
    JSXAttributeValue, JSXChild, JSXElement, JSXExpression, JSXOpeningElement, ObjectExpression,
    ObjectPropertyKind, TaggedTemplateExpression, TemplateLiteral,
};
use oxc_ast_visit::{walk, Visit};
use oxc_parser::Parser;
use oxc_span::SourceType;
use serde::{Deserialize, Serialize};

use crate::lookup_key;

const LINGUI_MACRO_PACKAGES: [&str; 3] =
    ["@lingui/macro", "@lingui/core/macro", "@lingui/react/macro"];

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub struct NativeTransformOptions {
    #[serde(rename = "runtimeModule")]
    pub runtime_module: Option<String>,
    #[serde(rename = "runtimeImportName")]
    pub runtime_import_name: Option<String>,
    #[serde(rename = "stripNonEssentialProps")]
    pub strip_non_essential_props: Option<bool>,
    #[serde(rename = "stripMessageField")]
    pub strip_message_field: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct NativeTransformEdit {
    pub start: usize,
    pub end: usize,
    pub text: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct NativeTransformResult {
    pub code: String,
    #[serde(rename = "hasChanged")]
    pub has_changed: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub edits: Vec<NativeTransformEdit>,
    #[serde(rename = "prependText", skip_serializing_if = "Option::is_none")]
    pub prepend_text: Option<String>,
}

#[derive(Debug, Clone)]
struct ImportedMacro {
    imported_name: String,
}

#[derive(Debug, Clone)]
struct Replacement {
    start: usize,
    end: usize,
    text: String,
}

struct ImportCollector {
    runtime_module: String,
    runtime_import_name: String,
    macro_imports: HashMap<String, ImportedMacro>,
    macro_import_ranges: Vec<(usize, usize)>,
    has_runtime_import: bool,
    has_trans_import: bool,
}

impl ImportCollector {
    fn new(runtime_module: &str, runtime_import_name: &str) -> Self {
        Self {
            runtime_module: runtime_module.to_string(),
            runtime_import_name: runtime_import_name.to_string(),
            macro_imports: HashMap::new(),
            macro_import_ranges: Vec::new(),
            has_runtime_import: false,
            has_trans_import: false,
        }
    }
}

impl<'a> Visit<'a> for ImportCollector {
    fn visit_import_declaration(&mut self, it: &ImportDeclaration<'a>) {
        let source = it.source.value.as_str();

        if LINGUI_MACRO_PACKAGES.contains(&source) {
            self.macro_import_ranges
                .push((it.span.start as usize, it.span.end as usize));

            if let Some(specifiers) = &it.specifiers {
                for specifier in specifiers {
                    if let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier {
                        self.macro_imports.insert(
                            specifier.local.name.to_string(),
                            ImportedMacro {
                                imported_name: specifier.imported.name().to_string(),
                            },
                        );
                    }
                }
            }
        }

        if source == self.runtime_module {
            if let Some(specifiers) = &it.specifiers {
                for specifier in specifiers {
                    if let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier {
                        if specifier.local.name == self.runtime_import_name.as_str() {
                            self.has_runtime_import = true;
                        }
                    }
                }
            }
        }

        if source == "@lingui/react" {
            if let Some(specifiers) = &it.specifiers {
                for specifier in specifiers {
                    if let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier {
                        if specifier.local.name == "Trans" {
                            self.has_trans_import = true;
                        }
                    }
                }
            }
        }

        walk::walk_import_declaration(self, it);
    }
}

struct TransformVisitor<'a> {
    source: &'a str,
    macro_imports: &'a HashMap<String, ImportedMacro>,
    options: &'a NativeTransformOptions,
    replacements: Vec<Replacement>,
    needs_runtime_import: bool,
    needs_trans_import: bool,
    error: Option<String>,
}

impl<'a> TransformVisitor<'a> {
    fn new(
        source: &'a str,
        macro_imports: &'a HashMap<String, ImportedMacro>,
        options: &'a NativeTransformOptions,
    ) -> Self {
        Self {
            source,
            macro_imports,
            options,
            replacements: Vec::new(),
            needs_runtime_import: false,
            needs_trans_import: false,
            error: None,
        }
    }

    fn fail(&mut self, message: String) {
        if self.error.is_none() {
            self.error = Some(message);
        }
    }
}

impl<'a> Visit<'a> for TransformVisitor<'a> {
    fn visit_jsx_element(&mut self, it: &JSXElement<'a>) {
        if self.error.is_some() {
            return;
        }

        let Some(tag_name) = it.opening_element.name.get_identifier_name() else {
            walk::walk_jsx_element(self, it);
            return;
        };

        let Some(macro_info) = self.macro_imports.get(tag_name.as_str()) else {
            walk::walk_jsx_element(self, it);
            return;
        };

        let replacement = match macro_info.imported_name.as_str() {
            "Trans" => transform_trans_element(it, self.source, self.options),
            "Plural" | "Select" | "SelectOrdinal" => {
                transform_choice_jsx_element(it, &macro_info.imported_name, self.options)
            }
            _ => Ok(None),
        };

        match replacement {
            Ok(Some(text)) => {
                self.replacements.push(Replacement {
                    start: it.span.start as usize,
                    end: it.span.end as usize,
                    text,
                });

                if macro_info.imported_name == "Trans" {
                    self.needs_trans_import = true;
                } else {
                    self.needs_runtime_import = true;
                }
                return;
            }
            Ok(None) => {}
            Err(error) => {
                self.fail(error);
                return;
            }
        }

        walk::walk_jsx_element(self, it);
    }

    fn visit_tagged_template_expression(&mut self, it: &TaggedTemplateExpression<'a>) {
        if self.error.is_some() {
            return;
        }

        let Some(local_name) = identifier_name(&it.tag) else {
            walk::walk_tagged_template_expression(self, it);
            return;
        };

        let Some(macro_info) = self.macro_imports.get(local_name) else {
            walk::walk_tagged_template_expression(self, it);
            return;
        };

        if !matches!(macro_info.imported_name.as_str(), "t" | "msg") {
            walk::walk_tagged_template_expression(self, it);
            return;
        }

        if let Some(text) = transform_tagged_template(&it.quasi, self.options) {
            self.replacements.push(Replacement {
                start: it.span.start as usize,
                end: it.span.end as usize,
                text,
            });
            self.needs_runtime_import = true;
        }

        walk::walk_tagged_template_expression(self, it);
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if self.error.is_some() {
            return;
        }

        let Some(local_name) = identifier_name(&it.callee) else {
            walk::walk_call_expression(self, it);
            return;
        };

        let Some(macro_info) = self.macro_imports.get(local_name) else {
            walk::walk_call_expression(self, it);
            return;
        };

        match macro_info.imported_name.as_str() {
            "t" | "msg" | "defineMessage" => {
                match transform_descriptor_call(it, &macro_info.imported_name, self.options) {
                    Ok(Some(text)) => {
                        self.replacements.push(Replacement {
                            start: it.span.start as usize,
                            end: it.span.end as usize,
                            text,
                        });
                        if macro_info.imported_name != "defineMessage" {
                            self.needs_runtime_import = true;
                        }
                    }
                    Ok(None) => {}
                    Err(error) => {
                        self.fail(error);
                        return;
                    }
                }
            }
            "plural" | "select" | "selectOrdinal" => {
                if let Some(text) =
                    transform_choice_call(it, &macro_info.imported_name, self.options)
                {
                    self.replacements.push(Replacement {
                        start: it.span.start as usize,
                        end: it.span.end as usize,
                        text,
                    });
                    self.needs_runtime_import = true;
                }
            }
            _ => {
                walk::walk_call_expression(self, it);
                return;
            }
        }

        walk::walk_call_expression(self, it);
    }
}

fn identifier_name<'a>(expr: &'a Expression<'a>) -> Option<&'a str> {
    match expr.without_parentheses() {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        _ => None,
    }
}

fn string_value(expr: &Expression<'_>) -> Option<String> {
    match expr.without_parentheses() {
        Expression::StringLiteral(literal) => Some(literal.value.to_string()),
        Expression::TemplateLiteral(template) => {
            template.single_quasi().map(|value| value.to_string())
        }
        _ => None,
    }
}

fn extract_object_properties(object: &ObjectExpression<'_>) -> HashMap<String, String> {
    let mut properties = HashMap::new();

    for property in &object.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            continue;
        };
        let Some(key) = property.key.static_name() else {
            continue;
        };
        let Some(value) = string_value(&property.value) else {
            continue;
        };
        properties.insert(key.into_owned(), value);
    }

    properties
}

fn extract_choice_options(object: &ObjectExpression<'_>) -> Vec<(String, String)> {
    let mut options = Vec::new();

    for property in &object.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            continue;
        };
        let Some(key) = property.key.static_name() else {
            continue;
        };
        let Some(value) = string_value(&property.value) else {
            continue;
        };

        let normalized_key = if let Some(exact) = key.strip_prefix('_') {
            format!("={exact}")
        } else {
            key.into_owned()
        };
        options.push((normalized_key, value));
    }

    options
}

fn jsx_attribute_string_value(value: &JSXAttributeValue<'_>) -> Option<String> {
    match value {
        JSXAttributeValue::StringLiteral(literal) => Some(literal.value.to_string()),
        JSXAttributeValue::ExpressionContainer(container) => {
            jsx_expression_string_value(&container.expression)
        }
        _ => None,
    }
}

fn jsx_expression_string_value(expr: &JSXExpression<'_>) -> Option<String> {
    match expr {
        JSXExpression::StringLiteral(literal) => Some(literal.value.to_string()),
        JSXExpression::TemplateLiteral(template) => {
            template.single_quasi().map(|value| value.to_string())
        }
        _ => None,
    }
}

fn jsx_attributes(opening_element: &JSXOpeningElement<'_>) -> HashMap<String, String> {
    let mut attrs = HashMap::new();

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

fn extract_jsx_value_name(opening_element: &JSXOpeningElement<'_>) -> Option<String> {
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

        return jsx_expression_name(&container.expression);
    }

    None
}

fn jsx_expression_name(expr: &JSXExpression<'_>) -> Option<String> {
    match expr {
        JSXExpression::Identifier(identifier) => Some(identifier.name.to_string()),
        JSXExpression::StaticMemberExpression(member) => Some(member.property.name.to_string()),
        JSXExpression::ComputedMemberExpression(member) => {
            member.static_property_name().map(|name| name.to_string())
        }
        JSXExpression::ParenthesizedExpression(expr) => expression_name(&expr.expression),
        _ => None,
    }
}

fn extract_choice_options_from_jsx(opening_element: &JSXOpeningElement<'_>) -> Vec<(String, String)> {
    let mut options = Vec::new();

    for attr in &opening_element.attributes {
        let Some(attr) = attr.as_attribute() else {
            continue;
        };
        let key = attr.name.get_identifier().name.to_string();
        if matches!(
            key.as_str(),
            "id" | "message" | "comment" | "context" | "value" | "offset"
        ) {
            continue;
        }
        let Some(value) = attr.value.as_ref().and_then(jsx_attribute_string_value) else {
            continue;
        };

        if let Some(exact) = key.strip_prefix('_') {
            options.push((format!("={exact}"), value));
        } else {
            options.push((key, value));
        }
    }

    options
}

fn clean_jsx_text(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut last_was_whitespace = false;

    for ch in text.chars() {
        if ch.is_whitespace() {
            if !last_was_whitespace {
                result.push(' ');
                last_was_whitespace = true;
            }
        } else {
            result.push(ch);
            last_was_whitespace = false;
        }
    }

    result
}

fn opening_element_to_component(opening_element: &JSXOpeningElement<'_>, source: &str) -> String {
    let start = opening_element.span.start as usize;
    let end = opening_element.span.end as usize;
    let markup = &source[start..end];

    if markup.trim_end().ends_with("/>") {
        return markup.to_string();
    }

    if let Some(prefix) = markup.strip_suffix('>') {
        format!("{prefix} />")
    } else {
        format!("{markup} />")
    }
}

fn extract_jsx_children_parts(
    children: &[JSXChild<'_>],
    source: &str,
    next_component_index: &mut usize,
) -> (String, Vec<String>, Vec<String>) {
    let mut parts = Vec::new();
    let mut values = Vec::new();
    let mut components = Vec::new();

    for child in children {
        match child {
            JSXChild::Text(text) => {
                let value = clean_jsx_text(text.value.as_str());
                if !value.is_empty() {
                    parts.push(value);
                }
            }
            JSXChild::ExpressionContainer(container) => match &container.expression {
                JSXExpression::StringLiteral(literal) => parts.push(literal.value.to_string()),
                expr => {
                    if let Some(name) = jsx_expression_name(expr) {
                        parts.push(format!("{{{name}}}"));
                        values.push(name);
                    }
                }
            },
            JSXChild::Element(element) => {
                let current_index = *next_component_index;
                *next_component_index += 1;

                let (inner_message, inner_values, inner_components) =
                    extract_jsx_children_parts(&element.children, source, next_component_index);
                parts.push(format!("<{current_index}>{inner_message}</{current_index}>"));
                values.extend(inner_values);
                components.push(opening_element_to_component(&element.opening_element, source));
                components.extend(inner_components);
            }
            JSXChild::Fragment(fragment) => {
                let (inner_message, inner_values, inner_components) =
                    extract_jsx_children_parts(&fragment.children, source, next_component_index);
                if !inner_message.is_empty() {
                    parts.push(inner_message);
                }
                values.extend(inner_values);
                components.extend(inner_components);
            }
            JSXChild::Spread(_) => {}
        }
    }

    (parts.join("").trim().to_string(), values, components)
}

fn expression_name(expr: &Expression<'_>) -> Option<String> {
    let expr = expr.without_parentheses();

    if let Expression::Identifier(identifier) = expr {
        return Some(identifier.name.to_string());
    }

    if let Some(member) = expr.as_member_expression() {
        return member.static_property_name().map(ToString::to_string);
    }

    None
}

fn template_to_message(template: &TemplateLiteral<'_>) -> (String, Option<Vec<String>>) {
    let mut message = String::new();
    let mut values = Vec::new();

    for (index, quasi) in template.quasis.iter().enumerate() {
        if let Some(value) = quasi.value.cooked {
            message.push_str(value.as_str());
        } else {
            message.push_str(quasi.value.raw.as_str());
        }

        if let Some(expr) = template.expressions.get(index) {
            let name = expression_name(expr).unwrap_or_else(|| index.to_string());
            message.push('{');
            message.push_str(&name);
            message.push('}');
            values.push(name);
        }
    }

    (
        message,
        if values.is_empty() {
            None
        } else {
            Some(values)
        },
    )
}

fn build_message_descriptor(
    lookup_key: &str,
    message: Option<&str>,
    values: Option<&[String]>,
    context: Option<&str>,
    comment: Option<&str>,
    options: &NativeTransformOptions,
) -> String {
    let mut parts = vec![format!("id: \"{}\"", escape_string(lookup_key))];

    if let Some(message) = message {
        if !options.strip_message_field.unwrap_or(false) {
            parts.push(format!("message: \"{}\"", escape_string(message)));
        }
    }

    if let Some(values) = values {
        if !values.is_empty() {
            parts.push(format!("values: {{ {} }}", values.join(", ")));
        }
    }

    if let Some(context) = context {
        if !options.strip_non_essential_props.unwrap_or(false) {
            parts.push(format!("context: \"{}\"", escape_string(context)));
        }
    }

    if let Some(comment) = comment {
        if !options.strip_non_essential_props.unwrap_or(false) {
            parts.push(format!("comment: \"{}\"", escape_string(comment)));
        }
    }

    format!("{{ {} }}", parts.join(", "))
}

fn escape_string(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
}

fn transform_tagged_template(
    template: &TemplateLiteral<'_>,
    options: &NativeTransformOptions,
) -> Option<String> {
    let (message, values) = template_to_message(template);
    if message.is_empty() {
        return None;
    }

    let lookup_key = lookup_key(&message, None);
    Some(build_runtime_call(
        &lookup_key,
        Some(&message),
        values.as_deref(),
        None,
        None,
        options,
    ))
}

fn transform_descriptor_call(
    call: &CallExpression<'_>,
    macro_name: &str,
    options: &NativeTransformOptions,
) -> Result<Option<String>, String> {
    let Some(first_arg) = call.arguments.first() else {
        return Ok(None);
    };
    let Argument::ObjectExpression(object) = first_arg else {
        return Ok(None);
    };

    let props = extract_object_properties(object);
    if props.contains_key("id") {
        return Err(unsupported_explicit_id_message());
    }
    let message = props.get("message").cloned();
    let context = props.get("context").cloned();
    let comment = props.get("comment").cloned();

    if message.is_none() {
        return Ok(None);
    }

    let message = message.expect("message checked");
    let lookup_key = lookup_key(&message, context.as_deref());
    let descriptor = build_message_descriptor(
        &lookup_key,
        Some(&message),
        None,
        context.as_deref(),
        comment.as_deref(),
        options,
    );

    if macro_name == "defineMessage" {
        Ok(Some(descriptor))
    } else {
        Ok(Some(build_runtime_call(
            &lookup_key,
            Some(&message),
            None,
            context.as_deref(),
            comment.as_deref(),
            options,
        )))
    }
}

fn transform_choice_call(
    call: &CallExpression<'_>,
    macro_name: &str,
    options: &NativeTransformOptions,
) -> Option<String> {
    let Some(value_arg) = call.arguments.first() else {
        return None;
    };
    let Some(options_arg) = call.arguments.get(1) else {
        return None;
    };

    let Some(value_expr) = value_arg.as_expression() else {
        return None;
    };
    let Argument::ObjectExpression(choice_object) = options_arg else {
        return None;
    };

    let value_name = expression_name(value_expr).unwrap_or_else(|| "0".to_string());
    let choice_options = extract_choice_options(choice_object);

    if choice_options.is_empty() {
        return None;
    }

    let format = if macro_name == "selectOrdinal" {
        "selectordinal"
    } else {
        macro_name
    };
    let message = build_icu_message(format, &value_name, &choice_options, None);
    let lookup_key = lookup_key(&message, None);
    let values = [value_name];
    Some(build_runtime_call(
        &lookup_key,
        Some(&message),
        Some(&values),
        None,
        None,
        options,
    ))
}

fn transform_trans_element(
    element: &JSXElement<'_>,
    source: &str,
    _options: &NativeTransformOptions,
) -> Result<Option<String>, String> {
    let attrs = jsx_attributes(&element.opening_element);
    if attrs.contains_key("id") {
        return Err(unsupported_explicit_id_message());
    }
    let context = attrs.get("context").cloned();

    let mut next_component_index = 0usize;
    let (children_message, values, components) =
        extract_jsx_children_parts(&element.children, source, &mut next_component_index);
    let message = attrs
        .get("message")
        .cloned()
        .or_else(|| (!children_message.is_empty()).then_some(children_message));
    let Some(message) = message else {
        return Ok(None);
    };
    let lookup_key = lookup_key(&message, context.as_deref());

    let mut attrs = vec![
        format!("id=\"{}\"", escape_string(&lookup_key)),
        format!("message=\"{}\"", escape_string(&message)),
    ];

    if !components.is_empty() {
        let components_prop = components
            .iter()
            .enumerate()
            .map(|(index, component)| format!("{index}: {component}"))
            .collect::<Vec<_>>()
            .join(", ");
        attrs.push(format!("components={{{{ {components_prop} }}}}"));
    }

    if !values.is_empty() {
        attrs.push(format!("values={{{{ {} }}}}", values.join(", ")));
    }

    Ok(Some(format!("<Trans {} />", attrs.join(" "))))
}

fn transform_choice_jsx_element(
    element: &JSXElement<'_>,
    macro_name: &str,
    options: &NativeTransformOptions,
) -> Result<Option<String>, String> {
    let attrs = jsx_attributes(&element.opening_element);
    if attrs.contains_key("id") {
        return Err(unsupported_explicit_id_message());
    }
    let context = attrs.get("context").cloned();
    let comment = attrs.get("comment").cloned();
    let Some(value_name) = extract_jsx_value_name(&element.opening_element) else {
        return Ok(None);
    };
    let choice_options = extract_choice_options_from_jsx(&element.opening_element);

    if choice_options.is_empty() {
        return Ok(None);
    }

    let format = match macro_name {
        "Plural" => "plural",
        "Select" => "select",
        "SelectOrdinal" => "selectordinal",
        _ => return Ok(None),
    };
    let message = build_icu_message(
        format,
        &value_name,
        &choice_options,
        attrs.get("offset").map(String::as_str),
    );
    let lookup_key = lookup_key(&message, context.as_deref());
    let values = [value_name];
    Ok(Some(build_runtime_call(
        &lookup_key,
        Some(&message),
        Some(&values),
        context.as_deref(),
        comment.as_deref(),
        options,
    )))
}

fn build_runtime_call(
    lookup_key: &str,
    message: Option<&str>,
    values: Option<&[String]>,
    context: Option<&str>,
    comment: Option<&str>,
    options: &NativeTransformOptions,
) -> String {
    let runtime_import_name = options.runtime_import_name.as_deref().unwrap_or("getI18n");
    let descriptor = build_runtime_descriptor(message, context, comment, options);
    let values_text = values
        .filter(|values| !values.is_empty())
        .map(|values| format!("{{ {} }}", values.join(", ")));

    match (values_text, descriptor) {
        (None, None) => format!("{runtime_import_name}()._(\"{}\")", escape_string(lookup_key)),
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

fn build_runtime_descriptor(
    message: Option<&str>,
    context: Option<&str>,
    comment: Option<&str>,
    options: &NativeTransformOptions,
) -> Option<String> {
    let mut parts = Vec::new();

    if let Some(message) = message {
        if !options.strip_message_field.unwrap_or(false) {
            parts.push(format!("message: \"{}\"", escape_string(message)));
        }
    }

    if let Some(context) = context {
        if !options.strip_non_essential_props.unwrap_or(false) {
            parts.push(format!("context: \"{}\"", escape_string(context)));
        }
    }

    if let Some(comment) = comment {
        if !options.strip_non_essential_props.unwrap_or(false) {
            parts.push(format!("comment: \"{}\"", escape_string(comment)));
        }
    }

    (!parts.is_empty()).then(|| format!("{{ {} }}", parts.join(", ")))
}

fn build_icu_message(
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
    let offset_part = offset.map(|value| format!(" offset:{value}")).unwrap_or_default();

    format!("{{{value_name}, {format},{offset_part} {option_parts}}}")
}

pub fn transform_macros_json(
    source: &str,
    filename: &str,
    options_json: Option<&str>,
) -> Result<String, String> {
    let options = options_json
        .map(serde_json::from_str::<NativeTransformOptions>)
        .transpose()
        .map_err(|error| error.to_string())?
        .unwrap_or_default();

    let runtime_module = options
        .runtime_module
        .clone()
        .unwrap_or_else(|| "@palamedes/runtime".to_string());
    let runtime_import_name = options
        .runtime_import_name
        .clone()
        .unwrap_or_else(|| "getI18n".to_string());

    let allocator = Allocator::default();
    let source_type = SourceType::from_path(filename).unwrap_or_else(|_| SourceType::tsx());
    let parsed = Parser::new(&allocator, source, source_type).parse();

    if !parsed.errors.is_empty() {
        let messages = parsed
            .errors
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(", ");
        return Err(format!("Parse error in {filename}: {messages}"));
    }

    let mut collector = ImportCollector::new(&runtime_module, &runtime_import_name);
    collector.visit_program(&parsed.program);

    if collector.macro_imports.is_empty() {
        return serde_json::to_string(&NativeTransformResult {
            code: source.to_string(),
            has_changed: false,
            edits: Vec::new(),
            prepend_text: None,
        })
        .map_err(|error| error.to_string());
    }

    let mut visitor = TransformVisitor::new(source, &collector.macro_imports, &options);
    visitor.visit_program(&parsed.program);

    if let Some(error) = visitor.error {
        return Err(error);
    }

    if visitor.replacements.is_empty() {
        return serde_json::to_string(&NativeTransformResult {
            code: source.to_string(),
            has_changed: false,
            edits: Vec::new(),
            prepend_text: None,
        })
        .map_err(|error| error.to_string());
    }

    let mut replacements = visitor.replacements;
    for (start, end) in collector.macro_import_ranges {
        replacements.push(Replacement {
            start,
            end,
            text: String::new(),
        });
    }

    if replacements.is_empty() {
        return serde_json::to_string(&NativeTransformResult {
            code: source.to_string(),
            has_changed: false,
            edits: Vec::new(),
            prepend_text: None,
        })
        .map_err(|error| error.to_string());
    }

    replacements.sort_by(|a, b| b.start.cmp(&a.start).then(b.end.cmp(&a.end)));
    let edits = replacements
        .iter()
        .map(|replacement| NativeTransformEdit {
            start: replacement.start,
            end: replacement.end,
            text: replacement.text.clone(),
        })
        .collect::<Vec<_>>();

    let mut code = source.to_string();
    for replacement in &replacements {
        code.replace_range(replacement.start..replacement.end, &replacement.text);
    }

    let mut prefix = String::new();

    if visitor.needs_runtime_import && !collector.has_runtime_import {
        prefix.push_str(&format!(
            "import {{ {runtime_import_name} }} from \"{runtime_module}\";\n"
        ));
    }

    if visitor.needs_trans_import && !collector.has_trans_import {
        prefix.push_str("import { Trans } from \"@lingui/react\";\n");
    }

    if !prefix.is_empty() {
        code = format!("{prefix}{code}");
    }

    serde_json::to_string(&NativeTransformResult {
        has_changed: code != source,
        code,
        edits,
        prepend_text: (!prefix.is_empty()).then_some(prefix),
    })
    .map_err(|error| error.to_string())
}

fn unsupported_explicit_id_message() -> String {
    "Explicit message ids are no longer supported. Remove `id` and rely on message/context instead."
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::{transform_macros_json, NativeTransformResult};

    #[test]
    fn transforms_tagged_templates() {
        let result = serde_json::from_str::<NativeTransformResult>(
            &transform_macros_json(
                "import { t } from \"@lingui/macro\";\nconst msg = t`Hello ${name}`;\n",
                "test.ts",
                None,
            )
            .expect("transform should succeed"),
        )
        .expect("json should deserialize");

        assert!(result.code.contains("getI18n()._(\""));
        assert!(result.code.contains("message: \"Hello {name}\""));
        assert!(result.code.contains("{ name }"));
        assert!(result
            .code
            .contains("import { getI18n } from \"@palamedes/runtime\";"));
    }

    #[test]
    fn transforms_define_message_without_runtime_import() {
        let result = serde_json::from_str::<NativeTransformResult>(&transform_macros_json(
            "import { defineMessage } from \"@lingui/macro\";\nconst msg = defineMessage({ message: \"Hello\" });\n",
            "test.ts",
            None,
        )
        .expect("transform should succeed"))
        .expect("json should deserialize");

        assert!(result.code.contains("id:"));
        assert!(result.code.contains("message: \"Hello\""));
        assert!(!result.code.contains("getI18n()._("));
    }

    #[test]
    fn transforms_plural_choice_macros() {
        let result = serde_json::from_str::<NativeTransformResult>(
            &transform_macros_json(
                "import { plural } from \"@lingui/macro\";\nconst msg = plural(count, { one: \"# item\", other: \"# items\" });\n",
                "test.ts",
                None,
            )
            .expect("transform should succeed"),
        )
        .expect("json should deserialize");

        assert!(result.code.contains("getI18n()._(\""));
        assert!(result
            .code
            .contains("message: \"{count, plural, one {# item} other {# items}}\""));
        assert!(result.code.contains("{ count }"));
    }

    #[test]
    fn transforms_select_ordinal_choice_macros() {
        let result = serde_json::from_str::<NativeTransformResult>(
            &transform_macros_json(
                "import { selectOrdinal } from \"@lingui/macro\";\nconst msg = selectOrdinal(count, { one: \"#st\", other: \"#th\" });\n",
                "test.ts",
                None,
            )
            .expect("transform should succeed"),
        )
        .expect("json should deserialize");

        assert!(result.code.contains("getI18n()._(\""));
        assert!(result
            .code
            .contains("message: \"{count, selectordinal, one {#st} other {#th}}\""));
        assert!(result.code.contains("{ count }"));
    }

    #[test]
    fn transforms_trans_jsx_macro() {
        let result = serde_json::from_str::<NativeTransformResult>(
            &transform_macros_json(
                "import { Trans } from \"@lingui/react/macro\";\nconst el = <Trans>Hello {name}</Trans>;\n",
                "test.tsx",
                None,
            )
            .expect("transform should succeed"),
        )
        .expect("json should deserialize");

        assert!(result
            .code
            .contains("import { Trans } from \"@lingui/react\";"));
        assert!(result
            .code
            .contains("<Trans id=\""));
        assert!(result.code.contains("message=\"Hello {name}\""));
        assert!(result.code.contains("values={{ name }}"));
        assert!(!result.code.contains("@palamedes/runtime"));
    }

    #[test]
    fn transforms_plural_jsx_macro() {
        let result = serde_json::from_str::<NativeTransformResult>(
            &transform_macros_json(
                "import { Plural } from \"@lingui/react/macro\";\nconst el = <Plural value={count} one=\"# item\" other=\"# items\" />;\n",
                "test.tsx",
                None,
            )
            .expect("transform should succeed"),
        )
        .expect("json should deserialize");

        assert!(result.code.contains("getI18n()._(\""));
        assert!(result
            .code
            .contains("message: \"{count, plural, one {# item} other {# items}}\""));
        assert!(result.code.contains("{ count }"));
    }

    #[test]
    fn rejects_explicit_ids() {
        let error = transform_macros_json(
            "import { t } from \"@lingui/macro\";\nconst msg = t({ id: \"greeting\", message: \"Hello\" });\n",
            "test.ts",
            None,
        )
        .expect_err("explicit ids should fail");

        assert!(error.contains("Explicit message ids"));
    }
}
