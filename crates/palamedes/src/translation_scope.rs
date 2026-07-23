use oxc_ast::ast::{CallExpression, Expression, JSXElement, Program, TaggedTemplateExpression};
use oxc_ast::ast_kind::AstKind;
use oxc_ast_visit::{walk, Visit};

use crate::error::{PalamedesError, PalamedesResult};

const EAGER_JS_MACROS: [&str; 4] = ["t", "plural", "select", "selectOrdinal"];
const EAGER_JSX_MACROS: [&str; 3] = ["Plural", "Select", "SelectOrdinal"];

pub(crate) fn validate_translation_macro_scopes<'a, F>(
    program: &Program<'a>,
    filename: &str,
    source: &str,
    imported_macro_name: F,
) -> PalamedesResult<()>
where
    F: Fn(&str) -> Option<String>,
{
    let mut validator = TranslationScopeValidator {
        filename,
        source,
        imported_macro_name: &imported_macro_name,
        function_depth: 0,
        error: None,
    };
    validator.visit_program(program);

    match validator.error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

struct TranslationScopeValidator<'a, F> {
    filename: &'a str,
    source: &'a str,
    imported_macro_name: &'a F,
    function_depth: usize,
    error: Option<PalamedesError>,
}

impl<F> TranslationScopeValidator<'_, F>
where
    F: Fn(&str) -> Option<String>,
{
    fn validate_macro(&mut self, local_name: &str, expected: &[&str], offset: usize) {
        if self.error.is_some() || self.function_depth > 0 {
            return;
        }

        let Some(macro_name) = (self.imported_macro_name)(local_name) else {
            return;
        };
        if !expected.contains(&macro_name.as_str()) {
            return;
        }

        self.error = Some(PalamedesError::TranslationMacroOutsideFunction {
            macro_name,
            location: source_location(self.source, self.filename, offset),
        });
    }
}

impl<'a, F> Visit<'a> for TranslationScopeValidator<'_, F>
where
    F: Fn(&str) -> Option<String>,
{
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

    fn visit_jsx_element(&mut self, it: &JSXElement<'a>) {
        if self.error.is_some() {
            return;
        }

        if let Some(local_name) = it.opening_element.name.get_identifier_name() {
            self.validate_macro(
                local_name.as_str(),
                &EAGER_JSX_MACROS,
                it.span.start as usize,
            );
        }

        if self.error.is_none() {
            walk::walk_jsx_element(self, it);
        }
    }

    fn visit_tagged_template_expression(&mut self, it: &TaggedTemplateExpression<'a>) {
        if self.error.is_some() {
            return;
        }

        if let Some(local_name) = identifier_name(&it.tag) {
            self.validate_macro(local_name, &["t"], it.span.start as usize);
        }

        if self.error.is_none() {
            walk::walk_tagged_template_expression(self, it);
        }
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if self.error.is_some() {
            return;
        }

        if let Some(local_name) = identifier_name(&it.callee) {
            self.validate_macro(local_name, &EAGER_JS_MACROS, it.span.start as usize);
        }

        if self.error.is_none() {
            walk::walk_call_expression(self, it);
        }
    }
}

fn identifier_name<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    match expression.without_parentheses() {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        _ => None,
    }
}

fn source_location(source: &str, filename: &str, offset: usize) -> String {
    let mut line = 1usize;
    let mut line_start = 0usize;

    for (index, ch) in source.char_indices() {
        if index >= offset {
            break;
        }
        if ch == '\n' {
            line += 1;
            line_start = index + 1;
        }
    }

    let column = offset.saturating_sub(line_start) + 1;

    format!("{filename}:{line}:{column}")
}
