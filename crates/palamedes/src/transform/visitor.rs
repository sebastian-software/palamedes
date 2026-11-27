use std::collections::{HashMap, HashSet};

use oxc_ast::ast::{
    Argument, CallExpression, Expression, JSXAttributeItem, JSXAttributeValue, JSXChild,
    JSXElement, JSXOpeningElement, ObjectPropertyKind, TaggedTemplateExpression,
};
use oxc_ast_visit::{Visit, walk};
use oxc_semantic::Semantic;
use oxc_span::GetSpan;

use crate::error::PalamedesError;
use crate::source::{DiagnosticLocation, SourceLocator};
use crate::source_macros::{create_element_macro_error, create_element_type};

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

    fn fail_nested_macro_in_value(
        &mut self,
        outer_macro: &str,
        nested_macro: &str,
        nested_start: usize,
    ) {
        let location = self
            .source_locator
            .indexed_location(self.filename, nested_start);
        self.fail(PalamedesError::UnsupportedMacroSyntax {
            macro_name: outer_macro.to_string(),
            location: location.format(),
            detail: format!(
                "nested `{nested_macro}` macro inside a value expression cannot be transformed; extract it into a variable before passing it or write complete messages in each branch"
            ),
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
        ) && let Some(nested_start) =
            nested_message_macro_in_children(&it.children, self.imports)
        {
            self.fail(PalamedesError::NestedMessageMacro {
                location: self
                    .source_locator
                    .indexed_location(self.filename, nested_start)
                    .format(),
                branch: None,
            });
            return;
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
                &self.imports.macro_imports,
                macro_info
                    .source
                    .strip_suffix("/macro")
                    .unwrap_or("@palamedes/react"),
                &attribute_replacements,
                &self
                    .source_locator
                    .indexed_location(self.filename, it.span.start as usize),
                self.options,
            ),
            "Plural" | "Select" | "SelectOrdinal" => {
                let location = self
                    .source_locator
                    .indexed_location(self.filename, it.span.start as usize);
                transform_choice_jsx_element(
                    it,
                    self.source,
                    &self.imports.macro_imports,
                    &macro_info.imported_name,
                    &location,
                    self.options,
                )
            }
            _ => Ok(None),
        };

        match replacement {
            Ok(Some((text, compiled_id))) => {
                let nested = if macro_info.imported_name == "Trans" {
                    nested_macro_use_in_trans_expressions(&it.children, self.imports)
                } else {
                    nested_macro_use_in_choice_jsx_attributes(
                        &it.opening_element.attributes,
                        self.imports,
                    )
                };
                if let Some((nested_macro, nested_start)) = nested {
                    self.fail_nested_macro_in_value(
                        &macro_info.imported_name,
                        &nested_macro,
                        nested_start,
                    );
                    return;
                }
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

        let location = self
            .source_locator
            .indexed_location(self.filename, it.span.start as usize);
        match transform_tagged_template(
            &it.quasi,
            self.source,
            &self.imports.macro_imports,
            &location,
            self.options,
        ) {
            Ok(Some((text, compiled_id))) => {
                if let Some((nested_macro, nested_start)) =
                    nested_macro_use_in_expressions(&it.quasi.expressions, self.imports)
                {
                    self.fail_nested_macro_in_value(
                        &macro_info.imported_name,
                        &nested_macro,
                        nested_start,
                    );
                    return;
                }
                self.replacements.push(Replacement {
                    start: it.span.start as usize,
                    end: it.span.end as usize,
                    text,
                });
                self.push_compiled_id(&compiled_id);
                self.record_consumed_binding(
                    macro_symbol_id,
                    tag_span.0 as usize,
                    tag_span.1 as usize,
                );
                self.needs_runtime_import = true;
            }
            Ok(None) => {
                self.fail_unsupported_macro(&macro_info.imported_name, it.span.start as usize);
            }
            Err(error) => {
                self.fail(error);
            }
        }
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if self.error.is_some() {
            return;
        }

        if let Some((type_name, type_span)) = create_element_type(it)
            && let Some((macro_info, _)) = self.imports.macro_at(type_name, type_span)
            && matches!(
                macro_info.imported_name.as_str(),
                "Trans" | "Plural" | "Select" | "SelectOrdinal"
            )
        {
            let location = self
                .source_locator
                .indexed_location(self.filename, it.span.start as usize)
                .format();
            self.fail(create_element_macro_error(
                &macro_info.imported_name,
                location,
            ));
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
                    &self.imports.macro_imports,
                    &macro_info.imported_name,
                    &location,
                    self.options,
                ) {
                    Ok(Some((text, compiled_id))) => {
                        if let Some((nested_macro, nested_start)) =
                            nested_macro_use_in_descriptor_call(it, self.imports)
                        {
                            self.fail_nested_macro_in_value(
                                &macro_info.imported_name,
                                &nested_macro,
                                nested_start,
                            );
                            return;
                        }
                        self.replacements.push(Replacement {
                            start: it.span.start as usize,
                            end: it.span.end as usize,
                            text,
                        });
                        self.push_compiled_id(&compiled_id);
                        self.record_consumed_binding(
                            macro_symbol_id,
                            callee_span.0 as usize,
                            callee_span.1 as usize,
                        );
                        self.needs_runtime_import = true;
                    }
                    Ok(None) => {
                        self.fail_unsupported_macro(
                            &macro_info.imported_name,
                            it.span.start as usize,
                        );
                    }
                    Err(error) => {
                        self.fail(error);
                    }
                }
            }
            "plural" | "select" | "selectOrdinal" => {
                match transform_choice_call(
                    it,
                    self.source,
                    &self.imports.macro_imports,
                    &macro_info.imported_name,
                    &location,
                    self.options,
                ) {
                    Ok(Some((text, compiled_id))) => {
                        if let Some((nested_macro, nested_start)) =
                            nested_macro_use_in_choice_call(it, self.imports)
                        {
                            self.fail_nested_macro_in_value(
                                &macro_info.imported_name,
                                &nested_macro,
                                nested_start,
                            );
                            return;
                        }
                        self.replacements.push(Replacement {
                            start: it.span.start as usize,
                            end: it.span.end as usize,
                            text,
                        });
                        self.push_compiled_id(&compiled_id);
                        self.record_consumed_binding(
                            macro_symbol_id,
                            callee_span.0 as usize,
                            callee_span.1 as usize,
                        );
                        self.needs_runtime_import = true;
                    }
                    Ok(None) => {
                        self.fail_unsupported_macro(
                            &macro_info.imported_name,
                            it.span.start as usize,
                        );
                    }
                    Err(error) => {
                        self.fail(error);
                    }
                }
            }
            _ => {
                walk::walk_call_expression(self, it);
            }
        }
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
                &self.imports.macro_imports,
                &macro_info.imported_name,
                &location,
                self.options,
            )
        };

        match replacement {
            Ok(Some((text, compiled_id))) => {
                if macro_info.imported_name != "Trans"
                    && let Some((nested_macro, nested_start)) =
                        nested_macro_use_in_lowered_choice_call(call, self.imports)
                {
                    self.fail_nested_macro_in_value(
                        &macro_info.imported_name,
                        &nested_macro,
                        nested_start,
                    );
                    return true;
                }
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

fn nested_macro_use_in_expressions<'a>(
    expressions: &[Expression<'a>],
    imports: &ImportCollector,
) -> Option<(String, usize)> {
    let mut finder = NestedMacroUseFinder {
        imports,
        nested: None,
    };
    for expression in expressions {
        finder.visit_expression(expression);
        if finder.nested.is_some() {
            break;
        }
    }
    finder.nested
}

fn nested_macro_use_in_descriptor_call<'a>(
    call: &CallExpression<'a>,
    imports: &ImportCollector,
) -> Option<(String, usize)> {
    let mut finder = NestedMacroUseFinder {
        imports,
        nested: None,
    };
    if let Some(Argument::ObjectExpression(descriptor)) = call.arguments.first()
        && let Some(message) = crate::descriptor::descriptor_property_value(descriptor, "message")
        && let Expression::TemplateLiteral(template) = message.without_parentheses()
    {
        for expression in &template.expressions {
            finder.visit_expression(expression);
            if finder.nested.is_some() {
                return finder.nested;
            }
        }
    }
    if let Some(values) = call.arguments.get(1) {
        finder.visit_argument(values);
    }
    finder.nested
}

fn nested_macro_use_in_choice_call<'a>(
    call: &CallExpression<'a>,
    imports: &ImportCollector,
) -> Option<(String, usize)> {
    let mut finder = NestedMacroUseFinder {
        imports,
        nested: None,
    };
    for argument in call.arguments.iter().take(2) {
        finder.visit_argument(argument);
        if finder.nested.is_some() {
            break;
        }
    }
    finder.nested
}

fn nested_macro_use_in_lowered_choice_call<'a>(
    call: &CallExpression<'a>,
    imports: &ImportCollector,
) -> Option<(String, usize)> {
    let Some(Argument::ObjectExpression(props)) = call.arguments.get(1) else {
        return None;
    };
    let mut finder = NestedMacroUseFinder {
        imports,
        nested: None,
    };
    // Lowering selects the last `value` property via `descriptor_property_value`.
    if let Some(value) = crate::descriptor::descriptor_property_value(props, "value") {
        finder.visit_expression(value);
        if finder.nested.is_some() {
            return finder.nested;
        }
    }
    for property in &props.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            continue;
        };
        if let Some(key) = property.key.static_name()
            && matches!(
                key.as_ref(),
                "id" | "message" | "comment" | "context" | "value" | "children" | "key" | "offset"
            )
        {
            continue;
        }
        finder.visit_expression(&property.value);
        if finder.nested.is_some() {
            break;
        }
    }
    finder.nested
}

fn nested_macro_use_in_choice_jsx_attributes<'a>(
    attributes: &[JSXAttributeItem<'a>],
    imports: &ImportCollector,
) -> Option<(String, usize)> {
    let mut finder = NestedMacroUseFinder {
        imports,
        nested: None,
    };
    // Lowering selects the first `value` attribute whose value is an expression container.
    let mut checked_value = false;
    for attribute in attributes {
        if let Some(attr) = attribute.as_attribute() {
            let name = attr.name.get_identifier().name.as_str();
            if name == "value" {
                if !checked_value
                    && let Some(JSXAttributeValue::ExpressionContainer(container)) =
                        attr.value.as_ref()
                {
                    checked_value = true;
                    finder.visit_jsx_expression_container(container);
                    if finder.nested.is_some() {
                        break;
                    }
                }
                continue;
            }
            if matches!(
                name,
                "id" | "message" | "comment" | "context" | "key" | "offset"
            ) {
                continue;
            }
        }
        finder.visit_jsx_attribute_item(attribute);
        if finder.nested.is_some() {
            break;
        }
    }
    finder.nested
}

fn nested_macro_use_in_trans_expressions<'a>(
    children: &[JSXChild<'a>],
    imports: &ImportCollector,
) -> Option<(String, usize)> {
    let mut finder = NestedMacroUseFinder {
        imports,
        nested: None,
    };
    fn visit_children<'a>(children: &[JSXChild<'a>], finder: &mut NestedMacroUseFinder<'_>) {
        for child in children {
            if finder.nested.is_some() {
                return;
            }
            match child {
                JSXChild::ExpressionContainer(container) => {
                    finder.visit_jsx_expression_container(container);
                }
                JSXChild::Element(element) => {
                    visit_children(&element.children, finder);
                }
                JSXChild::Fragment(fragment) => {
                    visit_children(&fragment.children, finder);
                }
                _ => {}
            }
        }
    }
    visit_children(children, &mut finder);
    finder.nested
}

struct NestedMacroUseFinder<'a> {
    imports: &'a ImportCollector,
    nested: Option<(String, usize)>,
}

impl<'a> Visit<'a> for NestedMacroUseFinder<'_> {
    fn visit_tagged_template_expression(&mut self, it: &TaggedTemplateExpression<'a>) {
        if self.nested.is_some() {
            return;
        }
        if let Some((local_name, tag_span)) = identifier_name_and_span(&it.tag)
            && let Some((macro_info, _)) = self.imports.macro_at(local_name, tag_span)
            && macro_info.imported_name == "t"
        {
            self.nested = Some((macro_info.imported_name, it.span.start as usize));
            return;
        }
        walk::walk_tagged_template_expression(self, it);
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if self.nested.is_some() {
            return;
        }
        if let Some((type_name, type_span)) = create_element_type(it)
            && let Some((macro_info, _)) = self.imports.macro_at(type_name, type_span)
            && matches!(
                macro_info.imported_name.as_str(),
                "Trans" | "Plural" | "Select" | "SelectOrdinal"
            )
        {
            self.nested = Some((macro_info.imported_name, it.span.start as usize));
            return;
        }
        if let Some((local_name, callee_span)) = identifier_name_and_span(&it.callee) {
            if self.imports.remix_jsx_binding_at(local_name, callee_span)
                == Some(super::imports::RemixJsxBinding::Helper)
                && let Some(element_type) = it.arguments.first().and_then(Argument::as_expression)
                && let Some((element_name, element_span)) = identifier_name_and_span(element_type)
                && let Some((macro_info, _)) = self.imports.macro_at(element_name, element_span)
                && matches!(
                    macro_info.imported_name.as_str(),
                    "Trans" | "Plural" | "Select" | "SelectOrdinal"
                )
            {
                self.nested = Some((macro_info.imported_name, it.span.start as usize));
                return;
            }
            if let Some((macro_info, _)) = self.imports.macro_at(local_name, callee_span)
                && matches!(
                    macro_info.imported_name.as_str(),
                    "t" | "plural" | "select" | "selectOrdinal"
                )
            {
                self.nested = Some((macro_info.imported_name, it.span.start as usize));
                return;
            }
        }
        walk::walk_call_expression(self, it);
    }

    fn visit_jsx_element(&mut self, it: &JSXElement<'a>) {
        if self.nested.is_some() {
            return;
        }
        if let Some(tag_name) = it.opening_element.name.get_identifier_name()
            && let Some((macro_info, _)) = self.imports.macro_at(
                tag_name.as_str(),
                (
                    it.opening_element.name.span().start,
                    it.opening_element.name.span().end,
                ),
            )
            && matches!(
                macro_info.imported_name.as_str(),
                "Trans" | "Plural" | "Select" | "SelectOrdinal"
            )
        {
            self.nested = Some((macro_info.imported_name, it.span.start as usize));
            return;
        }
        walk::walk_jsx_element(self, it);
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
