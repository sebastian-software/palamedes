mod imports;
mod messages;
mod runtime;
mod visitor;

#[cfg(test)]
mod tests;

use std::fmt::Write as _;

use oxc_allocator::Allocator;
use oxc_ast_visit::Visit;
use oxc_parser::Parser;
use oxc_span::SourceType;
use serde::{Deserialize, Serialize};

use crate::error::{PalamedesError, PalamedesResult};

use self::imports::ImportCollector;
use self::visitor::{Replacement, TransformVisitor};

/// Options controlling how macro transforms emit runtime code.
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub struct NativeTransformOptions {
    /// Runtime module path used for injected imports.
    #[serde(rename = "runtimeModule")]
    pub runtime_module: Option<String>,
    /// Named runtime import used for generated calls.
    #[serde(rename = "runtimeImportName")]
    pub runtime_import_name: Option<String>,
    /// Removes non-essential descriptor fields such as comments and context.
    #[serde(rename = "stripNonEssentialProps")]
    pub strip_non_essential_props: Option<bool>,
    /// Removes emitted source messages from descriptors when possible.
    #[serde(rename = "stripMessageField")]
    pub strip_message_field: Option<bool>,
}

/// A textual source replacement applied by the transformer.
#[derive(Debug, Deserialize, Serialize)]
pub struct NativeTransformEdit {
    /// Start byte offset of the replacement.
    pub start: usize,
    /// End byte offset of the replacement.
    pub end: usize,
    /// Replacement text.
    pub text: String,
}

/// Result of transforming a module containing Palamedes macros.
#[derive(Debug, Deserialize, Serialize)]
pub struct NativeTransformResult {
    /// Final transformed module source.
    pub code: String,
    /// Whether the transform changed the module.
    #[serde(rename = "hasChanged")]
    pub has_changed: bool,
    /// Compiled runtime IDs referenced by the transformed module.
    #[serde(rename = "compiledIds", default, skip_serializing_if = "Vec::is_empty")]
    pub compiled_ids: Vec<String>,
    /// Applied source edits in descending order.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub edits: Vec<NativeTransformEdit>,
    /// Prepended import block, if emitted separately.
    #[serde(rename = "prependText", skip_serializing_if = "Option::is_none")]
    pub prepend_text: Option<String>,
}

/// Transforms Palamedes macros into Palamedes runtime calls.
///
/// # Errors
///
/// Returns an error when the source cannot be parsed or when the module uses
/// unsupported author-facing explicit message IDs.
pub fn transform_macros(
    source: &str,
    filename: &str,
    options: Option<NativeTransformOptions>,
) -> PalamedesResult<NativeTransformResult> {
    let options = options.unwrap_or_default();

    let runtime_module = options
        .runtime_module
        .clone()
        .unwrap_or_else(|| "@palamedes/runtime".to_string());
    let runtime_import_name = options
        .runtime_import_name
        .clone()
        .unwrap_or_else(|| "getI18n".to_string());

    let allocator = Allocator::default();
    let source_type = SourceType::from_path(filename).unwrap_or_else(|_| SourceType::tsx());
    let parsed = Parser::new(&allocator, source, source_type).parse();

    if !parsed.errors.is_empty() {
        let messages = parsed
            .errors
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(", ");
        return Err(PalamedesError::ParseModuleSource {
            filename: filename.to_owned(),
            messages,
        });
    }

    let mut collector = ImportCollector::new(&runtime_module, &runtime_import_name);
    collector.visit_program(&parsed.program);

    if collector.macro_imports.is_empty() {
        return Ok(unchanged_result(source));
    }

    let mut visitor = TransformVisitor::new(source, &collector.macro_imports, &options);
    visitor.visit_program(&parsed.program);

    if let Some(error) = visitor.error {
        return Err(error);
    }

    if visitor.replacements.is_empty() {
        return Ok(unchanged_result(source));
    }

    let mut replacements = visitor.replacements;
    for (start, end) in collector.macro_import_ranges {
        replacements.push(Replacement {
            start,
            end,
            text: String::new(),
        });
    }

    if replacements.is_empty() {
        return Ok(unchanged_result(source));
    }

    let mut code = source.to_string();
    let mut prefix = String::new();

    if visitor.needs_runtime_import && !collector.has_runtime_import {
        let _ = writeln!(
            prefix,
            "import {{ {runtime_import_name} }} from \"{runtime_module}\";"
        );
    }

    if visitor.needs_trans_import && !collector.has_trans_import {
        prefix.push_str("import { Trans } from \"@palamedes/react\";\n");
    }

    if !prefix.is_empty() {
        let insertion_offset = import_insertion_offset(&parsed.program);
        let prefix = if insertion_offset == 0 {
            prefix
        } else {
            format!("\n{prefix}")
        };

        replacements.push(Replacement {
            start: insertion_offset,
            end: insertion_offset,
            text: prefix,
        });
    }

    replacements.sort_by(|a, b| b.start.cmp(&a.start).then(b.end.cmp(&a.end)));
    let edits = replacements
        .iter()
        .map(|replacement| NativeTransformEdit {
            start: replacement.start,
            end: replacement.end,
            text: replacement.text.clone(),
        })
        .collect::<Vec<_>>();

    for replacement in &replacements {
        code.replace_range(replacement.start..replacement.end, &replacement.text);
    }

    Ok(NativeTransformResult {
        has_changed: code != source,
        code,
        compiled_ids: visitor.compiled_ids,
        edits,
        prepend_text: None,
    })
}

fn import_insertion_offset(program: &oxc_ast::ast::Program<'_>) -> usize {
    if let Some(directive) = program.directives.last() {
        directive.span.end as usize
    } else if let Some(hashbang) = &program.hashbang {
        hashbang.span.end as usize
    } else {
        0
    }
}

fn unchanged_result(source: &str) -> NativeTransformResult {
    NativeTransformResult {
        code: source.to_owned(),
        has_changed: false,
        compiled_ids: Vec::new(),
        edits: Vec::new(),
        prepend_text: None,
    }
}
