use std::collections::HashMap;

use oxc_ast::ast::{ImportDeclaration, ImportDeclarationSpecifier, ImportOrExportKind};

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
