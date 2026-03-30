use std::collections::{HashMap, HashSet};

use oxc_ast::ast::{CallExpression, JSXElement, TaggedTemplateExpression};
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
    source: &'a str,
    macro_imports: &'a HashMap<String, ImportedMacro>,
    options: &'a NativeTransformOptions,
    pub replacements: Vec<Replacement>,
    pub compiled_ids: Vec<String>,
    pub needs_runtime_import: bool,
    pub trans_import_modules: HashSet<String>,
    pub error: Option<PalamedesError>,
}

impl<'a> TransformVisitor<'a> {
    pub(super) fn new(
        source: &'a str,
        macro_imports: &'a HashMap<String, ImportedMacro>,
        options: &'a NativeTransformOptions,
    ) -> Self {
        Self {
            source,
            macro_imports,
            options,
            replacements: Vec::new(),
            compiled_ids: Vec::new(),
            needs_runtime_import: false,
            trans_import_modules: HashSet::new(),
            error: None,
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

        let replacement = match macro_info.imported_name.as_str() {
            "Trans" => transform_trans_element(
                it,
                self.source,
                macro_info
                    .source
                    .strip_suffix("/macro")
                    .unwrap_or("@palamedes/react"),
            ),
            "Plural" | "Select" | "SelectOrdinal" => {
                transform_choice_jsx_element(
                    it,
                    self.source,
                    &macro_info.imported_name,
                    self.options,
                )
            }
            _ => Ok(None),
        };

        match replacement {
            Ok(Some((text, compiled_id))) => {
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

        if let Some((text, compiled_id)) =
            transform_tagged_template(&it.quasi, self.source, self.options)
        {
            self.replacements.push(Replacement {
                start: it.span.start as usize,
                end: it.span.end as usize,
                text,
            });
            self.push_compiled_id(&compiled_id);
            self.needs_runtime_import = true;
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
                match transform_descriptor_call(it, &macro_info.imported_name, self.options) {
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
                if let Some((text, compiled_id)) =
                    transform_choice_call(it, self.source, &macro_info.imported_name, self.options)
                {
                    self.replacements.push(Replacement {
                        start: it.span.start as usize,
                        end: it.span.end as usize,
                        text,
                    });
                    self.push_compiled_id(&compiled_id);
                    self.needs_runtime_import = true;
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
