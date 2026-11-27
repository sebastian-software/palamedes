//! Source/target ICU compatibility shared by audit and translation writeback.

use std::collections::BTreeMap;

use ferrocat_icu::{
    IcuCompatibilityOptions, IcuDiagnostic, IcuDiagnosticSeverity, IcuMessage, IcuNode,
    IcuParseError, compare_icu_messages,
};

use crate::icu_text::parse_runtime_icu;

/// Pre-parsed source ICU message and plain-argument occurrence table reused
/// across target locales during catalog audits.
pub(crate) struct ParsedSourceIcu {
    message: IcuMessage,
    plain_counts: Option<BTreeMap<String, usize>>,
}

impl ParsedSourceIcu {
    pub(crate) fn parse(source: &str) -> Result<Self, IcuParseError> {
        let message = parse_runtime_icu(source)?;
        let plain_counts = plain_argument_occurrences(&message);
        Ok(Self {
            message,
            plain_counts,
        })
    }

    pub(crate) fn compare_translation(
        &self,
        translation: &str,
    ) -> Result<Vec<IcuDiagnostic>, IcuParseError> {
        let translation_message = parse_runtime_icu(translation)?;
        let mut diagnostics = compare_icu_messages(
            &self.message,
            &translation_message,
            &IcuCompatibilityOptions::default(),
        )
        .diagnostics;

        // Occurrence counts are meaningful for plain messages, not across locale-specific choices.
        if let (Some(source_counts), Some(target_counts)) = (
            self.plain_counts.as_ref(),
            plain_argument_occurrences(&translation_message),
        ) {
            for (name, &source_count) in source_counts {
                let Some(target_count) = target_counts.get(name).copied() else {
                    continue;
                };
                if source_count != target_count {
                    diagnostics.push(IcuDiagnostic {
                        severity: IcuDiagnosticSeverity::Error,
                        code: "icu.argument_occurrence_mismatch".into(),
                        message: format!(
                            "ICU argument `{name}` appears {source_count} occurrence(s) in the source and {target_count} in the translation."
                        ),
                        name: Some(name.clone()),
                    });
                }
            }
        }
        Ok(diagnostics)
    }
}

pub(crate) fn compare_runtime_icu(
    source: &str,
    translation: &str,
) -> Result<Vec<IcuDiagnostic>, IcuParseError> {
    ParsedSourceIcu::parse(source)?.compare_translation(translation)
}

fn plain_argument_occurrences(message: &IcuMessage) -> Option<BTreeMap<String, usize>> {
    let mut counts = BTreeMap::new();
    count_plain_arguments(message, &mut counts).then_some(counts)
}

fn count_plain_arguments(message: &IcuMessage, counts: &mut BTreeMap<String, usize>) -> bool {
    count_plain_argument_nodes(&message.nodes, counts)
}

fn count_plain_argument_nodes(nodes: &[IcuNode], counts: &mut BTreeMap<String, usize>) -> bool {
    for node in nodes {
        let name = match node {
            IcuNode::Argument { name }
            | IcuNode::Number { name, .. }
            | IcuNode::Date { name, .. }
            | IcuNode::Time { name, .. }
            | IcuNode::List { name, .. }
            | IcuNode::Duration { name, .. }
            | IcuNode::Ago { name, .. }
            | IcuNode::Name { name, .. } => Some(name),
            IcuNode::Select { .. } | IcuNode::Plural { .. } => return false,
            IcuNode::Tag { children, .. } => {
                if !count_plain_argument_nodes(children, counts) {
                    return false;
                }
                None
            }
            IcuNode::Literal(_) | IcuNode::Pound => None,
            _ => None,
        };
        if let Some(name) = name {
            *counts.entry(name.clone()).or_default() += 1;
        }
    }
    true
}
