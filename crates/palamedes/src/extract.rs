use std::collections::{BTreeMap, HashMap};
use std::ffi::OsString;
use std::path::{Path, PathBuf};

use crate::catalog_update::{CatalogUpdateMessage, CatalogUpdateOrigin};
use crate::choice::{
    is_plural_format, normalize_choice_option_key, normalize_numeric_offset,
    normalize_string_offset,
};
use crate::descriptor::{
    descriptor_property_value, descriptor_static_property, unsupported_macro_syntax,
};
use crate::error::{PalamedesError, PalamedesResult};
use crate::jsx_entities::decode_jsx_entities;
use crate::jsx_message::{
    clean_jsx_text, join_jsx_message_parts, JoinedJsxMessage, JsxMessagePart,
};
use crate::placeholder_name::{expression_name, jsx_expression_name};
use crate::translation_scope::validate_translation_macro_scopes;
use oxc_allocator::Allocator;
use oxc_ast::ast::{
    Argument, BindingPattern, CallExpression, Declaration, Expression, ImportDeclaration,
    ImportDeclarationSpecifier, JSXAttributeValue, JSXChild, JSXElement, JSXExpression,
    JSXOpeningElement, MemberExpression, ObjectExpression, ObjectPropertyKind,
    TaggedTemplateExpression, TemplateLiteral, VariableDeclarator,
};
use oxc_ast_visit::{walk, Visit};
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType};
use serde::Serialize;

const PALAMEDES_MACRO_PACKAGES: [&str; 3] = [
    "@palamedes/core/macro",
    "@palamedes/react/macro",
    "@palamedes/solid/macro",
];
type ChoiceOptions = Vec<(String, String)>;
const CHOICE_VALUE_FALLBACK_NAME: &str = "value";

struct ExtractedChoiceOptions {
    options: ChoiceOptions,
    placeholders: BTreeMap<String, String>,
    offset: Option<String>,
}

#[derive(Debug, Clone)]
struct ImportedMacro {
    imported_name: String,
}

/// Extracted source-first message record emitted by the JS/TS extractor.
#[derive(Debug, Serialize)]
pub struct ExtractedMessageRecord {
    /// Extracted source message.
    pub message: String,
    /// Optional extracted comment.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    /// Optional extracted context.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
    /// Optional placeholder metadata.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub placeholders: Option<BTreeMap<String, String>>,
    /// Source origin as `(filename, line, column)`.
    pub origin: (String, usize, Option<usize>),
    /// Optional stable source container name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
}

/// Request for extracting and aggregating catalog messages from source files.
#[derive(Debug, Clone)]
pub struct ExtractCatalogMessagesRequest {
    /// Root directory used to make extracted origins relative.
    pub root_dir: String,
    /// Source files to read and extract in caller-provided order.
    pub files: Vec<String>,
}

/// Non-fatal source file extraction failure.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractCatalogFileFailure {
    /// File path that failed to read, parse, or extract.
    pub path: String,
    /// Human-readable failure message.
    pub message: String,
}

/// Aggregated catalog extraction result.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractCatalogMessagesResult {
    /// Deduplicated source-first catalog update messages.
    pub messages: Vec<CatalogUpdateMessage>,
    /// Number of input files processed.
    pub file_count: usize,
    /// Non-fatal file failures skipped during extraction.
    pub failed_files: Vec<ExtractCatalogFileFailure>,
}

#[derive(Debug)]
struct AggregatedCatalogEntry {
    message: String,
    context: Option<String>,
    placeholders: BTreeMap<String, Vec<String>>,
    extracted_comments: Vec<String>,
    origins: Vec<CatalogUpdateOrigin>,
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

    fn get_location(&self, offset: usize) -> (usize, usize) {
        let line = self.get_line(offset);
        let line_start = self
            .line_starts
            .get(line.saturating_sub(1))
            .copied()
            .unwrap_or(0);

        (line, offset.saturating_sub(line_start) + 1)
    }
}

struct MacroCollector {
    imported_macros: HashMap<String, ImportedMacro>,
    removed_macro_import: Option<(String, usize)>,
}

impl MacroCollector {
    fn new() -> Self {
        Self {
            imported_macros: HashMap::new(),
            removed_macro_import: None,
        }
    }
}

impl<'a> Visit<'a> for MacroCollector {
    fn visit_import_declaration(&mut self, it: &ImportDeclaration<'a>) {
        let source = it.source.value.as_str();
        if !PALAMEDES_MACRO_PACKAGES.contains(&source) {
            return;
        }

        if let Some(specifiers) = &it.specifiers {
            for specifier in specifiers {
                if let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier {
                    let imported_name = specifier.imported.name().to_string();
                    if matches!(imported_name.as_str(), "msg" | "defineMessage")
                        && self.removed_macro_import.is_none()
                    {
                        self.removed_macro_import =
                            Some((imported_name.clone(), it.span.start as usize));
                    }
                    self.imported_macros.insert(
                        specifier.local.name.to_string(),
                        ImportedMacro { imported_name },
                    );
                }
            }
        }
    }
}

struct ExtractionVisitor<'a> {
    filename: String,
    source: &'a str,
    line_locator: &'a LineLocator,
    imported_macros: &'a HashMap<String, ImportedMacro>,
    messages: Vec<ExtractedMessageRecord>,
    error: Option<PalamedesError>,
    scope_stack: Vec<String>,
}

impl<'a> ExtractionVisitor<'a> {
    fn new(
        filename: &str,
        source: &'a str,
        line_locator: &'a LineLocator,
        imported_macros: &'a HashMap<String, ImportedMacro>,
    ) -> Self {
        Self {
            filename: filename.to_string(),
            source,
            line_locator,
            imported_macros,
            messages: Vec::new(),
            error: None,
            scope_stack: Vec::new(),
        }
    }

    fn push(&mut self, message: ExtractedMessageRecord) {
        self.messages.push(message);
    }

    fn fail(&mut self, message: PalamedesError) {
        if self.error.is_none() {
            self.error = Some(message);
        }
    }

    fn fail_unsupported_macro(&mut self, macro_name: &str, span_start: usize) {
        self.fail(PalamedesError::UnsupportedMacroSyntax {
            macro_name: macro_name.to_string(),
            location: self.location(span_start),
            detail: "the macro could not be statically extracted; use a supported literal, template, descriptor, or choice shape".to_string(),
        });
    }

    fn origin(&self, span_start: usize) -> (String, usize, Option<usize>) {
        (
            self.filename.clone(),
            self.line_locator.get_line(span_start),
            None,
        )
    }

    fn current_scope(&self) -> Option<String> {
        self.scope_stack.last().cloned()
    }

    fn push_scope(&mut self, scope: &str) {
        self.scope_stack.push(scope.to_string());
    }

    fn pop_scope(&mut self) {
        self.scope_stack.pop();
    }

    fn location(&self, span_start: usize) -> String {
        let (line, column) = self.line_locator.get_location(span_start);

        format!("{}:{line}:{column}", self.filename)
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
    fn visit_declaration(&mut self, it: &Declaration<'a>) {
        let scope = match it {
            Declaration::FunctionDeclaration(function) => {
                function.id.as_ref().map(|id| id.name.as_str().to_string())
            }
            _ => None,
        };

        if let Some(scope) = scope {
            self.push_scope(&scope);
            walk::walk_declaration(self, it);
            self.pop_scope();
        } else {
            walk::walk_declaration(self, it);
        }
    }

    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        let scope = function_like_initializer_name(it);

        if let Some(scope) = scope {
            self.push_scope(&scope);
            walk::walk_variable_declarator(self, it);
            self.pop_scope();
        } else {
            walk::walk_variable_declarator(self, it);
        }
    }

    fn visit_jsx_element(&mut self, it: &JSXElement<'a>) {
        if self.error.is_some() {
            return;
        }

        let Some(tag_name) = it.opening_element.name.get_identifier_name() else {
            walk::walk_jsx_element(self, it);
            return;
        };

        if let Some(macro_name) = self
            .imported_macro_name(
                tag_name.as_str(),
                &["Trans", "Plural", "Select", "SelectOrdinal"],
            )
            .map(str::to_string)
        {
            if let Some(nested_start) =
                nested_message_macro_in_children(&it.children, self.imported_macros)
            {
                self.fail(PalamedesError::NestedMessageMacro {
                    location: self.location(nested_start),
                });
                return;
            }

            match extract_from_jsx_element(
                it,
                &macro_name,
                self.origin(it.span.start as usize),
                self.current_scope(),
                self.source,
                &self.location(it.span.start as usize),
            ) {
                Ok(Some(message)) => self.push(message),
                Ok(None) => {
                    self.fail_unsupported_macro(&macro_name, it.span.start as usize);
                    return;
                }
                Err(error) => {
                    self.fail(error);
                    return;
                }
            }
        }

        walk::walk_jsx_element(self, it);
    }

    fn visit_tagged_template_expression(&mut self, it: &TaggedTemplateExpression<'a>) {
        if self.error.is_some() {
            return;
        }

        if let Some(tag_name) = identifier_name(&it.tag) {
            if let Some(macro_name) = self
                .imported_macro_name(tag_name, &["t"])
                .map(str::to_string)
            {
                match extract_from_tagged_template(
                    &it.quasi,
                    self.origin(it.span.start as usize),
                    self.current_scope(),
                    self.source,
                    false,
                ) {
                    Ok(Some(message)) => self.push(message),
                    Ok(None) => {
                        self.fail_unsupported_macro(&macro_name, it.span.start as usize);
                        return;
                    }
                    Err(error) => {
                        self.fail(error);
                        return;
                    }
                }
            }
        }

        if is_i18n_runtime_call(&it.tag, true) {
            match extract_from_tagged_template(
                &it.quasi,
                self.origin(it.span.start as usize),
                self.current_scope(),
                self.source,
                true,
            ) {
                Ok(Some(message)) => self.push(message),
                Ok(None) => {}
                Err(error) => {
                    self.fail(error);
                    return;
                }
            }
        }

        walk::walk_tagged_template_expression(self, it);
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if self.error.is_some() {
            return;
        }

        if let Some(callee_name) = identifier_name(&it.callee) {
            if let Some(macro_name) = self
                .imported_macro_name(callee_name, &["t", "plural", "select", "selectOrdinal"])
                .map(str::to_string)
            {
                let message = match macro_name.as_str() {
                    "plural" | "select" | "selectOrdinal" => extract_from_choice_call(
                        it,
                        &macro_name,
                        self.origin(it.span.start as usize),
                        self.current_scope(),
                        self.source,
                        &self.location(it.span.start as usize),
                    ),
                    _ => extract_from_descriptor_call(
                        it,
                        &macro_name,
                        self.origin(it.span.start as usize),
                        self.current_scope(),
                        self.source,
                        &self.location(it.span.start as usize),
                    ),
                };

                match message {
                    Ok(Some(message)) => self.push(message),
                    Ok(None) => {
                        self.fail_unsupported_macro(&macro_name, it.span.start as usize);
                        return;
                    }
                    Err(error) => {
                        self.fail(error);
                        return;
                    }
                }
            }
        }

        if is_i18n_runtime_call(&it.callee, false) {
            match extract_from_runtime_call(
                it,
                self.origin(it.span.start as usize),
                self.current_scope(),
            ) {
                Ok(Some(message)) => self.push(message),
                Ok(None) => {}
                Err(error) => {
                    self.fail(error);
                    return;
                }
            }
        }

        walk::walk_call_expression(self, it);
    }
}

fn nested_message_macro_in_children<'a>(
    children: &'a [JSXChild<'a>],
    imported_macros: &HashMap<String, ImportedMacro>,
) -> Option<usize> {
    NestedMessageMacroFinder::find_in_children(children, imported_macros)
}

struct NestedMessageMacroFinder<'a> {
    imported_macros: &'a HashMap<String, ImportedMacro>,
    nested_start: Option<usize>,
}

impl<'a> NestedMessageMacroFinder<'a> {
    fn find_in_children(
        children: &[JSXChild<'a>],
        imported_macros: &'a HashMap<String, ImportedMacro>,
    ) -> Option<usize> {
        let mut finder = Self {
            imported_macros,
            nested_start: None,
        };

        for child in children {
            finder.visit_jsx_child(child);
            if finder.nested_start.is_some() {
                break;
            }
        }

        finder.nested_start
    }
}

impl<'a> Visit<'a> for NestedMessageMacroFinder<'a> {
    fn visit_jsx_element(&mut self, it: &JSXElement<'a>) {
        if self.nested_start.is_some() {
            return;
        }

        if is_jsx_message_macro(it, self.imported_macros) {
            self.nested_start = Some(it.span.start as usize);
            return;
        }

        walk::walk_jsx_element(self, it);
    }

    fn visit_jsx_opening_element(&mut self, _it: &JSXOpeningElement<'a>) {
        // Attributes and render props execute in their own render context; they are not part
        // of the enclosing <Trans> message body.
    }
}

fn is_jsx_message_macro(
    element: &JSXElement<'_>,
    imported_macros: &HashMap<String, ImportedMacro>,
) -> bool {
    let Some(tag_name) = element.opening_element.name.get_identifier_name() else {
        return false;
    };

    imported_macros
        .get(tag_name.as_str())
        .is_some_and(|macro_info| {
            matches!(
                macro_info.imported_name.as_str(),
                "Trans" | "Plural" | "Select" | "SelectOrdinal"
            )
        })
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

fn extract_choice_options_from_object(
    object: &ObjectExpression<'_>,
    source: &str,
    used_value_names: &mut HashMap<String, String>,
    format: &str,
    macro_name: &str,
    location: &str,
) -> PalamedesResult<ExtractedChoiceOptions> {
    let mut options = Vec::new();
    let mut placeholders = BTreeMap::new();
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
        let (value, option_placeholders) = match property.value.without_parentheses() {
            Expression::StringLiteral(literal) => (literal.value.to_string(), BTreeMap::new()),
            Expression::TemplateLiteral(template) => template_to_message_with_state(
                template,
                source,
                "choice option template expression",
                used_value_names,
            )?,
            _ => continue,
        };

        options.push((normalized_key, value));
        placeholders.extend(option_placeholders);
    }

    Ok(ExtractedChoiceOptions {
        options,
        placeholders,
        offset,
    })
}

fn extract_from_jsx_element(
    element: &JSXElement<'_>,
    macro_name: &str,
    origin: (String, usize, Option<usize>),
    scope: Option<String>,
    source: &str,
    location: &str,
) -> PalamedesResult<Option<ExtractedMessageRecord>> {
    let attrs = jsx_attributes(&element.opening_element);

    if macro_name == "Trans" {
        if attrs.contains_key("id") {
            return Err(PalamedesError::ExplicitMessageIdsUnsupported);
        }
        let message = match attrs.get("message") {
            Some(message) => Some(message.clone()),
            None => {
                let children_message = extract_jsx_children_as_message(&element.children, source)?;
                (!children_message.is_empty()).then_some(children_message)
            }
        };
        let comment = attrs.get("comment").cloned();
        let context = attrs.get("context").cloned();

        let Some(message) = message else {
            return Ok(None);
        };

        return Ok(Some(ExtractedMessageRecord {
            message,
            comment,
            context,
            placeholders: None,
            origin,
            scope,
        }));
    }

    if matches!(macro_name, "Plural" | "Select" | "SelectOrdinal") {
        if attrs.contains_key("id") {
            return Err(PalamedesError::ExplicitMessageIdsUnsupported);
        }
        let Some((value_name, value_expression)) =
            extract_jsx_choice_value(&element.opening_element, source)?
        else {
            return Ok(None);
        };
        let format = match macro_name {
            "Plural" => "plural",
            "Select" => "select",
            "SelectOrdinal" => "selectordinal",
            _ => return Ok(None),
        };
        let mut used_value_names = HashMap::from([(value_name.clone(), value_expression)]);
        let extracted_options = extract_choice_options_from_jsx(
            &element.opening_element,
            source,
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
        let context = attrs.get("context").cloned();

        return Ok(Some(ExtractedMessageRecord {
            message,
            comment: attrs.get("comment").cloned(),
            context,
            placeholders: (!extracted_options.placeholders.is_empty())
                .then_some(extracted_options.placeholders),
            origin,
            scope,
        }));
    }

    Ok(None)
}

fn extract_from_tagged_template(
    template: &TemplateLiteral<'_>,
    origin: (String, usize, Option<usize>),
    scope: Option<String>,
    source: &str,
    _runtime: bool,
) -> PalamedesResult<Option<ExtractedMessageRecord>> {
    let (message, placeholders) = template_to_message(template, source)?;
    if message.is_empty() {
        return Ok(None);
    }

    Ok(Some(ExtractedMessageRecord {
        message,
        comment: None,
        context: None,
        placeholders: (!placeholders.is_empty()).then_some(placeholders),
        origin,
        scope,
    }))
}

fn extract_from_descriptor_call(
    call: &CallExpression<'_>,
    macro_name: &str,
    origin: (String, usize, Option<usize>),
    scope: Option<String>,
    source: &str,
    location: &str,
) -> PalamedesResult<Option<ExtractedMessageRecord>> {
    let Some(first_arg) = call.arguments.first() else {
        return Err(unsupported_macro_syntax(
            macro_name,
            location,
            "the first argument must be a descriptor object",
        ));
    };
    let Argument::ObjectExpression(object) = first_arg else {
        return Err(unsupported_macro_syntax(
            macro_name,
            location,
            "the first argument must be a descriptor object",
        ));
    };

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

    let (message, placeholders) = match message_expression.without_parentheses() {
        Expression::StringLiteral(literal) => (literal.value.to_string(), BTreeMap::new()),
        Expression::TemplateLiteral(template) => template_to_message(template, source)?,
        _ => {
            return Err(unsupported_macro_syntax(
                macro_name,
                location,
                "the descriptor `message` must be a string literal or template literal",
            ));
        }
    };
    let comment = descriptor_static_property(object, "comment", macro_name, location)?;
    let context = descriptor_static_property(object, "context", macro_name, location)?;

    Ok(Some(ExtractedMessageRecord {
        message,
        comment,
        context,
        placeholders: (!placeholders.is_empty()).then_some(placeholders),
        origin,
        scope,
    }))
}

fn extract_from_choice_call(
    call: &CallExpression<'_>,
    macro_name: &str,
    origin: (String, usize, Option<usize>),
    scope: Option<String>,
    source: &str,
    location: &str,
) -> PalamedesResult<Option<ExtractedMessageRecord>> {
    let Some(value_arg) = call.arguments.first() else {
        return Ok(None);
    };
    let Some(options_arg) = call.arguments.get(1) else {
        return Ok(None);
    };
    let Argument::ObjectExpression(object) = options_arg else {
        return Ok(None);
    };

    let value_name = argument_expression_name(value_arg)
        .unwrap_or_else(|| CHOICE_VALUE_FALLBACK_NAME.to_string());
    let value_expression = value_arg
        .as_expression()
        .and_then(|expression| expression_source(expression, source))
        .unwrap_or_else(|| value_name.clone());
    let mut used_value_names = HashMap::from([(value_name.clone(), value_expression)]);
    let format = match macro_name {
        "plural" => "plural",
        "select" => "select",
        "selectOrdinal" => "selectordinal",
        _ => return Ok(None),
    };
    let extracted_options = extract_choice_options_from_object(
        object,
        source,
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

    Ok(Some(ExtractedMessageRecord {
        message,
        comment: None,
        context: None,
        placeholders: (!extracted_options.placeholders.is_empty())
            .then_some(extracted_options.placeholders),
        origin,
        scope,
    }))
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
    scope: Option<String>,
) -> PalamedesResult<Option<ExtractedMessageRecord>> {
    let Some(first_arg) = call.arguments.first() else {
        return Ok(None);
    };

    if matches!(first_arg, Argument::ObjectExpression(_)) {
        return Err(PalamedesError::UnsupportedMacroSyntax {
            macro_name: "i18n._".to_string(),
            location: format!("{}:{}:1", origin.0, origin.1),
            detail: "object-form runtime messages have been removed; pass a string id as the first argument and source metadata as the third argument".to_string(),
        });
    }

    let mut message = argument_string_value(first_arg);
    let mut comment = None;
    let mut context = None;

    if let Some(Argument::ObjectExpression(object)) = call.arguments.get(2) {
        let props = extract_object_properties(object);
        if props.contains_key("id") {
            return Err(PalamedesError::ExplicitMessageIdsUnsupported);
        }
        message = props.get("message").cloned().or(message);
        comment = props.get("comment").cloned();
        context = props.get("context").cloned();
    }

    Ok(message.map(|message| ExtractedMessageRecord {
        message,
        comment,
        context,
        placeholders: None,
        origin,
        scope,
    }))
}

fn function_like_initializer_name(declarator: &VariableDeclarator<'_>) -> Option<String> {
    let init = declarator.init.as_ref()?.without_parentheses();

    is_function_like_expression(init)
        .then(|| binding_identifier_name(&declarator.id))
        .flatten()
}

fn is_function_like_expression(expr: &Expression<'_>) -> bool {
    match expr.without_parentheses() {
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => true,
        Expression::CallExpression(call) => call
            .arguments
            .first()
            .and_then(argument_expression)
            .is_some_and(is_function_like_expression),
        _ => false,
    }
}

fn argument_expression<'a>(argument: &'a Argument<'a>) -> Option<&'a Expression<'a>> {
    match argument {
        Argument::SpreadElement(_) => None,
        _ => argument.as_expression(),
    }
}

fn binding_identifier_name(pattern: &BindingPattern<'_>) -> Option<String> {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => Some(identifier.name.to_string()),
        _ => None,
    }
}

fn template_to_message(
    template: &TemplateLiteral<'_>,
    source: &str,
) -> PalamedesResult<(String, BTreeMap<String, String>)> {
    let mut used_value_names = HashMap::new();
    template_to_message_with_state(
        template,
        source,
        "template expression",
        &mut used_value_names,
    )
}

fn template_to_message_with_state(
    template: &TemplateLiteral<'_>,
    source: &str,
    syntax: &'static str,
    used_value_names: &mut HashMap<String, String>,
) -> PalamedesResult<(String, BTreeMap<String, String>)> {
    let mut message = String::new();
    let mut placeholders = BTreeMap::new();

    for (index, quasi) in template.quasis.iter().enumerate() {
        if let Some(value) = quasi.value.cooked {
            message.push_str(value.as_str());
        } else {
            message.push_str(quasi.value.raw.as_str());
        }

        if let Some(expr) = template.expressions.get(index) {
            let Some(preferred_name) = expression_name(expr) else {
                return Err(PalamedesError::UnnamedPlaceholder { syntax });
            };
            let expression =
                expression_source(expr, source).unwrap_or_else(|| preferred_name.clone());
            let placeholder =
                make_unique_placeholder_name(preferred_name, &expression, used_value_names);
            message.push('{');
            message.push_str(&placeholder);
            message.push('}');
            placeholders.insert(placeholder, expression);
        }
    }

    Ok((message, placeholders))
}

fn make_unique_placeholder_name(
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

fn expression_source(expr: &Expression<'_>, source: &str) -> Option<String> {
    let span = expr.span();
    source
        .get(span.start as usize..span.end as usize)
        .map(str::trim)
        .filter(|expression| !expression.is_empty())
        .map(ToOwned::to_owned)
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
        JSXAttributeValue::StringLiteral(literal) => {
            Some(decode_jsx_entities(literal.value.as_str()))
        }
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

fn extract_jsx_choice_value(
    opening_element: &JSXOpeningElement<'_>,
    source: &str,
) -> PalamedesResult<Option<(String, String)>> {
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

        let name = jsx_expression_name(&container.expression)
            .unwrap_or_else(|| CHOICE_VALUE_FALLBACK_NAME.to_string());
        let span = container.expression.span();
        let expression = source
            .get(span.start as usize..span.end as usize)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(name.as_str())
            .to_string();

        return Ok(Some((name, expression)));
    }

    Ok(None)
}

fn extract_jsx_children_as_message(
    children: &[JSXChild<'_>],
    _source: &str,
) -> PalamedesResult<String> {
    let mut next_component_index = 0usize;

    Ok(extract_jsx_children_as_message_with_state(children, &mut next_component_index)?.message)
}

fn extract_jsx_children_as_message_with_state(
    children: &[JSXChild<'_>],
    next_component_index: &mut usize,
) -> PalamedesResult<JoinedJsxMessage> {
    let mut parts = Vec::new();

    for child in children {
        match child {
            JSXChild::Text(text) => {
                let value = clean_jsx_text(text.value.as_str());
                if !value.is_empty() {
                    parts.push(JsxMessagePart::Text(value));
                }
            }
            JSXChild::ExpressionContainer(container) => match &container.expression {
                JSXExpression::StringLiteral(literal) => {
                    parts.push(JsxMessagePart::Text(literal.value.to_string()));
                }
                expr => {
                    let Some(name) = jsx_expression_name(expr) else {
                        return Err(PalamedesError::UnnamedPlaceholder {
                            syntax: "JSX expression",
                        });
                    };
                    parts.push(JsxMessagePart::ValuePlaceholder(format!("{{{name}}}")));
                }
            },
            JSXChild::Element(element) => {
                let name = next_component_index.to_string();
                *next_component_index += 1;
                let inner = extract_jsx_children_as_message_with_state(
                    &element.children,
                    next_component_index,
                )?;
                let is_empty = inner.message.is_empty();
                let value = if is_empty {
                    format!("<{name}/>")
                } else {
                    format!("<{name}>{}</{name}>", inner.message)
                };
                parts.push(JsxMessagePart::ComponentPlaceholder { value, is_empty });
            }
            JSXChild::Fragment(fragment) => {
                let inner = extract_jsx_children_as_message_with_state(
                    &fragment.children,
                    next_component_index,
                )?;
                if !inner.message.is_empty() {
                    parts.push(JsxMessagePart::Message {
                        value: inner.message,
                        ends_with_placeholder: inner.ends_with_placeholder,
                    });
                }
            }
            JSXChild::Spread(_) => {
                return Err(PalamedesError::UnnamedPlaceholder {
                    syntax: "JSX spread child",
                });
            }
        }
    }

    Ok(join_jsx_message_parts(&parts))
}

fn extract_choice_options_from_jsx(
    opening_element: &JSXOpeningElement<'_>,
    source: &str,
    used_value_names: &mut HashMap<String, String>,
    format: &str,
    macro_name: &str,
    location: &str,
) -> PalamedesResult<ExtractedChoiceOptions> {
    let mut options = Vec::new();
    let mut placeholders = BTreeMap::new();
    let mut offset = None;

    for attr in &opening_element.attributes {
        let Some(attr) = attr.as_attribute() else {
            continue;
        };
        let key = attr.name.get_identifier().name.to_string();
        if matches!(
            key.as_str(),
            "id" | "message" | "comment" | "context" | "value"
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
        let Some(attr_value) = attr.value.as_ref() else {
            continue;
        };
        let (value, option_placeholders) = match attr_value {
            JSXAttributeValue::StringLiteral(literal) => {
                (decode_jsx_entities(literal.value.as_str()), BTreeMap::new())
            }
            JSXAttributeValue::ExpressionContainer(container) => match &container.expression {
                JSXExpression::StringLiteral(literal) => {
                    (literal.value.to_string(), BTreeMap::new())
                }
                JSXExpression::TemplateLiteral(template) => template_to_message_with_state(
                    template,
                    source,
                    "choice option template expression",
                    used_value_names,
                )?,
                _ => continue,
            },
            _ => continue,
        };

        options.push((normalized_key, value));
        placeholders.extend(option_placeholders);
    }

    Ok(ExtractedChoiceOptions {
        options,
        placeholders,
        offset,
    })
}

fn expression_offset_value(expression: &Expression<'_>) -> Option<String> {
    match expression.without_parentheses() {
        Expression::StringLiteral(literal) => normalize_string_offset(literal.value.as_str()),
        Expression::TemplateLiteral(template) => template
            .single_quasi()
            .and_then(|value| normalize_string_offset(value.as_str())),
        Expression::NumericLiteral(literal) => normalize_numeric_offset(literal.value),
        _ => None,
    }
}

fn jsx_offset_value(value: &JSXAttributeValue<'_>) -> Option<String> {
    match value {
        JSXAttributeValue::StringLiteral(literal) => {
            normalize_string_offset(literal.value.as_str())
        }
        JSXAttributeValue::ExpressionContainer(container) => match &container.expression {
            JSXExpression::StringLiteral(literal) => {
                normalize_string_offset(literal.value.as_str())
            }
            JSXExpression::TemplateLiteral(template) => template
                .single_quasi()
                .and_then(|value| normalize_string_offset(value.as_str())),
            JSXExpression::NumericLiteral(literal) => normalize_numeric_offset(literal.value),
            _ => None,
        },
        _ => None,
    }
}

fn invalid_offset(macro_name: &str, location: &str) -> PalamedesError {
    PalamedesError::UnsupportedMacroSyntax {
        macro_name: macro_name.to_string(),
        location: location.to_string(),
        detail: "`offset` must be a static non-negative integer".to_string(),
    }
}

fn invalid_choice_option(macro_name: &str, location: &str, key: &str) -> PalamedesError {
    PalamedesError::UnsupportedMacroSyntax {
        macro_name: macro_name.to_string(),
        location: location.to_string(),
        detail: format!(
            "`{key}` is not a valid plural category; use zero, one, two, few, many, other, or an exact _N key"
        ),
    }
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
    arg.as_expression().and_then(expression_name)
}

/// Extracts source-string-first messages from a JavaScript or TypeScript module.
///
/// # Errors
///
/// Returns an error when the source cannot be parsed or when the module uses
/// unsupported author-facing explicit message IDs.
pub fn extract_messages(
    source: &str,
    filename: &str,
) -> PalamedesResult<Vec<ExtractedMessageRecord>> {
    let allocator = Allocator::default();
    let source_type = SourceType::from_path(filename).unwrap_or_else(|_| SourceType::tsx());
    let parsed = Parser::new(&allocator, source, source_type).parse();

    if !parsed.diagnostics.is_empty() {
        let messages = parsed
            .diagnostics
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(", ");
        return Err(PalamedesError::ParseSource { messages });
    }

    let line_locator = LineLocator::new(source);
    let mut collector = MacroCollector::new();
    collector.visit_program(&parsed.program);

    if let Some((macro_name, offset)) = collector.removed_macro_import.as_ref() {
        let (line, column) = line_locator.get_location(*offset);
        return Err(PalamedesError::UnsupportedMacroSyntax {
            macro_name: macro_name.clone(),
            location: format!("{filename}:{line}:{column}"),
            detail: "this deferred message macro has been removed; translate at the point of use with `t`".to_string(),
        });
    }

    validate_translation_macro_scopes(&parsed.program, filename, source, |local_name| {
        collector
            .imported_macros
            .get(local_name)
            .map(|macro_info| macro_info.imported_name.clone())
    })?;

    let mut extractor =
        ExtractionVisitor::new(filename, source, &line_locator, &collector.imported_macros);
    extractor.visit_program(&parsed.program);

    if let Some(error) = extractor.error {
        return Err(error);
    }

    Ok(extractor.messages)
}

/// Extracts and aggregates source-first catalog update messages from files.
///
/// # Errors
///
/// Returns an error only for fatal authoring failures such as explicit message
/// IDs or nested message macros. Read, parse, and non-fatal extraction failures
/// are returned in `failed_files` so callers can preserve the CLI's
/// warning-oriented behavior.
pub fn extract_catalog_messages_from_files(
    request: ExtractCatalogMessagesRequest,
) -> PalamedesResult<ExtractCatalogMessagesResult> {
    let root_dir = PathBuf::from(&request.root_dir);
    let mut catalog = BTreeMap::<String, AggregatedCatalogEntry>::new();
    let mut failed_files = Vec::new();
    let file_count = request.files.len();

    for file in &request.files {
        let source = match std::fs::read_to_string(file) {
            Ok(source) => source,
            Err(source) => {
                failed_files.push(ExtractCatalogFileFailure {
                    path: file.clone(),
                    message: PalamedesError::ReadFile {
                        path: PathBuf::from(file),
                        source,
                    }
                    .to_string(),
                });
                continue;
            }
        };

        let extracted = match extract_messages(&source, file) {
            Ok(messages) => messages,
            Err(
                error @ (PalamedesError::ExplicitMessageIdsUnsupported
                | PalamedesError::NestedMessageMacro { .. }
                | PalamedesError::UnsupportedMacroSyntax { .. }
                | PalamedesError::TranslationMacroOutsideFunction { .. }),
            ) => {
                return Err(error);
            }
            Err(error) => {
                failed_files.push(ExtractCatalogFileFailure {
                    path: file.clone(),
                    message: error.to_string(),
                });
                continue;
            }
        };

        let relative_file = relative_origin_file(&root_dir, file);
        for message in extracted {
            add_extracted_message(&mut catalog, message, &relative_file);
        }
    }

    Ok(ExtractCatalogMessagesResult {
        messages: catalog
            .into_values()
            .map(CatalogUpdateMessage::from)
            .collect(),
        file_count,
        failed_files,
    })
}

fn relative_origin_file(root_dir: &Path, file: &str) -> String {
    let path = Path::new(file);
    path.strip_prefix(root_dir)
        .map(Path::to_path_buf)
        .or_else(|_| relative_path_from(root_dir, path).ok_or(()))
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .replace('\\', "/")
}

fn relative_path_from(root_dir: &Path, path: &Path) -> Option<PathBuf> {
    if root_dir.is_absolute() != path.is_absolute() {
        return None;
    }

    if path_prefix(root_dir) != path_prefix(path) {
        return None;
    }

    let root_components = normalized_path_components(root_dir);
    let path_components = normalized_path_components(path);
    let common_len = root_components
        .iter()
        .zip(path_components.iter())
        .take_while(|(root, path)| root == path)
        .count();

    let mut relative = PathBuf::new();
    for _ in common_len..root_components.len() {
        relative.push("..");
    }
    for component in &path_components[common_len..] {
        relative.push(component);
    }

    if relative.as_os_str().is_empty() {
        relative.push(".");
    }

    Some(relative)
}

fn path_prefix(path: &Path) -> Option<OsString> {
    path.components().find_map(|component| match component {
        std::path::Component::Prefix(prefix) => Some(prefix.as_os_str().to_os_string()),
        _ => None,
    })
}

fn normalized_path_components(path: &Path) -> Vec<OsString> {
    let mut normalized: Vec<OsString> = Vec::new();

    for component in path.components() {
        match component {
            std::path::Component::Prefix(_) | std::path::Component::RootDir => {}
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                if normalized
                    .last()
                    .is_some_and(|previous| previous.as_os_str() != "..")
                {
                    normalized.pop();
                } else {
                    normalized.push(component.as_os_str().to_os_string());
                }
            }
            std::path::Component::Normal(_) => {
                normalized.push(component.as_os_str().to_os_string());
            }
        }
    }

    normalized
}

fn add_extracted_message(
    catalog: &mut BTreeMap<String, AggregatedCatalogEntry>,
    message: ExtractedMessageRecord,
    relative_file: &str,
) {
    if message.message.is_empty() {
        return;
    }

    let key = catalog_key(&message.message, message.context.as_deref());
    let entry = catalog
        .entry(key)
        .or_insert_with(|| AggregatedCatalogEntry {
            message: message.message.clone(),
            context: message.context.clone(),
            placeholders: BTreeMap::new(),
            extracted_comments: Vec::new(),
            origins: Vec::new(),
        });

    if let Some(comment) = message.comment {
        if !entry.extracted_comments.contains(&comment) {
            entry.extracted_comments.push(comment);
        }
    }

    if let Some(placeholders) = message.placeholders {
        for (name, expression) in placeholders {
            let values = entry.placeholders.entry(name).or_default();
            if !values.contains(&expression) {
                values.push(expression);
            }
        }
    }

    let origin = CatalogUpdateOrigin {
        file: relative_file.to_string(),
        line: u32::try_from(message.origin.1).unwrap_or(u32::MAX),
        scope: message.scope.clone(),
    };
    if !entry.origins.contains(&origin) {
        entry.origins.push(origin);
    }
}

fn catalog_key(message: &str, context: Option<&str>) -> String {
    format!("{}\u{4}{message}", context.unwrap_or_default())
}

impl From<AggregatedCatalogEntry> for CatalogUpdateMessage {
    fn from(value: AggregatedCatalogEntry) -> Self {
        let AggregatedCatalogEntry {
            message,
            context,
            placeholders,
            extracted_comments,
            mut origins,
        } = value;
        origins.sort_by(|a, b| {
            a.file
                .cmp(&b.file)
                .then(a.line.cmp(&b.line))
                .then(a.scope.cmp(&b.scope))
        });

        Self {
            message,
            context,
            placeholders,
            extracted_comments,
            origins,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::{
        extract_catalog_messages_from_files, extract_messages as extract_messages_raw,
        ExtractCatalogMessagesRequest, ExtractedMessageRecord,
    };
    use crate::error::PalamedesResult;
    use crate::test_support::scope_macro_test_source;

    static TEMP_COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn extract_messages(
        source: &str,
        filename: &str,
    ) -> PalamedesResult<Vec<ExtractedMessageRecord>> {
        extract_messages_raw(&scope_macro_test_source(source, filename), filename)
    }

    #[test]
    fn rejects_eager_translation_macros_outside_functions() {
        let cases = [
            (
                r#"import { t as translate } from "@palamedes/core/macro";
const message = translate`Hello`;
"#,
                "test.ts",
                "t",
            ),
            (
                r##"import { plural } from "@palamedes/core/macro";
const message = plural(count, { one: "# item", other: "# items" });
"##,
                "test.ts",
                "plural",
            ),
            (
                r#"import { Select as Choice } from "@palamedes/react/macro";
const message = <Choice value={gender} other="They" />;
"#,
                "test.tsx",
                "Select",
            ),
            (
                r#"import { t } from "@palamedes/core/macro";
class Formatter { label = t`Hello`; }
"#,
                "test.ts",
                "t",
            ),
        ];

        for (source, filename, macro_name) in cases {
            let error = extract_messages_raw(source, filename)
                .expect_err("top-level eager translation macros must fail");
            let message = error.to_string();
            assert!(message.contains(&format!(
                "Translation macro `{macro_name}` must be used inside a function"
            )));
            assert!(message.contains(filename));
        }
    }

    #[test]
    fn extracts_translation_macros_in_deferred_scopes_and_trans_at_module_scope() {
        let source = r##"import { plural, t } from "@palamedes/core/macro";
import { Plural, Trans } from "@palamedes/react/macro";

const safe = <Trans>Rendered later</Trans>;
function declaration() { return t`Function`; }
const arrow = () => t`Arrow`;
const object = { method() { return t`Method`; } };
class Formatter { method() { return t`Class method`; } }
items.map(() => t`Callback`);
function Component() {
  return <Plural value={count} one="# item" other="# items" />;
}
function choices() {
  return plural(count, { one: "# item", other: "# items" });
}
"##;

        let messages = extract_messages_raw(source, "test.tsx")
            .expect("function-scoped macros and top-level Trans should extract");
        let source_messages = messages
            .iter()
            .map(|message| message.message.as_str())
            .collect::<Vec<_>>();

        assert!(source_messages.contains(&"Rendered later"));
        assert!(source_messages.contains(&"Class method"));
        assert!(source_messages.contains(&"{count, plural, one {# item} other {# items}}"));
    }

    #[test]
    fn extracts_tagged_templates() {
        let messages = extract_messages(
            r#"
              import { t } from "@palamedes/core/macro"
              const message = t`Hello ${name} and ${resolved.locale}`
            "#,
            "test.tsx",
        )
        .expect("messages should extract");

        assert_eq!(messages[0].message, "Hello {name} and {locale}");
        let placeholders = messages[0]
            .placeholders
            .as_ref()
            .expect("placeholder metadata");
        assert_eq!(placeholders.get("name").map(String::as_str), Some("name"));
        assert_eq!(
            placeholders.get("locale").map(String::as_str),
            Some("resolved.locale")
        );
    }

    #[test]
    fn extracts_zero_argument_accessor_placeholder_names() {
        let messages = extract_messages(
            r##"
              import { plural, t } from "@palamedes/core/macro"
              import { Plural, Trans } from "@palamedes/react/macro"

              const tagged = t`You have ${count()} items`
              const rich = <Trans>There are {props.quantity()} tasks</Trans>
              const choice = plural(count(), { one: "# item", other: "# items" })
              const richChoice = <Plural value={props.quantity()} one="# task" other="# tasks" />
            "##,
            "test.tsx",
        )
        .expect("zero-argument accessors should extract");

        assert_eq!(
            messages
                .iter()
                .map(|message| message.message.as_str())
                .collect::<Vec<_>>(),
            vec![
                "You have {count} items",
                "There are {quantity} tasks",
                "{count, plural, one {# item} other {# items}}",
                "{quantity, plural, one {# task} other {# tasks}}",
            ]
        );
        assert_eq!(
            messages[0].placeholders,
            Some(BTreeMap::from([(
                "count".to_string(),
                "count()".to_string()
            )]))
        );
    }

    #[test]
    fn extracts_plural_offsets_from_calls_and_jsx() {
        let messages = extract_messages(
            r##"
              import { plural } from "@palamedes/core/macro"
              import { Plural } from "@palamedes/react/macro"

              const call = plural(count, { offset: 1, one: "# item", other: "# items" })
              const stringCall = plural(count, { offset: "2", one: "# item", other: "# items" })
              const jsx = <Plural value={count} offset={1} one="# item" other="# items" />
            "##,
            "test.tsx",
        )
        .expect("static plural offsets should extract");

        assert_eq!(
            messages
                .iter()
                .map(|message| message.message.as_str())
                .collect::<Vec<_>>(),
            vec![
                "{count, plural, offset:1 one {# item} other {# items}}",
                "{count, plural, offset:2 one {# item} other {# items}}",
                "{count, plural, offset:1 one {# item} other {# items}}",
            ]
        );
    }

    #[test]
    fn rejects_invalid_plural_offsets_and_categories() {
        let cases = [
            r##"
              import { plural } from "@palamedes/core/macro"
              const message = plural(count, { offset: dynamicOffset, one: "# item", other: "# items" })
            "##,
            r##"
              import { plural } from "@palamedes/core/macro"
              const message = plural(count, { invalid: "broken", other: "# items" })
            "##,
            r##"
              import { Plural } from "@palamedes/react/macro"
              const message = <Plural value={count} offset={-1} one="# item" other="# items" />
            "##,
        ];

        for source in cases {
            let error = extract_messages(source, "test.tsx").expect_err("invalid plural metadata");
            assert!(error.to_string().contains("Unsupported"));
        }
    }

    #[test]
    fn extracts_interpolated_descriptor_templates() {
        let messages = extract_messages(
            r#"
              import { t } from "@palamedes/core/macro"
              const first = t({
                message: `Descriptor ${name}`,
                context: "probe context",
              })
              const second = t({ message: `Locale ${resolved.locale}` })
            "#,
            "test.tsx",
        )
        .expect("messages should extract");

        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].message, "Descriptor {name}");
        assert_eq!(messages[0].context.as_deref(), Some("probe context"));
        assert_eq!(
            messages[0].placeholders,
            Some(BTreeMap::from([("name".to_string(), "name".to_string())]))
        );
        assert_eq!(messages[1].message, "Locale {locale}");
        assert_eq!(
            messages[1].placeholders,
            Some(BTreeMap::from([(
                "locale".to_string(),
                "resolved.locale".to_string()
            )]))
        );
    }

    #[test]
    fn rejects_removed_deferred_macro_imports() {
        for macro_name in ["msg", "defineMessage"] {
            let source = format!(
                r#"import {{ t, {macro_name} as deferred }} from "@palamedes/core/macro"
const message = t`Hello`
"#
            );
            let error = extract_messages(&source, "test.ts")
                .expect_err("removed deferred macro imports must fail");

            let message = error.to_string();
            assert!(message.contains(&format!(
                "Unsupported `{macro_name}` macro usage at test.ts:1:1"
            )));
            assert!(message.contains("deferred message macro has been removed"));
        }
    }

    #[test]
    fn rejects_dynamic_descriptor_messages_with_location() {
        let error = extract_messages(
            r#"import { t } from "@palamedes/core/macro"
const message = t({ message })
"#,
            "test.ts",
        )
        .expect_err("dynamic descriptor messages must fail");

        let message = error.to_string();
        assert!(message.contains("Unsupported `t` macro usage at test.ts:2:17"));
        assert!(message.contains("must be a string literal or template literal"));
    }

    #[test]
    fn extracts_runtime_calls() {
        let messages = extract_messages(
            r#"
              const message = i18n._("lookup-key", { name }, { message: "Hello {name}" })
            "#,
            "test.tsx",
        )
        .expect("messages should extract");

        assert_eq!(messages[0].message, "Hello {name}");
    }

    #[test]
    fn rejects_object_form_runtime_messages() {
        let error = extract_messages(r#"const message = i18n._({ message: "Hello" })"#, "test.ts")
            .expect_err("object-form runtime messages must fail");

        assert!(error
            .to_string()
            .contains("object-form runtime messages have been removed"));
    }

    #[test]
    fn rejects_explicit_ids() {
        let error = extract_messages(
            r#"
              import { t } from "@palamedes/core/macro"
              const message = t({ id: "greeting", message: "Hello" })
            "#,
            "test.tsx",
        )
        .expect_err("explicit ids should fail");

        assert!(error.to_string().contains("Explicit message ids"));
    }

    #[test]
    fn rejects_unnamed_template_placeholders() {
        let error = extract_messages(
            r#"
              import { t } from "@palamedes/core/macro"
              const message = t`Hello ${firstName + lastName}`
            "#,
            "test.tsx",
        )
        .expect_err("unnamed placeholders should fail");

        assert!(error.to_string().contains("stable placeholder name"));
    }

    #[test]
    fn uses_numeric_jsx_component_placeholder_names() {
        let messages = extract_messages(
            r#"
              import { Trans } from "@palamedes/react/macro"
              const message = <Trans>Accept <a href="/terms">terms</a> and <a href="/privacy">privacy</a></Trans>
            "#,
            "test.tsx",
        )
        .expect("messages should extract");

        assert_eq!(
            messages[0].message,
            "Accept <0>terms</0> and <1>privacy</1>"
        );
    }

    #[test]
    fn decodes_jsx_entities_before_extracting_message_ids() {
        let messages = extract_messages(
            r#"
              import { Trans } from "@palamedes/react/macro"
              const child = <Trans>Green-e&reg; applies to US &amp; Canada only</Trans>
              const attr = <Trans message="Decision &quot;Model&quot; &#x26; review" />
              const expression = <Trans>{"A &amp; B"}</Trans>
              const expressionAttr = <Trans message={"Literal &amp; Value"} />
              const rich = <Trans>Accept <a href="/terms">terms &amp; conditions</a></Trans>
            "#,
            "test.tsx",
        )
        .expect("messages should extract");

        assert_eq!(
            messages
                .iter()
                .map(|message| message.message.as_str())
                .collect::<Vec<_>>(),
            vec![
                "Green-e® applies to US & Canada only",
                "Decision \"Model\" & review",
                "A &amp; B",
                "Literal &amp; Value",
                "Accept <0>terms & conditions</0>",
            ]
        );
    }

    #[test]
    fn decodes_jsx_choice_attribute_entities() {
        let messages = extract_messages(
            r##"
              import { Plural } from "@palamedes/react/macro"
              const message = <Plural value={count} one="# item &amp; fee" other="# items &amp; fees" />
            "##,
            "test.tsx",
        )
        .expect("messages should extract");

        assert_eq!(
            messages[0].message,
            "{count, plural, one {# item & fee} other {# items & fees}}"
        );
    }

    #[test]
    fn extracts_computed_defaulted_and_literal_choice_values() {
        let messages = extract_messages(
            r##"
              import { plural } from "@palamedes/core/macro"
              const computed = plural(periodCounts[period] ?? 0, { one: "# entry", other: "# entries" })
              const literal = plural(21, { one: "# month", other: "# months" })
            "##,
            "test.tsx",
        )
        .expect("messages should extract");

        assert_eq!(
            messages
                .iter()
                .map(|message| message.message.as_str())
                .collect::<Vec<_>>(),
            vec![
                "{period, plural, one {# entry} other {# entries}}",
                "{value, plural, one {# month} other {# months}}",
            ]
        );
    }

    #[test]
    fn extracts_plural_messages_with_numeric_hyphenated_text() {
        let messages = extract_messages(
            r##"
              import { plural, t } from "@palamedes/core/macro"

              export function Demo(count) {
                const a = plural(count, { one: "# queue detail 003", other: "# queue details 003" })
                const b = plural(count, { one: "# queue detail 00042-now", other: "# queue details 00042-now" })
                return [t({ message: "x" }), a, b]
              }
            "##,
            "test.tsx",
        )
        .expect("messages should extract");

        assert_eq!(
            messages
                .iter()
                .map(|message| message.message.as_str())
                .collect::<Vec<_>>(),
            vec![
                "{count, plural, one {# queue detail 003} other {# queue details 003}}",
                "{count, plural, one {# queue detail 00042-now} other {# queue details 00042-now}}",
                "x",
            ]
        );
    }

    #[test]
    fn extracts_plural_choice_branch_interpolations() {
        let messages = extract_messages(
            r##"
              import { plural } from "@palamedes/core/macro"
              const message = plural(count, {
                one: `# item will be archived because ${planLabel} allows a maximum of ${max}`,
                other: `# items will be archived because ${planLabel} allows a maximum of ${max}`,
              })
            "##,
            "test.tsx",
        )
        .expect("messages should extract");

        assert_eq!(
            messages[0].message,
            "{count, plural, one {# item will be archived because {planLabel} allows a maximum of {max}} other {# items will be archived because {planLabel} allows a maximum of {max}}}"
        );
        assert_eq!(
            messages[0].placeholders,
            Some(BTreeMap::from([
                ("max".to_string(), "max".to_string()),
                ("planLabel".to_string(), "planLabel".to_string()),
            ]))
        );
    }

    #[test]
    fn extracts_plural_jsx_branch_interpolations() {
        let messages = extract_messages(
            r##"
              import { Plural } from "@palamedes/react/macro"
              const message = <Plural
                value={count}
                one={`# item will be archived because ${planLabel} allows a maximum of ${max}`}
                other={`# items will be archived because ${planLabel} allows a maximum of ${max}`}
              />
            "##,
            "test.tsx",
        )
        .expect("messages should extract");

        assert_eq!(
            messages[0].message,
            "{count, plural, one {# item will be archived because {planLabel} allows a maximum of {max}} other {# items will be archived because {planLabel} allows a maximum of {max}}}"
        );
        assert_eq!(
            messages[0].placeholders,
            Some(BTreeMap::from([
                ("max".to_string(), "max".to_string()),
                ("planLabel".to_string(), "planLabel".to_string()),
            ]))
        );
    }

    #[test]
    fn extracts_defaulted_jsx_choice_values() {
        let messages = extract_messages(
            r##"
              import { Plural } from "@palamedes/react/macro"
              const message = <Plural value={node.locationCount ?? 0} one="# location" other="# locations" />
            "##,
            "test.tsx",
        )
        .expect("messages should extract");

        assert_eq!(
            messages[0].message,
            "{locationCount, plural, one {# location} other {# locations}}"
        );
    }

    #[test]
    fn leaves_javascript_string_literal_entities_unchanged() {
        let messages = extract_messages(
            r#"
              import { t } from "@palamedes/core/macro"
              const message = t({ message: "Fish &amp; Chips" })
            "#,
            "test.tsx",
        )
        .expect("messages should extract");

        assert_eq!(messages[0].message, "Fish &amp; Chips");
    }

    #[test]
    fn uses_numeric_jsx_component_placeholder_names_for_identical_markup() {
        let messages = extract_messages(
            r#"
              import { Trans } from "@palamedes/react/macro"
              const message = <Trans><strong>A</strong> and <strong>B</strong></Trans>
            "#,
            "test.tsx",
        )
        .expect("messages should extract");

        assert_eq!(messages[0].message, "<0>A</0> and <1>B</1>");
    }

    #[test]
    fn uses_self_closing_jsx_component_placeholders_for_empty_children() {
        let messages = extract_messages(
            r#"
              import { Trans } from "@palamedes/react/macro"
              const message = <Trans>I agree to the <a href={COMMERCIAL_TERMS_URL}>Commercial Terms <ExternalLink className="inline" /></a></Trans>
            "#,
            "test.tsx",
        )
        .expect("messages should extract");

        assert_eq!(
            messages[0].message,
            "I agree to the <0>Commercial Terms<1/></0>"
        );
    }

    #[test]
    fn preserves_inline_whitespace_before_empty_component_placeholders_with_trailing_text() {
        let messages = extract_messages(
            r#"
              import { Trans } from "@palamedes/react/macro"
              const message = <Trans>Foo <Icon /> bar</Trans>
            "#,
            "test.tsx",
        )
        .expect("messages should extract");

        assert_eq!(messages[0].message, "Foo <0/> bar");
    }

    #[test]
    fn preserves_lingui_inline_expression_spacing_across_line_breaks() {
        let messages = extract_messages(
            "
              import { Trans } from \"@palamedes/react/macro\"
              const paren = <Trans>\n  Allocate energy usage to business units for {locationName} (\n  {periodLabel}). Total: {totalMwh} MWh\n</Trans>
              const percent = <Trans>\n  Match Score: {matchPercentage}\n  %\n</Trans>
              const possessive = <Trans>\n  We just need a few details to connect you with {clientCompanyName}\n  's sustainability program.\n</Trans>
            ",
            "test.tsx",
        )
        .expect("messages should extract");

        assert_eq!(
            messages
                .iter()
                .map(|message| message.message.as_str())
                .collect::<Vec<_>>(),
            vec![
                "Allocate energy usage to business units for {locationName} ({periodLabel}). Total: {totalMwh} MWh",
                "Match Score: {matchPercentage}%",
                "We just need a few details to connect you with {clientCompanyName}'s sustainability program.",
            ]
        );
    }

    #[test]
    fn normalizes_jsx_component_placeholder_boundary_whitespace() {
        let messages = extract_messages(
            r#"
              import { Trans } from "@palamedes/react/macro"
              const helper = <Trans>Reach out to your {" "}<a href="/advisor">advisor</a>{" "} for help.</Trans>
              const target = <Trans><strong>100%</strong> Clean Energy by {" "}<strong>{targetYear}</strong></Trans>
              const details = <Trans><strong>Dates & Capacity:</strong> {" "}commercial_operation_date, project_capacity_mw, buyer_capacity_mw</Trans>
            "#,
            "test.tsx",
        )
        .expect("messages should extract");

        assert_eq!(
            messages
                .iter()
                .map(|message| message.message.as_str())
                .collect::<Vec<_>>(),
            vec![
                "Reach out to your <0>advisor</0> for help.",
                "<0>100%</0> Clean Energy by <1>{targetYear}</1>",
                "<0>Dates & Capacity:</0> commercial_operation_date, project_capacity_mw, buyer_capacity_mw",
            ]
        );
    }

    #[test]
    fn normalizes_jsx_component_placeholder_before_punctuation() {
        let messages = extract_messages(
            r#"
              import { Trans } from "@palamedes/react/macro"
              const message = <Trans>Delete {" "}<strong>{selectedProjectName}</strong> ? This action cannot be undone.</Trans>
              const tailored = <Trans>
                Tailored to your {volume} MWh of annual electricity use in {countryName}
                .
              </Trans>
              const literalBraces = <Trans>{"{name}"} .</Trans>
            "#,
            "test.tsx",
        )
        .expect("messages should extract");

        assert_eq!(
            messages[0].message,
            "Delete <0>{selectedProjectName}</0>? This action cannot be undone."
        );
        assert_eq!(
            messages[1].message,
            "Tailored to your {volume} MWh of annual electricity use in {countryName}."
        );
        assert_eq!(messages[2].message, "{name} .");
    }

    #[test]
    fn preserves_leading_jsx_separator_spacing() {
        let messages = extract_messages(
            r#"
              import { Trans } from "@palamedes/react/macro"
              const price = <Trans> · ${priceFormatted}/MWh</Trans>
              const manager = <Trans> — no manager</Trans>
            "#,
            "test.tsx",
        )
        .expect("messages should extract");

        assert_eq!(
            messages
                .iter()
                .map(|message| message.message.as_str())
                .collect::<Vec<_>>(),
            vec![" · ${priceFormatted}/MWh", " — no manager"]
        );
    }

    #[test]
    fn rejects_unnamed_jsx_placeholders() {
        let error = extract_messages(
            r#"
              import { Trans } from "@palamedes/react/macro"
              const message = <Trans>Hello {firstName + lastName}</Trans>
            "#,
            "test.tsx",
        )
        .expect_err("unnamed JSX placeholders should fail");

        assert!(error.to_string().contains("stable placeholder name"));
    }

    #[test]
    fn rejects_nested_jsx_message_macros() {
        let error = extract_messages(
            r##"
              import { Plural, Trans } from "@palamedes/react/macro"
              const message = <Trans><Plural value={contractCount} one="# contract" other="# contracts" /> ({capacityMW} MW)</Trans>
            "##,
            "test.tsx",
        )
        .expect_err("nested message macros should fail");
        let message = error.to_string();

        assert!(message.contains("Nested i18n macro is not extractable as a single message"));
        assert!(message.contains("test.tsx:3:"));
        assert!(message.contains("Move the full sentence into <Plural> branches"));
    }

    #[test]
    fn rejects_nested_jsx_message_macros_inside_conditional_and_logical_expressions() {
        for source in [
            r#"
              import { Plural, Trans } from "@palamedes/react/macro"
              const message = <Trans>{showCount ? <Plural value={count} one="one" other="other" /> : null}</Trans>
            "#,
            r#"
              import { Plural, Trans } from "@palamedes/react/macro"
              const message = <Trans>{showCount && <Plural value={count} one="one" other="other" />}</Trans>
            "#,
        ] {
            let error = extract_messages(source, "test.tsx")
                .expect_err("nested message macros in JSX expressions should fail");
            let message = error.to_string();

            assert!(message.contains("Nested i18n macro is not extractable as a single message"));
            assert!(!message.contains("stable placeholder name"));
        }
    }

    #[test]
    fn rejects_nested_jsx_message_macros_inside_map_callbacks() {
        let error = extract_messages(
            r#"
              import { Plural, Trans } from "@palamedes/react/macro"
              const message = <Trans>{items.map((item) => <Plural value={item.count} one="one" other="other" />)}</Trans>
            "#,
            "test.tsx",
        )
        .expect_err("nested message macros in map callbacks should fail");
        let message = error.to_string();

        assert!(message.contains("Nested i18n macro is not extractable as a single message"));
        assert!(!message.contains("stable placeholder name"));
    }

    #[test]
    fn allows_nested_jsx_message_macros_inside_render_prop_attributes() {
        let messages = extract_messages(
            r#"
              import { Plural, Trans } from "@palamedes/react/macro"
              const message = <Trans><List renderItem={() => <Plural value={count} one="one" other="other" />} /></Trans>
            "#,
            "test.tsx",
        )
        .expect("nested message macros in render prop attributes should not fail");

        assert_eq!(messages[0].message, "<0/>");
    }

    #[test]
    fn batch_extracts_deduped_catalog_messages_with_relative_origins() {
        let root = temp_root("batch-relative");
        let src = root.join("src");
        fs::create_dir_all(&src).expect("src dir");
        let first = src.join("App.tsx");
        let second = src.join("More.tsx");
        fs::write(
            &first,
            r#"
              import { t } from "@palamedes/core/macro"
              function firstMessages() {
                const a = t({ message: "Hello {name}", comment: "Greeting" })
                const b = t`Computed ${user.name}`
                return [a, b]
              }
            "#,
        )
        .expect("first source");
        fs::write(
            &second,
            r#"
              import { t } from "@palamedes/core/macro"
              function secondMessages() {
                return t({ message: "Hello {name}", comment: "Greeting" })
              }
            "#,
        )
        .expect("second source");

        let result = extract_catalog_messages_from_files(ExtractCatalogMessagesRequest {
            root_dir: root.to_string_lossy().into_owned(),
            files: vec![
                first.to_string_lossy().into_owned(),
                second.to_string_lossy().into_owned(),
            ],
        })
        .expect("batch extraction");

        assert_eq!(result.file_count, 2);
        assert!(result.failed_files.is_empty());

        let hello = result
            .messages
            .iter()
            .find(|message| message.message == "Hello {name}")
            .expect("hello message");
        assert_eq!(hello.extracted_comments, vec!["Greeting"]);
        assert_eq!(hello.origins.len(), 2);
        assert_eq!(hello.origins[0].file, "src/App.tsx");
        assert_eq!(hello.origins[1].file, "src/More.tsx");

        let computed = result
            .messages
            .iter()
            .find(|message| message.message == "Computed {name}")
            .expect("computed message");
        assert_eq!(
            computed
                .placeholders
                .get("name")
                .expect("placeholder expression"),
            &vec!["user.name".to_string()]
        );

        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn batch_extracts_parent_include_origins_relative_to_root_dir() {
        let root = temp_root("batch-parent-relative");
        let app = root.join("apps").join("web");
        let shared_src = root.join("packages").join("ui").join("src");
        fs::create_dir_all(&app).expect("app dir");
        fs::create_dir_all(&shared_src).expect("shared src dir");
        let shared = shared_src.join("shared-card.tsx");
        fs::write(
            &shared,
            r#"
              import { t } from "@palamedes/core/macro"
              export function label() {
                return t`Shared action`
              }
            "#,
        )
        .expect("shared source");

        let result = extract_catalog_messages_from_files(ExtractCatalogMessagesRequest {
            root_dir: app.to_string_lossy().into_owned(),
            files: vec![shared.to_string_lossy().into_owned()],
        })
        .expect("batch extraction");

        let shared_action = result
            .messages
            .iter()
            .find(|message| message.message == "Shared action")
            .expect("shared message");
        assert_eq!(shared_action.origins.len(), 1);
        assert_eq!(
            shared_action.origins[0].file,
            "../../packages/ui/src/shared-card.tsx"
        );
        assert!(!shared_action.origins[0].file.starts_with('/'));

        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn batch_extracts_stable_origin_scopes_from_named_containers() {
        let root = temp_root("batch-origin-scopes");
        let src = root.join("src");
        fs::create_dir_all(&src).expect("src dir");
        let app = src.join("App.tsx");
        fs::write(
            &app,
            r#"
              import { t } from "@palamedes/core/macro"
              import { Trans } from "@palamedes/react/macro"

              export function CheckoutButton() {
                return <Trans>Start checkout</Trans>
              }

              export const GET = () => {
                return t`Route response`
              }

              export const WrappedButton = memo(() => {
                return <Trans>Wrapped checkout</Trans>
              })

              export const deferredLabel = () => t`Deferred label`
            "#,
        )
        .expect("source");

        let result = extract_catalog_messages_from_files(ExtractCatalogMessagesRequest {
            root_dir: root.to_string_lossy().into_owned(),
            files: vec![app.to_string_lossy().into_owned()],
        })
        .expect("batch extraction");

        let checkout = result
            .messages
            .iter()
            .find(|message| message.message == "Start checkout")
            .expect("checkout message");
        assert_eq!(checkout.origins.len(), 1);
        assert_eq!(checkout.origins[0].file, "src/App.tsx");
        assert_eq!(checkout.origins[0].scope.as_deref(), Some("CheckoutButton"));

        let route = result
            .messages
            .iter()
            .find(|message| message.message == "Route response")
            .expect("route message");
        assert_eq!(route.origins.len(), 1);
        assert_eq!(route.origins[0].file, "src/App.tsx");
        assert_eq!(route.origins[0].scope.as_deref(), Some("GET"));

        let wrapped = result
            .messages
            .iter()
            .find(|message| message.message == "Wrapped checkout")
            .expect("wrapped message");
        assert_eq!(wrapped.origins.len(), 1);
        assert_eq!(wrapped.origins[0].file, "src/App.tsx");
        assert_eq!(wrapped.origins[0].scope.as_deref(), Some("WrappedButton"));

        let deferred = result
            .messages
            .iter()
            .find(|message| message.message == "Deferred label")
            .expect("deferred message");
        assert_eq!(deferred.origins.len(), 1);
        assert_eq!(deferred.origins[0].file, "src/App.tsx");
        assert_eq!(deferred.origins[0].scope.as_deref(), Some("deferredLabel"));

        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn batch_sorts_aggregated_origins_by_file_then_line() {
        let root = temp_root("batch-origin-order");
        let src = root.join("src");
        fs::create_dir_all(&src).expect("src dir");
        let first = src.join("A.tsx");
        let second = src.join("Z.tsx");
        fs::write(
            &first,
            concat!(
                "import { t } from \"@palamedes/core/macro\"\n",
                "export const early = () => t`Shared origin`\n",
                "\n",
                "export const later = () => t`Shared origin`\n",
            ),
        )
        .expect("first source");
        fs::write(
            &second,
            concat!(
                "import { t } from \"@palamedes/core/macro\"\n",
                "export const duplicate = () => t`Shared origin`\n",
            ),
        )
        .expect("second source");

        let result = extract_catalog_messages_from_files(ExtractCatalogMessagesRequest {
            root_dir: root.to_string_lossy().into_owned(),
            files: vec![
                second.to_string_lossy().into_owned(),
                first.to_string_lossy().into_owned(),
            ],
        })
        .expect("batch extraction");

        let shared = result
            .messages
            .iter()
            .find(|message| message.message == "Shared origin")
            .expect("shared message");
        let origins = shared
            .origins
            .iter()
            .map(|origin| (origin.file.as_str(), origin.line))
            .collect::<Vec<_>>();
        assert_eq!(
            origins,
            vec![("src/A.tsx", 2), ("src/A.tsx", 4), ("src/Z.tsx", 2)]
        );

        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn batch_reports_non_fatal_file_failures() {
        let root = temp_root("batch-failure");
        fs::create_dir_all(&root).expect("root dir");
        let invalid = root.join("invalid.ts");
        fs::write(&invalid, "const broken =").expect("invalid source");

        let result = extract_catalog_messages_from_files(ExtractCatalogMessagesRequest {
            root_dir: root.to_string_lossy().into_owned(),
            files: vec![invalid.to_string_lossy().into_owned()],
        })
        .expect("batch extraction should continue");

        assert_eq!(result.file_count, 1);
        assert_eq!(result.failed_files.len(), 1);
        assert!(result.failed_files[0].message.contains("Parse error"));

        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn batch_keeps_explicit_ids_fatal() {
        let root = temp_root("batch-explicit-id");
        fs::create_dir_all(&root).expect("root dir");
        let source = root.join("bad.ts");
        fs::write(
            &source,
            r#"
              import { t } from "@palamedes/core/macro"
              function message() {
                return t({ id: "greeting", message: "Hello" })
              }
            "#,
        )
        .expect("source");

        let error = extract_catalog_messages_from_files(ExtractCatalogMessagesRequest {
            root_dir: root.to_string_lossy().into_owned(),
            files: vec![source.to_string_lossy().into_owned()],
        })
        .expect_err("explicit IDs should fail");

        assert!(error.to_string().contains("Explicit message ids"));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn batch_keeps_top_level_translation_macros_fatal() {
        let root = temp_root("batch-top-level-translation");
        fs::create_dir_all(&root).expect("root dir");
        let source = root.join("bad.ts");
        fs::write(
            &source,
            r#"
              import { t } from "@palamedes/core/macro"
              const message = t`Hello`
            "#,
        )
        .expect("source");

        let error = extract_catalog_messages_from_files(ExtractCatalogMessagesRequest {
            root_dir: root.to_string_lossy().into_owned(),
            files: vec![source.to_string_lossy().into_owned()],
        })
        .expect_err("top-level translation macros should fail");

        assert!(error
            .to_string()
            .contains("Translation macro `t` must be used inside a function"));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn batch_keeps_nested_jsx_message_macros_fatal() {
        let root = temp_root("batch-nested-message-macro");
        fs::create_dir_all(&root).expect("root dir");
        let source = root.join("bad.tsx");
        fs::write(
            &source,
            r##"
              import { Plural, Trans } from "@palamedes/react/macro"
              function Message() {
                return <Trans><Plural value={count} one="# item" other="# items" /> total</Trans>
              }
            "##,
        )
        .expect("source");

        let error = extract_catalog_messages_from_files(ExtractCatalogMessagesRequest {
            root_dir: root.to_string_lossy().into_owned(),
            files: vec![source.to_string_lossy().into_owned()],
        })
        .expect_err("nested message macros should fail");

        assert!(error.to_string().contains("Nested i18n macro"));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn batch_keeps_unsupported_macro_syntax_fatal() {
        let root = temp_root("batch-unsupported-macro");
        fs::create_dir_all(&root).expect("root dir");
        let source = root.join("bad.ts");
        fs::write(
            &source,
            r#"
              import { t } from "@palamedes/core/macro"
              function message() {
                return t({ message })
              }
            "#,
        )
        .expect("source");

        let error = extract_catalog_messages_from_files(ExtractCatalogMessagesRequest {
            root_dir: root.to_string_lossy().into_owned(),
            files: vec![source.to_string_lossy().into_owned()],
        })
        .expect_err("unsupported macro syntax should fail");

        assert!(error.to_string().contains("Unsupported `t` macro usage"));
        fs::remove_dir_all(root).expect("cleanup");
    }

    fn temp_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "palamedes-{label}-{}-{}",
            std::process::id(),
            TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
        ))
    }
}
