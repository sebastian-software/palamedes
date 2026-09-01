use oxc_ast::ast::{CallExpression, Expression, JSXElement, Program, TaggedTemplateExpression};
use oxc_ast::ast_kind::AstKind;
use oxc_ast_visit::{walk, Visit};
use oxc_span::GetSpan;

use crate::error::{PalamedesError, PalamedesResult};

const EAGER_JS_MACROS: [&str; 4] = ["t", "plural", "select", "selectOrdinal"];
const EAGER_JSX_MACROS: [&str; 3] = ["Plural", "Select", "SelectOrdinal"];

pub(crate) fn validate_translation_macro_scopes<'a, F, G>(
    program: &Program<'a>,
    filename: &str,
    source: &str,
    imported_macro_name: F,
    is_lowered_jsx_helper: G,
) -> PalamedesResult<()>
where
    F: Fn(&str, (u32, u32)) -> Option<String>,
    G: Fn(&str, (u32, u32)) -> bool,
{
    let mut validator = TranslationScopeValidator {
        filename,
        source,
        imported_macro_name: &imported_macro_name,
        is_lowered_jsx_helper: &is_lowered_jsx_helper,
        function_depth: 0,
        error: None,
    };
    validator.visit_program(program);

    match validator.error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

struct TranslationScopeValidator<'a, F, G> {
    filename: &'a str,
    source: &'a str,
    imported_macro_name: &'a F,
    is_lowered_jsx_helper: &'a G,
    function_depth: usize,
    error: Option<PalamedesError>,
}

impl<F, G> TranslationScopeValidator<'_, F, G>
where
    F: Fn(&str, (u32, u32)) -> Option<String>,
    G: Fn(&str, (u32, u32)) -> bool,
{
    fn validate_macro(
        &mut self,
        local_name: &str,
        span: (u32, u32),
        expected: &[&str],
        offset: usize,
    ) {
        if self.error.is_some() || self.function_depth > 0 {
            return;
        }

        let Some(macro_name) = (self.imported_macro_name)(local_name, span) else {
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

impl<'a, F, G> Visit<'a> for TranslationScopeValidator<'_, F, G>
where
    F: Fn(&str, (u32, u32)) -> Option<String>,
    G: Fn(&str, (u32, u32)) -> bool,
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
                (
                    it.opening_element.name.span().start,
                    it.opening_element.name.span().end,
                ),
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

        if let Some((local_name, span)) = identifier_name(&it.tag) {
            self.validate_macro(local_name, span, &["t"], it.span.start as usize);
        }

        if self.error.is_none() {
            walk::walk_tagged_template_expression(self, it);
        }
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if self.error.is_some() {
            return;
        }

        if let Some((local_name, span)) = identifier_name(&it.callee) {
            self.validate_macro(local_name, span, &EAGER_JS_MACROS, it.span.start as usize);
            if (self.is_lowered_jsx_helper)(local_name, span) {
                if let Some((macro_name, macro_span)) = it
                    .arguments
                    .first()
                    .and_then(|argument| argument.as_expression())
                    .and_then(identifier_name)
                {
                    self.validate_macro(
                        macro_name,
                        macro_span,
                        &EAGER_JSX_MACROS,
                        it.span.start as usize,
                    );
                }
            }
        }

        if self.error.is_none() {
            walk::walk_call_expression(self, it);
        }
    }
}

fn identifier_name<'a>(expression: &'a Expression<'a>) -> Option<(&'a str, (u32, u32))> {
    match expression.without_parentheses() {
        Expression::Identifier(identifier) => Some((
            identifier.name.as_str(),
            (identifier.span.start, identifier.span.end),
        )),
        _ => None,
    }
}

/// Formats a byte offset as a one-based filename, line, and Unicode-scalar column location.
pub(crate) fn source_location(source: &str, filename: &str, offset: usize) -> String {
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

    let column = source[line_start..offset].chars().count() + 1;

    format!("{filename}:{line}:{column}")
}

#[cfg(test)]
mod tests {
    use super::source_location;

    #[test]
    fn source_locations_use_unicode_scalar_columns() {
        let source = "const label = \"😀\"; t`Hello`";
        let offset = source.find("t`Hello`").expect("translation macro offset");

        assert_eq!(source_location(source, "view.tsx", offset), "view.tsx:1:20");
    }
}
