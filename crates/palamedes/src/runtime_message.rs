use std::collections::BTreeMap;

use ferrocat_icu::{parse_icu, IcuNode, IcuPluralKind};

/// Runtime-ready message programs keyed by compiled message ID.
///
/// Constant text is omitted from this map. Messages that cannot be represented
/// by the browser runtime retain a lazy-parser marker.
pub type RuntimeCompiledMessages = BTreeMap<String, RuntimeCompiledMessage>;

/// Build-time result for one non-constant catalog message.
#[derive(Debug, PartialEq, Eq)]
pub enum RuntimeCompiledMessage {
    /// Runtime-ready program input.
    Nodes(Vec<RuntimeMessageNode>),
    /// Keep the browser runtime's resilient lazy-parser path.
    Lazy,
}

/// Host-neutral node shape lowered into executable message functions.
#[derive(Debug, PartialEq, Eq)]
pub enum RuntimeMessageNode {
    /// Literal message text.
    Text {
        /// Text content.
        value: String,
    },
    /// Apostrophe-quoted text whose pound signs remain literal in a plural.
    Literal {
        /// Quoted text content.
        value: String,
    },
    /// Simple argument substitution.
    Variable {
        /// Argument identifier.
        name: String,
    },
    /// Number, date, or time formatter invocation.
    Formatted {
        /// Argument identifier.
        variable: String,
        /// Runtime formatter kind.
        format: RuntimeMessageFormat,
        /// Optional formatter style.
        style: Option<String>,
    },
    /// Select, plural, or ordinal-plural branch.
    Choice {
        /// Argument identifier.
        variable: String,
        /// Runtime choice kind.
        kind: RuntimeMessageChoiceKind,
        /// Optional plural offset.
        offset: Option<u32>,
        /// Available selector branches.
        options: BTreeMap<String, Vec<Self>>,
    },
    /// Rich-text component placeholder.
    Tag {
        /// Component placeholder name.
        name: String,
        /// Nested message nodes.
        children: Vec<Self>,
    },
    /// Runtime plural operand placeholder.
    Pound,
}

/// Formatter kinds implemented by the browser runtime.
#[derive(Debug, PartialEq, Eq)]
pub enum RuntimeMessageFormat {
    /// Number formatting through `Intl.NumberFormat`.
    Number,
    /// Date formatting through `Intl.DateTimeFormat`.
    Date,
    /// Time formatting through `Intl.DateTimeFormat`.
    Time,
}

/// Choice kinds implemented by the browser runtime.
#[derive(Debug, PartialEq, Eq)]
pub enum RuntimeMessageChoiceKind {
    /// Cardinal plural selection.
    Plural,
    /// String selection.
    Select,
    /// Ordinal plural selection.
    Selectordinal,
}

/// Parses compiled catalog strings into a host-neutral message program.
///
/// This is a product-specific compilation step rather than a second ICU
/// parser: Ferrocat owns parsing, while Palamedes maps its AST to the runtime
/// operations used to generate executable JavaScript catalog functions.
#[must_use]
pub fn compile_runtime_catalog_messages(
    messages: &BTreeMap<String, String>,
) -> RuntimeCompiledMessages {
    messages
        .iter()
        .filter_map(|(id, pattern)| {
            let nodes = match parse_icu(pattern)
                .ok()
                .and_then(|parsed| convert_nodes(parsed.nodes, false))
            {
                Some(nodes) => nodes,
                None => return Some((id.clone(), RuntimeCompiledMessage::Lazy)),
            };
            (!is_constant_text(pattern, &nodes))
                .then(|| (id.clone(), RuntimeCompiledMessage::Nodes(nodes)))
        })
        .collect()
}

fn is_constant_text(pattern: &str, nodes: &[RuntimeMessageNode]) -> bool {
    (nodes.is_empty() && pattern.is_empty())
        || matches!(nodes, [RuntimeMessageNode::Text { value }] if value == pattern)
}

fn convert_nodes(nodes: Vec<IcuNode>, in_plural: bool) -> Option<Vec<RuntimeMessageNode>> {
    let mut converted = Vec::with_capacity(nodes.len());
    for node in nodes {
        let node = convert_node(node, in_plural)?;
        push_node(&mut converted, node);
    }
    Some(converted)
}

fn convert_node(node: IcuNode, in_plural: bool) -> Option<RuntimeMessageNode> {
    match node {
        IcuNode::Literal(value) if in_plural && value.contains('#') => {
            Some(RuntimeMessageNode::Literal { value })
        }
        IcuNode::Literal(value) => Some(RuntimeMessageNode::Text { value }),
        IcuNode::Argument { name } => Some(RuntimeMessageNode::Variable { name }),
        IcuNode::Number { name, style } => Some(RuntimeMessageNode::Formatted {
            variable: name,
            format: RuntimeMessageFormat::Number,
            style,
        }),
        IcuNode::Date { name, style } => Some(RuntimeMessageNode::Formatted {
            variable: name,
            format: RuntimeMessageFormat::Date,
            style,
        }),
        IcuNode::Time { name, style } => Some(RuntimeMessageNode::Formatted {
            variable: name,
            format: RuntimeMessageFormat::Time,
            style,
        }),
        IcuNode::Select { name, options } => Some(RuntimeMessageNode::Choice {
            variable: name,
            kind: RuntimeMessageChoiceKind::Select,
            offset: None,
            options: convert_options(options, in_plural)?,
        }),
        IcuNode::Plural {
            name,
            kind,
            offset,
            options,
        } => Some(RuntimeMessageNode::Choice {
            variable: name,
            kind: match kind {
                IcuPluralKind::Cardinal => RuntimeMessageChoiceKind::Plural,
                IcuPluralKind::Ordinal => RuntimeMessageChoiceKind::Selectordinal,
            },
            offset: (offset != 0).then_some(offset),
            options: convert_options(options, true)?,
        }),
        IcuNode::Pound => Some(RuntimeMessageNode::Pound),
        IcuNode::Tag { name, children } => Some(RuntimeMessageNode::Tag {
            name,
            children: convert_nodes(children, in_plural)?,
        }),
        _ => None,
    }
}

fn convert_options(
    options: Vec<ferrocat_icu::IcuOption>,
    in_plural: bool,
) -> Option<BTreeMap<String, Vec<RuntimeMessageNode>>> {
    options
        .into_iter()
        .map(|option| Some((option.selector, convert_nodes(option.value, in_plural)?)))
        .collect()
}

fn push_node(nodes: &mut Vec<RuntimeMessageNode>, node: RuntimeMessageNode) {
    if let (
        Some(RuntimeMessageNode::Text { value: previous }),
        RuntimeMessageNode::Text { value },
    ) = (nodes.last_mut(), &node)
    {
        previous.push_str(value);
    } else {
        nodes.push(node);
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::{compile_runtime_catalog_messages, RuntimeCompiledMessage, RuntimeMessageNode};

    fn compile(pattern: &str) -> Option<RuntimeCompiledMessage> {
        compile_runtime_catalog_messages(&BTreeMap::from([(
            "message".to_owned(),
            pattern.to_owned(),
        )]))
        .remove("message")
    }

    #[test]
    fn marks_constant_text_without_repeating_nodes() {
        assert_eq!(compile("Hello"), None);
        assert_eq!(compile(""), None);
    }

    #[test]
    fn compiles_variables_and_rich_text() {
        assert_eq!(
            compile("Hello {name}, <strong>welcome</strong>"),
            Some(RuntimeCompiledMessage::Nodes(vec![
                RuntimeMessageNode::Text {
                    value: "Hello ".to_owned(),
                },
                RuntimeMessageNode::Variable {
                    name: "name".to_owned(),
                },
                RuntimeMessageNode::Text {
                    value: ", ".to_owned(),
                },
                RuntimeMessageNode::Tag {
                    name: "strong".to_owned(),
                    children: vec![RuntimeMessageNode::Text {
                        value: "welcome".to_owned(),
                    }],
                },
            ]))
        );
    }

    #[test]
    fn preserves_quoted_and_runtime_plural_pounds() {
        let Some(RuntimeCompiledMessage::Nodes(nodes)) =
            compile("{count, plural, other {'#' of # items}}")
        else {
            panic!("expected compiled plural");
        };
        let [RuntimeMessageNode::Choice { options, .. }] = nodes.as_slice() else {
            panic!("expected compiled plural");
        };

        assert_eq!(
            options.get("other"),
            Some(&vec![
                RuntimeMessageNode::Literal {
                    value: "# of ".to_owned(),
                },
                RuntimeMessageNode::Pound,
                RuntimeMessageNode::Text {
                    value: " items".to_owned(),
                },
            ])
        );
    }

    #[test]
    fn treats_pound_as_syntax_only_inside_a_plural() {
        let Some(RuntimeCompiledMessage::Nodes(nodes)) =
            compile("{gender, select, other {# profile}}")
        else {
            panic!("expected compiled select");
        };
        let [RuntimeMessageNode::Choice { options, .. }] = nodes.as_slice() else {
            panic!("expected compiled select");
        };
        assert_eq!(
            options.get("other"),
            Some(&vec![RuntimeMessageNode::Text {
                value: "# profile".to_owned(),
            }])
        );

        let Some(RuntimeCompiledMessage::Nodes(nodes)) =
            compile("{count, plural, other {{gender, select, other {# profiles}}}}")
        else {
            panic!("expected compiled plural");
        };
        let [RuntimeMessageNode::Choice { options, .. }] = nodes.as_slice() else {
            panic!("expected compiled plural");
        };
        let Some([RuntimeMessageNode::Choice { options, .. }]) =
            options.get("other").map(Vec::as_slice)
        else {
            panic!("expected nested select");
        };
        assert_eq!(
            options.get("other"),
            Some(&vec![
                RuntimeMessageNode::Pound,
                RuntimeMessageNode::Text {
                    value: " profiles".to_owned(),
                },
            ])
        );
    }

    #[test]
    fn keeps_unsupported_formatter_kinds_lazy() {
        let messages = BTreeMap::from([("message".to_owned(), "Items: {items, list}".to_owned())]);
        assert_eq!(
            compile_runtime_catalog_messages(&messages).get("message"),
            Some(&RuntimeCompiledMessage::Lazy)
        );
    }
}
