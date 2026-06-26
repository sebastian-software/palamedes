use std::collections::{HashMap, HashSet};

use oxc_ast::ast::{
    CallExpression, JSXChild, JSXElement, JSXOpeningElement, TaggedTemplateExpression,
};
use oxc_ast_visit::{walk, Visit};

use crate::error::PalamedesError;

use super::imports::ImportedMacro;
use super::messages::identifier_name;
use super::runtime::{
    transform_choice_call, transform_choice_jsx_element, transform_descriptor_call,
    transform_tagged_template, transform_trans_element,
};
use super::NativeTransformOptions;

#[derive(Debug, Clone)]
pub(super) struct Replacement {
    pub start: usize,
    pub end: usize,
    pub text: String,
}

pub(super) struct TransformVisitor<'a> {
    filename: &'a str,
    source: &'a str,
    macro_imports: &'a HashMap<String, ImportedMacro>,
    options: &'a NativeTransformOptions,
    pub replacements: Vec<Replacement>,
    pub compiled_ids: Vec<String>,
    pub needs_runtime_import: bool,
    pub trans_import_modules: HashSet<String>,
    pub error: Option<PalamedesError>,
    jsx_child_element_depth: usize,
}

impl<'a> TransformVisitor<'a> {
    pub(super) fn new(
        filename: &'a str,
        source: &'a str,
        macro_imports: &'a HashMap<String, ImportedMacro>,
        options: &'a NativeTransformOptions,
    ) -> Self {
        Self {
            filename,
            source,
            macro_imports,
            options,
            replacements: Vec::new(),
            compiled_ids: Vec::new(),
            needs_runtime_import: false,
            trans_import_modules: HashSet::new(),
            error: None,
            jsx_child_element_depth: 0,
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

        let Some(macro_info) = self.macro_imports.get(tag_name.as_str()) else {
            walk::walk_jsx_element(self, it);
            return;
        };

        if matches!(
            macro_info.imported_name.as_str(),
            "Trans" | "Plural" | "Select" | "SelectOrdinal"
        ) {
            if let Some(nested_start) =
                nested_message_macro_in_children(&it.children, self.macro_imports)
            {
                self.fail(PalamedesError::NestedMessageMacro {
                    location: source_location(self.source, self.filename, nested_start),
                });
                return;
            }
        }

        let replacement = match macro_info.imported_name.as_str() {
            "Trans" => transform_trans_element(
                it,
                self.source,
                macro_info
                    .source
                    .strip_suffix("/macro")
                    .unwrap_or("@palamedes/react"),
            ),
            "Plural" | "Select" | "SelectOrdinal" => transform_choice_jsx_element(
                it,
                self.source,
                &macro_info.imported_name,
                self.options,
            ),
            _ => Ok(None),
        };

        match replacement {
            Ok(Some((text, compiled_id))) => {
                let text =
                    if macro_info.imported_name != "Trans" && self.jsx_child_element_depth > 0 {
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

                if macro_info.imported_name == "Trans" {
                    if let Some(module) = macro_info.source.strip_suffix("/macro") {
                        self.trans_import_modules.insert(module.to_string());
                    }
                } else {
                    self.needs_runtime_import = true;
                }
                return;
            }
            Ok(None) => {}
            Err(error) => {
                self.fail(error);
                return;
            }
        }

        walk::walk_jsx_element(self, it);
    }

    fn visit_jsx_child(&mut self, it: &JSXChild<'a>) {
        if matches!(it, JSXChild::Element(_)) {
            self.jsx_child_element_depth += 1;
            walk::walk_jsx_child(self, it);
            self.jsx_child_element_depth -= 1;
        } else {
            walk::walk_jsx_child(self, it);
        }
    }

    fn visit_tagged_template_expression(&mut self, it: &TaggedTemplateExpression<'a>) {
        if self.error.is_some() {
            return;
        }

        let Some(local_name) = identifier_name(&it.tag) else {
            walk::walk_tagged_template_expression(self, it);
            return;
        };

        let Some(macro_info) = self.macro_imports.get(local_name) else {
            walk::walk_tagged_template_expression(self, it);
            return;
        };

        if !matches!(macro_info.imported_name.as_str(), "t" | "msg") {
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
                self.needs_runtime_import = true;
            }
            Ok(None) => {}
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

        let Some(local_name) = identifier_name(&it.callee) else {
            walk::walk_call_expression(self, it);
            return;
        };

        let Some(macro_info) = self.macro_imports.get(local_name) else {
            walk::walk_call_expression(self, it);
            return;
        };

        match macro_info.imported_name.as_str() {
            "t" | "msg" | "defineMessage" => {
                match transform_descriptor_call(
                    it,
                    self.source,
                    &macro_info.imported_name,
                    self.options,
                ) {
                    Ok(Some((text, compiled_id))) => {
                        self.replacements.push(Replacement {
                            start: it.span.start as usize,
                            end: it.span.end as usize,
                            text,
                        });
                        self.push_compiled_id(&compiled_id);
                        if macro_info.imported_name != "defineMessage" {
                            self.needs_runtime_import = true;
                        }
                    }
                    Ok(None) => {}
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
                    self.options,
                ) {
                    Ok(Some((text, compiled_id))) => {
                        self.replacements.push(Replacement {
                            start: it.span.start as usize,
                            end: it.span.end as usize,
                            text,
                        });
                        self.push_compiled_id(&compiled_id);
                        self.needs_runtime_import = true;
                    }
                    Ok(None) => {}
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

fn nested_message_macro_in_children<'a>(
    children: &'a [JSXChild<'a>],
    macro_imports: &HashMap<String, ImportedMacro>,
) -> Option<usize> {
    NestedMessageMacroFinder::find_in_children(children, macro_imports)
}

struct NestedMessageMacroFinder<'a> {
    macro_imports: &'a HashMap<String, ImportedMacro>,
    nested_start: Option<usize>,
}

impl<'a> NestedMessageMacroFinder<'a> {
    fn find_in_children(
        children: &[JSXChild<'a>],
        macro_imports: &'a HashMap<String, ImportedMacro>,
    ) -> Option<usize> {
        let mut finder = Self {
            macro_imports,
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

        if is_jsx_message_macro(it, self.macro_imports) {
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

fn is_jsx_message_macro(
    element: &JSXElement<'_>,
    macro_imports: &HashMap<String, ImportedMacro>,
) -> bool {
    let Some(tag_name) = element.opening_element.name.get_identifier_name() else {
        return false;
    };

    macro_imports
        .get(tag_name.as_str())
        .is_some_and(|macro_info| {
            matches!(
                macro_info.imported_name.as_str(),
                "Trans" | "Plural" | "Select" | "SelectOrdinal"
            )
        })
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
