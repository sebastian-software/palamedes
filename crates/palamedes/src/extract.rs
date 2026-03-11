use std::collections::{BTreeMap, HashMap};

use oxc_allocator::Allocator;
use oxc_ast::ast::{
    Argument, CallExpression, Expression, ImportDeclaration, ImportDeclarationSpecifier,
    JSXAttributeValue, JSXChild, JSXElement, JSXExpression, JSXOpeningElement,
    MemberExpression, ObjectExpression, ObjectPropertyKind, TaggedTemplateExpression,
    TemplateLiteral,
};
use oxc_ast_visit::{walk, Visit};
use oxc_parser::Parser;
use oxc_span::SourceType;
use pofile::generate_message_id;
use serde::Serialize;

const LINGUI_MACRO_PACKAGES: [&str; 3] =
    ["@lingui/macro", "@lingui/core/macro", "@lingui/react/macro"];
type ChoiceOptions = Vec<(String, String)>;

#[derive(Debug, Clone)]
struct ImportedMacro {
    imported_name: String,
}

#[derive(Debug, Serialize)]
pub struct ExtractedMessageRecord {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub placeholders: Option<BTreeMap<String, String>>,
    pub origin: (String, usize, Option<usize>),
}

struct LineLocator {
    line_starts: Vec<usize>,
}

impl LineLocator {
    fn new(source: &str) -> Self {
        let mut line_starts = vec![0];
        for (index, ch) in source.char_indices() {
            if ch == '\n' {
                line_starts.push(index + 1);
            }
        }
        Self { line_starts }
    }

    fn get_line(&self, offset: usize) -> usize {
        match self.line_starts.binary_search(&offset) {
            Ok(index) => index + 1,
            Err(index) => index,
        }
    }
}

struct MacroCollector {
    imported_macros: HashMap<String, ImportedMacro>,
}

impl MacroCollector {
    fn new() -> Self {
        Self {
            imported_macros: HashMap::new(),
        }
    }
}

impl<'a> Visit<'a> for MacroCollector {
    fn visit_import_declaration(&mut self, it: &ImportDeclaration<'a>) {
        let source = it.source.value.as_str();
        if !LINGUI_MACRO_PACKAGES.contains(&source) {
            return;
        }

        if let Some(specifiers) = &it.specifiers {
            for specifier in specifiers {
                if let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier {
                    self.imported_macros.insert(
                        specifier.local.name.to_string(),
                        ImportedMacro {
                            imported_name: specifier.imported.name().to_string(),
                        },
                    );
                }
            }
        }
    }

}

struct ExtractionVisitor<'a> {
    filename: String,
    line_locator: &'a LineLocator,
    imported_macros: &'a HashMap<String, ImportedMacro>,
    messages: Vec<ExtractedMessageRecord>,
}

impl<'a> ExtractionVisitor<'a> {
    fn new(
        filename: &str,
        line_locator: &'a LineLocator,
        imported_macros: &'a HashMap<String, ImportedMacro>,
    ) -> Self {
        Self {
            filename: filename.to_string(),
            line_locator,
            imported_macros,
            messages: Vec::new(),
        }
    }

    fn push(&mut self, message: ExtractedMessageRecord) {
        self.messages.push(message);
    }

    fn origin(&self, span_start: usize) -> (String, usize, Option<usize>) {
        (
            self.filename.clone(),
            self.line_locator.get_line(span_start),
            None,
        )
    }

    fn imported_macro_name(&self, local_name: &str, expected: &[&str]) -> Option<&str> {
        self.imported_macros.get(local_name).and_then(|macro_info| {
            expected
                .contains(&macro_info.imported_name.as_str())
                .then_some(macro_info.imported_name.as_str())
        })
    }
}

impl<'a> Visit<'a> for ExtractionVisitor<'a> {
    fn visit_jsx_element(&mut self, it: &JSXElement<'a>) {
        let Some(tag_name) = it.opening_element.name.get_identifier_name() else {
            walk::walk_jsx_element(self, it);
            return;
        };

        if let Some(macro_name) = self.imported_macro_name(
            tag_name.as_str(),
            &["Trans", "Plural", "Select", "SelectOrdinal"],
        ) {
            if let Some(message) =
                extract_from_jsx_element(it, macro_name, self.origin(it.span.start as usize))
            {
                self.push(message);
            }
        }

        walk::walk_jsx_element(self, it);
    }

    fn visit_tagged_template_expression(&mut self, it: &TaggedTemplateExpression<'a>) {
        if let Some(tag_name) = identifier_name(&it.tag) {
            if matches!(
                self.imported_macro_name(tag_name, &["t", "msg"]),
                Some("t" | "msg")
            ) {
                if let Some(message) = extract_from_tagged_template(
                    &it.quasi,
                    self.origin(it.span.start as usize),
                    false,
                ) {
                    self.push(message);
                }
            }
        }

        if is_i18n_runtime_call(&it.tag, true) {
            if let Some(message) =
                extract_from_tagged_template(&it.quasi, self.origin(it.span.start as usize), true)
            {
                self.push(message);
            }
        }

        walk::walk_tagged_template_expression(self, it);
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if let Some(callee_name) = identifier_name(&it.callee) {
            if let Some(macro_name) = self.imported_macro_name(
                callee_name,
                &[
                    "t",
                    "defineMessage",
                    "msg",
                    "plural",
                    "select",
                    "selectOrdinal",
                ],
            ) {
                let message = match macro_name {
                    "plural" | "select" | "selectOrdinal" => extract_from_choice_call(
                        it,
                        macro_name,
                        self.origin(it.span.start as usize),
                    ),
                    _ => extract_from_descriptor_call(
                        it,
                        macro_name,
                        self.origin(it.span.start as usize),
                    ),
                };

                if let Some(message) = message {
                    self.push(message);
                }
            }
        }

        if is_i18n_runtime_call(&it.callee, false) {
            if let Some(message) =
                extract_from_runtime_call(it, self.origin(it.span.start as usize))
            {
                self.push(message);
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

fn argument_string_value(arg: &Argument<'_>) -> Option<String> {
    match arg {
        Argument::StringLiteral(literal) => Some(literal.value.to_string()),
        Argument::TemplateLiteral(template) => {
            template.single_quasi().map(|value| value.to_string())
        }
        _ => None,
    }
}

fn extract_object_properties(object: &ObjectExpression<'_>) -> BTreeMap<String, String> {
    let mut properties = BTreeMap::new();

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

fn extract_choice_options_from_object(object: &ObjectExpression<'_>) -> ChoiceOptions {
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

        let key = key.into_owned();
        if let Some(exact) = key.strip_prefix('_') {
            options.push((format!("={exact}"), value));
        } else {
            options.push((key, value));
        }
    }

    options
}

fn extract_from_jsx_element(
    element: &JSXElement<'_>,
    macro_name: &str,
    origin: (String, usize, Option<usize>),
) -> Option<ExtractedMessageRecord> {
    let attrs = jsx_attributes(&element.opening_element);

    if macro_name == "Trans" {
        let explicit_id = attrs.get("id").cloned();
        let message = attrs
            .get("message")
            .cloned()
            .or_else(|| Some(extract_jsx_children_as_message(&element.children)))
            .filter(|message| !message.is_empty());
        let comment = attrs.get("comment").cloned();
        let context = attrs.get("context").cloned();

        if explicit_id.is_none() && message.is_none() {
            return None;
        }

        let id = explicit_id.unwrap_or_else(|| {
            generate_message_id(message.as_deref().unwrap_or(""), context.as_deref())
        });

        return Some(ExtractedMessageRecord {
            id,
            message,
            comment,
            context,
            placeholders: None,
            origin,
        });
    }

    if matches!(macro_name, "Plural" | "Select" | "SelectOrdinal") {
        let explicit_id = attrs.get("id").cloned();
        let value_name = extract_jsx_value_name(&element.opening_element)?;
        let options = extract_choice_options_from_jsx(&element.opening_element);
        if options.is_empty() {
            return None;
        }

        let format = match macro_name {
            "Plural" => "plural",
            "Select" => "select",
            "SelectOrdinal" => "selectordinal",
            _ => return None,
        };

        let message = build_icu_message(
            format,
            &value_name,
            &options,
            attrs.get("offset").map(String::as_str),
        );
        let context = attrs.get("context").cloned();
        let id = explicit_id.unwrap_or_else(|| generate_message_id(&message, context.as_deref()));

        return Some(ExtractedMessageRecord {
            id,
            message: Some(message),
            comment: attrs.get("comment").cloned(),
            context,
            placeholders: None,
            origin,
        });
    }

    None
}

fn extract_from_tagged_template(
    template: &TemplateLiteral<'_>,
    origin: (String, usize, Option<usize>),
    runtime: bool,
) -> Option<ExtractedMessageRecord> {
    let (message, placeholders) = template_to_message(template);
    if message.is_empty() {
        return None;
    }

    let id = if runtime {
        message.clone()
    } else {
        generate_message_id(&message, None)
    };

    Some(ExtractedMessageRecord {
        id,
        message: (!runtime).then_some(message),
        comment: None,
        context: None,
        placeholders: (!placeholders.is_empty()).then_some(placeholders),
        origin,
    })
}

fn extract_from_descriptor_call(
    call: &CallExpression<'_>,
    macro_name: &str,
    origin: (String, usize, Option<usize>),
) -> Option<ExtractedMessageRecord> {
    let first_arg = call.arguments.first()?;
    let Argument::ObjectExpression(object) = first_arg else {
        return None;
    };

    let props = extract_object_properties(object);
    let explicit_id = props.get("id").cloned();
    let message = props.get("message").cloned();
    let comment = props.get("comment").cloned();
    let context = props.get("context").cloned();

    if explicit_id.is_none() && message.is_none() {
        return None;
    }

    let id = explicit_id.unwrap_or_else(|| {
        generate_message_id(message.as_deref().unwrap_or(""), context.as_deref())
    });

    let message = if macro_name == "t" || macro_name == "defineMessage" || macro_name == "msg" {
        message
    } else {
        None
    };

    Some(ExtractedMessageRecord {
        id,
        message,
        comment,
        context,
        placeholders: None,
        origin,
    })
}

fn extract_from_choice_call(
    call: &CallExpression<'_>,
    macro_name: &str,
    origin: (String, usize, Option<usize>),
) -> Option<ExtractedMessageRecord> {
    let value_arg = call.arguments.first()?;
    let options_arg = call.arguments.get(1)?;
    let Argument::ObjectExpression(object) = options_arg else {
        return None;
    };

    let value_name = argument_expression_name(value_arg)?;
    let options = extract_choice_options_from_object(object);
    if options.is_empty() {
        return None;
    }

    let format = match macro_name {
        "plural" => "plural",
        "select" => "select",
        "selectOrdinal" => "selectordinal",
        _ => return None,
    };

    let message = build_icu_message(format, &value_name, &options, None);

    Some(ExtractedMessageRecord {
        id: generate_message_id(&message, None),
        message: Some(message),
        comment: None,
        context: None,
        placeholders: None,
        origin,
    })
}

fn is_i18n_runtime_call(expr: &Expression<'_>, allow_t: bool) -> bool {
    let Some(member) = expr.without_parentheses().as_member_expression() else {
        return false;
    };

    let Some(property_name) = member.static_property_name() else {
        return false;
    };

    if property_name != "_" && !(allow_t && property_name == "t") {
        return false;
    }

    if member.object().without_parentheses().is_specific_id("i18n") {
        return true;
    }

    member
        .object()
        .without_parentheses()
        .as_member_expression()
        .and_then(MemberExpression::static_property_name)
        == Some("i18n")
}

fn extract_from_runtime_call(
    call: &CallExpression<'_>,
    origin: (String, usize, Option<usize>),
) -> Option<ExtractedMessageRecord> {
    let first_arg = call.arguments.first()?;

    if let Argument::ObjectExpression(object) = first_arg {
        let props = extract_object_properties(object);
        let id = props.get("id")?.clone();
        return Some(ExtractedMessageRecord {
            id,
            message: props.get("message").cloned(),
            comment: props.get("comment").cloned(),
            context: props.get("context").cloned(),
            placeholders: None,
            origin,
        });
    }

    let id = argument_string_value(first_arg)?;
    let mut message = None;
    let mut comment = None;
    let mut context = None;

    if let Some(Argument::ObjectExpression(object)) = call.arguments.get(2) {
        let props = extract_object_properties(object);
        message = props.get("message").cloned();
        comment = props.get("comment").cloned();
        context = props.get("context").cloned();
    }

    Some(ExtractedMessageRecord {
        id,
        message,
        comment,
        context,
        placeholders: None,
        origin,
    })
}

fn template_to_message(template: &TemplateLiteral<'_>) -> (String, BTreeMap<String, String>) {
    let mut message = String::new();
    let mut placeholders = BTreeMap::new();

    for (index, quasi) in template.quasis.iter().enumerate() {
        if let Some(value) = quasi.value.cooked {
            message.push_str(value.as_str());
        } else {
            message.push_str(quasi.value.raw.as_str());
        }

        if let Some(expr) = template.expressions.get(index) {
            let placeholder = expression_name(expr).unwrap_or_else(|| index.to_string());
            message.push('{');
            message.push_str(&placeholder);
            message.push('}');
            placeholders.insert(placeholder.clone(), placeholder);
        }
    }

    (message, placeholders)
}

fn jsx_attributes(opening_element: &JSXOpeningElement<'_>) -> BTreeMap<String, String> {
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
        JSXExpression::CallExpression(call) => getter_name(call.callee_name()?),
        JSXExpression::ParenthesizedExpression(expr) => expression_name(&expr.expression),
        _ => None,
    }
}

fn extract_jsx_children_as_message(children: &[JSXChild<'_>]) -> String {
    let mut placeholder_index = 0usize;
    let mut parts = Vec::new();

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
                    } else {
                        parts.push(format!("{{{placeholder_index}}}"));
                        placeholder_index += 1;
                    }
                }
            },
            JSXChild::Element(element) => {
                let current_index = placeholder_index;
                let inner = extract_jsx_children_as_message(&element.children);
                parts.push(format!("<{current_index}>{inner}</{current_index}>"));
                placeholder_index += 1;
            }
            JSXChild::Fragment(fragment) => {
                let inner = extract_jsx_children_as_message(&fragment.children);
                if !inner.is_empty() {
                    parts.push(inner);
                }
            }
            JSXChild::Spread(_) => {
                parts.push(format!("{{{placeholder_index}}}"));
                placeholder_index += 1;
            }
        }
    }

    parts.join("").trim().to_string()
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

fn extract_choice_options_from_jsx(opening_element: &JSXOpeningElement<'_>) -> ChoiceOptions {
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

fn build_icu_message(
    format: &str,
    value_name: &str,
    options: &ChoiceOptions,
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

fn argument_expression_name(arg: &Argument<'_>) -> Option<String> {
    match arg {
        Argument::Identifier(identifier) => Some(identifier.name.to_string()),
        Argument::StaticMemberExpression(member) => Some(member.property.name.to_string()),
        Argument::ComputedMemberExpression(member) => {
            member.static_property_name().map(|name| name.to_string())
        }
        Argument::CallExpression(call) => getter_name(call.callee_name()?),
        Argument::ParenthesizedExpression(expr) => expression_name(&expr.expression),
        _ => None,
    }
}

fn expression_name(expr: &Expression<'_>) -> Option<String> {
    let expr = expr.without_parentheses();

    if let Expression::Identifier(identifier) = expr {
        return Some(identifier.name.to_string());
    }

    if let Some(member) = expr.as_member_expression() {
        return member.static_property_name().map(ToString::to_string);
    }

    if let Expression::CallExpression(call) = expr {
        return getter_name(call.callee_name()?);
    }

    None
}

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

pub fn extract_messages_json(source: &str, filename: &str) -> Result<String, String> {
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
        return Err(format!("Parse error: {messages}"));
    }

    let line_locator = LineLocator::new(source);
    let mut collector = MacroCollector::new();
    collector.visit_program(&parsed.program);

    let mut extractor = ExtractionVisitor::new(
        filename,
        &line_locator,
        &collector.imported_macros,
    );
    extractor.visit_program(&parsed.program);

    serde_json::to_string(&extractor.messages).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::extract_messages_json;

    #[test]
    fn extracts_tagged_templates() {
        let json = extract_messages_json(
            r#"
              import { t } from "@lingui/core/macro"
              const message = t`Hello ${name}`
            "#,
            "test.tsx",
        )
        .expect("messages should serialize");

        assert!(json.contains(r#""message":"Hello {name}""#));
    }

    #[test]
    fn extracts_runtime_calls() {
        let json = extract_messages_json(
            r#"
              const message = i18n._("greeting", { name }, { message: "Hello {name}" })
            "#,
            "test.tsx",
        )
        .expect("messages should serialize");

        assert!(json.contains(r#""id":"greeting""#));
        assert!(json.contains(r#""message":"Hello {name}""#));
    }
}
