use std::collections::{BTreeMap, HashMap, HashSet};

use oxc_allocator::Allocator;
use oxc_ast::ast::{
    Argument, BindingPattern, CallExpression, Expression, ImportDeclaration,
    ImportDeclarationSpecifier, MemberExpression, ObjectExpression, ObjectPropertyKind,
    TaggedTemplateExpression, TemplateLiteral, VariableDeclarator,
};
use oxc_ast_visit::{walk, Visit};
use oxc_parser::Parser;
use oxc_span::SourceType;
use pofile::generate_message_id;
use serde::Serialize;

const LINGUI_MACRO_PACKAGES: [&str; 3] =
    ["@lingui/macro", "@lingui/core/macro", "@lingui/react/macro"];

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
    hook_t_bindings: HashSet<String>,
}

impl MacroCollector {
    fn new() -> Self {
        Self {
            imported_macros: HashMap::new(),
            hook_t_bindings: HashSet::new(),
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

    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        let Some(Expression::CallExpression(call_expr)) = &it.init else {
            walk::walk_variable_declarator(self, it);
            return;
        };

        let Expression::Identifier(callee) = call_expr.callee.without_parentheses() else {
            walk::walk_variable_declarator(self, it);
            return;
        };

        let Some(macro_info) = self.imported_macros.get(callee.name.as_str()) else {
            walk::walk_variable_declarator(self, it);
            return;
        };

        if macro_info.imported_name != "useLingui" {
            walk::walk_variable_declarator(self, it);
            return;
        }

        let BindingPattern::ObjectPattern(object_pattern) = &it.id else {
            walk::walk_variable_declarator(self, it);
            return;
        };

        for property in &object_pattern.properties {
            let Some(key) = property.key.static_name() else {
                continue;
            };
            if key != "t" && key != "_" {
                continue;
            }
            if let Some(binding_name) = property.value.get_identifier_name() {
                self.hook_t_bindings.insert(binding_name.to_string());
            }
        }

        walk::walk_variable_declarator(self, it);
    }
}

struct ExtractionVisitor<'a> {
    filename: String,
    line_locator: &'a LineLocator,
    imported_macros: &'a HashMap<String, ImportedMacro>,
    hook_t_bindings: &'a HashSet<String>,
    messages: Vec<ExtractedMessageRecord>,
}

impl<'a> ExtractionVisitor<'a> {
    fn new(
        filename: &str,
        line_locator: &'a LineLocator,
        imported_macros: &'a HashMap<String, ImportedMacro>,
        hook_t_bindings: &'a HashSet<String>,
    ) -> Self {
        Self {
            filename: filename.to_string(),
            line_locator,
            imported_macros,
            hook_t_bindings,
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
        if self.hook_t_bindings.contains(local_name) && expected.contains(&"t") {
            return Some("t");
        }

        self.imported_macros.get(local_name).and_then(|macro_info| {
            expected
                .contains(&macro_info.imported_name.as_str())
                .then_some(macro_info.imported_name.as_str())
        })
    }
}

impl<'a> Visit<'a> for ExtractionVisitor<'a> {
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
            if let Some(macro_name) =
                self.imported_macro_name(callee_name, &["t", "defineMessage", "msg"])
            {
                if let Some(message) = extract_from_descriptor_call(
                    it,
                    macro_name,
                    self.origin(it.span.start as usize),
                ) {
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
        &collector.hook_t_bindings,
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
