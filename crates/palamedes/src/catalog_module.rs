//! Renders compiled catalog messages as executable JavaScript modules.
//!
//! Bundler plugins, `pmds catalog compile --target js`, and the Node binding
//! share this renderer, so every host receives the same parser-free module
//! (ADR-005, ADR-019).

use std::collections::BTreeMap;

use crate::error::{PalamedesError, PalamedesResult};
use crate::runtime_message::{
    RuntimeCompiledMessage, RuntimeMessageChoiceKind, RuntimeMessageFormat, RuntimeMessageNode,
    compile_runtime_catalog_messages,
};

type Result<T> = PalamedesResult<T>;

/// Renders compiled catalog messages as an executable JavaScript module.
///
/// `locale` and `resource_path` only label diagnostics.
///
/// # Errors
///
/// Returns [`PalamedesError::RenderCatalogModule`] when a message cannot be
/// lowered to the parser-free runtime or uses an unsupported formatter style.
pub fn render_catalog_module(
    messages: &BTreeMap<String, String>,
    locale: &str,
    resource_path: &str,
) -> Result<String> {
    let compiled = compile_runtime_catalog_messages(messages);
    let mut renderer = RuntimeModuleRenderer::default();
    let mut entries = Vec::with_capacity(messages.len());
    let context = RuntimeModuleContext {
        locale,
        resource_path,
    };

    for (id, pattern) in messages {
        let key = render_javascript_string(id, locale, resource_path)?;
        let value = match compiled.get(id) {
            None => render_javascript_string(pattern, locale, resource_path)?,
            Some(RuntimeCompiledMessage::Lazy) => {
                return Err(render_error(format!(
                    "Failed to compile catalog message for locale {locale} at {resource_path}: ICU pattern cannot be lowered to the parser-free runtime (message: {pattern:?})"
                )));
            }
            Some(RuntimeCompiledMessage::Nodes(nodes)) => {
                if let Some((formatter, style)) = unsupported_runtime_formatter_style(nodes) {
                    return Err(render_error(format!(
                        "Failed to compile catalog message for locale {locale} at {resource_path}: unsupported {formatter} formatter style {style:?} (message: {pattern:?})"
                    )));
                }
                renderer.render_message(nodes, &context)?
            }
        };
        entries.push(format!("[{key}]:{value}"));
    }

    Ok(format!(
        "import{{defineCompiledCatalog as __palamedesDefineCompiledCatalog}}from\"@palamedes/core/compiled\";{}export const messages=__palamedesDefineCompiledCatalog({{{}}});export default {{ messages }};",
        renderer.declarations,
        entries.join(",")
    ))
}

#[derive(Default)]
struct RuntimeModuleRenderer {
    declarations: String,
    next_message: usize,
    next_choice: usize,
    next_branch: usize,
}

struct RuntimeModuleContext<'a> {
    locale: &'a str,
    resource_path: &'a str,
}

impl RuntimeModuleRenderer {
    fn render_message(
        &mut self,
        nodes: &[RuntimeMessageNode],
        context: &RuntimeModuleContext<'_>,
    ) -> Result<String> {
        let expression = self.render_nodes(nodes, false, context)?;
        let name = self.message_name();
        self.declarations
            .push_str(&format!("const {name}=(v,r)=>{expression};"));
        Ok(name)
    }

    fn render_nodes(
        &mut self,
        nodes: &[RuntimeMessageNode],
        in_branch: bool,
        context: &RuntimeModuleContext<'_>,
    ) -> Result<String> {
        let mut parts = Vec::with_capacity(nodes.len());
        for node in nodes {
            parts.extend(self.render_node(node, in_branch, context)?);
        }
        if parts.len() == 1
            && nodes.len() == 1
            && !matches!(nodes[0], RuntimeMessageNode::Text { .. })
        {
            return Ok(parts.pop().expect("single rendered message part"));
        }
        Ok(format!("r.join({})", parts.join(",")))
    }

    fn render_node(
        &mut self,
        node: &RuntimeMessageNode,
        in_branch: bool,
        context: &RuntimeModuleContext<'_>,
    ) -> Result<Vec<String>> {
        let expression = match node {
            RuntimeMessageNode::Text { value } => {
                render_javascript_string(value, context.locale, context.resource_path)?
            }
            RuntimeMessageNode::Literal { value } => format!(
                "r.literal({})",
                render_javascript_string(value, context.locale, context.resource_path)?
            ),
            RuntimeMessageNode::Variable { name } => format!(
                "r.value(v,{})",
                render_javascript_string(name, context.locale, context.resource_path)?
            ),
            RuntimeMessageNode::Formatted {
                variable,
                format,
                style,
            } => {
                let operation = match format {
                    RuntimeMessageFormat::Number => "number",
                    RuntimeMessageFormat::Date => "date",
                    RuntimeMessageFormat::Time => "time",
                };
                let variable =
                    render_javascript_string(variable, context.locale, context.resource_path)?;
                let style = style
                    .as_deref()
                    .map(|style| {
                        render_javascript_string(style, context.locale, context.resource_path)
                    })
                    .transpose()?
                    .map(|style| format!(",{style}"))
                    .unwrap_or_default();
                format!("r.{operation}(v,{variable}{style})")
            }
            RuntimeMessageNode::Choice {
                variable,
                kind,
                offset,
                options,
            } => self.render_choice(
                variable,
                kind,
                offset.unwrap_or(0),
                options,
                in_branch,
                context,
            )?,
            RuntimeMessageNode::Tag { name, children } => format!(
                "r.tag({},{})",
                render_javascript_string(name, context.locale, context.resource_path)?,
                self.render_nodes(children, in_branch, context)?
            ),
            RuntimeMessageNode::Pound => {
                if in_branch {
                    "r.pound(p)".to_owned()
                } else {
                    "\"#\"".to_owned()
                }
            }
        };
        Ok(vec![expression])
    }

    fn render_choice(
        &mut self,
        variable: &str,
        kind: &RuntimeMessageChoiceKind,
        offset: u32,
        options: &BTreeMap<String, Vec<RuntimeMessageNode>>,
        in_branch: bool,
        context: &RuntimeModuleContext<'_>,
    ) -> Result<String> {
        let choice_name = format!("__pc{}", self.next_choice);
        self.next_choice += 1;
        let mut option_entries = Vec::with_capacity(options.len());

        for (selector, nodes) in options {
            let expression = self.render_nodes(nodes, true, context)?;
            let branch_name = format!("__pb{}", self.next_branch);
            self.next_branch += 1;
            self.declarations
                .push_str(&format!("const {branch_name}=(v,r,p)=>{expression};"));
            option_entries.push(format!(
                "[{}]:{branch_name}",
                render_javascript_string(selector, context.locale, context.resource_path)?
            ));
        }

        self.declarations.push_str(&format!(
            "const {choice_name}={{{}}};",
            option_entries.join(",")
        ));
        let variable = render_javascript_string(variable, context.locale, context.resource_path)?;
        Ok(match kind {
            RuntimeMessageChoiceKind::Select => {
                if in_branch {
                    format!("r.select(v,{variable},{choice_name},p)")
                } else {
                    format!("r.select(v,{variable},{choice_name})")
                }
            }
            RuntimeMessageChoiceKind::Plural => {
                format!("r.plural(v,{variable},{offset},\"plural\",{choice_name})")
            }
            RuntimeMessageChoiceKind::Selectordinal => {
                format!("r.plural(v,{variable},{offset},\"selectordinal\",{choice_name})")
            }
        })
    }

    fn message_name(&mut self) -> String {
        let name = format!("__pm{}", self.next_message);
        self.next_message += 1;
        name
    }
}

fn render_javascript_string(value: &str, locale: &str, resource_path: &str) -> Result<String> {
    serde_json::to_string(value).map_err(|error| {
        render_error(format!(
            "Failed to render catalog module for locale {locale} at {resource_path}: {error}"
        ))
    })
}

fn unsupported_runtime_formatter_style(nodes: &[RuntimeMessageNode]) -> Option<(String, String)> {
    for node in nodes {
        match node {
            RuntimeMessageNode::Formatted { format, style, .. }
                if !is_supported_runtime_formatter_style(format, style.as_deref()) =>
            {
                return Some((
                    runtime_formatter_name(format).to_owned(),
                    style.clone().unwrap_or_default(),
                ));
            }
            RuntimeMessageNode::Choice { options, .. } => {
                for branch in options.values() {
                    if let Some(result) = unsupported_runtime_formatter_style(branch) {
                        return Some(result);
                    }
                }
            }
            RuntimeMessageNode::Tag { children, .. } => {
                if let Some(result) = unsupported_runtime_formatter_style(children) {
                    return Some(result);
                }
            }
            _ => {}
        }
    }
    None
}

fn is_supported_runtime_formatter_style(
    format: &RuntimeMessageFormat,
    style: Option<&str>,
) -> bool {
    let Some(style) = style.map(str::trim).filter(|style| !style.is_empty()) else {
        return true;
    };

    match format {
        RuntimeMessageFormat::Number => {
            if let Some(skeleton) = style.strip_prefix("::") {
                return matches!(skeleton, "percent" | "integer")
                    || skeleton.strip_prefix("currency/").is_some_and(|currency| {
                        currency.len() == 3
                            && currency.bytes().all(|byte| byte.is_ascii_alphabetic())
                    });
            }
            matches!(style, "percent" | "integer")
        }
        RuntimeMessageFormat::Date | RuntimeMessageFormat::Time => {
            matches!(style, "short" | "medium" | "long" | "full")
        }
    }
}

fn runtime_formatter_name(format: &RuntimeMessageFormat) -> &'static str {
    match format {
        RuntimeMessageFormat::Number => "number",
        RuntimeMessageFormat::Date => "date",
        RuntimeMessageFormat::Time => "time",
    }
}

fn render_error(message: String) -> PalamedesError {
    PalamedesError::RenderCatalogModule { message }
}
