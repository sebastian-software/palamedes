use std::collections::BTreeMap;

use ferrocat_icu::{IcuNode, IcuPluralKind, parse_icu};

/// Runtime-ready message programs keyed by compiled message ID.
///
/// Constant text is omitted from this map. Messages that cannot be represented
/// by the parser-free runtime retain an unlowerable marker so module rendering
/// can reject them instead of emitting a runtime parser fallback.
pub type RuntimeCompiledMessages = BTreeMap<String, RuntimeCompiledMessage>;

/// Build-time result for one non-constant catalog message.
#[derive(Debug, PartialEq, Eq)]
pub enum RuntimeCompiledMessage {
    /// Runtime-ready program input.
    Nodes(Vec<RuntimeMessageNode>),
    /// The message cannot be lowered to the parser-free runtime ABI.
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

/// Maximum nesting depth for ICU choices and rich-text tags lowered to the
/// parser-free runtime ABI.
pub(crate) const MAX_NESTING_DEPTH: usize = 64;

/// Linear, non-recursive pre-check that rejects patterns whose unquoted ICU
/// brace/tag nesting exceeds `max_depth` before invoking `ferrocat_icu::parse_icu`,
/// which parses nested choices and tags recursively.
pub(crate) fn exceeds_icu_nesting_depth(pattern: &str, max_depth: usize) -> bool {
    let bytes = pattern.as_bytes();
    let mut index = 0;
    let mut in_quote = false;
    let mut brace_depth = 0usize;
    let mut tag_depth = 0usize;

    while index < bytes.len() {
        let byte = bytes[index];
        if in_quote {
            if byte == b'\'' {
                if bytes.get(index + 1) == Some(&b'\'') {
                    index += 2;
                    continue;
                }
                in_quote = false;
            }
            index += 1;
            continue;
        }
        match byte {
            b'\'' => {
                if bytes.get(index + 1) == Some(&b'\'') {
                    index += 2;
                    continue;
                }
                in_quote = true;
                index += 1;
            }
            b'{' => {
                brace_depth += 1;
                if (brace_depth / 2) + tag_depth > max_depth {
                    return true;
                }
                index += 1;
            }
            b'}' => {
                brace_depth = brace_depth.saturating_sub(1);
                index += 1;
            }
            b'<' => {
                if let Some((next_index, delta)) = scan_icu_tag(bytes, index) {
                    match delta {
                        1 => {
                            tag_depth += 1;
                            if (brace_depth / 2) + tag_depth > max_depth {
                                return true;
                            }
                        }
                        -1 => {
                            tag_depth = tag_depth.saturating_sub(1);
                        }
                        _ => {}
                    }
                    index = next_index;
                } else {
                    index += 1;
                }
            }
            _ => {
                index += 1;
            }
        }
    }
    false
}

fn scan_icu_tag(bytes: &[u8], start: usize) -> Option<(usize, i8)> {
    let mut cursor = start + 1;
    let closing = bytes.get(cursor) == Some(&b'/');
    if closing {
        cursor += 1;
    } else if !bytes.get(cursor).is_some_and(u8::is_ascii_alphanumeric) {
        return None;
    }
    let name_start = cursor;
    while bytes
        .get(cursor)
        .is_some_and(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
    {
        cursor += 1;
    }
    if cursor == name_start {
        return None;
    }
    if !closing && bytes.get(cursor) == Some(&b'/') && bytes.get(cursor + 1) == Some(&b'>') {
        return Some((cursor + 2, 0));
    }
    if bytes.get(cursor) == Some(&b'>') {
        return Some((cursor + 1, if closing { -1 } else { 1 }));
    }
    None
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
            if exceeds_icu_nesting_depth(pattern, MAX_NESTING_DEPTH) {
                return Some((id.clone(), RuntimeCompiledMessage::Lazy));
            }
            let nodes = match parse_icu(pattern)
                .ok()
                .and_then(|parsed| convert_nodes(parsed.nodes, false, 0))
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

fn convert_nodes(
    nodes: Vec<IcuNode>,
    in_plural: bool,
    depth: usize,
) -> Option<Vec<RuntimeMessageNode>> {
    if depth > MAX_NESTING_DEPTH {
        return None;
    }
    let mut converted = Vec::with_capacity(nodes.len());
    for node in nodes {
        let node = convert_node(node, in_plural, depth)?;
        push_node(&mut converted, node);
    }
    Some(converted)
}

fn convert_node(node: IcuNode, in_plural: bool, depth: usize) -> Option<RuntimeMessageNode> {
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
            options: convert_options(options, in_plural, depth + 1)?,
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
            options: convert_options(options, true, depth + 1)?,
        }),
        IcuNode::Pound => Some(RuntimeMessageNode::Pound),
        IcuNode::Tag { name, children } => Some(RuntimeMessageNode::Tag {
            name,
            children: convert_nodes(children, in_plural, depth + 1)?,
        }),
        _ => None,
    }
}

fn convert_options(
    options: Vec<ferrocat_icu::IcuOption>,
    in_plural: bool,
    depth: usize,
) -> Option<BTreeMap<String, Vec<RuntimeMessageNode>>> {
    options
        .into_iter()
        .map(|option| {
            Some((
                option.selector,
                convert_nodes(option.value, in_plural, depth)?,
            ))
        })
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

    use super::{RuntimeCompiledMessage, RuntimeMessageNode, compile_runtime_catalog_messages};

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
    fn marks_unsupported_formatter_kinds_as_unlowerable() {
        let messages = BTreeMap::from([("message".to_owned(), "Items: {items, list}".to_owned())]);
        assert_eq!(
            compile_runtime_catalog_messages(&messages).get("message"),
            Some(&RuntimeCompiledMessage::Lazy)
        );
    }

    #[test]
    fn rejects_excessively_nested_icu_messages() {
        fn build_nested_tags(depth: usize) -> Vec<ferrocat_icu::IcuNode> {
            let mut nodes = vec![ferrocat_icu::IcuNode::Literal("leaf".to_owned())];
            for level in 0..depth {
                nodes = vec![ferrocat_icu::IcuNode::Tag {
                    name: format!("t{level}"),
                    children: nodes,
                }];
            }
            nodes
        }

        assert!(
            super::convert_nodes(build_nested_tags(super::MAX_NESTING_DEPTH), false, 0).is_some()
        );
        assert!(
            super::convert_nodes(build_nested_tags(super::MAX_NESTING_DEPTH + 1), false, 0)
                .is_none()
        );

        let mut deep_pattern = String::from("leaf");
        for _ in 0..=super::MAX_NESTING_DEPTH {
            deep_pattern = format!("{{kind, select, other {{{deep_pattern}}}}}");
        }
        assert_eq!(compile(&deep_pattern), Some(RuntimeCompiledMessage::Lazy));

        // Very deep inputs (10,000 levels) must be rejected before recursive
        // `ferrocat_icu::parse_icu` can overflow the call stack.
        let huge_choices = format!(
            "{}leaf{}",
            "{kind, select, other {".repeat(10_000),
            "}}".repeat(10_000)
        );
        assert_eq!(compile(&huge_choices), Some(RuntimeCompiledMessage::Lazy));

        let prefixed_huge_choices = format!("'# {huge_choices}");
        assert_eq!(
            compile(&prefixed_huge_choices),
            Some(RuntimeCompiledMessage::Lazy)
        );

        let huge_tags = format!("{}leaf{}", "<a>".repeat(10_000), "</a>".repeat(10_000));
        assert_eq!(compile(&huge_tags), Some(RuntimeCompiledMessage::Lazy));

        let huge_dotted_tags = format!(
            "{}leaf{}",
            "<ui.label>".repeat(10_000),
            "</ui.label>".repeat(10_000)
        );
        assert_eq!(
            compile(&huge_dotted_tags),
            Some(RuntimeCompiledMessage::Lazy)
        );
    }
}
