use std::collections::{HashMap, HashSet};

pub(super) use crate::source_macros::ImportedMacro;
use crate::{source_macros::record_macro_import_declaration, transform::Replacement};
use oxc_ast::ast::{
    BindingIdentifier, IdentifierReference, ImportDeclaration, ImportDeclarationSpecifier,
    ImportOrExportKind, JSXIdentifier,
};
use oxc_ast_visit::{walk, Visit};
use oxc_semantic::Semantic;
use oxc_span::GetSpan;
use oxc_syntax::{scope::ScopeId, symbol::SymbolId};

pub(super) struct ImportCollector {
    runtime_module: String,
    runtime_import_name: String,
    pub macro_imports: HashMap<String, ImportedMacro>,
    macro_specifiers: Vec<MacroImportSpecifier>,
    reference_symbols: HashMap<(u32, u32), SymbolId>,
    reference_scopes: HashMap<(u32, u32), ScopeId>,
    pub removed_macro_import: Option<(String, usize)>,
    pub has_reusable_runtime_import: bool,
    /// Number of bindings that could shadow calls through the configured local name.
    pub runtime_import_binding_count: usize,
    /// All authored identifiers that a generated import alias must not capture.
    pub used_identifier_names: HashSet<String>,
    reusable_trans_import_symbols: HashMap<String, SymbolId>,
}

impl ImportCollector {
    pub(super) fn new(runtime_module: &str, runtime_import_name: &str) -> Self {
        Self {
            runtime_module: runtime_module.to_string(),
            runtime_import_name: runtime_import_name.to_string(),
            macro_imports: HashMap::new(),
            macro_specifiers: Vec::new(),
            reference_symbols: HashMap::new(),
            reference_scopes: HashMap::new(),
            removed_macro_import: None,
            has_reusable_runtime_import: false,
            runtime_import_binding_count: 0,
            used_identifier_names: HashSet::new(),
            reusable_trans_import_symbols: HashMap::new(),
        }
    }

    /// Resolve macro references from the same native OXC semantic analysis used
    /// for transform decisions. Missing facts intentionally make a binding
    /// ineligible for removal.
    pub(super) fn resolve_macro_references(&mut self, semantic: &Semantic<'_>) {
        for specifier in &self.macro_specifiers {
            let Some(symbol_id) = specifier.symbol_id else {
                continue;
            };
            for reference in semantic.scoping().get_resolved_references(symbol_id) {
                let span = semantic.nodes().get_node(reference.node_id()).span();
                self.reference_symbols
                    .insert((span.start, span.end), symbol_id);
                self.reference_scopes
                    .insert((span.start, span.end), reference.scope_id());
            }
        }
    }

    /// Returns a macro only if this exact use resolves to its imported binding.
    pub(super) fn macro_at(
        &self,
        local_name: &str,
        span: (u32, u32),
    ) -> Option<(ImportedMacro, SymbolId)> {
        let macro_info = self.macro_imports.get(local_name)?;
        let symbol_id = *self.reference_symbols.get(&span)?;
        self.macro_specifiers
            .iter()
            .any(|specifier| {
                specifier.local_name == local_name && specifier.symbol_id == Some(symbol_id)
            })
            .then(|| (macro_info.clone(), symbol_id))
    }

    pub(super) fn macro_import_cleanup_replacements(
        &self,
        source: &str,
        semantic: &Semantic<'_>,
        consumed_binding_ranges: &[(SymbolId, usize, usize)],
    ) -> Vec<Replacement> {
        let mut removable = HashSet::new();
        for (index, specifier) in self.macro_specifiers.iter().enumerate() {
            let Some(symbol_id) = specifier.symbol_id else {
                continue;
            };
            let all_references_consumed = semantic
                .scoping()
                .get_resolved_references(symbol_id)
                .all(|reference| {
                    let span = semantic.nodes().get_node(reference.node_id()).span();
                    consumed_binding_ranges
                        .iter()
                        .any(|(consumed_symbol, start, end)| {
                            *consumed_symbol == symbol_id
                                && *start <= span.start as usize
                                && span.end as usize <= *end
                        })
                });
            if all_references_consumed {
                removable.insert(index);
            }
        }

        let mut replacements = Vec::new();
        let mut declarations = HashMap::<(usize, usize), Vec<usize>>::new();
        for index in removable {
            let specifier = &self.macro_specifiers[index];
            declarations
                .entry(specifier.declaration_range)
                .or_default()
                .push(index);
        }

        for (declaration_range, removed) in declarations {
            let all_macro_specifiers = self
                .macro_specifiers
                .iter()
                .filter(|specifier| specifier.declaration_range == declaration_range)
                .count();
            if removed.len() == all_macro_specifiers
                && all_macro_specifiers == declaration_specifier_count(source, declaration_range)
            {
                replacements.push(Replacement {
                    start: declaration_range.0,
                    end: declaration_range.1,
                    text: String::new(),
                });
                continue;
            }

            for index in removed {
                let specifier = &self.macro_specifiers[index];
                if let Some((start, end)) =
                    removable_specifier_range(source, declaration_range, specifier.specifier_range)
                {
                    replacements.push(Replacement {
                        start,
                        end,
                        text: String::new(),
                    });
                }
            }
        }

        replacements
    }

    pub(super) fn has_surviving_reference(
        &self,
        semantic: &Semantic<'_>,
        symbol_id: SymbolId,
        consumed_binding_ranges: &[(SymbolId, usize, usize)],
    ) -> bool {
        semantic
            .scoping()
            .get_resolved_references(symbol_id)
            .any(|reference| {
                let span = semantic.nodes().get_node(reference.node_id()).span();
                !consumed_binding_ranges
                    .iter()
                    .any(|(consumed_symbol, start, end)| {
                        *consumed_symbol == symbol_id
                            && *start <= span.start as usize
                            && span.end as usize <= *end
                    })
            })
    }

    pub(super) fn can_reuse_trans_import_at(
        &self,
        semantic: &Semantic<'_>,
        module: &str,
        reference_span: (u32, u32),
    ) -> bool {
        let Some(&import_symbol) = self.reusable_trans_import_symbols.get(module) else {
            return false;
        };
        let Some(&scope_id) = self.reference_scopes.get(&reference_span) else {
            return false;
        };

        semantic.scoping().find_binding(scope_id, "Trans".into()) == Some(import_symbol)
    }

    pub(super) fn can_use_generated_trans_import_at(
        &self,
        semantic: &Semantic<'_>,
        macro_symbol: SymbolId,
        reference_span: (u32, u32),
    ) -> bool {
        let Some(&scope_id) = self.reference_scopes.get(&reference_span) else {
            return false;
        };

        semantic
            .scoping()
            .find_binding(scope_id, "Trans".into())
            .is_none_or(|symbol_id| symbol_id == macro_symbol)
    }
}

#[derive(Debug)]
struct MacroImportSpecifier {
    local_name: String,
    symbol_id: Option<SymbolId>,
    declaration_range: (usize, usize),
    specifier_range: (usize, usize),
}

fn declaration_specifier_count(source: &str, declaration_range: (usize, usize)) -> usize {
    let declaration = &source[declaration_range.0..declaration_range.1];
    let Some(brace_start) = declaration.find('{') else {
        return usize::MAX;
    };
    if !declaration["import".len()..brace_start].trim().is_empty() {
        return usize::MAX;
    }
    if declaration.contains("/*")
        || declaration.contains("//")
        || declaration.contains('*')
        || declaration.contains("import type")
        || declaration.contains("{ type ")
    {
        return usize::MAX;
    }
    declaration
        .get(brace_start + 1..)
        .and_then(|rest| rest.split('}').next())
        .map(|specifiers| {
            specifiers
                .split(',')
                .filter(|specifier| !specifier.trim().is_empty())
                .count()
        })
        .unwrap_or(usize::MAX)
}

fn removable_specifier_range(
    source: &str,
    declaration_range: (usize, usize),
    specifier_range: (usize, usize),
) -> Option<(usize, usize)> {
    let mut after = specifier_range.1;
    while after < declaration_range.1 && source.as_bytes()[after].is_ascii_whitespace() {
        after += 1;
    }
    if source.as_bytes().get(after) == Some(&b',') {
        return Some((specifier_range.0, after + 1));
    }

    let mut before = specifier_range.0;
    while before > declaration_range.0 && source.as_bytes()[before - 1].is_ascii_whitespace() {
        before -= 1;
    }
    if before > declaration_range.0 && source.as_bytes()[before - 1] == b',' {
        return Some((before - 1, specifier_range.1));
    }

    None
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
        let is_macro_import = record_macro_import_declaration(
            it,
            &mut self.macro_imports,
            &mut self.removed_macro_import,
            None,
        );

        if is_macro_import && it.import_kind == ImportOrExportKind::Value {
            if let Some(specifiers) = &it.specifiers {
                for specifier in specifiers {
                    if let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier {
                        if specifier.import_kind == ImportOrExportKind::Value {
                            self.macro_specifiers.push(MacroImportSpecifier {
                                local_name: specifier.local.name.to_string(),
                                symbol_id: specifier.local.symbol_id.get(),
                                declaration_range: (it.span.start as usize, it.span.end as usize),
                                specifier_range: (
                                    specifier.span.start as usize,
                                    specifier.span.end as usize,
                                ),
                            });
                        }
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
            "@palamedes/react/compiled" | "@palamedes/solid/compiled"
        ) && it.import_kind == ImportOrExportKind::Value
        {
            if let Some(specifiers) = &it.specifiers {
                for specifier in specifiers {
                    if let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier {
                        if specifier.import_kind == ImportOrExportKind::Value
                            && specifier.imported.name() == "Trans"
                            && specifier.local.name == "Trans"
                        {
                            if let Some(symbol_id) = specifier.local.symbol_id.get() {
                                self.reusable_trans_import_symbols
                                    .insert(source.to_string(), symbol_id);
                            }
                        }
                    }
                }
            }
        }

        walk::walk_import_declaration(self, it);
    }
}
