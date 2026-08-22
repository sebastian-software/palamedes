mod imports;
mod messages;
mod runtime;
mod server_functions;
mod visitor;

#[cfg(test)]
mod tests;

use std::fmt::Write as _;

use oxc_allocator::Allocator;
use oxc_ast_visit::Visit;
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::SourceType;
use serde::{Deserialize, Serialize};
use string_wizard::{Hires, MagicString, SourceMapOptions};

use crate::error::{PalamedesError, PalamedesResult};
use crate::source::{display_filename, format_parser_diagnostics};
use crate::translation_scope::{source_location, validate_translation_macro_scopes};

use self::imports::ImportCollector;
use self::server_functions::{initializer_import, ServerFunctionTransform};
use self::visitor::TransformVisitor;

#[derive(Debug, Clone)]
pub(super) struct Replacement {
    pub start: usize,
    pub end: usize,
    pub text: String,
}

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
    /// Keeps source messages in generated runtime calls and rich-text props.
    ///
    /// The native transform itself strips source fallbacks by default (`None`
    /// resolves to `false`). First-party host adapters set this to `true` in
    /// every environment unless explicitly configured with
    /// `keepSourceFallbacks: false` for compact, hash-only output when bundle
    /// size or embedding authored source text is a concern.
    #[serde(rename = "keepSourceFallbacks")]
    pub keep_source_fallbacks: Option<bool>,
    /// Legacy inverse of `keep_source_fallbacks`.
    ///
    /// Explicit values remain supported for compatibility. New integrations
    /// should use the positive option instead.
    #[serde(rename = "stripMessageField")]
    pub strip_message_field: Option<bool>,
    /// Instruments recognized Server Functions with a request initializer.
    #[serde(rename = "serverFunctions")]
    pub server_functions: Option<ServerFunctionTransformOptions>,
}

/// Configuration for framework Server Function instrumentation.
#[derive(Debug, Deserialize)]
pub struct ServerFunctionTransformOptions {
    /// Module that exports the initializer.
    #[serde(rename = "initializerModule")]
    pub initializer_module: String,
    /// Named initializer export.
    #[serde(rename = "initializerExport")]
    pub initializer_export: String,
}

impl NativeTransformOptions {
    fn keep_source_fallbacks(&self) -> bool {
        self.keep_source_fallbacks
            .or_else(|| self.strip_message_field.map(|strip| !strip))
            .unwrap_or(false)
    }
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

/// A standard source map produced for a transformed module.
#[derive(Debug, Deserialize, Serialize)]
pub struct NativeTransformSourceMap {
    /// Source map version.
    pub version: u32,
    /// Original source filenames.
    pub sources: Vec<String>,
    /// Original source content, when embedded.
    #[serde(rename = "sourcesContent", skip_serializing_if = "Option::is_none")]
    pub sources_content: Option<Vec<Option<String>>>,
    /// Source map symbol names.
    pub names: Vec<String>,
    /// VLQ-encoded source map mappings.
    pub mappings: String,
    /// Generated filename.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
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
    /// Source map for transformed code.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub map: Option<NativeTransformSourceMap>,
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

    if let Some(server_functions) = &options.server_functions {
        if server_functions.initializer_module.is_empty()
            || !oxc_syntax::identifier::is_identifier_name(&server_functions.initializer_export)
        {
            return Err(PalamedesError::InvalidServerFunctionInitializer {
                initializer_module: server_functions.initializer_module.clone(),
                initializer_export: server_functions.initializer_export.clone(),
            });
        }
    }

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

    if !parsed.diagnostics.is_empty() {
        let filename = display_filename(filename).to_owned();
        return Err(PalamedesError::ParseModuleSource {
            messages: format_parser_diagnostics(source, &filename, &parsed.diagnostics),
            filename,
        });
    }

    let semantic = SemanticBuilder::new()
        .with_build_nodes(true)
        .build(&parsed.program)
        .semantic;

    let mut collector = ImportCollector::new(&runtime_module, &runtime_import_name);
    collector.visit_program(&parsed.program);
    collector.resolve_macro_references(&semantic);

    let runtime_import_name_is_unsafe = if collector.has_reusable_runtime_import {
        collector.runtime_import_binding_count > 1
    } else {
        collector
            .used_identifier_names
            .contains(&runtime_import_name)
    };
    let effective_runtime_import_name = if runtime_import_name_is_unsafe {
        unique_runtime_import_alias(&runtime_import_name, &collector.used_identifier_names)
    } else {
        runtime_import_name.clone()
    };
    let mut options = options;
    options.runtime_import_name = Some(effective_runtime_import_name.clone());

    if let Some((macro_name, offset)) = collector.removed_macro_import.as_ref() {
        return Err(PalamedesError::UnsupportedMacroSyntax {
            macro_name: macro_name.clone(),
            location: source_location(source, filename, *offset),
            detail: "this deferred message macro has been removed; translate at the point of use with `t`".to_string(),
        });
    }

    if collector.macro_imports.is_empty() && options.server_functions.is_none() {
        return Ok(unchanged_result(source));
    }

    if !collector.macro_imports.is_empty() {
        validate_translation_macro_scopes(
            &parsed.program,
            filename,
            source,
            |local_name, span| {
                collector
                    .macro_at(local_name, span)
                    .map(|(macro_info, _)| macro_info.imported_name)
            },
        )?;
    }

    let mut visitor = TransformVisitor::new(filename, source, &collector, &options);
    visitor.visit_program(&parsed.program);

    if let Some(error) = visitor.error {
        return Err(error);
    }
    visitor.rebind_surviving_trans(&semantic);

    let mut server_function_transform = options.server_functions.as_ref().map(|_| {
        ServerFunctionTransform::run(
            &parsed.program,
            source,
            filename,
            &collector.macro_imports,
            &collector.used_identifier_names,
        )
    });
    if let Some(error) = server_function_transform
        .as_mut()
        .and_then(|transform| transform.error.take())
    {
        return Err(error);
    }

    let mut replacements = visitor.replacements;
    if !replacements.is_empty() {
        replacements.extend(collector.macro_import_cleanup_replacements(
            source,
            &semantic,
            &visitor.consumed_binding_ranges,
        ));
    }
    if let Some(transform) = &server_function_transform {
        replacements.extend(transform.replacements.iter().cloned());
    }

    if replacements.is_empty() {
        return Ok(unchanged_result(source));
    }

    let mut prefix = String::new();

    if let (Some(server_options), Some(transform)) =
        (&options.server_functions, &server_function_transform)
    {
        if !transform.replacements.is_empty() {
            prefix.push_str(&initializer_import(
                server_options,
                &transform.initializer_alias,
            ));
        }
    }

    let needs_runtime_import = !collector.has_reusable_runtime_import
        || effective_runtime_import_name != runtime_import_name;
    if visitor.needs_runtime_import && needs_runtime_import {
        if effective_runtime_import_name == runtime_import_name {
            let _ = writeln!(
                prefix,
                "import {{ {runtime_import_name} }} from \"{runtime_module}\";"
            );
        } else {
            let _ = writeln!(
                prefix,
                "import {{ {runtime_import_name} as {effective_runtime_import_name} }} from \"{runtime_module}\";"
            );
        }
    }

    let mut trans_imports = visitor.trans_imports.iter().cloned().collect::<Vec<_>>();
    trans_imports.sort();
    for (module, local_name) in trans_imports {
        if local_name != "Trans" || !visitor.reused_trans_imports.contains(&module) {
            if local_name == "Trans" {
                let _ = writeln!(prefix, "import {{ Trans }} from \"{module}\";");
            } else {
                let _ = writeln!(
                    prefix,
                    "import {{ Trans as {local_name} }} from \"{module}\";"
                );
            }
        }
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

    let mut magic_string = MagicString::new(source);
    for replacement in &replacements {
        apply_replacement(&mut magic_string, replacement)?;
    }

    let code = magic_string.to_string();
    let has_changed = code != source;
    let map = has_changed.then(|| {
        let mut map = magic_string.source_map(SourceMapOptions {
            include_content: true,
            source: filename.into(),
            hires: Hires::False,
        });
        map.set_file(filename);
        let json = map.to_json();
        NativeTransformSourceMap {
            version: json.version,
            sources: json.sources,
            sources_content: json.sources_content,
            names: json.names,
            mappings: json.mappings,
            file: json.file,
        }
    });

    Ok(NativeTransformResult {
        has_changed,
        code,
        compiled_ids: visitor.compiled_ids,
        edits,
        map,
        prepend_text: None,
    })
}

fn unique_runtime_import_alias(
    runtime_import_name: &str,
    used_identifier_names: &std::collections::HashSet<String>,
) -> String {
    let base = format!("__palamedes{}", uppercase_first(runtime_import_name));
    if !used_identifier_names.contains(&base) {
        return base;
    }

    let mut counter = 2;
    loop {
        let candidate = format!("{base}{counter}");
        if !used_identifier_names.contains(&candidate) {
            return candidate;
        }
        counter += 1;
    }
}

fn uppercase_first(value: &str) -> String {
    let mut chars = value.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

fn apply_replacement(
    magic_string: &mut MagicString<'_>,
    replacement: &Replacement,
) -> PalamedesResult<()> {
    let start = string_wizard_offset(replacement.start)?;

    if replacement.start == replacement.end {
        magic_string
            .append_left(start, replacement.text.clone())
            .map_err(|reason| PalamedesError::TransformEditFailed { reason })?;
    } else {
        let end = string_wizard_offset(replacement.end)?;

        magic_string
            .update(start, end, replacement.text.clone())
            .map_err(|reason| PalamedesError::TransformEditFailed { reason })?;
    }

    Ok(())
}

fn string_wizard_offset(offset: usize) -> PalamedesResult<u32> {
    u32::try_from(offset).map_err(|_| PalamedesError::TransformOffsetTooLarge { offset })
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
        map: None,
        prepend_text: None,
    }
}
