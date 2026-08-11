use std::collections::{BTreeMap, HashMap, HashSet};
use std::ffi::OsString;
use std::path::{Path, PathBuf};

use crate::catalog_update::{CatalogUpdateMessage, CatalogUpdateOrigin};
use crate::descriptor::{
    descriptor_property_value, descriptor_static_property, unsupported_macro_syntax,
};
use crate::error::{PalamedesError, PalamedesResult};
use crate::extract_cache::{ExtractCache, ReadStartFingerprint};
use crate::icu_text::escape_icu_source_literal;
use crate::jsx_message::clean_jsx_text;
use crate::mdx::{analyze_mdx, MdxOptions};
use crate::placeholder_name::expression_name;
use crate::source::{
    SourceAnalysisOptions, SourceAnalysisResult, SourceComment, SourceCommentKind,
    SourceDiagnostic, SourceDiagnosticSeverity, SourceFileAnalysisResult, SourceLocator,
    SourceRange, SourceRuleOptions, SOURCE_DIAGNOSTIC_CODE_NO_EMPTY_COMPONENT_ONLY_MESSAGE,
    SOURCE_DIAGNOSTIC_CODE_NO_PLACEHOLDER_ONLY_MESSAGE, SOURCE_DIAGNOSTIC_CODE_PREFER_TRANS_IN_JSX,
};
use crate::source_macros::{record_macro_import_declaration, ImportedMacro};
use crate::source_message::{
    build_icu_message as shared_build_icu_message, expression_source, jsx_attributes,
    lower_choice_options_from_jsx as shared_lower_choice_options_from_jsx,
    lower_choice_options_from_object, lower_jsx_children, lower_jsx_choice_value_binding,
    lower_template,
};
use crate::translation_scope::validate_translation_macro_scopes;
use oxc_allocator::Allocator;
use oxc_ast::ast::{
    Argument, BindingIdentifier, BindingPattern, CallExpression, CommentKind, Declaration,
    Expression, ImportDeclaration, JSXChild, JSXElement, JSXExpression, JSXOpeningElement,
    LogicalOperator, MemberExpression, ObjectExpression, ObjectPropertyKind, Program,
    TaggedTemplateExpression, TemplateLiteral, VariableDeclarator,
};
use oxc_ast_visit::{walk, Visit};
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::{GetSpan, SourceType};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};

type ChoiceOptions = Vec<(String, String)>;
const CHOICE_VALUE_FALLBACK_NAME: &str = "value";

struct ExtractedChoiceOptions {
    options: ChoiceOptions,
    placeholders: BTreeMap<String, String>,
    offset: Option<String>,
}

/// Extracted source-first message record emitted by the JS/TS/MDX extractor.
#[derive(Clone, Debug, Serialize, Deserialize)]
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
    /// Worker threads for the parallel read/parse pass.
    ///
    /// Defaults to [`DEFAULT_EXTRACT_THREADS`] when `None`, and is clamped to
    /// the file count and to the machine's available parallelism. `Some(1)`
    /// forces the serial path.
    pub max_threads: Option<usize>,
}

/// One file to analyze as part of a source-analysis batch.
///
/// `path` identifies the file on disk and in [`ExtractCache`], while `filename`
/// is the display path written into diagnostics. Keeping them separate lets a
/// caller cache absolute paths while reporting stable project-relative paths.
#[derive(Clone, Debug)]
pub struct SourceFileAnalysisRequest {
    /// Path to read and use as the cache key.
    pub path: String,
    /// Display filename for diagnostics produced from `path`.
    pub filename: String,
}

/// Optional behavior for aggregated catalog extraction.
#[derive(Clone, Debug)]
pub struct ExtractCatalogMessagesOptions {
    /// Whether stable source scopes should be extracted for catalog references.
    pub reference_scopes: bool,
    /// MDX translation-unit and configured-field behavior.
    pub mdx: MdxOptions,
    /// Source-authoring rules evaluated while the shared analysis is cached.
    ///
    /// Extraction output never depends on these diagnostics. Keeping them in
    /// the same pass lets `pmds extract` warm the cache consumed by
    /// `pmds lint` without parsing an unchanged file twice.
    pub rules: SourceRuleOptions,
}

impl Default for ExtractCatalogMessagesOptions {
    fn default() -> Self {
        Self {
            reference_scopes: true,
            mdx: MdxOptions::default(),
            rules: SourceRuleOptions::disabled(),
        }
    }
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
    /// Source-authoring diagnostics collected by the shared analysis pass.
    pub diagnostics: Vec<SourceDiagnostic>,
}

#[derive(Debug)]
struct AggregatedCatalogEntry {
    message: String,
    context: Option<String>,
    placeholders: BTreeMap<String, Vec<String>>,
    extracted_comments: Vec<String>,
    origins: Vec<CatalogUpdateOrigin>,
}

struct MacroCollector<'a> {
    imported_macros: HashMap<String, ImportedMacro>,
    removed_macro_import: Option<(String, usize)>,
    /// Names bound outside the import declarations, which are never walked
    /// into. A macro local name appearing here is therefore a binding that can
    /// shadow the import; see [`MacroResolution::resolve`].
    binding_names: Vec<&'a str>,
}

impl MacroCollector<'_> {
    fn new() -> Self {
        Self {
            imported_macros: HashMap::new(),
            removed_macro_import: None,
            binding_names: Vec::new(),
        }
    }
}

impl<'a> Visit<'a> for MacroCollector<'a> {
    fn visit_import_declaration(&mut self, it: &ImportDeclaration<'a>) {
        record_macro_import_declaration(
            it,
            &mut self.imported_macros,
            &mut self.removed_macro_import,
            None,
        );
    }

    fn visit_binding_identifier(&mut self, it: &BindingIdentifier<'a>) {
        self.binding_names.push(it.name.as_str());
    }
}

/// How an identifier that spells a macro import is matched to that import.
enum MacroResolution {
    /// No binding shadows a macro import, so the name alone identifies the use.
    ByName,
    /// Spans of the uses that resolve to a macro import binding.
    ByReference(HashSet<(u32, u32)>),
}

impl MacroResolution {
    /// Extraction deliberately avoids the semantic pass the transform runs
    /// (ADR-019): it is the dominant remaining cost of `pmds extract`, and on
    /// the realistic benchmark corpus it adds about 60% to parsing and visiting
    /// a macro-bearing file. A name that is never re-bound in the module can
    /// only resolve to the import, so the pass is built for the files that do
    /// re-bind one — the same files where a name-only match would disagree with
    /// the transform.
    fn resolve(program: &Program<'_>, collector: &MacroCollector<'_>) -> Self {
        let shadowed = collector
            .binding_names
            .iter()
            .any(|name| collector.imported_macros.contains_key(*name));
        if !shadowed {
            return Self::ByName;
        }

        let semantic = SemanticBuilder::new()
            .with_build_nodes(true)
            .build(program)
            .semantic;
        let mut spans = HashSet::new();
        for local_name in collector.imported_macros.keys() {
            // Macro imports bind at module scope, so the root binding for a
            // macro local name is the import itself.
            let Some(symbol_id) = semantic
                .scoping()
                .get_root_binding(local_name.as_str().into())
            else {
                continue;
            };
            for reference in semantic.scoping().get_resolved_references(symbol_id) {
                let span = semantic.nodes().get_node(reference.node_id()).span();
                spans.insert((span.start, span.end));
            }
        }

        Self::ByReference(spans)
    }

    fn is_macro_use(&self, span: (u32, u32)) -> bool {
        match self {
            Self::ByName => true,
            Self::ByReference(spans) => spans.contains(&span),
        }
    }
}

#[derive(Clone, Copy)]
enum SourceMessageSurface {
    TaggedTemplate,
    Descriptor,
    Trans,
    Runtime,
    Choice,
}

enum AuthoredMessagePart {
    Literal(String),
    ValuePlaceholder,
    Component { children: Vec<Self> },
}

struct AuthoredMessageFacts {
    surface: SourceMessageSurface,
    range: SourceRange,
    parts: Vec<AuthoredMessagePart>,
}

impl AuthoredMessageFacts {
    fn has_literal_text(&self) -> bool {
        fn contains_literal(parts: &[AuthoredMessagePart]) -> bool {
            parts.iter().any(|part| match part {
                AuthoredMessagePart::Literal(value) => !value.trim().is_empty(),
                AuthoredMessagePart::ValuePlaceholder => false,
                AuthoredMessagePart::Component { children } => contains_literal(children),
            })
        }

        contains_literal(&self.parts)
    }

    fn has_value_placeholder(&self) -> bool {
        fn contains_value(parts: &[AuthoredMessagePart]) -> bool {
            parts.iter().any(|part| match part {
                AuthoredMessagePart::Literal(_) => false,
                AuthoredMessagePart::ValuePlaceholder => true,
                AuthoredMessagePart::Component { children } => contains_value(children),
            })
        }

        contains_value(&self.parts)
    }

    fn is_one_empty_component(&self) -> bool {
        matches!(
            self.parts.as_slice(),
            [AuthoredMessagePart::Component { children }] if children.is_empty()
        )
    }
}

struct ExtractionVisitor<'a> {
    filename: String,
    source: &'a str,
    source_locator: &'a SourceLocator<'a>,
    imported_macros: &'a HashMap<String, ImportedMacro>,
    macro_resolution: &'a MacroResolution,
    rules: &'a SourceRuleOptions,
    messages: Vec<ExtractedMessageRecord>,
    diagnostics: Vec<SourceDiagnostic>,
    error: Option<PalamedesError>,
    scope_stack: Vec<String>,
    jsx_parent_stack: Vec<&'a str>,
    renderable_t_spans: HashSet<(usize, usize)>,
    reference_scopes: bool,
}

impl<'a> ExtractionVisitor<'a> {
    fn new(
        filename: &str,
        source: &'a str,
        source_locator: &'a SourceLocator<'a>,
        imported_macros: &'a HashMap<String, ImportedMacro>,
        macro_resolution: &'a MacroResolution,
        rules: &'a SourceRuleOptions,
        reference_scopes: bool,
    ) -> Self {
        Self {
            filename: filename.to_string(),
            source,
            source_locator,
            imported_macros,
            macro_resolution,
            rules,
            messages: Vec::new(),
            diagnostics: Vec::new(),
            error: None,
            scope_stack: Vec::new(),
            jsx_parent_stack: Vec::new(),
            renderable_t_spans: HashSet::new(),
            reference_scopes,
        }
    }

    fn push(&mut self, message: ExtractedMessageRecord, facts: AuthoredMessageFacts) {
        self.messages.push(message);
        self.diagnose(facts);
    }

    fn facts(
        &self,
        surface: SourceMessageSurface,
        start: usize,
        end: usize,
        parts: Vec<AuthoredMessagePart>,
    ) -> AuthoredMessageFacts {
        AuthoredMessageFacts {
            surface,
            range: self.source_locator.range(start, end),
            parts,
        }
    }

    fn diagnose(&mut self, facts: AuthoredMessageFacts) {
        if !matches!(
            facts.surface,
            SourceMessageSurface::TaggedTemplate
                | SourceMessageSurface::Descriptor
                | SourceMessageSurface::Trans
        ) {
            return;
        }

        if !facts.has_literal_text() && facts.has_value_placeholder() {
            if let Some(severity) = self.rules.placeholder_only.severity() {
                self.diagnostics.push(SourceDiagnostic {
                    code: SOURCE_DIAGNOSTIC_CODE_NO_PLACEHOLDER_ONLY_MESSAGE.to_owned(),
                    severity,
                    file: self.filename.clone(),
                    primary: facts.range,
                    message: "This message contains placeholders but no translatable text."
                        .to_owned(),
                    help: "Move translation to the surrounding authored sentence, or remove the translation macro if this value should be rendered as-is.".to_owned(),
                    related: None,
                });
            }
            return;
        }

        if facts.is_one_empty_component() {
            if let Some(severity) = self.rules.empty_component_only.severity() {
                self.diagnostics.push(SourceDiagnostic {
                    code: SOURCE_DIAGNOSTIC_CODE_NO_EMPTY_COMPONENT_ONLY_MESSAGE.to_owned(),
                    severity,
                    file: self.filename.clone(),
                    primary: facts.range,
                    message: "This message contains only an empty component placeholder."
                        .to_owned(),
                    help: "Add translatable text around or inside the component, or render the component without a translation macro.".to_owned(),
                    related: None,
                });
            }
        }
    }

    fn diagnose_prefer_trans(&mut self, start: usize, end: usize, macro_source: &str) {
        if !self.renderable_t_spans.contains(&(start, end)) {
            return;
        }
        let Some(severity) = self.rules.prefer_trans_in_jsx.severity() else {
            return;
        };
        let framework = match macro_source {
            "@palamedes/react/macro" => "React",
            "@palamedes/solid/macro" => "Solid",
            _ => "the active UI framework",
        };
        self.diagnostics.push(SourceDiagnostic {
            code: SOURCE_DIAGNOSTIC_CODE_PREFER_TRANS_IN_JSX.to_owned(),
            severity,
            file: self.filename.clone(),
            primary: self.source_locator.range(start, end),
            message: "This `t` message is rendered directly as a JSX child; `<Trans>` is often easier to read here, while `t` remains supported.".to_owned(),
            help: format!(
                "Consider {framework}'s `<Trans>` macro for JSX-native readability. `t` remains supported; preserve any comment or context metadata when converting."
            ),
            related: None,
        });
    }

    fn walk_jsx_element_children(&mut self, element: &JSXElement<'a>, tag_name: Option<&'a str>) {
        if let Some(tag_name) = tag_name {
            self.jsx_parent_stack.push(tag_name);
            walk::walk_jsx_element(self, element);
            self.jsx_parent_stack.pop();
        } else {
            walk::walk_jsx_element(self, element);
        }
    }

    fn current_jsx_parent_allows_trans(&self) -> bool {
        !self.jsx_parent_stack.iter().any(|parent| {
            is_restricted_trans_parent(parent)
                || self.imported_macros.get(*parent).is_some_and(|macro_info| {
                    matches!(
                        macro_info.imported_name.as_str(),
                        "Trans" | "Plural" | "Select" | "SelectOrdinal"
                    )
                })
        })
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
            self.source_locator.line(span_start),
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
        let (line, column) = self.source_locator.location(span_start);

        format!("{}:{line}:{column}", self.filename)
    }

    fn imported_macro_name(
        &self,
        local_name: &str,
        span: (u32, u32),
        expected: &[&str],
    ) -> Option<&str> {
        self.imported_macros
            .get(local_name)
            .filter(|_| self.macro_resolution.is_macro_use(span))
            .and_then(|macro_info| {
                expected
                    .contains(&macro_info.imported_name.as_str())
                    .then_some(macro_info.imported_name.as_str())
            })
    }
}

impl<'a> Visit<'a> for ExtractionVisitor<'a> {
    fn visit_declaration(&mut self, it: &Declaration<'a>) {
        let scope = if self.reference_scopes {
            match it {
                Declaration::FunctionDeclaration(function) => {
                    function.id.as_ref().map(|id| id.name.as_str().to_string())
                }
                _ => None,
            }
        } else {
            None
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
        let scope = if self.reference_scopes {
            function_like_initializer_name(it)
        } else {
            None
        };

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
            self.walk_jsx_element_children(it, None);
            return;
        };
        let tag_name = tag_name.as_str();

        if let Some(macro_name) = self
            .imported_macro_name(
                tag_name,
                jsx_element_name_span(it),
                &["Trans", "Plural", "Select", "SelectOrdinal"],
            )
            .map(str::to_string)
        {
            if let Some(nested_start) = nested_message_macro_in_children(
                &it.children,
                self.imported_macros,
                self.macro_resolution,
            ) {
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
                Ok(Some(message)) => {
                    let surface = if macro_name == "Trans" {
                        SourceMessageSurface::Trans
                    } else {
                        SourceMessageSurface::Choice
                    };
                    let parts = if macro_name == "Trans" {
                        trans_authored_parts(it)
                    } else {
                        Vec::new()
                    };
                    let facts =
                        self.facts(surface, it.span.start as usize, it.span.end as usize, parts);
                    self.push(message, facts);
                }
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

        self.walk_jsx_element_children(it, Some(tag_name));
    }

    fn visit_jsx_child(&mut self, it: &JSXChild<'a>) {
        if self.rules.prefer_trans_in_jsx.severity().is_none() {
            walk::walk_jsx_child(self, it);
            return;
        }
        if let JSXChild::ExpressionContainer(container) = it {
            if self.current_jsx_parent_allows_trans() {
                if let Some(expression) = container.expression.as_expression() {
                    collect_direct_render_expression_spans(
                        expression,
                        &mut self.renderable_t_spans,
                    );
                }
            }
        }
        walk::walk_jsx_child(self, it);
    }

    fn visit_tagged_template_expression(&mut self, it: &TaggedTemplateExpression<'a>) {
        if self.error.is_some() {
            return;
        }

        if let Some((tag_name, tag_span)) = identifier_name(&it.tag) {
            if let Some(macro_name) = self
                .imported_macro_name(tag_name, tag_span, &["t"])
                .map(str::to_string)
            {
                let macro_source = self
                    .imported_macros
                    .get(tag_name)
                    .map(|macro_info| macro_info.source.clone())
                    .unwrap_or_default();
                match extract_from_tagged_template(
                    &it.quasi,
                    self.origin(it.span.start as usize),
                    self.current_scope(),
                    self.source,
                ) {
                    Ok(Some(message)) => {
                        let facts = self.facts(
                            SourceMessageSurface::TaggedTemplate,
                            it.span.start as usize,
                            it.span.end as usize,
                            template_authored_parts(&it.quasi),
                        );
                        self.push(message, facts);
                        self.diagnose_prefer_trans(
                            it.span.start as usize,
                            it.span.end as usize,
                            &macro_source,
                        );
                    }
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
            ) {
                Ok(Some(message)) => {
                    let facts = self.facts(
                        SourceMessageSurface::Runtime,
                        it.span.start as usize,
                        it.span.end as usize,
                        template_authored_parts(&it.quasi),
                    );
                    self.push(message, facts);
                }
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

        if let Some((callee_name, callee_span)) = identifier_name(&it.callee) {
            if let Some(macro_name) = self
                .imported_macro_name(
                    callee_name,
                    callee_span,
                    &["t", "plural", "select", "selectOrdinal"],
                )
                .map(str::to_string)
            {
                let macro_source = self
                    .imported_macros
                    .get(callee_name)
                    .map(|macro_info| macro_info.source.clone())
                    .unwrap_or_default();
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
                    Ok(Some(message)) => {
                        let (surface, parts) = if macro_name == "t" {
                            (
                                SourceMessageSurface::Descriptor,
                                descriptor_authored_parts(it),
                            )
                        } else {
                            (SourceMessageSurface::Choice, Vec::new())
                        };
                        let facts = self.facts(
                            surface,
                            it.span.start as usize,
                            it.span.end as usize,
                            parts,
                        );
                        self.push(message, facts);
                        if macro_name == "t" {
                            self.diagnose_prefer_trans(
                                it.span.start as usize,
                                it.span.end as usize,
                                &macro_source,
                            );
                        }
                    }
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
                Ok(Some(message)) => {
                    let facts = self.facts(
                        SourceMessageSurface::Runtime,
                        it.span.start as usize,
                        it.span.end as usize,
                        Vec::new(),
                    );
                    self.push(message, facts);
                }
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

fn is_restricted_trans_parent(parent: &str) -> bool {
    matches!(
        parent,
        "option" | "textarea" | "title" | "desc" | "script" | "style"
    )
}

fn collect_direct_render_expression_spans(
    expression: &Expression<'_>,
    spans: &mut HashSet<(usize, usize)>,
) {
    match expression.without_parentheses() {
        Expression::TaggedTemplateExpression(expression) => {
            spans.insert((expression.span.start as usize, expression.span.end as usize));
        }
        Expression::CallExpression(expression) => {
            spans.insert((expression.span.start as usize, expression.span.end as usize));
        }
        Expression::ConditionalExpression(expression) => {
            collect_direct_render_expression_spans(&expression.consequent, spans);
            collect_direct_render_expression_spans(&expression.alternate, spans);
        }
        Expression::LogicalExpression(expression)
            if expression.operator == LogicalOperator::And =>
        {
            collect_direct_render_expression_spans(&expression.right, spans);
        }
        _ => {}
    }
}

fn template_authored_parts(template: &TemplateLiteral<'_>) -> Vec<AuthoredMessagePart> {
    let mut parts = Vec::with_capacity(template.quasis.len() + template.expressions.len());
    for (index, quasi) in template.quasis.iter().enumerate() {
        let value = quasi
            .value
            .cooked
            .map_or_else(|| quasi.value.raw.as_str(), |value| value.as_str());
        parts.push(AuthoredMessagePart::Literal(value.to_owned()));
        if template.expressions.get(index).is_some() {
            parts.push(AuthoredMessagePart::ValuePlaceholder);
        }
    }
    parts
}

fn descriptor_authored_parts(call: &CallExpression<'_>) -> Vec<AuthoredMessagePart> {
    let Some(Argument::ObjectExpression(object)) = call.arguments.first() else {
        return Vec::new();
    };
    let Some(message) = descriptor_property_value(object, "message") else {
        return Vec::new();
    };
    match message.without_parentheses() {
        Expression::StringLiteral(literal) => {
            vec![AuthoredMessagePart::Literal(literal.value.to_string())]
        }
        Expression::TemplateLiteral(template) => template_authored_parts(template),
        _ => Vec::new(),
    }
}

fn trans_authored_parts(element: &JSXElement<'_>) -> Vec<AuthoredMessagePart> {
    if let Some(message) = jsx_attributes(&element.opening_element).get("message") {
        return vec![AuthoredMessagePart::Literal(message.clone())];
    }
    jsx_children_authored_parts(&element.children)
}

fn jsx_children_authored_parts(children: &[JSXChild<'_>]) -> Vec<AuthoredMessagePart> {
    let mut parts = Vec::new();
    for child in children {
        match child {
            JSXChild::Text(text) => {
                let value = clean_jsx_text(text.value.as_str());
                if !value.is_empty() {
                    parts.push(AuthoredMessagePart::Literal(value));
                }
            }
            JSXChild::ExpressionContainer(container) => match &container.expression {
                JSXExpression::EmptyExpression(_) => {}
                JSXExpression::StringLiteral(literal) => {
                    parts.push(AuthoredMessagePart::Literal(literal.value.to_string()));
                }
                _ => parts.push(AuthoredMessagePart::ValuePlaceholder),
            },
            JSXChild::Element(element) => {
                parts.push(AuthoredMessagePart::Component {
                    children: jsx_children_authored_parts(&element.children),
                });
            }
            JSXChild::Fragment(fragment) => {
                parts.extend(jsx_children_authored_parts(&fragment.children));
            }
            JSXChild::Spread(_) => parts.push(AuthoredMessagePart::ValuePlaceholder),
        }
    }
    parts
}

fn nested_message_macro_in_children<'a>(
    children: &'a [JSXChild<'a>],
    imported_macros: &HashMap<String, ImportedMacro>,
    macro_resolution: &MacroResolution,
) -> Option<usize> {
    NestedMessageMacroFinder::find_in_children(children, imported_macros, macro_resolution)
}

struct NestedMessageMacroFinder<'a> {
    imported_macros: &'a HashMap<String, ImportedMacro>,
    macro_resolution: &'a MacroResolution,
    nested_start: Option<usize>,
}

impl<'a> NestedMessageMacroFinder<'a> {
    fn find_in_children(
        children: &[JSXChild<'a>],
        imported_macros: &'a HashMap<String, ImportedMacro>,
        macro_resolution: &'a MacroResolution,
    ) -> Option<usize> {
        let mut finder = Self {
            imported_macros,
            macro_resolution,
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

        if is_jsx_message_macro(it, self.imported_macros, self.macro_resolution) {
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
    macro_resolution: &MacroResolution,
) -> bool {
    let Some(tag_name) = element.opening_element.name.get_identifier_name() else {
        return false;
    };

    imported_macros
        .get(tag_name.as_str())
        .filter(|_| macro_resolution.is_macro_use(jsx_element_name_span(element)))
        .is_some_and(|macro_info| {
            matches!(
                macro_info.imported_name.as_str(),
                "Trans" | "Plural" | "Select" | "SelectOrdinal"
            )
        })
}

fn jsx_element_name_span(element: &JSXElement<'_>) -> (u32, u32) {
    let span = element.opening_element.name.span();

    (span.start, span.end)
}

fn identifier_name<'a>(expr: &'a Expression<'a>) -> Option<(&'a str, (u32, u32))> {
    match expr.without_parentheses() {
        Expression::Identifier(identifier) => Some((
            identifier.name.as_str(),
            (identifier.span.start, identifier.span.end),
        )),
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
    let lowered = lower_choice_options_from_object(
        object,
        source,
        used_value_names,
        format,
        macro_name,
        location,
        ToOwned::to_owned,
    )?;

    Ok(ExtractedChoiceOptions {
        options: lowered.options,
        placeholders: lowered
            .values
            .into_iter()
            .map(|value| (value.name, value.expression))
            .collect(),
        offset: lowered.offset,
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
    let (message, values) = lower_template(
        template,
        source,
        syntax,
        used_value_names,
        ToOwned::to_owned,
    )?;
    let placeholders = values
        .into_iter()
        .map(|value| (value.name, value.expression))
        .collect();

    Ok((escape_icu_source_literal(&message), placeholders))
}

fn extract_jsx_choice_value(
    opening_element: &JSXOpeningElement<'_>,
    source: &str,
) -> PalamedesResult<Option<(String, String)>> {
    let mut used_value_names = HashMap::new();
    Ok(
        lower_jsx_choice_value_binding(opening_element, source, &mut used_value_names)
            .map(|value| (value.name, value.expression)),
    )
}

fn extract_jsx_children_as_message(
    children: &[JSXChild<'_>],
    source: &str,
) -> PalamedesResult<String> {
    let lowered = lower_jsx_children(children, source, ToOwned::to_owned, |_| String::new())?;
    Ok(escape_icu_source_literal(&lowered.message))
}

fn extract_choice_options_from_jsx(
    opening_element: &JSXOpeningElement<'_>,
    source: &str,
    used_value_names: &mut HashMap<String, String>,
    format: &str,
    macro_name: &str,
    location: &str,
) -> PalamedesResult<ExtractedChoiceOptions> {
    let lowered = shared_lower_choice_options_from_jsx(
        opening_element,
        source,
        used_value_names,
        format,
        macro_name,
        location,
        ToOwned::to_owned,
    )?;

    Ok(ExtractedChoiceOptions {
        options: lowered.options,
        placeholders: lowered
            .values
            .into_iter()
            .map(|value| (value.name, value.expression))
            .collect(),
        offset: lowered.offset,
    })
}

fn build_icu_message(
    format: &str,
    value_name: &str,
    options: &ChoiceOptions,
    offset: Option<&str>,
) -> String {
    escape_icu_source_literal(&shared_build_icu_message(
        format, value_name, options, offset,
    ))
}

fn argument_expression_name(arg: &Argument<'_>) -> Option<String> {
    arg.as_expression().and_then(expression_name)
}

/// Extracts source-string-first messages from a JavaScript, TypeScript, or MDX module.
///
/// # Errors
///
/// Returns an error when the source cannot be parsed or when the module uses
/// unsupported author-facing explicit message IDs.
pub fn extract_messages(
    source: &str,
    filename: &str,
) -> PalamedesResult<Vec<ExtractedMessageRecord>> {
    extract_messages_with_mdx_options(source, filename, &MdxOptions::default())
}

/// Extracts source-string-first messages with explicit MDX semantics.
///
/// JavaScript and TypeScript extraction is unaffected by `mdx_options`.
///
/// # Errors
///
/// Returns an error under the same conditions as [`extract_messages`].
pub fn extract_messages_with_mdx_options(
    source: &str,
    filename: &str,
    mdx_options: &MdxOptions,
) -> PalamedesResult<Vec<ExtractedMessageRecord>> {
    let allocator = Allocator::default();
    extract_messages_in(&allocator, source, filename, true, mdx_options)
}

/// Analyze one JavaScript, TypeScript, JSX, TSX, or MDX source file.
///
/// Extraction, non-type-aware source diagnostics, and comment discovery share
/// one native parse and Palamedes macro classification. Parse failures and
/// unsupported macro syntax remain fatal errors.
///
/// # Errors
///
/// Returns an error when JavaScript or TypeScript cannot be parsed, or when the
/// source uses non-extractable Palamedes authoring syntax. MDX structural
/// diagnostics are returned in the structured result to stay compatible with
/// [`crate::analyze_mdx`].
pub fn analyze_source(source: &str, filename: &str) -> PalamedesResult<SourceAnalysisResult> {
    analyze_source_with_options(source, filename, &SourceAnalysisOptions::default())
}

/// Analyze one source file with explicit MDX semantics.
///
/// JavaScript and TypeScript analysis is unaffected by `mdx_options`.
///
/// # Errors
///
/// Returns an error under the same conditions as [`analyze_source`].
pub fn analyze_source_with_mdx_options(
    source: &str,
    filename: &str,
    mdx_options: &MdxOptions,
) -> PalamedesResult<SourceAnalysisResult> {
    analyze_source_with_options(
        source,
        filename,
        &SourceAnalysisOptions {
            mdx: mdx_options.clone(),
            ..SourceAnalysisOptions::default()
        },
    )
}

/// Analyze one source file with explicit MDX and rule options.
///
/// # Errors
///
/// Returns an error under the same conditions as [`analyze_source`].
pub fn analyze_source_with_options(
    source: &str,
    filename: &str,
    options: &SourceAnalysisOptions,
) -> PalamedesResult<SourceAnalysisResult> {
    let allocator = Allocator::default();
    analyze_source_in(
        &allocator,
        source,
        filename,
        true,
        &options.mdx,
        &options.rules,
    )
}

/// Analyze one source file while reusing the cache shared with batch extraction.
///
/// The source is read exactly once so callers can apply suppressions to the same
/// text that was analyzed. A compatible cache hit still skips parsing. Stored
/// diagnostics are rewritten to `filename` on return so callers can choose
/// project-relative display paths.
///
/// # Errors
///
/// Returns an error when the file cannot be read or has the same fatal source
/// authoring problem as [`analyze_source_with_options`]. Cache failures remain
/// advisory and degrade to a normal analysis.
pub fn analyze_source_file_cached(
    path: &str,
    filename: &str,
    root_dir: &str,
    options: &ExtractCatalogMessagesOptions,
    cache: &mut ExtractCache,
) -> PalamedesResult<SourceFileAnalysisResult> {
    let mut results = analyze_source_files_cached(
        &[SourceFileAnalysisRequest {
            path: path.to_owned(),
            filename: filename.to_owned(),
        }],
        root_dir,
        options,
        Some(1),
        cache,
    )?;
    // The batch always returns exactly one outcome for every input file.
    results
        .pop()
        .expect("one source-analysis request produces one outcome")
}

/// Analyze source files while reusing the cache shared with batch extraction.
///
/// Reading, cache validation, and parsing run in a bounded Rayon pool. The
/// supplied cache is observed immutably by workers, then fresh results are
/// inserted serially in request order. This keeps cache writes, diagnostics,
/// and caller-side suppression processing deterministic while still avoiding
/// serial parse work on cold trees.
///
/// The returned vector has one result per input, in input order. A bad file
/// does not prevent independent files from being analyzed; its entry contains
/// the original [`PalamedesError`]. A pool-construction failure applies to the
/// whole batch and is returned from this function.
pub fn analyze_source_files_cached(
    files: &[SourceFileAnalysisRequest],
    root_dir: &str,
    options: &ExtractCatalogMessagesOptions,
    max_threads: Option<usize>,
    cache: &mut ExtractCache,
) -> PalamedesResult<Vec<PalamedesResult<SourceFileAnalysisResult>>> {
    cache.reset_if_request_differs(root_dir, options);
    let threads = resolve_extract_threads(max_threads, files.len());
    let outcomes: Vec<SourceFileAnalysisOutcome> = if threads <= 1 {
        files
            .iter()
            .map(|file| analyze_one_source_file_cached(file, options, cache))
            .collect()
    } else {
        rayon::ThreadPoolBuilder::new()
            .num_threads(threads)
            .build()
            .map_err(|source| PalamedesError::ExtractionPool {
                message: source.to_string(),
            })?
            .install(|| {
                files
                    .par_iter()
                    .map(|file| analyze_one_source_file_cached(file, options, cache))
                    .collect()
            })
    };

    Ok(outcomes
        .into_iter()
        .map(|outcome| match outcome {
            SourceFileAnalysisOutcome::Analyzed {
                path,
                filename,
                source,
                analysis,
                fresh,
                fingerprint,
            } => {
                if fresh {
                    cache.insert(
                        path.clone(),
                        relative_origin_file(Path::new(root_dir), &path),
                        &analysis.messages,
                        &analysis.diagnostics,
                        &analysis.comments,
                        fingerprint,
                    );
                }
                Ok(SourceFileAnalysisResult {
                    source,
                    analysis: analysis_with_display_filename(analysis, &filename),
                })
            }
            SourceFileAnalysisOutcome::Failed(error) => Err(error),
        })
        .collect())
}

/// Result of the parallel source-analysis phase before ordered cache insertion.
enum SourceFileAnalysisOutcome {
    Analyzed {
        path: String,
        filename: String,
        source: String,
        analysis: SourceAnalysisResult,
        fresh: bool,
        fingerprint: Option<ReadStartFingerprint>,
    },
    Failed(PalamedesError),
}

fn analyze_one_source_file_cached(
    file: &SourceFileAnalysisRequest,
    options: &ExtractCatalogMessagesOptions,
    cache: &ExtractCache,
) -> SourceFileAnalysisOutcome {
    let fingerprint = cache.fingerprint_before_read(&file.path);
    let source = match std::fs::read_to_string(&file.path) {
        Ok(source) => source,
        Err(source) => {
            return SourceFileAnalysisOutcome::Failed(PalamedesError::ReadFile {
                path: PathBuf::from(&file.path),
                source,
            });
        }
    };
    if let Some((_relative_file, messages, diagnostics, comments)) =
        cache.get_after_read(&file.path, fingerprint)
    {
        return SourceFileAnalysisOutcome::Analyzed {
            path: file.path.clone(),
            filename: file.filename.clone(),
            source,
            analysis: SourceAnalysisResult {
                messages,
                diagnostics,
                comments,
            },
            fresh: false,
            fingerprint: None,
        };
    }

    let analysis = EXTRACT_ARENA.with(|arena| {
        let mut arena = arena.borrow_mut();
        let analysis = analyze_source_in(
            &arena,
            &source,
            &file.path,
            options.reference_scopes,
            &options.mdx,
            &options.rules,
        );
        arena.reset();
        analysis
    });

    match analysis {
        Ok(analysis) => SourceFileAnalysisOutcome::Analyzed {
            path: file.path.clone(),
            filename: file.filename.clone(),
            source,
            analysis,
            fresh: true,
            fingerprint,
        },
        Err(error) => SourceFileAnalysisOutcome::Failed(error),
    }
}

fn analysis_with_display_filename(
    mut analysis: SourceAnalysisResult,
    filename: &str,
) -> SourceAnalysisResult {
    for diagnostic in &mut analysis.diagnostics {
        diagnostic.file = filename.to_owned();
    }
    analysis
}

/*
 * Extraction against a caller-owned arena. A fresh Allocator per file means a
 * fresh set of bump chunks from the system allocator per file, and on a 1500
 * file tree that allocation churn is what limits parallel extraction — it
 * contends far earlier than the parsing itself does. The batch path reuses one
 * arena per worker thread and resets it between files instead.
 */
fn extract_messages_in(
    allocator: &Allocator,
    source: &str,
    filename: &str,
    reference_scopes: bool,
    mdx_options: &MdxOptions,
) -> PalamedesResult<Vec<ExtractedMessageRecord>> {
    let result = analyze_source_in(
        allocator,
        source,
        filename,
        reference_scopes,
        mdx_options,
        &SourceRuleOptions::disabled(),
    )?;

    if is_mdx_filename(filename) && !result.diagnostics.is_empty() {
        return Err(mdx_diagnostics_error(&result.diagnostics));
    }

    Ok(result.messages)
}

fn is_mdx_filename(filename: &str) -> bool {
    Path::new(filename)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("mdx"))
}

fn mdx_diagnostics_error(diagnostics: &[SourceDiagnostic]) -> PalamedesError {
    let filename = diagnostics
        .first()
        .map_or_else(String::new, |diagnostic| diagnostic.file.clone());
    let messages = diagnostics
        .iter()
        .map(|diagnostic| {
            format!(
                "{}:{}:{}: {} ({})",
                diagnostic.file,
                diagnostic.primary.line,
                diagnostic.primary.column,
                diagnostic.message,
                diagnostic.code
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    PalamedesError::ParseModuleSource { filename, messages }
}

fn analyze_source_in(
    allocator: &Allocator,
    source: &str,
    filename: &str,
    reference_scopes: bool,
    mdx_options: &MdxOptions,
    rules: &SourceRuleOptions,
) -> PalamedesResult<SourceAnalysisResult> {
    if is_mdx_filename(filename) {
        let result = analyze_mdx(source, filename, mdx_options.clone());
        return Ok(SourceAnalysisResult {
            messages: result.messages,
            diagnostics: result
                .diagnostics
                .into_iter()
                .map(|diagnostic| SourceDiagnostic {
                    code: diagnostic.code,
                    severity: SourceDiagnosticSeverity::Error,
                    file: filename.to_owned(),
                    primary: diagnostic.primary,
                    message: diagnostic.message,
                    help: "Fix the MDX syntax at the highlighted source range.".to_owned(),
                    related: diagnostic.related,
                })
                .collect(),
            comments: result.comments,
        });
    }

    let source_type = SourceType::from_path(filename).unwrap_or_else(|_| SourceType::tsx());
    let parsed = Parser::new(allocator, source, source_type).parse();

    if !parsed.diagnostics.is_empty() {
        let messages = parsed
            .diagnostics
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(", ");
        return Err(PalamedesError::ParseSource { messages });
    }

    let source_locator = SourceLocator::new(source);
    let comments = parsed
        .program
        .comments
        .iter()
        .map(|comment| SourceComment {
            range: source_locator.range(comment.span.start as usize, comment.span.end as usize),
            kind: match comment.kind {
                CommentKind::Line => SourceCommentKind::Line,
                CommentKind::SingleLineBlock | CommentKind::MultiLineBlock => {
                    SourceCommentKind::Block
                }
            },
        })
        .collect::<Vec<_>>();

    let mut collector = MacroCollector::new();
    collector.visit_program(&parsed.program);

    /*
     * Without a single imported Palamedes macro, the only remaining extraction
     * surface is the `i18n._`/`i18n.t` runtime-call form, and every spelling of
     * it necessarily contains the text `i18n`. When neither is present nothing
     * can be extracted and none of the macro-shape diagnostics below can fire:
     * the scope validator and the extraction visitor resolve identifiers
     * through the import map before doing anything else. On real trees most
     * files carry no i18n at all, so skipping their remaining two AST walks and
     * the line index is a large share of the extraction pass. A file that
     * merely mentions `i18n` somewhere takes the normal path; the check is an
     * over-approximation, never a behavior change.
     */
    if collector.imported_macros.is_empty()
        && collector.removed_macro_import.is_none()
        && !source.contains("i18n")
    {
        return Ok(SourceAnalysisResult {
            messages: Vec::new(),
            diagnostics: Vec::new(),
            comments,
        });
    }

    if let Some((macro_name, offset)) = collector.removed_macro_import.as_ref() {
        let (line, column) = source_locator.location(*offset);
        return Err(PalamedesError::UnsupportedMacroSyntax {
            macro_name: macro_name.clone(),
            location: format!("{filename}:{line}:{column}"),
            detail: "this deferred message macro has been removed; translate at the point of use with `t`".to_string(),
        });
    }

    let macro_resolution = MacroResolution::resolve(&parsed.program, &collector);

    validate_translation_macro_scopes(&parsed.program, filename, source, |local_name, span| {
        collector
            .imported_macros
            .get(local_name)
            .filter(|_| macro_resolution.is_macro_use(span))
            .map(|macro_info| macro_info.imported_name.clone())
    })?;

    let mut extractor = ExtractionVisitor::new(
        filename,
        source,
        &source_locator,
        &collector.imported_macros,
        &macro_resolution,
        rules,
        reference_scopes,
    );
    extractor.visit_program(&parsed.program);

    if let Some(error) = extractor.error {
        return Err(error);
    }

    extractor.diagnostics.sort_by(|left, right| {
        (left.primary.start, left.primary.end, left.code.as_str()).cmp(&(
            right.primary.start,
            right.primary.end,
            right.code.as_str(),
        ))
    });

    Ok(SourceAnalysisResult {
        messages: extractor.messages,
        diagnostics: extractor.diagnostics,
        comments,
    })
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
    extract_catalog_messages_from_files_with_options(
        request,
        ExtractCatalogMessagesOptions::default(),
    )
}

/// Extracts and aggregates source-first catalog update messages with explicit
/// reference behavior.
///
/// # Errors
///
/// Returns the same fatal authoring errors and non-fatal file failures as
/// [`extract_catalog_messages_from_files`].
pub fn extract_catalog_messages_from_files_with_options(
    request: ExtractCatalogMessagesRequest,
    options: ExtractCatalogMessagesOptions,
) -> PalamedesResult<ExtractCatalogMessagesResult> {
    extract_catalog_messages_cached(request, options, &mut ExtractCache::disabled())
}

/// Extracts catalog messages, reusing and updating `cache`.
///
/// Unchanged files skip both the read and the parse. Hold the same
/// [`ExtractCache`] across calls — watch mode does — so later runs never touch
/// disk for files nobody edited.
///
/// # Errors
///
/// Same as [`extract_catalog_messages_from_files`]. Cache problems are never
/// errors: they degrade to a normal extraction.
pub fn extract_catalog_messages_cached(
    request: ExtractCatalogMessagesRequest,
    options: ExtractCatalogMessagesOptions,
    cache: &mut ExtractCache,
) -> PalamedesResult<ExtractCatalogMessagesResult> {
    let root_dir = PathBuf::from(&request.root_dir);
    let mut catalog = BTreeMap::<String, AggregatedCatalogEntry>::new();
    let mut failed_files = Vec::new();
    let mut diagnostics = Vec::new();
    let file_count = request.files.len();
    let reference_scopes = options.reference_scopes;
    let mdx_options = options.mdx;
    let rules = options.rules;

    /*
     * A cache handed to us may have been loaded for a different request — watch
     * mode keeps one instance alive across config reloads, so a changed
     * reference root or scope setting would otherwise serve entries whose
     * origins and records belong to the previous configuration.
     */
    cache.reset_if_request_differs(
        &request.root_dir,
        &ExtractCatalogMessagesOptions {
            reference_scopes,
            mdx: mdx_options.clone(),
            rules: rules.clone(),
        },
    );

    /*
     * Reading and parsing each file is independent work and dominates extraction
     * on real trees, so it runs in parallel. Aggregation deliberately does not:
     * add_extracted_message appends to origins, extracted_comments, and
     * placeholder value lists, so the merge order decides the output order.
     * par_iter().collect() preserves input order, and the fold below walks that
     * ordered Vec, which keeps the written catalog byte-identical to the serial
     * implementation regardless of how work got scheduled.
     *
     * The pool is built here rather than taken from rayon's global pool: this is
     * a library, and installing a global pool would decide thread policy for
     * every embedder, including the Node binding.
     */
    let threads = resolve_extract_threads(request.max_threads, file_count);
    let mut outcomes: Vec<FileExtraction> = if threads <= 1 {
        request
            .files
            .iter()
            .map(|file| {
                extract_one_file(
                    file,
                    &root_dir,
                    reference_scopes,
                    &mdx_options,
                    &rules,
                    cache,
                )
            })
            .collect()
    } else {
        rayon::ThreadPoolBuilder::new()
            .num_threads(threads)
            .build()
            .map_err(|source| PalamedesError::ExtractionPool {
                message: source.to_string(),
            })?
            .install(|| {
                request
                    .files
                    .par_iter()
                    .map(|file| {
                        extract_one_file(
                            file,
                            &root_dir,
                            reference_scopes,
                            &mdx_options,
                            &rules,
                            cache,
                        )
                    })
                    .collect()
            })
    };

    /*
     * The serial path returned on the first fatal file it reached, so report the
     * first one in file order rather than whichever thread happened to finish
     * first. Later files are already parsed at this point; that is wasted work
     * on a failing run only, and it keeps the reported error deterministic.
     */
    if let Some(index) = outcomes
        .iter()
        .position(|outcome| matches!(outcome, FileExtraction::Fatal(_)))
    {
        if let FileExtraction::Fatal(error) = outcomes.swap_remove(index) {
            return Err(error);
        }
    }

    /*
     * Only files that were actually extracted this run are written back. Cache
     * hits are already stored, and failures must not be, so a file that stops
     * parsing is retried on the next run instead of being remembered as broken.
     */
    for outcome in outcomes {
        match outcome {
            FileExtraction::Extracted {
                path,
                relative_file,
                messages,
                diagnostics: file_diagnostics,
                comments,
                fresh,
                fingerprint,
            } => {
                if fresh {
                    cache.insert(
                        path.clone(),
                        relative_file.clone(),
                        &messages,
                        &file_diagnostics,
                        &comments,
                        fingerprint,
                    );
                }
                if is_mdx_filename(&path) && !file_diagnostics.is_empty() {
                    failed_files.push(ExtractCatalogFileFailure {
                        path,
                        message: mdx_diagnostics_error(&file_diagnostics).to_string(),
                    });
                    diagnostics.extend(file_diagnostics);
                    continue;
                }
                diagnostics.extend(file_diagnostics);
                for message in messages {
                    add_extracted_message(&mut catalog, message, &relative_file);
                }
            }
            FileExtraction::Failed(failure) => failed_files.push(failure),
            // Unreachable: the first fatal outcome returned above.
            FileExtraction::Fatal(error) => return Err(error),
        }
    }

    Ok(ExtractCatalogMessagesResult {
        messages: catalog
            .into_values()
            .map(CatalogUpdateMessage::from)
            .collect(),
        file_count,
        failed_files,
        diagnostics,
    })
}

thread_local! {
    /// Arena reused across every file a worker thread handles, reset in between.
    static EXTRACT_ARENA: std::cell::RefCell<Allocator> =
        std::cell::RefCell::new(Allocator::default());
}

/// Reads and extracts one file, classifying the outcome for ordered merging.
///
/// A cache hit skips both the read and the parse; validating the entry costs
/// one `stat`.
fn extract_one_file(
    file: &String,
    root_dir: &Path,
    reference_scopes: bool,
    mdx_options: &MdxOptions,
    rules: &SourceRuleOptions,
    cache: &ExtractCache,
) -> FileExtraction {
    if let Some((relative_file, messages, diagnostics, comments)) = cache.get(file) {
        return FileExtraction::Extracted {
            path: file.clone(),
            relative_file,
            messages,
            diagnostics,
            comments,
            fresh: false,
            fingerprint: None,
        };
    }

    // Observed before the read so insert() can reject a file edited mid-run.
    let fingerprint = cache.fingerprint_before_read(file);
    let source = match std::fs::read_to_string(file) {
        Ok(source) => source,
        Err(source) => {
            return FileExtraction::Failed(ExtractCatalogFileFailure {
                path: file.clone(),
                message: PalamedesError::ReadFile {
                    path: PathBuf::from(file),
                    source,
                }
                .to_string(),
            });
        }
    };

    /*
     * Batch fast path: every extractable construct requires one of two textual
     * markers. Macro imports name a `@palamedes/...` package as a literal
     * import specifier, and the runtime-call form spells an `i18n` member
     * somewhere. A file containing neither cannot produce messages or
     * macro-shape diagnostics, so the parse is skipped entirely; on real trees
     * most files carry no i18n at all, and parsing them is the bulk of the
     * extraction pass. MDX files always take the full path.
     *
     * Deliberate trade-off, scoped to batch extraction (`pmds extract` and the
     * binding): a syntax-broken file without any i18n marker no longer fails
     * the run — the same posture other extractors take for non-matching files.
     * Files with a marker keep exact parse diagnostics, and the single-file
     * `extract_messages` API still parses everything.
     */
    let is_mdx = Path::new(file)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("mdx"));
    if !is_mdx
        && !source.contains("@palamedes")
        && !source.contains("i18n")
        && !source.contains("palamedes-lint-")
    {
        return FileExtraction::Extracted {
            path: file.clone(),
            relative_file: relative_origin_file(root_dir, file),
            messages: Vec::new(),
            diagnostics: Vec::new(),
            comments: Vec::new(),
            // The marker fast path has not produced a complete comment list,
            // so it must not seed the shared source-analysis cache.
            fresh: false,
            fingerprint,
        };
    }

    let analyzed = EXTRACT_ARENA.with(|arena| {
        let mut arena = arena.borrow_mut();
        let analyzed =
            analyze_source_in(&arena, &source, file, reference_scopes, mdx_options, rules);
        /*
         * Safe to reset here: ExtractedMessageRecord owns its strings, so
         * nothing returned above borrows from the arena.
         */
        arena.reset();
        analyzed
    });

    match analyzed {
        Ok(analysis) => FileExtraction::Extracted {
            path: file.clone(),
            relative_file: relative_origin_file(root_dir, file),
            messages: analysis.messages,
            diagnostics: analysis.diagnostics,
            comments: analysis.comments,
            fresh: true,
            fingerprint,
        },
        Err(
            error @ (PalamedesError::ExplicitMessageIdsUnsupported
            | PalamedesError::NestedMessageMacro { .. }
            | PalamedesError::UnsupportedMacroSyntax { .. }
            | PalamedesError::TranslationMacroOutsideFunction { .. }),
        ) => FileExtraction::Fatal(error),
        Err(error) => FileExtraction::Failed(ExtractCatalogFileFailure {
            path: file.clone(),
            message: error.to_string(),
        }),
    }
}

/*
 * `pmds extract` is a one-shot process, so it never amortizes pool setup: the
 * first extraction in a process pays a per-thread cost that is dominated by
 * kernel VM work serialized on the process-wide vm_map lock. Measured on the
 * realistic benchmark corpus (1500 files, 6000 messages, M1 Ultra), extraction
 * is 119 ms serial, bottoms out around 45 ms at four threads, and climbs back
 * to 197 ms at twenty — worse than serial. Four is the measured floor, not a
 * core count, which is why it is a constant and not `available_parallelism()`.
 *
 * See ADR-013 for the full measurement and the reasoning behind the bound.
 */
pub const DEFAULT_EXTRACT_THREADS: usize = 4;

fn resolve_extract_threads(requested: Option<usize>, file_count: usize) -> usize {
    let available = std::thread::available_parallelism()
        .map(std::num::NonZeroUsize::get)
        .unwrap_or(1);
    requested
        .unwrap_or(DEFAULT_EXTRACT_THREADS)
        .max(1)
        .min(available)
        .min(file_count.max(1))
}

/// Per-file result of the parallel extraction pass, merged in input order.
enum FileExtraction {
    Extracted {
        /// Source path, used as the cache key.
        path: String,
        relative_file: String,
        messages: Vec<ExtractedMessageRecord>,
        diagnostics: Vec<SourceDiagnostic>,
        comments: Vec<SourceComment>,
        /// Whether the result contains a complete parse and should be cached.
        fresh: bool,
        /// File identity observed before reading, used to reject mid-run edits.
        fingerprint: Option<ReadStartFingerprint>,
    },
    Failed(ExtractCatalogFileFailure),
    Fatal(PalamedesError),
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
        analyze_source, analyze_source_file_cached, analyze_source_files_cached,
        analyze_source_with_mdx_options, analyze_source_with_options,
        extract_catalog_messages_cached, extract_catalog_messages_from_files,
        extract_catalog_messages_from_files_with_options, extract_messages as extract_messages_raw,
        resolve_extract_threads, ExtractCatalogMessagesOptions, ExtractCatalogMessagesRequest,
        ExtractedMessageRecord, SourceFileAnalysisRequest, DEFAULT_EXTRACT_THREADS,
    };
    use crate::error::PalamedesResult;
    use crate::extract_cache::ExtractCache;
    use crate::mdx::MdxOptions;
    use crate::source::{
        SourceAnalysisOptions, SourceCommentKind, SourceDiagnosticSeverity, SourceRuleLevel,
        SourceRuleOptions,
    };
    use crate::test_support::scope_macro_test_source;

    static TEMP_COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn extract_messages(
        source: &str,
        filename: &str,
    ) -> PalamedesResult<Vec<ExtractedMessageRecord>> {
        extract_messages_raw(&scope_macro_test_source(source, filename), filename)
    }

    #[test]
    fn shared_source_analysis_returns_extracted_messages_and_diagnostics() {
        let source = scope_macro_test_source(
            r#"import { t as translate } from "@palamedes/core/macro";
function Greeting({ name }: { name: string }) {
  return translate`Hello ${name}`;
}
"#,
            "test.tsx",
        );

        let result = analyze_source(&source, "test.tsx").expect("analyze source");

        assert_eq!(result.messages.len(), 1);
        assert_eq!(result.messages[0].message, "Hello {name}");
        assert!(result.diagnostics.is_empty());
    }

    #[test]
    fn shared_source_analysis_returns_parser_comment_ranges() {
        let source = r#"const continued = 'first\
second';
const comparison = continued</pattern/.test(value);
const inert = `// not a comment`;
const active = `value ${(
  // palamedes-lint-disable-next-line pmds/no-placeholder-only-message
  value
)}`;
/* block */
"#;

        let result = analyze_source(source, "test.ts").expect("analyze source comments");
        let comments = result
            .comments
            .iter()
            .map(|comment| {
                (
                    &source[comment.range.start..comment.range.end],
                    comment.kind,
                )
            })
            .collect::<Vec<_>>();

        assert_eq!(
            comments,
            vec![
                (
                    "// palamedes-lint-disable-next-line pmds/no-placeholder-only-message",
                    SourceCommentKind::Line,
                ),
                ("/* block */", SourceCommentKind::Block),
            ]
        );
    }

    #[test]
    fn shared_mdx_analysis_returns_only_semantic_comment_ranges() {
        let source = r#"<!-- palamedes-lint-disable-line pmds/no-placeholder-only-message -->

```mdx
<!-- fenced example -->
```

{`raw <!-- not a comment --> ${(
  // palamedes-lint-disable-next-line pmds/no-placeholder-only-message
  value
)}`}

<Comp value={/* palamedes-lint-disable-line pmds/prefer-trans-in-jsx */ value} />
"#;

        let result = analyze_source(source, "guide.mdx").expect("analyze MDX comments");
        let comments = result
            .comments
            .iter()
            .map(|comment| {
                (
                    &source[comment.range.start..comment.range.end],
                    comment.kind,
                )
            })
            .collect::<Vec<_>>();

        assert_eq!(
            comments,
            vec![
                (
                    "<!-- palamedes-lint-disable-line pmds/no-placeholder-only-message -->",
                    SourceCommentKind::Html,
                ),
                (
                    "// palamedes-lint-disable-next-line pmds/no-placeholder-only-message",
                    SourceCommentKind::Line,
                ),
                (
                    "/* palamedes-lint-disable-line pmds/prefer-trans-in-jsx */",
                    SourceCommentKind::Block,
                ),
            ]
        );
        assert!(comments
            .iter()
            .all(|(text, _)| !text.contains("fenced example")));
        assert!(comments
            .iter()
            .all(|(text, _)| !text.contains("not a comment")));
    }

    #[test]
    fn shared_source_analysis_maps_mdx_errors_to_the_common_diagnostic_shape() {
        let result = analyze_source_with_mdx_options(
            "# Intro\n\n<Component\n",
            "guide.mdx",
            &MdxOptions::default(),
        )
        .expect("MDX diagnostics are structured results");

        assert!(result.messages.is_empty());
        assert_eq!(result.diagnostics.len(), 1);
        let diagnostic = &result.diagnostics[0];
        assert_eq!(diagnostic.file, "guide.mdx");
        assert_eq!(diagnostic.severity, SourceDiagnosticSeverity::Error);
        assert!(!diagnostic.code.is_empty());
        assert!(!diagnostic.message.is_empty());
        assert!(!diagnostic.help.is_empty());
        assert!(diagnostic.primary.line >= 1);
        assert!(diagnostic.primary.column >= 1);
    }

    #[test]
    fn diagnoses_placeholder_only_messages_from_semantic_source_parts() {
        let source = r#"import { t as translate } from "@palamedes/core/macro";
import { Trans as Translate } from "@palamedes/react/macro";
function Greeting({ status, firstName, lastName }) {
  const tagged = translate`${status}`;
  const descriptor = translate({ message: `${firstName}${lastName}` });
  return <Translate>{firstName}{lastName}</Translate>;
}
"#;

        let result = analyze_source(source, "test.tsx").expect("analyze placeholder-only source");

        assert_eq!(result.messages.len(), 3);
        assert_eq!(result.diagnostics.len(), 3);
        for diagnostic in &result.diagnostics {
            assert_eq!(diagnostic.code, "pmds/no-placeholder-only-message");
            assert_eq!(diagnostic.severity, SourceDiagnosticSeverity::Warning);
            let highlighted = &source[diagnostic.primary.start..diagnostic.primary.end];
            assert!(highlighted.starts_with("translate") || highlighted.starts_with("<Translate>"));
        }
    }

    #[test]
    fn placeholder_only_classification_handles_solid_aliases_and_literal_braces() {
        let placeholder_source = r#"import { Trans as Translate } from "@palamedes/solid/macro";
const message = <Translate>{status}</Translate>;
"#;
        let placeholder =
            analyze_source(placeholder_source, "test.tsx").expect("analyze Solid Trans alias");
        assert_eq!(placeholder.diagnostics.len(), 1);

        let literal_source = r#"import { t } from "@palamedes/core/macro";
import { Trans } from "@palamedes/react/macro";
function Greeting({ status }) {
  const tagged = t`Status: ${status}`;
  const descriptor = t({ message: "{name}" });
  return <Trans>{"{name}"}</Trans>;
}
"#;
        let literal = analyze_source(literal_source, "test.tsx").expect("analyze literal text");
        assert_eq!(literal.messages.len(), 3);
        assert!(literal.diagnostics.is_empty());
    }

    #[test]
    fn empty_component_only_is_opt_in_and_preserves_nested_jsx_semantics() {
        let source = r#"import { Trans } from "@palamedes/react/macro";
const icon = <Trans>{/* formatting */}<><Button /></></Trans>;
const rich = <Trans><strong>Delete project</strong></Trans>;
"#;

        let recommended = analyze_source(source, "test.tsx").expect("analyze recommended rules");
        assert!(recommended.diagnostics.is_empty());

        let configured = analyze_source_with_options(
            source,
            "test.tsx",
            &SourceAnalysisOptions {
                rules: SourceRuleOptions {
                    empty_component_only: SourceRuleLevel::Warning,
                    ..SourceRuleOptions::default()
                },
                ..SourceAnalysisOptions::default()
            },
        )
        .expect("analyze opt-in component rule");

        assert_eq!(configured.diagnostics.len(), 1);
        let diagnostic = &configured.diagnostics[0];
        assert_eq!(diagnostic.code, "pmds/no-empty-component-only-message");
        assert_eq!(
            &source[diagnostic.primary.start..diagnostic.primary.end],
            "<Trans>{/* formatting */}<><Button /></></Trans>"
        );
    }

    #[test]
    fn mdx_rich_text_corpus_keeps_component_only_diagnostics_disabled() {
        let result = analyze_source(
            "Delete **project**.\n\nClick <Button /> to continue.",
            "guide.mdx",
        )
        .expect("analyze valid MDX rich text");

        assert!(!result.messages.is_empty());
        assert!(result.diagnostics.is_empty());
    }

    #[test]
    fn extraction_ignores_non_fatal_source_authoring_diagnostics() {
        let source = r#"import { t } from "@palamedes/core/macro";
function Greeting({ status }) { return t`${status}`; }
"#;

        let messages = extract_messages_raw(source, "test.ts").expect("extract messages");
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].message, "{status}");
    }

    #[test]
    fn suggests_trans_for_direct_conditional_and_logical_jsx_render_positions() {
        let source = r#"import { t as translate } from "@palamedes/react/macro";
function Greeting({ name, ready }) {
  return <section>
    {translate`Welcome ${name}`}
    {ready ? translate({ message: "Ready", comment: "Visible state", context: "status" }) : translate`Waiting`}
    {ready && translate`Done`}
  </section>;
}
"#;

        let result = analyze_source(source, "test.tsx").expect("analyze render positions");
        let diagnostics = result
            .diagnostics
            .iter()
            .filter(|diagnostic| diagnostic.code == "pmds/prefer-trans-in-jsx")
            .collect::<Vec<_>>();

        assert_eq!(diagnostics.len(), 4);
        for diagnostic in diagnostics {
            assert_eq!(diagnostic.severity, SourceDiagnosticSeverity::Info);
            assert!(diagnostic.message.contains("`t` remains supported"));
            assert!(diagnostic.help.contains("React's `<Trans>`"));
            assert!(diagnostic.help.contains("`t` remains supported"));
            assert!(
                source[diagnostic.primary.start..diagnostic.primary.end].starts_with("translate")
            );
        }
    }

    #[test]
    fn prefer_trans_resolves_solid_and_core_macro_sources_without_guessing_a_fix() {
        let solid_source = r#"import { t as translate } from "@palamedes/solid/macro";
function Greeting() { return <p>{translate`Hello`}</p>; }
"#;
        let solid = analyze_source(solid_source, "solid.tsx").expect("analyze Solid render");
        assert!(solid.diagnostics[0].help.contains("Solid's `<Trans>`"));

        let core_source = r#"import { t as translate } from "@palamedes/core/macro";
function Greeting() { return <p>{translate`Hello`}</p>; }
"#;
        let core = analyze_source(core_source, "core.tsx").expect("analyze core render");
        assert!(core.diagnostics[0]
            .help
            .contains("the active UI framework's `<Trans>`"));
    }

    #[test]
    fn prefer_trans_excludes_non_render_and_structurally_restricted_positions() {
        let source = r#"import { t as translate } from "@palamedes/react/macro";
function Greeting({ ready }) {
  const render = (value) => value;
  return <>
    <Card title={translate`Attribute`} />
    <div>{render(translate`Argument`)}</div>
    <div>{[translate`Array`]}</div>
    <div>{({ label: translate`Object` }).label}</div>
    <option>{translate`Option`}</option>
    <textarea>{translate`Textarea`}</textarea>
    <svg><title>{translate`Title`}</title><desc>{translate`Description`}</desc></svg>
    <div>{translate`Left side` && <span />}</div>
    <div>{translate`Fallback` || "fallback"}</div>
    <div>{translate`Fallback` ?? "fallback"}</div>
  </>;
}
"#;

        let result = analyze_source(source, "test.tsx").expect("analyze excluded positions");
        assert_eq!(result.messages.len(), 11);
        assert!(result
            .diagnostics
            .iter()
            .all(|diagnostic| diagnostic.code != "pmds/prefer-trans-in-jsx"));
    }

    #[test]
    fn prefer_trans_ignores_unrelated_local_t_functions() {
        let source = r#"function t(strings) { return strings[0]; }
function Greeting() { return <p>{t`Hello`}</p>; }
"#;

        let result = analyze_source(source, "test.tsx").expect("analyze unrelated t");
        assert!(result.messages.is_empty());
        assert!(result.diagnostics.is_empty());
    }

    #[test]
    fn resolves_extract_threads_within_measured_bounds() {
        let available = std::thread::available_parallelism()
            .map(std::num::NonZeroUsize::get)
            .unwrap_or(1);

        // Default is the measured bound, not the core count.
        assert_eq!(
            resolve_extract_threads(None, 10_000),
            DEFAULT_EXTRACT_THREADS.min(available)
        );

        // An explicit request is honored, still clamped to the machine.
        assert_eq!(resolve_extract_threads(Some(2), 10_000), 2.min(available));

        // Never spawn more workers than there are files to hand out.
        assert_eq!(resolve_extract_threads(None, 2), 2.min(available));

        // 1 forces the serial path; 0 is treated as 1 rather than panicking in
        // ThreadPoolBuilder.
        assert_eq!(resolve_extract_threads(Some(1), 10_000), 1);
        assert_eq!(resolve_extract_threads(Some(0), 10_000), 1);

        // An empty file list must still resolve to a buildable pool size.
        assert!(resolve_extract_threads(None, 0) >= 1);
    }

    #[test]
    fn batch_extraction_is_independent_of_thread_count() {
        let root = temp_root("thread-count-parity");
        std::fs::create_dir_all(&root).expect("create root");
        let mut files = Vec::new();
        for index in 0..24 {
            let path = root.join(format!("fixture-{index:02}.tsx"));
            std::fs::write(
                &path,
                format!(
                    "import {{ t }} from \"@palamedes/core/macro\"\n\
                     export function Fixture{index}() {{\n\
                       return [t({{ message: \"Message {index}\" }}), t({{ message: \"Shared\" }})]\n\
                     }}\n"
                ),
            )
            .expect("write fixture");
            files.push(path.to_string_lossy().into_owned());
        }

        let run = |threads: usize| {
            extract_catalog_messages_from_files(ExtractCatalogMessagesRequest {
                root_dir: root.to_string_lossy().into_owned(),
                files: files.clone(),
                max_threads: Some(threads),
            })
            .expect("batch extraction")
            .messages
        };

        /*
         * "Shared" appears in every file, so its aggregated origins are exactly
         * where a racy merge would show up: same set, different order.
         */
        let serial = run(1);
        for threads in [2, 4, 8] {
            assert_eq!(
                serial,
                run(threads),
                "thread count {threads} changed the extracted catalog"
            );
        }

        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn batch_source_analysis_keeps_order_and_cache_results_independent_of_threads() {
        let root = temp_root("source-analysis-thread-count");
        fs::create_dir_all(&root).expect("create root");
        let mut files = Vec::new();
        for index in 0..12 {
            let path = root.join(format!("fixture-{index:02}.tsx"));
            fs::write(
                &path,
                format!(
                    "import {{ t }} from \"@palamedes/core/macro\";\nexport function Label{index}({{ status }}) {{ return t`${{status}}`; }}\n"
                ),
            )
            .expect("write fixture");
            fs::File::options()
                .write(true)
                .open(&path)
                .expect("open fixture")
                .set_modified(std::time::SystemTime::now() - std::time::Duration::from_secs(10))
                .expect("age fixture");
            files.push(SourceFileAnalysisRequest {
                path: path.to_string_lossy().into_owned(),
                filename: format!("src/fixture-{index:02}.tsx"),
            });
        }
        // Duplicate inputs are reachable through library callers and must keep
        // their caller-provided order even though cache insertion is serial.
        files.push(files[3].clone());

        let options = ExtractCatalogMessagesOptions {
            rules: SourceRuleOptions::default(),
            ..ExtractCatalogMessagesOptions::default()
        };
        let run = |threads, cache: &mut ExtractCache| {
            analyze_source_files_cached(
                &files,
                &root.to_string_lossy(),
                &options,
                Some(threads),
                cache,
            )
            .expect("batch source analysis")
            .into_iter()
            .map(|result| {
                let result = result.expect("fixture analysis");
                serde_json::to_vec(&(result.source, result.analysis))
                    .expect("serialize deterministic analysis")
            })
            .collect::<Vec<_>>()
        };

        let mut uncached = ExtractCache::disabled();
        let serial = run(1, &mut uncached);
        for threads in [2, 4, 8] {
            let mut cache = ExtractCache::disabled();
            assert_eq!(serial, run(threads, &mut cache), "thread count {threads}");
        }

        let cache_path = root.join("cache.json");
        let mut warm_cache =
            ExtractCache::load_with_options(&cache_path, &root.to_string_lossy(), &options);
        assert_eq!(serial, run(4, &mut warm_cache));
        assert_eq!(warm_cache.len(), 12);
        assert_eq!(serial, run(2, &mut warm_cache));

        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn batch_source_analysis_preserves_partial_failures_in_input_order() {
        let root = temp_root("source-analysis-partial-failure");
        fs::create_dir_all(&root).expect("create root");
        let valid = root.join("valid.ts");
        fs::write(&valid, "export const value = 1;\n").expect("write source");
        let files = vec![
            SourceFileAnalysisRequest {
                path: valid.to_string_lossy().into_owned(),
                filename: "src/valid.ts".to_owned(),
            },
            SourceFileAnalysisRequest {
                path: root.join("missing.ts").to_string_lossy().into_owned(),
                filename: "src/missing.ts".to_owned(),
            },
        ];
        let mut cache = ExtractCache::disabled();
        let outcomes = analyze_source_files_cached(
            &files,
            &root.to_string_lossy(),
            &ExtractCatalogMessagesOptions::default(),
            Some(4),
            &mut cache,
        )
        .expect("batch executes");

        assert!(outcomes[0].is_ok());
        assert!(outcomes[1].is_err());
        fs::remove_dir_all(root).expect("cleanup");
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

    /*
     * Extraction and the transform must classify the same uses as macro uses.
     * `does_not_transform_shadowed_macro_locals` in `transform/tests.rs` pins
     * this fixture from the transform side: the shadowed tag is left alone
     * there, so extracting it would put a never-rendered message in catalogs.
     */
    #[test]
    fn does_not_extract_shadowed_macro_locals() {
        let source = r#"import { t } from "@palamedes/core/macro";
function Example() {
  const label = t`Upload failed`;
  return ((t) => t`runtime tag`)(runtimeTag) && label;
}
"#;

        let messages = extract_messages_raw(source, "test.ts").expect("extract messages");
        let source_messages = messages
            .iter()
            .map(|message| message.message.as_str())
            .collect::<Vec<_>>();

        assert_eq!(source_messages, vec!["Upload failed"]);
    }

    #[test]
    fn shadowed_macro_locals_in_unsupported_shapes_do_not_fail_extraction() {
        let cases = [
            (
                r#"import { t } from "@palamedes/core/macro";
function Example(lookup) {
  const label = t`Upload failed`;
  return ((t) => t(lookup))(String) && label;
}
"#,
                "test.ts",
            ),
            (
                r#"import { select, t } from "@palamedes/core/macro";
function Example(node) {
  const label = t`Upload failed`;
  return ((select) => select(node))(querySelector) && label;
}
"#,
                "test.ts",
            ),
        ];

        for (source, filename) in cases {
            let messages =
                extract_messages_raw(source, filename).expect("shadowed locals are not macros");
            let source_messages = messages
                .iter()
                .map(|message| message.message.as_str())
                .collect::<Vec<_>>();

            assert_eq!(source_messages, vec!["Upload failed"]);
        }
    }

    #[test]
    fn shadowed_macro_locals_outside_functions_are_not_eager_macro_uses() {
        let source = r#"import { t } from "@palamedes/core/macro";
function Example() {
  return t`Upload failed`;
}
{
  const t = createTranslator();
  t({ id: "local" });
}
"#;

        let messages =
            extract_messages_raw(source, "test.ts").expect("shadowed locals are not macros");
        let source_messages = messages
            .iter()
            .map(|message| message.message.as_str())
            .collect::<Vec<_>>();

        assert_eq!(source_messages, vec!["Upload failed"]);
    }

    #[test]
    fn shadowed_jsx_macro_locals_are_not_nested_message_macros() {
        let source = r#"import { Trans } from "@palamedes/react/macro";
function Example({ rows }) {
  return <Trans>Upload {getRows((Trans) => <Trans key={1} />)} failed</Trans>;
}
"#;

        let messages =
            extract_messages_raw(source, "test.tsx").expect("shadowed locals are not macros");
        let source_messages = messages
            .iter()
            .map(|message| message.message.as_str())
            .collect::<Vec<_>>();

        assert_eq!(source_messages, vec!["Upload {rows} failed"]);
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
    fn ignores_jsx_comments_inside_trans() {
        let messages = extract_messages(
            r#"
              import { Trans } from "@palamedes/react/macro"
              const message = <Trans>Hello {/* translator note */} world</Trans>
            "#,
            "test.tsx",
        )
        .expect("JSX comments should be ignored");

        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].message, "Hello world");
        assert_eq!(messages[0].placeholders, None);
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
            max_threads: None,
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
            max_threads: None,
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
            max_threads: None,
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

        let without_scopes = extract_catalog_messages_from_files_with_options(
            ExtractCatalogMessagesRequest {
                root_dir: root.to_string_lossy().into_owned(),
                files: vec![app.to_string_lossy().into_owned()],
                max_threads: None,
            },
            ExtractCatalogMessagesOptions {
                reference_scopes: false,
                ..ExtractCatalogMessagesOptions::default()
            },
        )
        .expect("batch extraction without scopes");
        assert!(without_scopes
            .messages
            .iter()
            .flat_map(|message| &message.origins)
            .all(|origin| origin.scope.is_none()));

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
            max_threads: None,
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
        // The i18n marker keeps the file on the parsing path; marker-free
        // files skip the parse entirely and are covered by the test below.
        fs::write(
            &invalid,
            "import { t } from \"@palamedes/core/macro\"\nconst broken =",
        )
        .expect("invalid source");

        let result = extract_catalog_messages_from_files(ExtractCatalogMessagesRequest {
            root_dir: root.to_string_lossy().into_owned(),
            files: vec![invalid.to_string_lossy().into_owned()],
            max_threads: None,
        })
        .expect("batch extraction should continue");

        assert_eq!(result.file_count, 1);
        assert_eq!(result.failed_files.len(), 1);
        assert!(result.failed_files[0].message.contains("Parse error"));

        fs::remove_dir_all(root).expect("cleanup");
    }

    /*
     * The batch fast path must not report syntax errors in files that carry no
     * i18n marker at all: they cannot produce messages, and failing the run on
     * them would make `pmds extract` a project-wide syntax check.
     */
    #[test]
    fn batch_skips_broken_files_without_i18n_markers() {
        let root = temp_root("batch-skip-markerless");
        fs::create_dir_all(&root).expect("root dir");
        let invalid = root.join("invalid.ts");
        fs::write(&invalid, "const broken =").expect("invalid source");

        let result = extract_catalog_messages_from_files(ExtractCatalogMessagesRequest {
            root_dir: root.to_string_lossy().into_owned(),
            files: vec![invalid.to_string_lossy().into_owned()],
            max_threads: None,
        })
        .expect("batch extraction should continue");

        assert_eq!(result.file_count, 1);
        assert!(result.failed_files.is_empty());
        assert!(result.messages.is_empty());

        fs::remove_dir_all(root).expect("cleanup");
    }

    /*
     * Unsupported macro syntax is fatal for the whole batch, so classifying a
     * shadowed local as a macro use failed `pmds extract` for the entire tree.
     */
    #[test]
    fn batch_extracts_files_that_shadow_a_macro_local() {
        let root = temp_root("batch-shadowed-macro");
        fs::create_dir_all(&root).expect("root dir");
        let source = root.join("shadowed.ts");
        fs::write(
            &source,
            r#"
              import { t } from "@palamedes/core/macro"
              function message(lookup) {
                return ((t) => t(lookup))(String) && t`Hello`
              }
            "#,
        )
        .expect("source");

        let result = extract_catalog_messages_from_files(ExtractCatalogMessagesRequest {
            root_dir: root.to_string_lossy().into_owned(),
            files: vec![source.to_string_lossy().into_owned()],
            max_threads: None,
        })
        .expect("shadowed locals are not macro uses");

        assert!(result.failed_files.is_empty());
        assert_eq!(
            result
                .messages
                .iter()
                .map(|message| message.message.as_str())
                .collect::<Vec<_>>(),
            vec!["Hello"]
        );

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
            max_threads: None,
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
            max_threads: None,
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
            max_threads: None,
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
            max_threads: None,
        })
        .expect_err("unsupported macro syntax should fail");

        assert!(error.to_string().contains("Unsupported `t` macro usage"));
        fs::remove_dir_all(root).expect("cleanup");
    }

    /*
     * A reused cache outlives the request it was loaded for — watch mode holds
     * one across config reloads. Entries stamped for another reference root
     * carry that root's origins, so they must not be served after the request
     * changes.
     */
    #[test]
    fn cached_extraction_bypasses_entries_stamped_for_another_request() {
        let root = temp_root("cached-stamp-change");
        let src = root.join("src");
        fs::create_dir_all(&src).expect("src dir");
        let app = src.join("App.tsx");
        fs::write(
            &app,
            r#"
              import { t } from "@palamedes/core/macro"
              function messages() {
                return t`Cached origin`
              }
            "#,
        )
        .expect("source");
        // Backdated out of the cache's racy window so the entry is really
        // stored and the second run would be a hit.
        let aged = std::time::SystemTime::now() - std::time::Duration::from_secs(10);
        fs::File::options()
            .write(true)
            .open(&app)
            .expect("open source")
            .set_modified(aged)
            .expect("age source");

        let mut cache = ExtractCache::load(&root.join("cache.json"), "unused", true);
        let files = vec![app.to_string_lossy().into_owned()];
        let request = |root_dir: &std::path::Path| ExtractCatalogMessagesRequest {
            root_dir: root_dir.to_string_lossy().into_owned(),
            files: files.clone(),
            max_threads: None,
        };

        let first = extract_catalog_messages_cached(
            request(&root),
            ExtractCatalogMessagesOptions::default(),
            &mut cache,
        )
        .expect("first extraction");
        assert_eq!(first.messages[0].origins[0].file, "src/App.tsx");

        // Same file, new reference root: the origin has to follow the request
        // instead of being served from the entry stored for the old root.
        let second = extract_catalog_messages_cached(
            request(&src),
            ExtractCatalogMessagesOptions::default(),
            &mut cache,
        )
        .expect("second extraction");
        assert_eq!(second.messages[0].origins[0].file, "App.tsx");

        // And the re-stamped cache still serves the new request.
        let third = extract_catalog_messages_cached(
            request(&src),
            ExtractCatalogMessagesOptions::default(),
            &mut cache,
        )
        .expect("third extraction");
        assert_eq!(third.messages[0].origins[0].file, "App.tsx");

        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn extraction_warms_byte_equivalent_cached_source_analysis() {
        let root = temp_root("shared-analysis-cache");
        let src = root.join("src");
        fs::create_dir_all(&src).expect("src dir");
        let view = src.join("View.tsx");
        fs::write(
            &view,
            r#"
              import { t } from "@palamedes/react/macro"
              function View({ status }) {
                return <p>{t`${status}`}</p>
              }
            "#,
        )
        .expect("source");
        let aged = std::time::SystemTime::now() - std::time::Duration::from_secs(10);
        fs::File::options()
            .write(true)
            .open(&view)
            .expect("open source")
            .set_modified(aged)
            .expect("age source");

        let path = view.to_string_lossy().into_owned();
        let root_dir = root.to_string_lossy().into_owned();
        let options = ExtractCatalogMessagesOptions {
            rules: SourceRuleOptions::default(),
            ..ExtractCatalogMessagesOptions::default()
        };
        let mut cache =
            ExtractCache::load_with_options(&root.join("cache.json"), &root_dir, &options);
        let extracted = extract_catalog_messages_cached(
            ExtractCatalogMessagesRequest {
                root_dir: root_dir.clone(),
                files: vec![path.clone()],
                max_threads: Some(1),
            },
            options.clone(),
            &mut cache,
        )
        .expect("extract and warm cache");
        assert_eq!(extracted.diagnostics.len(), 2);
        assert_eq!(cache.len(), 1);

        let cached =
            analyze_source_file_cached(&path, "src/View.tsx", &root_dir, &options, &mut cache)
                .expect("cached analysis");
        let uncached = analyze_source_file_cached(
            &path,
            "src/View.tsx",
            &root_dir,
            &options,
            &mut ExtractCache::disabled(),
        )
        .expect("uncached analysis");

        assert_eq!(cached.source, uncached.source);
        assert_eq!(
            serde_json::to_vec(&cached.analysis).expect("serialize cached"),
            serde_json::to_vec(&uncached.analysis).expect("serialize uncached"),
            "cached and uncached analysis must be byte-for-byte equivalent"
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn extraction_marker_fast_path_does_not_cache_incomplete_comments() {
        let root = temp_root("shared-analysis-fast-path");
        fs::create_dir_all(&root).expect("create root");
        let source_path = root.join("plain.ts");
        fs::write(
            &source_path,
            "// ordinary comment\nexport const value = 1;\n",
        )
        .expect("write source");
        fs::File::options()
            .write(true)
            .open(&source_path)
            .expect("open source")
            .set_modified(std::time::SystemTime::now() - std::time::Duration::from_secs(10))
            .expect("age source");

        let path = source_path.to_string_lossy().into_owned();
        let root_dir = root.to_string_lossy().into_owned();
        let options = ExtractCatalogMessagesOptions::default();
        let mut cache =
            ExtractCache::load_with_options(&root.join("cache.json"), &root_dir, &options);
        extract_catalog_messages_cached(
            ExtractCatalogMessagesRequest {
                root_dir: root_dir.clone(),
                files: vec![path.clone()],
                max_threads: Some(1),
            },
            options.clone(),
            &mut cache,
        )
        .expect("marker-free extraction");
        assert_eq!(
            cache.len(),
            0,
            "fast path must not seed an incomplete entry"
        );

        let analyzed =
            analyze_source_file_cached(&path, "plain.ts", &root_dir, &options, &mut cache)
                .expect("source analysis");
        assert_eq!(analyzed.analysis.comments.len(), 1);
        assert_eq!(analyzed.analysis.comments[0].kind, SourceCommentKind::Line);
        assert_eq!(cache.len(), 1, "full analysis should seed the cache");

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
