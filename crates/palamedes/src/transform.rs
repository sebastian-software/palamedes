use std::collections::HashMap;

use oxc_allocator::Allocator;
use oxc_ast::ast::{
    Argument, CallExpression, Expression, ImportDeclaration, ImportDeclarationSpecifier,
    ObjectExpression, ObjectPropertyKind, TaggedTemplateExpression, TemplateLiteral,
};
use oxc_ast_visit::{walk, Visit};
use oxc_parser::Parser;
use oxc_span::SourceType;
use pofile::generate_message_id;
use serde::{Deserialize, Serialize};

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
pub struct NativeTransformResult {
    pub code: String,
    #[serde(rename = "hasChanged")]
    pub has_changed: bool,
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
}

impl ImportCollector {
    fn new(runtime_module: &str, runtime_import_name: &str) -> Self {
        Self {
            runtime_module: runtime_module.to_string(),
            runtime_import_name: runtime_import_name.to_string(),
            macro_imports: HashMap::new(),
            macro_import_ranges: Vec::new(),
            has_runtime_import: false,
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

        walk::walk_import_declaration(self, it);
    }
}

struct TransformVisitor<'a> {
    macro_imports: &'a HashMap<String, ImportedMacro>,
    options: &'a NativeTransformOptions,
    replacements: Vec<Replacement>,
    needs_runtime_import: bool,
}

impl<'a> TransformVisitor<'a> {
    fn new(
        macro_imports: &'a HashMap<String, ImportedMacro>,
        options: &'a NativeTransformOptions,
    ) -> Self {
        Self {
            macro_imports,
            options,
            replacements: Vec::new(),
            needs_runtime_import: false,
        }
    }
}

impl<'a> Visit<'a> for TransformVisitor<'a> {
    fn visit_tagged_template_expression(&mut self, it: &TaggedTemplateExpression<'a>) {
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
        let Some(local_name) = identifier_name(&it.callee) else {
            walk::walk_call_expression(self, it);
            return;
        };

        let Some(macro_info) = self.macro_imports.get(local_name) else {
            walk::walk_call_expression(self, it);
            return;
        };

        if !matches!(
            macro_info.imported_name.as_str(),
            "t" | "msg" | "defineMessage"
        ) {
            walk::walk_call_expression(self, it);
            return;
        }

        if let Some(text) = transform_descriptor_call(it, &macro_info.imported_name, self.options) {
            self.replacements.push(Replacement {
                start: it.span.start as usize,
                end: it.span.end as usize,
                text,
            });
            if macro_info.imported_name != "defineMessage" {
                self.needs_runtime_import = true;
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
    id: &str,
    message: Option<&str>,
    values: Option<&[String]>,
    context: Option<&str>,
    comment: Option<&str>,
    options: &NativeTransformOptions,
) -> String {
    let mut parts = vec![format!("id: \"{}\"", escape_string(id))];

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

    let id = generate_message_id(&message, None);
    let descriptor =
        build_message_descriptor(&id, Some(&message), values.as_deref(), None, None, options);

    Some(build_runtime_call(&descriptor, options))
}

fn transform_descriptor_call(
    call: &CallExpression<'_>,
    macro_name: &str,
    options: &NativeTransformOptions,
) -> Option<String> {
    let first_arg = call.arguments.first()?;
    let Argument::ObjectExpression(object) = first_arg else {
        return None;
    };

    let props = extract_object_properties(object);
    let explicit_id = props.get("id").cloned();
    let message = props.get("message").cloned();
    let context = props.get("context").cloned();
    let comment = props.get("comment").cloned();

    if explicit_id.is_none() && message.is_none() {
        return None;
    }

    let id = explicit_id.unwrap_or_else(|| {
        generate_message_id(message.as_deref().unwrap_or(""), context.as_deref())
    });
    let descriptor = build_message_descriptor(
        &id,
        message.as_deref(),
        None,
        context.as_deref(),
        comment.as_deref(),
        options,
    );

    if macro_name == "defineMessage" {
        Some(descriptor)
    } else {
        Some(build_runtime_call(&descriptor, options))
    }
}

fn build_runtime_call(descriptor: &str, options: &NativeTransformOptions) -> String {
    let runtime_import_name = options.runtime_import_name.as_deref().unwrap_or("getI18n");
    format!("{runtime_import_name}()._({descriptor})")
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
        })
        .map_err(|error| error.to_string());
    }

    let mut visitor = TransformVisitor::new(&collector.macro_imports, &options);
    visitor.visit_program(&parsed.program);

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
        })
        .map_err(|error| error.to_string());
    }

    replacements.sort_by(|a, b| b.start.cmp(&a.start).then(b.end.cmp(&a.end)));

    let mut code = source.to_string();
    for replacement in replacements {
        code.replace_range(replacement.start..replacement.end, &replacement.text);
    }

    if visitor.needs_runtime_import && !collector.has_runtime_import {
        code = format!("import {{ {runtime_import_name} }} from \"{runtime_module}\";\n{code}");
    }

    serde_json::to_string(&NativeTransformResult {
        has_changed: code != source,
        code,
    })
    .map_err(|error| error.to_string())
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

        assert!(result.code.contains("getI18n()._({ id:"));
        assert!(result.code.contains("message: \"Hello {name}\""));
        assert!(result.code.contains("values: { name }"));
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
}
