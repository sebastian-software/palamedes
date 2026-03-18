use std::collections::HashMap;

use oxc_ast::ast::{ImportDeclaration, ImportDeclarationSpecifier};
use oxc_ast_visit::{walk, Visit};

pub(super) const LINGUI_MACRO_PACKAGES: [&str; 3] =
    ["@lingui/macro", "@lingui/core/macro", "@lingui/react/macro"];

#[derive(Debug, Clone)]
pub(super) struct ImportedMacro {
    pub imported_name: String,
}

pub(super) struct ImportCollector {
    runtime_module: String,
    runtime_import_name: String,
    pub macro_imports: HashMap<String, ImportedMacro>,
    pub macro_import_ranges: Vec<(usize, usize)>,
    pub has_runtime_import: bool,
    pub has_trans_import: bool,
}

impl ImportCollector {
    pub(super) fn new(runtime_module: &str, runtime_import_name: &str) -> Self {
        Self {
            runtime_module: runtime_module.to_string(),
            runtime_import_name: runtime_import_name.to_string(),
            macro_imports: HashMap::new(),
            macro_import_ranges: Vec::new(),
            has_runtime_import: false,
            has_trans_import: false,
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

        if source == "@lingui/react" {
            if let Some(specifiers) = &it.specifiers {
                for specifier in specifiers {
                    if let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier {
                        if specifier.local.name == "Trans" {
                            self.has_trans_import = true;
                        }
                    }
                }
            }
        }

        walk::walk_import_declaration(self, it);
    }
}
