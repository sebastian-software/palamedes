use std::collections::{HashMap, HashSet};

use oxc_ast::ast::{
    CallExpression, Expression, JSXChild, JSXElement, JSXOpeningElement, TaggedTemplateExpression,
};
use oxc_ast_visit::{walk, Visit};
use oxc_semantic::Semantic;
use oxc_span::GetSpan;

use crate::error::PalamedesError;
use crate::source::{DiagnosticLocation, SourceLocator};

use super::imports::ImportCollector;
use super::runtime::{
    transform_choice_call, transform_choice_jsx_element, transform_descriptor_call,
    transform_lowered_choice_call, transform_lowered_trans_call, transform_tagged_template,
    transform_trans_element,
};
use super::{NativeTransformOptions, Replacement};
use oxc_syntax::symbol::SymbolId;

pub(super) struct TransformVisitor<'a> {
    filename: &'a str,
    source: &'a str,
    source_locator: SourceLocator<'a>,
    imports: &'a ImportCollector,
    options: &'a NativeTransformOptions,
    pub replacements: Vec<Replacement>,
    pub compiled_ids: Vec<String>,
    pub needs_runtime_import: bool,
    pub trans_imports: HashSet<(String, String)>,
    pub reused_trans_imports: HashSet<String>,
    trans_replacements: Vec<TransReplacement>,
    pub consumed_binding_ranges: Vec<(SymbolId, usize, usize)>,
    pub error: Option<PalamedesError>,
    jsx_child_element_spans: Vec<(usize, usize)>,
}

#[derive(Clone)]
struct TransReplacement {
    import_module: String,
    macro_symbol_id: SymbolId,
    reference_span: (u32, u32),
    replacement_index: usize,
    style: TransReplacementStyle,
}

#[derive(Clone, Copy)]
enum TransReplacementStyle {
    Identifier,
    Jsx,
}

impl<'a> TransformVisitor<'a> {
    pub(super) fn new(
        filename: &'a str,
        source: &'a str,
        imports: &'a ImportCollector,
        options: &'a NativeTransformOptions,
    ) -> Self {
        Self {
            filename,
            source,
            source_locator: SourceLocator::new(source),
            imports,
            options,
            replacements: Vec::new(),
            compiled_ids: Vec::new(),
            needs_runtime_import: false,
            trans_imports: HashSet::new(),
            reused_trans_imports: HashSet::new(),
            trans_replacements: Vec::new(),
            consumed_binding_ranges: Vec::new(),
            error: None,
            jsx_child_element_spans: Vec::new(),
        }
    }

    fn fail(&mut self, message: PalamedesError) {
        if self.error.is_none() {
            self.error = Some(message);
        }
    }

    fn push_compiled_id(&mut self, compiled_id: &str) {
        if !self
            .compiled_ids
            .iter()
            .any(|existing| existing == compiled_id)
        {
            self.compiled_ids.push(compiled_id.to_owned());
        }
    }

    fn fail_unsupported_macro(&mut self, macro_name: &str, start: usize) {
        let location = self.source_locator.indexed_location(self.filename, start);
        self.fail(PalamedesError::UnsupportedMacroSyntax {
            macro_name: macro_name.to_string(),
            location: location.format(),
            detail: "the macro could not be statically transformed; use a supported literal, template, descriptor, or choice shape".to_string(),
        });
    }

    fn record_consumed_binding(&mut self, symbol_id: SymbolId, start: usize, end: usize) {
        self.consumed_binding_ranges.push((symbol_id, start, end));
    }

    pub(super) fn rebind_surviving_trans(&mut self, semantic: &Semantic<'_>) {
        let mut aliases = HashMap::<SymbolId, String>::new();
        let mut reserved = self.imports.used_identifier_names.clone();
        for replacement in self.trans_replacements.clone() {
            let symbol_id = replacement.macro_symbol_id;
            let module = replacement.import_module;
            let replacement_index = replacement.replacement_index;
            let reference_span = replacement.reference_span;
            let reuses_trans_import =
                self.imports
                    .can_reuse_trans_import_at(semantic, &module, reference_span);
            let needs_alias = self.imports.has_surviving_reference(
                semantic,
                symbol_id,
                &self.consumed_binding_ranges,
            ) || (!reuses_trans_import
                && !self.imports.can_use_generated_trans_import_at(
                    semantic,
                    symbol_id,
                    reference_span,
                ));
            let local_name = if needs_alias {
                aliases
                    .entry(symbol_id)
                    .or_insert_with(|| unique_identifier("__palamedesTrans", &mut reserved))
                    .clone()
            } else {
                "Trans".to_string()
            };
            match replacement.style {
                TransReplacementStyle::Jsx if local_name != "Trans" => {
                    self.replacements[replacement_index].text = self.replacements
                        [replacement_index]
                        .text
                        .replacen("<Trans ", &format!("<{local_name} "), 1);
                }
                TransReplacementStyle::Identifier => {
                    self.replacements[replacement_index].text = self.replacements
                        [replacement_index]
                        .text
                        .replacen("__palamedesTrans", &local_name, 1);
                }
                TransReplacementStyle::Jsx => {}
            }
            if local_name == "Trans" && reuses_trans_import {
                self.reused_trans_imports.insert(module.clone());
            }
            self.trans_imports.insert((module, local_name));
        }
    }

    fn is_current_jsx_child_element(&self, element: &JSXElement<'_>) -> bool {
        self.jsx_child_element_spans
            .last()
            .is_some_and(|(start, end)| {
                *start == element.span.start as usize && *end == element.span.end as usize
            })
    }

    fn visit_preserved_attribute_macros(&mut self, children: &[JSXChild<'a>]) {
        for child in children {
            if self.error.is_some() {
                return;
            }

            match child {
                JSXChild::Element(element) => {
                    walk::walk_jsx_opening_element(self, &element.opening_element);
                    self.visit_preserved_attribute_macros(&element.children);
                }
                JSXChild::Fragment(fragment) => {
                    self.visit_preserved_attribute_macros(&fragment.children);
                }
                JSXChild::ExpressionContainer(container) => {
                    walk::walk_jsx_expression_container(self, container);
                }
                _ => {}
            }
        }
    }
}

impl<'a> Visit<'a> for TransformVisitor<'a> {
    fn visit_jsx_element(&mut self, it: &JSXElement<'a>) {
        if self.error.is_some() {
            return;
        }

        let Some(tag_name) = it.opening_element.name.get_identifier_name() else {
            walk::walk_jsx_element(self, it);
            return;
        };

        let Some((macro_info, macro_symbol_id)) = self.imports.macro_at(
            tag_name.as_str(),
            (
                it.opening_element.name.span().start,
                it.opening_element.name.span().end,
            ),
        ) else {
            walk::walk_jsx_element(self, it);
            return;
        };

        if matches!(
            macro_info.imported_name.as_str(),
            "Trans" | "Plural" | "Select" | "SelectOrdinal"
        ) {
            if let Some(nested_start) = nested_message_macro_in_children(&it.children, self.imports)
            {
                self.fail(PalamedesError::NestedMessageMacro {
                    location: self
                        .source_locator
                        .indexed_location(self.filename, nested_start)
                        .format(),
                });
                return;
            }
        }

        let attribute_replacement_start = self.replacements.len();
        if macro_info.imported_name == "Trans" {
            self.visit_preserved_attribute_macros(&it.children);
            if self.error.is_some() {
                return;
            }
        }
        let attribute_replacements = self.replacements.split_off(attribute_replacement_start);

        let replacement = match macro_info.imported_name.as_str() {
            "Trans" => transform_trans_element(
                it,
                self.source,
                macro_info
                    .source
                    .strip_suffix("/macro")
                    .unwrap_or("@palamedes/react"),
                &attribute_replacements,
                self.options,
            ),
            "Plural" | "Select" | "SelectOrdinal" => {
                let location = self
                    .source_locator
                    .indexed_location(self.filename, it.span.start as usize);
                transform_choice_jsx_element(
                    it,
                    self.source,
                    &macro_info.imported_name,
                    &location,
                    self.options,
                )
            }
            _ => Ok(None),
        };

        match replacement {
            Ok(Some((text, compiled_id))) => {
                let text = if macro_info.imported_name != "Trans"
                    && self.is_current_jsx_child_element(it)
                {
                    format!("{{{text}}}")
                } else {
                    text
                };
                self.replacements.push(Replacement {
                    start: it.span.start as usize,
                    end: it.span.end as usize,
                    text,
                });
                self.push_compiled_id(&compiled_id);
                self.record_consumed_binding(
                    macro_symbol_id,
                    it.span.start as usize,
                    it.span.end as usize,
                );

                if macro_info.imported_name == "Trans" {
                    if let Some(module) = macro_info.source.strip_suffix("/macro") {
                        self.trans_replacements.push(TransReplacement {
                            macro_symbol_id,
                            import_module: format!("{module}/compiled"),
                            replacement_index: self.replacements.len() - 1,
                            reference_span: (
                                it.opening_element.name.span().start,
                                it.opening_element.name.span().end,
                            ),
                            style: TransReplacementStyle::Jsx,
                        });
                    }
                } else {
                    self.needs_runtime_import = true;
                }
            }
            Ok(None) => {
                self.fail_unsupported_macro(&macro_info.imported_name, it.span.start as usize);
            }
            Err(error) => {
                self.fail(error);
            }
        }
    }

    fn visit_jsx_child(&mut self, it: &JSXChild<'a>) {
        if let JSXChild::Element(element) = it {
            self.jsx_child_element_spans
                .push((element.span.start as usize, element.span.end as usize));
            walk::walk_jsx_child(self, it);
            self.jsx_child_element_spans.pop();
        } else {
            walk::walk_jsx_child(self, it);
        }
    }

    fn visit_tagged_template_expression(&mut self, it: &TaggedTemplateExpression<'a>) {
        if self.error.is_some() {
            return;
        }

        let Some((local_name, tag_span)) = identifier_name_and_span(&it.tag) else {
            walk::walk_tagged_template_expression(self, it);
            return;
        };

        let Some((macro_info, macro_symbol_id)) = self.imports.macro_at(local_name, tag_span)
        else {
            walk::walk_tagged_template_expression(self, it);
            return;
        };

        if macro_info.imported_name != "t" {
            walk::walk_tagged_template_expression(self, it);
            return;
        }

        match transform_tagged_template(&it.quasi, self.source, self.options) {
            Ok(Some((text, compiled_id))) => {
                self.replacements.push(Replacement {
                    start: it.span.start as usize,
                    end: it.span.end as usize,
                    text,
                });
                self.push_compiled_id(&compiled_id);
                self.record_consumed_binding(
                    macro_symbol_id,
                    it.span.start as usize,
                    it.span.end as usize,
                );
                self.needs_runtime_import = true;
            }
            Ok(None) => {
                self.fail_unsupported_macro(&macro_info.imported_name, it.span.start as usize);
                return;
            }
            Err(error) => {
                self.fail(error);
                return;
            }
        }

        walk::walk_tagged_template_expression(self, it);
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if self.error.is_some() {
            return;
        }

        let Some((local_name, callee_span)) = identifier_name_and_span(&it.callee) else {
            walk::walk_call_expression(self, it);
            return;
        };

        if self.imports.remix_jsx_binding_at(local_name, callee_span)
            == Some(super::imports::RemixJsxBinding::Helper)
            && self.transform_lowered_jsx_macro(it)
        {
            return;
        }

        let Some((macro_info, macro_symbol_id)) = self.imports.macro_at(local_name, callee_span)
        else {
            walk::walk_call_expression(self, it);
            return;
        };
        let location = self
            .source_locator
            .indexed_location(self.filename, it.span.start as usize);

        match macro_info.imported_name.as_str() {
            "t" => {
                match transform_descriptor_call(
                    it,
                    self.source,
                    &macro_info.imported_name,
                    &location,
                    self.options,
                ) {
                    Ok(Some((text, compiled_id))) => {
                        self.replacements.push(Replacement {
                            start: it.span.start as usize,
                            end: it.span.end as usize,
                            text,
                        });
                        self.push_compiled_id(&compiled_id);
                        self.record_consumed_binding(
                            macro_symbol_id,
                            it.span.start as usize,
                            it.span.end as usize,
                        );
                        self.needs_runtime_import = true;
                    }
                    Ok(None) => {
                        self.fail_unsupported_macro(
                            &macro_info.imported_name,
                            it.span.start as usize,
                        );
                        return;
                    }
                    Err(error) => {
                        self.fail(error);
                        return;
                    }
                }
            }
            "plural" | "select" | "selectOrdinal" => {
                match transform_choice_call(
                    it,
                    self.source,
                    &macro_info.imported_name,
                    &location,
                    self.options,
                ) {
                    Ok(Some((text, compiled_id))) => {
                        self.replacements.push(Replacement {
                            start: it.span.start as usize,
                            end: it.span.end as usize,
                            text,
                        });
                        self.push_compiled_id(&compiled_id);
                        self.record_consumed_binding(
                            macro_symbol_id,
                            it.span.start as usize,
                            it.span.end as usize,
                        );
                        self.needs_runtime_import = true;
                    }
                    Ok(None) => {
                        self.fail_unsupported_macro(
                            &macro_info.imported_name,
                            it.span.start as usize,
                        );
                        return;
                    }
                    Err(error) => {
                        self.fail(error);
                        return;
                    }
                }
            }
            _ => {
                walk::walk_call_expression(self, it);
                return;
            }
        }

        walk::walk_call_expression(self, it);
    }
}

impl TransformVisitor<'_> {
    fn transform_lowered_jsx_macro(&mut self, call: &CallExpression<'_>) -> bool {
        let Some(element_type) = call
            .arguments
            .first()
            .and_then(|argument| argument.as_expression())
        else {
            return false;
        };
        let Some((local_name, reference_span)) = identifier_name_and_span(element_type) else {
            return false;
        };
        let Some((macro_info, macro_symbol_id)) = self.imports.macro_at(local_name, reference_span)
        else {
            return false;
        };
        if !matches!(
            macro_info.imported_name.as_str(),
            "Trans" | "Plural" | "Select" | "SelectOrdinal"
        ) {
            return false;
        }

        let location = self
            .source_locator
            .indexed_location(self.filename, call.span.start as usize);
        let replacement = if macro_info.imported_name == "Trans" {
            transform_lowered_trans_call(
                call,
                self.source,
                self.imports,
                &macro_info.imported_name,
                &location,
                self.options,
            )
        } else {
            transform_lowered_choice_call(
                call,
                self.source,
                &macro_info.imported_name,
                &location,
                self.options,
            )
        };

        match replacement {
            Ok(Some((text, compiled_id))) => {
                self.replacements.push(Replacement {
                    start: call.span.start as usize,
                    end: call.span.end as usize,
                    text,
                });
                self.push_compiled_id(&compiled_id);
                self.record_consumed_binding(
                    macro_symbol_id,
                    call.span.start as usize,
                    call.span.end as usize,
                );
                if macro_info.imported_name == "Trans" {
                    if let Some(module) = macro_info.source.strip_suffix("/macro") {
                        self.trans_replacements.push(TransReplacement {
                            import_module: format!("{module}/compiled"),
                            macro_symbol_id,
                            reference_span,
                            replacement_index: self.replacements.len() - 1,
                            style: TransReplacementStyle::Identifier,
                        });
                    }
                } else {
                    self.needs_runtime_import = true;
                }
            }
            Ok(None) => {
                self.fail_unsupported_macro(&macro_info.imported_name, call.span.start as usize);
            }
            Err(error) => self.fail(error),
        }
        true
    }
}

fn nested_message_macro_in_children<'a>(
    children: &'a [JSXChild<'a>],
    imports: &ImportCollector,
) -> Option<usize> {
    NestedMessageMacroFinder::find_in_children(children, imports)
}

struct NestedMessageMacroFinder<'a> {
    imports: &'a ImportCollector,
    nested_start: Option<usize>,
}

impl<'a> NestedMessageMacroFinder<'a> {
    fn find_in_children(children: &[JSXChild<'a>], imports: &'a ImportCollector) -> Option<usize> {
        let mut finder = Self {
            imports,
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

        if is_jsx_message_macro(it, self.imports) {
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

fn is_jsx_message_macro(element: &JSXElement<'_>, imports: &ImportCollector) -> bool {
    let Some(tag_name) = element.opening_element.name.get_identifier_name() else {
        return false;
    };

    imports
        .macro_at(
            tag_name.as_str(),
            (
                element.opening_element.name.span().start,
                element.opening_element.name.span().end,
            ),
        )
        .is_some_and(|(macro_info, _)| {
            matches!(
                macro_info.imported_name.as_str(),
                "Trans" | "Plural" | "Select" | "SelectOrdinal"
            )
        })
}

fn identifier_name_and_span<'a>(expression: &'a Expression<'a>) -> Option<(&'a str, (u32, u32))> {
    match expression.without_parentheses() {
        Expression::Identifier(identifier) => Some((
            identifier.name.as_str(),
            (identifier.span.start, identifier.span.end),
        )),
        _ => None,
    }
}

fn unique_identifier(base: &str, reserved: &mut HashSet<String>) -> String {
    if reserved.insert(base.to_string()) {
        return base.to_string();
    }
    let mut counter = 2;
    loop {
        let candidate = format!("{base}{counter}");
        if reserved.insert(candidate.clone()) {
            return candidate;
        }
        counter += 1;
    }
}
