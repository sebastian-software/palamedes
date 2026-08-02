use std::collections::{HashMap, HashSet};

use oxc_ast::ast::{
    BindingIdentifier, IdentifierReference, ImportDeclaration, ImportDeclarationSpecifier,
    ImportOrExportKind, JSXIdentifier,
};
use oxc_ast_visit::{walk, Visit};

pub(super) const PALAMEDES_MACRO_PACKAGES: [&str; 3] = [
    "@palamedes/core/macro",
    "@palamedes/react/macro",
    "@palamedes/solid/macro",
];

#[derive(Debug, Clone)]
pub(super) struct ImportedMacro {
    pub imported_name: String,
    pub source: String,
}

pub(super) struct ImportCollector {
    runtime_module: String,
    runtime_import_name: String,
    pub macro_imports: HashMap<String, ImportedMacro>,
    pub macro_import_ranges: Vec<(usize, usize)>,
    pub removed_macro_import: Option<(String, usize)>,
    pub has_reusable_runtime_import: bool,
    /// Number of bindings that could shadow calls through the configured local name.
    pub runtime_import_binding_count: usize,
    /// All authored identifiers that a generated import alias must not capture.
    pub used_identifier_names: HashSet<String>,
    pub trans_import_sources: HashSet<String>,
}

impl ImportCollector {
    pub(super) fn new(runtime_module: &str, runtime_import_name: &str) -> Self {
        Self {
            runtime_module: runtime_module.to_string(),
            runtime_import_name: runtime_import_name.to_string(),
            macro_imports: HashMap::new(),
            macro_import_ranges: Vec::new(),
            removed_macro_import: None,
            has_reusable_runtime_import: false,
            runtime_import_binding_count: 0,
            used_identifier_names: HashSet::new(),
            trans_import_sources: HashSet::new(),
        }
    }
}

impl<'a> Visit<'a> for ImportCollector {
    fn visit_binding_identifier(&mut self, it: &BindingIdentifier<'a>) {
        let name = it.name.to_string();
        if name == self.runtime_import_name {
            self.runtime_import_binding_count += 1;
        }
        self.used_identifier_names.insert(name);
        walk::walk_binding_identifier(self, it);
    }

    fn visit_identifier_reference(&mut self, it: &IdentifierReference<'a>) {
        self.used_identifier_names.insert(it.name.to_string());
        walk::walk_identifier_reference(self, it);
    }

    fn visit_jsx_identifier(&mut self, it: &JSXIdentifier<'a>) {
        self.used_identifier_names.insert(it.name.to_string());
        walk::walk_jsx_identifier(self, it);
    }

    fn visit_import_declaration(&mut self, it: &ImportDeclaration<'a>) {
        let source = it.source.value.as_str();

        if PALAMEDES_MACRO_PACKAGES.contains(&source) {
            self.macro_import_ranges
                .push((it.span.start as usize, it.span.end as usize));

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
                        self.macro_imports.insert(
                            specifier.local.name.to_string(),
                            ImportedMacro {
                                imported_name,
                                source: source.to_string(),
                            },
                        );
                    }
                }
            }
        }

        if source == self.runtime_module && it.import_kind == ImportOrExportKind::Value {
            if let Some(specifiers) = &it.specifiers {
                for specifier in specifiers {
                    if let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier {
                        if specifier.import_kind == ImportOrExportKind::Value
                            && specifier.imported.name() == self.runtime_import_name.as_str()
                            && specifier.local.name == self.runtime_import_name.as_str()
                        {
                            self.has_reusable_runtime_import = true;
                        }
                    }
                }
            }
        }

        if matches!(
            source,
            "@palamedes/react"
                | "@palamedes/react/compiled"
                | "@palamedes/solid"
                | "@palamedes/solid/compiled"
        ) {
            if let Some(specifiers) = &it.specifiers {
                for specifier in specifiers {
                    if let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier {
                        if specifier.local.name == "Trans" {
                            self.trans_import_sources.insert(source.to_string());
                        }
                    }
                }
            }
        }

        walk::walk_import_declaration(self, it);
    }
}
