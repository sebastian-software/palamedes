//! Extraction manifest for executing JavaScript macros without a compiler transform.
//!
//! Unbundled Node code calls the real `t`, `plural`, `select`, and
//! `selectOrdinal` functions. At that point the runtime only sees static text
//! and values: a tagged template arrives as its `TemplateStringsArray`, a
//! choice as its evaluated options object. The manifest maps that static text
//! to the compiled lookup key and placeholder names the transform would have
//! produced, so the runtime never hashes or parses (ADR-005, ADR-006, ADR-020).

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;

use oxc_allocator::Allocator;
use oxc_ast::ast::{
    Argument, CallExpression, Expression, ObjectExpression, ObjectPropertyKind,
    TaggedTemplateExpression, TemplateLiteral,
};
use oxc_ast_visit::{Visit, walk};
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType};
use serde::{Deserialize, Serialize};

use crate::SourceFileAnalysisRequest;
use crate::choice::is_plural_format;
use crate::descriptor::{descriptor_property_value, descriptor_static_property};
use crate::error::{PalamedesError, PalamedesResult};
use crate::extract::{MacroCollector, MacroResolution};
use crate::icu_text::compiled_message_key;
use crate::placeholder_name::expression_name;
use crate::source::{SourceLocator, display_filename, format_parser_diagnostics};
use crate::source_message::{
    build_icu_message, check_lowered_message, expression_source, lower_choice_options_from_object,
    lower_template, make_unique_value_name,
};

/// Current manifest format version.
pub const RUNTIME_MACRO_MANIFEST_VERSION: u32 = 1;

const CORE_MACRO_PACKAGE: &str = "@palamedes/core/macro";
const CHOICE_VALUE_FALLBACK_NAME: &str = "value";

/// Lookup data for every runtime-executable macro call in a source tree.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeMacroManifest {
    /// Manifest format version.
    pub version: u32,
    /// Tagged `t` templates keyed by their static template parts.
    pub templates: Vec<RuntimeMacroTemplate>,
    /// `t` descriptors keyed by message and context.
    pub descriptors: Vec<RuntimeMacroDescriptor>,
    /// `plural`, `select`, and `selectOrdinal` calls keyed by their options.
    pub choices: Vec<RuntimeMacroChoice>,
}

/// One tagged `t` template.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeMacroTemplate {
    /// Cooked template parts as the runtime receives them.
    pub strings: Vec<Option<String>>,
    /// Compiled lookup key.
    pub key: String,
    /// Placeholder name for each interpolated value, in source order.
    pub values: Vec<String>,
}

/// One `t({ message, context })` descriptor.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeMacroDescriptor {
    /// Descriptor message as the runtime receives it.
    pub message: String,
    /// Descriptor context, when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
    /// Compiled lookup key.
    pub key: String,
}

/// One `plural`, `select`, or `selectOrdinal` call.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeMacroChoice {
    /// Macro name: `plural`, `select`, or `selectOrdinal`.
    pub kind: String,
    /// Option properties as the runtime receives them, including `offset`.
    pub options: BTreeMap<String, String>,
    /// Placeholder name of the selector value.
    pub value: String,
    /// Compiled lookup key.
    pub key: String,
}

enum Entry {
    Template(RuntimeMacroTemplate),
    Descriptor(RuntimeMacroDescriptor),
    Choice(RuntimeMacroChoice),
}

impl Entry {
    fn macro_name(&self) -> &str {
        match self {
            Self::Template(_) | Self::Descriptor(_) => "t",
            Self::Choice(choice) => &choice.kind,
        }
    }

    /// What the runtime can observe about the call; equal signatures must
    /// resolve to equal entries.
    fn signature(&self) -> String {
        let value = match self {
            Self::Template(template) => serde_json::json!(["template", template.strings]),
            Self::Descriptor(descriptor) => {
                serde_json::json!(["descriptor", descriptor.message, descriptor.context])
            }
            Self::Choice(choice) => serde_json::json!([choice.kind, choice.options]),
        };
        value.to_string()
    }
}

impl PartialEq for Entry {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Template(left), Self::Template(right)) => left == right,
            (Self::Descriptor(left), Self::Descriptor(right)) => left == right,
            (Self::Choice(left), Self::Choice(right)) => left == right,
            _ => false,
        }
    }
}

/// Collect the runtime macro manifest for a set of source files.
///
/// MDX files are skipped because their messages always go through a compiler.
///
/// # Errors
///
/// Returns an error when a file cannot be read or parsed, when a macro call
/// cannot be recovered from its runtime arguments, or when two calls look
/// identical at runtime but compile to different messages.
pub fn collect_runtime_macro_manifest(
    files: &[SourceFileAnalysisRequest],
) -> PalamedesResult<RuntimeMacroManifest> {
    let mut entries = BTreeMap::<String, (Entry, String)>::new();
    for file in files {
        if file.path.ends_with(".mdx") {
            continue;
        }
        let source =
            std::fs::read_to_string(&file.path).map_err(|source| PalamedesError::ReadFile {
                path: PathBuf::from(&file.path),
                source,
            })?;
        for (entry, location) in collect_source_entries(&source, &file.filename)? {
            match entries.get(&entry.signature()) {
                Some((existing, _)) if *existing == entry => {}
                Some((existing, first)) => {
                    return Err(PalamedesError::RuntimeMacroCollision {
                        macro_name: existing.macro_name().to_owned(),
                        first: first.clone(),
                        second: location,
                    });
                }
                None => {
                    entries.insert(entry.signature(), (entry, location));
                }
            }
        }
    }

    let mut manifest = RuntimeMacroManifest {
        version: RUNTIME_MACRO_MANIFEST_VERSION,
        ..RuntimeMacroManifest::default()
    };
    for (entry, _) in entries.into_values() {
        match entry {
            Entry::Template(template) => manifest.templates.push(template),
            Entry::Descriptor(descriptor) => manifest.descriptors.push(descriptor),
            Entry::Choice(choice) => manifest.choices.push(choice),
        }
    }
    Ok(manifest)
}

fn collect_source_entries(source: &str, filename: &str) -> PalamedesResult<Vec<(Entry, String)>> {
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

    let mut collector = MacroCollector::new();
    collector.visit_program(&parsed.program);
    if !collector
        .imported_macros
        .values()
        .any(|imported| imported.source == CORE_MACRO_PACKAGE)
    {
        return Ok(Vec::new());
    }
    let resolution = MacroResolution::resolve(&parsed.program, &collector);
    let locator = SourceLocator::new(source);
    let mut visitor = ManifestVisitor {
        filename,
        source,
        locator: &locator,
        collector: &collector,
        resolution: &resolution,
        entries: Vec::new(),
        error: None,
    };
    visitor.visit_program(&parsed.program);
    match visitor.error {
        Some(error) => Err(error),
        None => Ok(visitor.entries),
    }
}

struct ManifestVisitor<'a, 'c> {
    filename: &'a str,
    source: &'a str,
    locator: &'a SourceLocator<'a>,
    collector: &'a MacroCollector<'c>,
    resolution: &'a MacroResolution,
    entries: Vec<(Entry, String)>,
    error: Option<PalamedesError>,
}

impl ManifestVisitor<'_, '_> {
    fn macro_name(&self, expression: &Expression<'_>) -> Option<String> {
        let Expression::Identifier(identifier) = expression.without_parentheses() else {
            return None;
        };
        let imported = self
            .collector
            .imported_macros
            .get(identifier.name.as_str())?;
        (imported.source == CORE_MACRO_PACKAGE
            && self
                .resolution
                .is_macro_use((identifier.span.start, identifier.span.end)))
        .then(|| imported.imported_name.clone())
    }

    fn location(&self, offset: u32) -> String {
        let (line, column) = self.locator.location(offset as usize);
        format!("{}:{line}:{column}", self.filename)
    }

    fn record(&mut self, offset: u32, entry: PalamedesResult<Option<Entry>>) {
        match entry {
            Ok(Some(entry)) => {
                let location = self.location(offset);
                self.entries.push((entry, location));
            }
            Ok(None) => {}
            Err(error) => {
                self.error.get_or_insert(error);
            }
        }
    }

    fn unsupported(&self, macro_name: &str, offset: u32, detail: &str) -> PalamedesError {
        PalamedesError::RuntimeMacroUnsupported {
            macro_name: macro_name.to_owned(),
            location: self.location(offset),
            detail: detail.to_owned(),
        }
    }

    fn template(&self, template: &TemplateLiteral<'_>) -> PalamedesResult<Option<Entry>> {
        let mut used_value_names = HashMap::new();
        let (message, lowered_values) = lower_template(
            template,
            self.source,
            &self.collector.imported_macros,
            "template expression",
            &mut used_value_names,
        )?;
        if message.is_empty() {
            return Ok(None);
        }
        check_lowered_message(
            &message,
            lowered_values.iter().map(|value| value.name.as_str()),
            [],
            "t",
            &self
                .locator
                .indexed_location(self.filename, template.span.start as usize),
        )?;

        // Replays the naming in `lower_template` per slot: values are
        // deduplicated there, but the runtime receives one value per slot.
        let mut used_value_names = HashMap::new();
        let mut values = Vec::with_capacity(template.expressions.len());
        for expression in &template.expressions {
            let preferred_name =
                expression_name(expression).ok_or(PalamedesError::UnnamedPlaceholder {
                    syntax: "template expression",
                })?;
            let source = expression_source(expression, self.source)
                .unwrap_or_else(|| preferred_name.clone());
            values.push(make_unique_value_name(
                preferred_name,
                &source,
                &mut used_value_names,
            ));
        }

        Ok(Some(Entry::Template(RuntimeMacroTemplate {
            strings: template
                .quasis
                .iter()
                .map(|quasi| quasi.value.cooked.map(|value| value.to_string()))
                .collect(),
            key: compiled_message_key(&message, None),
            values,
        })))
    }

    fn descriptor(&self, call: &CallExpression<'_>) -> PalamedesResult<Option<Entry>> {
        let location = self.location(call.span.start);
        let Some(Argument::ObjectExpression(object)) = call.arguments.first() else {
            return Err(self.unsupported(
                "t",
                call.span.start,
                "the first argument must be a descriptor object",
            ));
        };
        let Some(message) = descriptor_property_value(object, "message") else {
            return Ok(None);
        };
        let (runtime_message, message) = match message.without_parentheses() {
            Expression::StringLiteral(literal) => {
                (literal.value.to_string(), literal.value.to_string())
            }
            Expression::TemplateLiteral(template) if template.expressions.is_empty() => {
                let mut used_value_names = HashMap::new();
                let (message, _) = lower_template(
                    template,
                    self.source,
                    &self.collector.imported_macros,
                    "template expression",
                    &mut used_value_names,
                )?;
                check_lowered_message(&message, [], [], "t", location.as_str())?;
                let runtime_message = template
                    .single_quasi()
                    .map(|value| value.to_string())
                    .unwrap_or_default();
                (runtime_message, message)
            }
            _ => {
                return Err(self.unsupported(
                    "t",
                    call.span.start,
                    "the runtime only sees the interpolated descriptor message; use a string message with a values object, for example t({ message: \"Hello {name}\" }, { name })",
                ));
            }
        };
        let context = descriptor_static_property(object, "context", "t", location.as_str())?;

        Ok(Some(Entry::Descriptor(RuntimeMacroDescriptor {
            key: compiled_message_key(&message, context.as_deref()),
            message: runtime_message,
            context,
        })))
    }

    fn choice(
        &self,
        call: &CallExpression<'_>,
        macro_name: &str,
    ) -> PalamedesResult<Option<Entry>> {
        let (Some(value), Some(Argument::ObjectExpression(object))) = (
            call.arguments.first().and_then(Argument::as_expression),
            call.arguments.get(1),
        ) else {
            return Ok(None);
        };
        let format = if macro_name == "selectOrdinal" {
            "selectordinal"
        } else {
            macro_name
        };
        let location = self
            .locator
            .indexed_location(self.filename, call.span.start as usize);
        let mut used_value_names = HashMap::new();
        let preferred_name =
            expression_name(value).unwrap_or_else(|| CHOICE_VALUE_FALLBACK_NAME.to_owned());
        let value_source =
            expression_source(value, self.source).unwrap_or_else(|| preferred_name.clone());
        let value_name =
            make_unique_value_name(preferred_name, &value_source, &mut used_value_names);
        let lowered = lower_choice_options_from_object(
            object,
            self.source,
            &self.collector.imported_macros,
            &mut used_value_names,
            format,
            macro_name,
            &location,
        )?;
        if lowered.options.is_empty() {
            return Ok(None);
        }
        if !lowered.values.is_empty() {
            return Err(self.unsupported(
                macro_name,
                call.span.start,
                "a branch interpolates a value, but the runtime only sees the finished branch text; write the message as a t descriptor with ICU syntax and a values object instead",
            ));
        }

        let options = self.runtime_options(object, format, macro_name, lowered.offset)?;
        let message = build_icu_message(
            format,
            &value_name,
            &lowered.options,
            options.get("offset").map(String::as_str),
        );
        check_lowered_message(&message, [value_name.as_str()], [], macro_name, &location)?;
        Ok(Some(Entry::Choice(RuntimeMacroChoice {
            kind: macro_name.to_owned(),
            options,
            value: value_name,
            key: compiled_message_key(&message, None),
        })))
    }

    /// The options object as the runtime will stringify it.
    fn runtime_options(
        &self,
        object: &ObjectExpression<'_>,
        format: &str,
        macro_name: &str,
        offset: Option<String>,
    ) -> PalamedesResult<BTreeMap<String, String>> {
        let mut options = BTreeMap::new();
        for property in &object.properties {
            // Defensive backstop: `lower_choice_options_from_object` already
            // rejects spread options and computed keys before this runs.
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                return Err(self.unsupported(
                    macro_name,
                    property.span().start,
                    "spread options cannot be matched at runtime",
                ));
            };
            let Some(key) = property.key.static_name() else {
                return Err(self.unsupported(
                    macro_name,
                    property.span.start,
                    "computed option names cannot be matched at runtime",
                ));
            };
            if is_plural_format(format) && key == "offset" {
                continue;
            }
            let value = match property.value.without_parentheses() {
                Expression::StringLiteral(literal) => literal.value.to_string(),
                Expression::TemplateLiteral(template) if template.expressions.is_empty() => {
                    template
                        .single_quasi()
                        .map(|value| value.to_string())
                        .unwrap_or_default()
                }
                _ => {
                    return Err(self.unsupported(
                        macro_name,
                        property.span.start,
                        "every branch must be a string literal",
                    ));
                }
            };
            options.insert(key.into_owned(), value);
        }
        if let Some(offset) = offset {
            options.insert("offset".to_owned(), offset);
        }
        Ok(options)
    }
}

impl<'a> Visit<'a> for ManifestVisitor<'_, '_> {
    fn visit_tagged_template_expression(&mut self, it: &TaggedTemplateExpression<'a>) {
        if self.error.is_none() && self.macro_name(&it.tag).as_deref() == Some("t") {
            let entry = self.template(&it.quasi);
            self.record(it.span.start, entry);
        }
        walk::walk_tagged_template_expression(self, it);
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if self.error.is_none()
            && let Some(macro_name) = self.macro_name(&it.callee)
        {
            let entry = match macro_name.as_str() {
                "t" => self.descriptor(it),
                "plural" | "select" | "selectOrdinal" => self.choice(it, &macro_name),
                _ => Ok(None),
            };
            self.record(it.span.start, entry);
        }
        walk::walk_call_expression(self, it);
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::{RuntimeMacroManifest, collect_runtime_macro_manifest};
    use crate::{PalamedesError, SourceFileAnalysisRequest, transform_macros};

    fn manifest(sources: &[(&str, &str)]) -> Result<RuntimeMacroManifest, PalamedesError> {
        let dir = tempfile::tempdir().expect("temporary directory");
        let files = sources
            .iter()
            .map(|(name, source)| {
                let path = dir.path().join(name);
                fs::write(&path, source).expect("source file");
                SourceFileAnalysisRequest {
                    path: path.to_string_lossy().into_owned(),
                    filename: (*name).to_owned(),
                }
            })
            .collect::<Vec<_>>();
        collect_runtime_macro_manifest(&files)
    }

    fn transformed(source: &str) -> String {
        transform_macros(source, "fixture.ts", None)
            .expect("transform succeeds")
            .code
    }

    #[test]
    fn records_template_parts_keys_and_slot_names() {
        let source = r##"import { t } from "@palamedes/core/macro";
export const f = (id: string, user: { name: string }, other: { name: string }) => [
  t`Booking ${id} is confirmed.`,
  t`${user.name} meets ${other.name} and ${user.name}.`,
  t`It's {not} a placeholder.`,
];"##;
        let manifest = manifest(&[("a.ts", source)]).expect("manifest");
        let code = transformed(source);

        assert_eq!(manifest.version, 1);
        assert_eq!(manifest.templates.len(), 3);
        let booking = manifest
            .templates
            .iter()
            .find(|entry| entry.strings[0].as_deref() == Some("Booking "))
            .expect("booking template");
        assert_eq!(booking.values, ["id"]);
        let names = manifest
            .templates
            .iter()
            .find(|entry| entry.values.len() == 3)
            .expect("member template");
        assert_eq!(names.values, ["name", "name_1", "name"]);
        for entry in &manifest.templates {
            assert!(
                code.contains(&format!("\"{}\"", entry.key)),
                "transform and manifest disagree on {:?}: {code}",
                entry.strings
            );
        }
    }

    #[test]
    fn records_descriptors_and_choices_with_transform_keys() {
        let source = r##"import { plural, select, selectOrdinal, t } from "@palamedes/core/macro";
export const f = (seats: number, role: string, place: number, name: string) => [
  t({ message: "Hello {name}", context: "greeting" }, { name }),
  t({ message: `It's done.` }),
  plural(seats, { one: "# seat available", other: "# seats available" }),
  plural(seats, { offset: 1, "=0": "Nobody", other: "# others" }),
  select(role, { admin: "Administrator", other: "Member" }),
  selectOrdinal(place, { one: "#st", two: "#nd", few: "#rd", other: "#th" }),
];"##;
        let manifest = manifest(&[("a.ts", source)]).expect("manifest");
        let code = transformed(source);

        assert_eq!(manifest.descriptors.len(), 2);
        assert_eq!(manifest.choices.len(), 4);
        let offset = manifest
            .choices
            .iter()
            .find(|choice| choice.options.contains_key("offset"))
            .expect("offset choice");
        assert_eq!(offset.options["offset"], "1");
        assert_eq!(offset.options["=0"], "Nobody");
        assert_eq!(offset.value, "seats");
        let keys = manifest
            .descriptors
            .iter()
            .map(|entry| &entry.key)
            .chain(manifest.choices.iter().map(|entry| &entry.key));
        for key in keys {
            assert!(
                code.contains(&format!("\"{key}\"")),
                "missing {key}: {code}"
            );
        }
    }

    #[test]
    fn deduplicates_identical_calls_across_files() {
        let source = "import { t } from \"@palamedes/core/macro\";\nexport const f = (id: string) => t`Booking ${id}.`;";
        let manifest = manifest(&[("a.ts", source), ("b.ts", source)]).expect("manifest");

        assert_eq!(manifest.templates.len(), 1);
    }

    #[test]
    fn rejects_runtime_collisions() {
        let first = "import { t } from \"@palamedes/core/macro\";\nexport const f = (id: string) => t`Booking ${id}.`;";
        let second = "import { t } from \"@palamedes/core/macro\";\n\nexport const g = (code: string) => t`Booking ${code}.`;";
        let error = manifest(&[("a.ts", first), ("b.ts", second)]).expect_err("collision");

        assert!(
            matches!(&error, PalamedesError::RuntimeMacroCollision { first, second, .. }
                if first == "a.ts:2:34" && second == "b.ts:3:36"),
            "{error}"
        );
    }

    #[test]
    fn rejects_shapes_the_runtime_cannot_recover() {
        for (source, detail) in [
            (
                "plural(n, { one: `# night for ${guest}`, other: `# nights for ${guest}` })",
                "interpolates a value",
            ),
            ("t({ message: `Hello ${name}` })", "string message"),
        ] {
            let source = format!(
                "import {{ plural, t }} from \"@palamedes/core/macro\";\nexport const f = (n: number, guest: string, label: string, name: string) => {source};"
            );
            let error = manifest(&[("a.ts", &source)]).expect_err("unsupported shape");
            assert!(
                matches!(&error, PalamedesError::RuntimeMacroUnsupported { detail: actual, .. } if actual.contains(detail)),
                "{error}"
            );
        }
    }

    #[test]
    fn rejects_choice_branches_like_extraction_and_the_transform() {
        let prefix = "export const f = (n: number, role: string, label: string) => ";
        for (call, anchor, expected_key, nested) in [
            (
                "plural(n, { one: label, other: \"# items\" })",
                "label",
                "one",
                false,
            ),
            ("plural(n, { one: ONE, other: OTHER })", "ONE", "one", false),
            (
                "select(role, { admin: \"Admin\", other: plural(n, { one: \"#\", other: \"#\" }) })",
                "plural(n, { one: \"#\"",
                "other",
                true,
            ),
        ] {
            let source = format!(
                "import {{ plural, select }} from \"@palamedes/core/macro\";\n{prefix}{call};"
            );
            let column = prefix.len() + call.find(anchor).expect("anchor") + 1;
            let expected_location = format!("a.ts:2:{column}");
            let error = manifest(&[("a.ts", &source)]).expect_err("unsupported branch");
            let matched = if nested {
                matches!(&error, PalamedesError::NestedMessageMacro { location, branch: Some(key) }
                    if *location == expected_location && key == expected_key)
            } else {
                matches!(&error, PalamedesError::UnsupportedMacroSyntax { macro_name, location, detail }
                    if macro_name == "plural"
                        && *location == expected_location
                        && detail.contains(&format!("`{expected_key}` branch")))
            };
            assert!(matched, "{call}: {error}");
        }
    }

    #[test]
    fn ignores_shadowed_and_foreign_macros() {
        let source = r##"import { t } from "@palamedes/core/macro";
import { plural } from "@palamedes/react/macro";
export function f(n: number) {
  const t = (strings: TemplateStringsArray) => strings.join("");
  return [t`not a macro ${n}`, plural(n, { one: "#", other: "#" })];
}"##;
        let manifest = manifest(&[("a.tsx", source)]).expect("manifest");

        assert_eq!(
            manifest,
            RuntimeMacroManifest {
                version: 1,
                ..Default::default()
            }
        );
    }
}
