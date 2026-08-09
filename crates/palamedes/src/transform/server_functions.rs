use std::collections::{HashMap, HashSet};

use oxc_ast::ast::{
    ArrowFunctionBody, ArrowFunctionExpression, CallExpression, Declaration, Expression,
    FormalParameters, Function, FunctionBody, ImportOrExportKind, JSXElement, Program, Statement,
    TaggedTemplateExpression, VariableDeclaration, VariableDeclarationKind,
};
use oxc_ast::ast_kind::AstKind;
use oxc_ast_visit::{walk, Visit};
use oxc_semantic::{Semantic, SemanticBuilder};
use oxc_span::GetSpan;
use oxc_syntax::reference::Reference;
use oxc_syntax::symbol::SymbolId;

use crate::error::PalamedesError;
use crate::translation_scope::source_location;

use super::imports::ImportedMacro;
use super::messages::identifier_name;
use super::{Replacement, ServerFunctionTransformOptions};

const INITIALIZER_ALIAS: &str = "__palamedesServerFunctionInitializer";
const EAGER_JS_MACROS: [&str; 4] = ["t", "plural", "select", "selectOrdinal"];
const EAGER_JSX_MACROS: [&str; 3] = ["Plural", "Select", "SelectOrdinal"];

pub(super) struct ServerFunctionTransform {
    pub replacements: Vec<Replacement>,
    pub initializer_alias: String,
    pub error: Option<PalamedesError>,
}

impl ServerFunctionTransform {
    pub(super) fn run<'a>(
        program: &Program<'a>,
        source: &'a str,
        filename: &'a str,
        macro_imports: &'a HashMap<String, ImportedMacro>,
        used_identifier_names: &HashSet<String>,
    ) -> Self {
        let initializer_alias = unique_identifier(INITIALIZER_ALIAS, used_identifier_names);
        let module_function_spans = module_server_function_spans(program);
        let (replacements, error) = {
            let mut visitor = ServerFunctionVisitor {
                source,
                filename,
                macro_imports,
                module_function_spans: &module_function_spans,
                initializer_alias: &initializer_alias,
                replacements: Vec::new(),
                error: None,
            };
            visitor.visit_program(program);
            (visitor.replacements, visitor.error)
        };

        Self {
            replacements,
            initializer_alias,
            error,
        }
    }
}

pub(super) fn initializer_import(options: &ServerFunctionTransformOptions, alias: &str) -> String {
    let module = serde_json::to_string(&options.initializer_module)
        .expect("serializing a Rust string as JSON cannot fail");
    format!(
        "import {{ {} as {alias} }} from {module};\n",
        options.initializer_export
    )
}

fn unique_identifier(base: &str, used: &HashSet<String>) -> String {
    if !used.contains(base) {
        return base.to_string();
    }

    let mut counter = 2;
    loop {
        let candidate = format!("{base}{counter}");
        if !used.contains(&candidate) {
            return candidate;
        }
        counter += 1;
    }
}

fn has_use_server_directive(body: &FunctionBody<'_>) -> bool {
    body.directives
        .iter()
        .any(|directive| directive.directive.as_str() == "use server")
}

fn module_server_function_spans(program: &Program<'_>) -> HashSet<(u32, u32)> {
    if !program
        .directives
        .iter()
        .any(|directive| directive.directive.as_str() == "use server")
    {
        return HashSet::new();
    }

    let semantic = SemanticBuilder::new().build(program).semantic;
    let local_async_function_spans = local_async_function_spans(program, &semantic);
    let mut named_exports = HashSet::new();
    for statement in &program.body {
        if let Statement::ExportNamedDeclaration(export) = statement {
            if export.export_kind == ImportOrExportKind::Value {
                for specifier in &export.specifiers {
                    if specifier.export_kind == ImportOrExportKind::Value {
                        named_exports.insert(specifier.local.name().to_string());
                    }
                }
            }
        }
        if let Statement::ExportDefaultDeclaration(export) = statement {
            if let Some(Expression::Identifier(identifier)) = export
                .declaration
                .as_expression()
                .map(Expression::get_inner_expression)
            {
                named_exports.insert(identifier.name.to_string());
            }
        }
    }

    let mut spans = HashSet::new();
    for statement in &program.body {
        match statement {
            Statement::ExportDeclaration(export) => {
                record_declaration_functions(
                    &export.declaration,
                    None,
                    &local_async_function_spans,
                    &semantic,
                    &mut spans,
                );
            }
            Statement::ExportDefaultDeclaration(export) => match &export.declaration {
                oxc_ast::ast::ExportDefaultDeclarationKind::FunctionDeclaration(function) => {
                    record_function(function, &mut spans);
                }
                declaration => {
                    if let Some(expression) = declaration.as_expression() {
                        record_exported_initializer_functions(
                            expression,
                            &local_async_function_spans,
                            &semantic,
                            &mut spans,
                        );
                    }
                }
            },
            Statement::FunctionDeclaration(function) => {
                let name = function.id.as_ref().map(|id| id.name.as_str());
                if name.is_some_and(|name| named_exports.contains(name)) {
                    record_function(function, &mut spans);
                }
            }
            Statement::VariableDeclaration(declaration) => {
                record_variable_functions(
                    declaration,
                    Some(&named_exports),
                    &local_async_function_spans,
                    &semantic,
                    &mut spans,
                );
            }
            _ => {}
        }
    }
    spans
}

/// Records module-scope async functions that can be passed by reference to an
/// exported Server Function wrapper. Bindings with writes are excluded because
/// a later assignment could change which callback the wrapper invokes.
fn local_async_function_spans(
    program: &Program<'_>,
    semantic: &Semantic<'_>,
) -> HashMap<SymbolId, (u32, u32)> {
    let mut spans = HashMap::new();

    for statement in &program.body {
        match statement {
            Statement::FunctionDeclaration(function) => {
                record_local_async_function(function, semantic, &mut spans);
            }
            Statement::VariableDeclaration(declaration) => {
                record_local_async_variable_functions(declaration, semantic, &mut spans);
            }
            Statement::ExportDeclaration(export) => match &export.declaration {
                Declaration::FunctionDeclaration(function) => {
                    record_local_async_function(function, semantic, &mut spans);
                }
                Declaration::VariableDeclaration(declaration) => {
                    record_local_async_variable_functions(declaration, semantic, &mut spans);
                }
                _ => {}
            },
            Statement::ExportDefaultDeclaration(export) => {
                if let oxc_ast::ast::ExportDefaultDeclarationKind::FunctionDeclaration(function) =
                    &export.declaration
                {
                    record_local_async_function(function, semantic, &mut spans);
                }
            }
            _ => {}
        }
    }

    spans
}

fn record_local_async_function(
    function: &Function<'_>,
    semantic: &Semantic<'_>,
    spans: &mut HashMap<SymbolId, (u32, u32)>,
) {
    if function.r#async && function.body.is_some() {
        if let Some(symbol_id) = function
            .id
            .as_ref()
            .and_then(|identifier| identifier.symbol_id.get())
            .filter(|&symbol_id| !symbol_has_writes(semantic, symbol_id))
        {
            spans.insert(symbol_id, (function.span.start, function.span.end));
        }
    }
}

fn record_local_async_variable_functions(
    declaration: &VariableDeclaration<'_>,
    semantic: &Semantic<'_>,
    spans: &mut HashMap<SymbolId, (u32, u32)>,
) {
    if declaration.kind != VariableDeclarationKind::Const {
        return;
    }

    for declarator in &declaration.declarations {
        let Some(symbol_id) = declarator
            .id
            .get_binding_identifier()
            .and_then(|identifier| identifier.symbol_id.get())
            .filter(|&symbol_id| !symbol_has_writes(semantic, symbol_id))
        else {
            continue;
        };
        let Some(initializer) = &declarator.init else {
            continue;
        };

        let span = match initializer.get_inner_expression() {
            Expression::ArrowFunctionExpression(function) if function.r#async => {
                Some((function.span.start, function.span.end))
            }
            Expression::FunctionExpression(function)
                if function.r#async && function.body.is_some() =>
            {
                Some((function.span.start, function.span.end))
            }
            _ => None,
        };
        if let Some(span) = span {
            spans.insert(symbol_id, span);
        }
    }
}

fn symbol_has_writes(semantic: &Semantic<'_>, symbol_id: SymbolId) -> bool {
    semantic
        .scoping()
        .get_resolved_references(symbol_id)
        .any(Reference::is_write)
}

fn record_declaration_functions(
    declaration: &Declaration<'_>,
    named_exports: Option<&HashSet<String>>,
    local_async_function_spans: &HashMap<SymbolId, (u32, u32)>,
    semantic: &Semantic<'_>,
    spans: &mut HashSet<(u32, u32)>,
) {
    match declaration {
        Declaration::FunctionDeclaration(function) => {
            let should_record = named_exports.is_none_or(|exports| {
                function
                    .id
                    .as_ref()
                    .is_some_and(|id| exports.contains(id.name.as_str()))
            });
            if should_record {
                record_function(function, spans);
            }
        }
        Declaration::VariableDeclaration(declaration) => {
            record_variable_functions(
                declaration,
                named_exports,
                local_async_function_spans,
                semantic,
                spans,
            );
        }
        _ => {}
    }
}

fn record_variable_functions(
    declaration: &VariableDeclaration<'_>,
    named_exports: Option<&HashSet<String>>,
    local_async_function_spans: &HashMap<SymbolId, (u32, u32)>,
    semantic: &Semantic<'_>,
    spans: &mut HashSet<(u32, u32)>,
) {
    for declarator in &declaration.declarations {
        let should_record = named_exports.is_none_or(|exports| {
            declarator
                .id
                .get_identifier_name()
                .is_some_and(|name| exports.contains(name.as_str()))
        });
        if should_record {
            if let Some(initializer) = &declarator.init {
                record_exported_initializer_functions(
                    initializer,
                    local_async_function_spans,
                    semantic,
                    spans,
                );
            }
        }
    }
}

fn record_function(function: &Function<'_>, spans: &mut HashSet<(u32, u32)>) {
    if function.r#async && function.body.is_some() {
        spans.insert((function.span.start, function.span.end));
    }
}

fn record_exported_initializer_functions(
    expression: &Expression<'_>,
    local_async_function_spans: &HashMap<SymbolId, (u32, u32)>,
    semantic: &Semantic<'_>,
    spans: &mut HashSet<(u32, u32)>,
) {
    if let Expression::Identifier(identifier) = expression.get_inner_expression() {
        if let Some(span) = identifier
            .reference_id
            .get()
            .and_then(|reference_id| semantic.scoping().get_reference(reference_id).symbol_id())
            .and_then(|symbol_id| local_async_function_spans.get(&symbol_id))
        {
            spans.insert(*span);
        }
    }

    let mut collector = ExportedInitializerFunctionCollector {
        spans,
        local_async_function_spans,
        semantic,
        function_depth: 0,
    };
    collector.visit_expression(expression.get_inner_expression());
}

struct ExportedInitializerFunctionCollector<'a> {
    spans: &'a mut HashSet<(u32, u32)>,
    local_async_function_spans: &'a HashMap<SymbolId, (u32, u32)>,
    semantic: &'a Semantic<'a>,
    function_depth: usize,
}

impl<'a> Visit<'a> for ExportedInitializerFunctionCollector<'_> {
    fn visit_function(&mut self, it: &Function<'a>, flags: oxc_syntax::scope::ScopeFlags) {
        if it.r#async && it.body.is_some() {
            record_function(it, self.spans);
            return;
        }
        self.function_depth += 1;
        walk::walk_function(self, it, flags);
        self.function_depth -= 1;
    }

    fn visit_arrow_function_expression(&mut self, it: &ArrowFunctionExpression<'a>) {
        if it.r#async {
            self.spans.insert((it.span.start, it.span.end));
            return;
        }
        self.function_depth += 1;
        walk::walk_arrow_function_expression(self, it);
        self.function_depth -= 1;
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if self.function_depth == 0 {
            for argument in &it.arguments {
                let Some(Expression::Identifier(identifier)) = argument
                    .as_expression()
                    .map(Expression::get_inner_expression)
                else {
                    continue;
                };
                if let Some(span) = identifier
                    .reference_id
                    .get()
                    .and_then(|reference_id| {
                        self.semantic
                            .scoping()
                            .get_reference(reference_id)
                            .symbol_id()
                    })
                    .and_then(|symbol_id| self.local_async_function_spans.get(&symbol_id))
                {
                    self.spans.insert(*span);
                }
            }
        }
        walk::walk_call_expression(self, it);
    }
}

struct ServerFunctionVisitor<'a> {
    source: &'a str,
    filename: &'a str,
    macro_imports: &'a HashMap<String, ImportedMacro>,
    module_function_spans: &'a HashSet<(u32, u32)>,
    initializer_alias: &'a str,
    replacements: Vec<Replacement>,
    error: Option<PalamedesError>,
}

impl ServerFunctionVisitor<'_> {
    fn validate_parameters(&mut self, params: &FormalParameters<'_>) -> bool {
        let mut validator = EagerParameterMacroVisitor {
            macro_imports: self.macro_imports,
            function_depth: 0,
            macro_offset: None,
        };
        validator.visit_formal_parameters(params);
        if let Some(offset) = validator.macro_offset {
            self.error = Some(PalamedesError::ServerFunctionParameterMacro {
                location: source_location(self.source, self.filename, offset),
            });
            return false;
        }
        true
    }

    fn instrument_body(&mut self, body: &FunctionBody<'_>) {
        let offset = body
            .directives
            .last()
            .map_or(body.span.start as usize + 1, |directive| {
                directive.span.end as usize
            });
        self.replacements.push(Replacement {
            start: offset,
            end: offset,
            text: format!("\n  await {}();", self.initializer_alias),
        });
    }
}

impl<'a> Visit<'a> for ServerFunctionVisitor<'_> {
    fn visit_function(&mut self, it: &Function<'a>, flags: oxc_syntax::scope::ScopeFlags) {
        if self.error.is_some() {
            return;
        }
        let is_server_function = it.r#async
            && it.body.as_ref().is_some_and(|body| {
                has_use_server_directive(body)
                    || self
                        .module_function_spans
                        .contains(&(it.span.start, it.span.end))
            });
        if is_server_function && self.validate_parameters(&it.params) {
            self.instrument_body(it.body.as_ref().expect("checked above"));
        }
        if self.error.is_none() {
            walk::walk_function(self, it, flags);
        }
    }

    fn visit_arrow_function_expression(&mut self, it: &ArrowFunctionExpression<'a>) {
        if self.error.is_some() {
            return;
        }
        let inline = match &it.body {
            ArrowFunctionBody::FunctionBody(body) => has_use_server_directive(body),
            _ => false,
        };
        let is_server_function = it.r#async
            && (inline
                || self
                    .module_function_spans
                    .contains(&(it.span.start, it.span.end)));
        if is_server_function && self.validate_parameters(&it.params) {
            match &it.body {
                ArrowFunctionBody::FunctionBody(body) => self.instrument_body(body),
                body => {
                    let span = body.span();
                    self.replacements.push(Replacement {
                        start: span.start as usize,
                        end: span.start as usize,
                        text: format!("{{\n  await {}();\n  return ", self.initializer_alias),
                    });
                    self.replacements.push(Replacement {
                        start: span.end as usize,
                        end: span.end as usize,
                        text: ";\n}".to_string(),
                    });
                }
            }
        }
        if self.error.is_none() {
            walk::walk_arrow_function_expression(self, it);
        }
    }
}

struct EagerParameterMacroVisitor<'a> {
    macro_imports: &'a HashMap<String, ImportedMacro>,
    function_depth: usize,
    macro_offset: Option<usize>,
}

impl EagerParameterMacroVisitor<'_> {
    fn check(&mut self, local_name: &str, expected: &[&str], offset: usize) {
        if self.macro_offset.is_some() || self.function_depth > 0 {
            return;
        }
        if self
            .macro_imports
            .get(local_name)
            .is_some_and(|imported| expected.contains(&imported.imported_name.as_str()))
        {
            self.macro_offset = Some(offset);
        }
    }
}

impl<'a> Visit<'a> for EagerParameterMacroVisitor<'_> {
    fn enter_node(&mut self, kind: AstKind<'a>) {
        if matches!(
            kind,
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            self.function_depth += 1;
        }
    }

    fn leave_node(&mut self, kind: AstKind<'a>) {
        if matches!(
            kind,
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            self.function_depth = self.function_depth.saturating_sub(1);
        }
    }

    fn visit_tagged_template_expression(&mut self, it: &TaggedTemplateExpression<'a>) {
        if let Some(local_name) = identifier_name(&it.tag) {
            self.check(local_name, &["t"], it.span.start as usize);
        }
        if self.macro_offset.is_none() {
            walk::walk_tagged_template_expression(self, it);
        }
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if let Some(local_name) = identifier_name(&it.callee) {
            self.check(local_name, &EAGER_JS_MACROS, it.span.start as usize);
        }
        if self.macro_offset.is_none() {
            walk::walk_call_expression(self, it);
        }
    }

    fn visit_jsx_element(&mut self, it: &JSXElement<'a>) {
        if let Some(local_name) = it.opening_element.name.get_identifier_name() {
            self.check(
                local_name.as_str(),
                &EAGER_JSX_MACROS,
                it.span.start as usize,
            );
        }
        if self.macro_offset.is_none() {
            walk::walk_jsx_element(self, it);
        }
    }
}
