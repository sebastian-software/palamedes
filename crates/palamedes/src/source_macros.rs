use std::collections::HashMap;

use oxc_ast::ast::{
    CallExpression, Expression, ImportDeclaration, ImportDeclarationSpecifier, ImportOrExportKind,
};

use crate::error::PalamedesError;

pub(crate) const PALAMEDES_MACRO_PACKAGES: [&str; 4] = [
    "@palamedes/core/macro",
    "@palamedes/react/macro",
    "@palamedes/remix/macro",
    "@palamedes/solid/macro",
];

#[derive(Clone, Debug)]
pub(crate) struct ImportedMacro {
    pub(crate) imported_name: String,
    pub(crate) source: String,
}

/// Palamedes macro imports of one module, keyed by their local name.
pub(crate) type MacroImports = HashMap<String, ImportedMacro>;

/// The element-type identifier of a classic `createElement(Type, …)` or
/// `React.createElement(Type, …)` call, with its span.
///
/// Only JSX is a macro surface for the component macros. Passing one to
/// `createElement` keeps the import alive and renders the runtime stub, so
/// extraction and the transform reject the call by this shape.
pub(crate) fn create_element_type<'a>(
    call: &'a CallExpression<'a>,
) -> Option<(&'a str, (u32, u32))> {
    let is_create_element = match call.callee.without_parentheses() {
        Expression::Identifier(identifier) => identifier.name == "createElement",
        Expression::StaticMemberExpression(member) => member.property.name == "createElement",
        _ => false,
    };
    if !is_create_element {
        return None;
    }
    match call
        .arguments
        .first()?
        .as_expression()?
        .without_parentheses()
    {
        Expression::Identifier(identifier) => Some((
            identifier.name.as_str(),
            (identifier.span.start, identifier.span.end),
        )),
        _ => None,
    }
}

/// The located error for a component macro passed to `createElement`.
pub(crate) fn create_element_macro_error(macro_name: &str, location: String) -> PalamedesError {
    let function_macro = match macro_name {
        "Plural" => "plural",
        "Select" => "select",
        "SelectOrdinal" => "selectOrdinal",
        _ => "t",
    };
    PalamedesError::UnsupportedMacroSyntax {
        macro_name: macro_name.to_owned(),
        location,
        detail: format!(
            "`createElement({macro_name}, …)` is not a macro form, so the call would render the macro's runtime stub; write it as JSX (`<{macro_name} … />`) or use the `{function_macro}` function macro"
        ),
    }
}

pub(crate) fn record_macro_import_declaration(
    declaration: &ImportDeclaration<'_>,
    macro_imports: &mut HashMap<String, ImportedMacro>,
    removed_macro_import: &mut Option<(String, usize)>,
    macro_import_ranges: Option<&mut Vec<(usize, usize)>>,
) -> bool {
    let source = declaration.source.value.as_str();
    if !PALAMEDES_MACRO_PACKAGES.contains(&source) {
        return false;
    }

    if let Some(ranges) = macro_import_ranges {
        ranges.push((
            declaration.span.start as usize,
            declaration.span.end as usize,
        ));
    }

    if let Some(specifiers) = &declaration.specifiers {
        for specifier in specifiers {
            if let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier {
                if declaration.import_kind != ImportOrExportKind::Value
                    || specifier.import_kind != ImportOrExportKind::Value
                {
                    continue;
                }
                let imported_name = specifier.imported.name().to_string();
                if matches!(imported_name.as_str(), "msg" | "defineMessage")
                    && removed_macro_import.is_none()
                {
                    *removed_macro_import =
                        Some((imported_name.clone(), declaration.span.start as usize));
                }
                macro_imports.insert(
                    specifier.local.name.to_string(),
                    ImportedMacro {
                        imported_name,
                        source: source.to_string(),
                    },
                );
            }
        }
    }

    true
}
