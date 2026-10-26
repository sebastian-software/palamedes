//! Read-only, source-aware review signals for proposed and stored target text.

use std::collections::BTreeMap;

use ferrocat_icu::IcuNode;
use serde::{Deserialize, Serialize};

use crate::icu_text::parse_runtime_icu;
use crate::{CatalogDiagnosticSeverity, TranslationCandidateId, TranslationValue};

/// Optional target-text review checks. Both checks default to disabled.
#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetTextCheckOptions {
    /// Warn about whole-message boundary whitespace absent on the same source boundary.
    #[serde(default)]
    pub boundary_whitespace: bool,
    /// Warn about additional native PO metadata markers in visible target literals.
    #[serde(default)]
    pub metadata_leakage: bool,
}

/// Half-open UTF-8 byte range in the original decoded target string.
///
/// This is neither a PO-file location nor a JavaScript UTF-16 character range.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetTextSpan {
    /// Inclusive starting byte offset.
    pub start: usize,
    /// Exclusive ending byte offset.
    pub end: usize,
}

/// One proposed translation value, before catalog escaping or writeback.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationTargetText {
    /// Candidate identity; its message supplies the source text.
    pub id: TranslationCandidateId,
    /// Proposed content in the existing candidate/patch representation.
    pub translation: TranslationValue,
}

/// Request for read-only checks of proposed translation strings.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationTargetTextRequest {
    /// Proposed values, checked in request order.
    pub targets: Vec<TranslationTargetText>,
    /// Explicitly enabled checks.
    #[serde(default)]
    pub checks: TargetTextCheckOptions,
}

/// One optional review warning for a proposed translation.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationTargetTextDiagnostic {
    /// Always a warning; these checks do not reject patch writeback.
    pub severity: CatalogDiagnosticSeverity,
    /// Stable machine-readable code.
    pub code: String,
    /// Human-readable review signal.
    pub message: String,
    /// Relevant byte range in the containing result's `target`.
    pub span: TargetTextSpan,
}

/// Optional review findings for one proposed value, with shared identity and payload.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationTargetTextResult {
    /// Candidate identity, including target locale.
    pub id: TranslationCandidateId,
    /// Decoded ICU payload checked by Core; diagnostic spans index this string.
    pub target: String,
    /// Review warnings for this value. Empty results are omitted from the response.
    pub diagnostics: Vec<TranslationTargetTextDiagnostic>,
}

/// Checks proposed values without reading or writing catalogs.
///
/// Invalid source or rendered target ICU is skipped: use the existing ICU validation
/// APIs for syntax errors. Rendering a projected plural can itself fail (see Errors).
/// Boundary checks apply only to the whole message, not branch or tag fragments.
/// Metadata exemptions match the source's marker keys and occurrence counts.
///
/// # Errors
///
/// Returns an error when a projected plural branch cannot be rendered as ICU.
pub fn check_translation_targets(
    request: &TranslationTargetTextRequest,
) -> crate::PalamedesResult<Vec<TranslationTargetTextResult>> {
    let mut results = Vec::new();
    if !request.checks.boundary_whitespace && !request.checks.metadata_leakage {
        return Ok(results);
    }
    for target in &request.targets {
        let rendered =
            crate::translation_candidates::render_translation_value(&target.translation)?;
        let diagnostics = check_target_text(&target.id.message, &rendered, request.checks)
            .into_iter()
            .map(|warning| TranslationTargetTextDiagnostic {
                severity: CatalogDiagnosticSeverity::Warning,
                code: warning.code.to_owned(),
                message: warning.message.to_owned(),
                span: warning.span,
            })
            .collect::<Vec<_>>();
        if !diagnostics.is_empty() {
            results.push(TranslationTargetTextResult {
                id: target.id.clone(),
                target: rendered,
                diagnostics,
            });
        }
    }
    Ok(results)
}

pub(crate) struct TargetTextWarning {
    pub(crate) code: &'static str,
    pub(crate) message: &'static str,
    pub(crate) span: TargetTextSpan,
}

pub(crate) fn check_target_text(
    source: &str,
    target: &str,
    checks: TargetTextCheckOptions,
) -> Vec<TargetTextWarning> {
    if !checks.boundary_whitespace && !checks.metadata_leakage {
        return Vec::new();
    }
    let (Ok(source_message), Ok(target_message)) =
        (parse_runtime_icu(source), parse_runtime_icu(target))
    else {
        return Vec::new();
    };
    let mut warnings = Vec::new();
    if checks.boundary_whitespace && !target.is_empty() {
        let start_end = target.len() - target.trim_start_matches(char::is_whitespace).len();
        let leading_reported = start_end > 0 && !source.starts_with(char::is_whitespace);
        if leading_reported {
            warnings.push(TargetTextWarning {
                code: "target.boundary_whitespace",
                message: "Target introduces leading whitespace absent from the source boundary.",
                span: TargetTextSpan {
                    start: 0,
                    end: start_end,
                },
            });
        }
        let end_start = target.trim_end_matches(char::is_whitespace).len();
        if end_start < target.len()
            && !(leading_reported && end_start == 0)
            && !source.ends_with(char::is_whitespace)
        {
            warnings.push(TargetTextWarning {
                code: "target.boundary_whitespace",
                message: "Target introduces trailing whitespace absent from the source boundary.",
                span: TargetTextSpan {
                    start: end_start,
                    end: target.len(),
                },
            });
        }
    }
    if checks.metadata_leakage {
        let mut source_markers = BTreeMap::<String, usize>::new();
        for (key, _) in literal_markers(source, &source_message.nodes) {
            *source_markers.entry(key).or_default() += 1;
        }
        for (key, span) in literal_markers(target, &target_message.nodes) {
            if let Some(remaining) = source_markers.get_mut(&key)
                && *remaining > 0
            {
                *remaining -= 1;
                continue;
            }
            warnings.push(TargetTextWarning {
                code: "target.metadata_leakage",
                message: "Target introduces a catalog metadata marker absent from the source literals.",
                span,
            });
        }
    }
    warnings.sort_by_key(|warning| (warning.span.start, warning.span.end, warning.code));
    warnings
}

fn literal_contains(nodes: &[IcuNode], text: &str) -> bool {
    nodes.iter().any(|node| match node {
        IcuNode::Literal(value) => value.contains(text),
        IcuNode::Tag { children, .. } => literal_contains(children, text),
        IcuNode::Plural { options, .. } | IcuNode::Select { options, .. } => options
            .iter()
            .any(|option| literal_contains(&option.value, text)),
        _ => false,
    })
}

fn probed_marker(nodes: &[IcuNode], start_probe: &str, end_probe: &str) -> Option<String> {
    for node in nodes {
        let marker = match node {
            IcuNode::Literal(value) => value.find(start_probe).and_then(|start| {
                let remaining = &value[start + start_probe.len()..];
                remaining
                    .find(end_probe)
                    .map(|end| format!("#{}", &remaining[..end]))
            }),
            IcuNode::Tag { children, .. } => probed_marker(children, start_probe, end_probe),
            IcuNode::Plural { options, .. } | IcuNode::Select { options, .. } => options
                .iter()
                .find_map(|option| probed_marker(&option.value, start_probe, end_probe)),
            _ => None,
        };
        if marker.is_some() {
            return marker;
        }
    }
    None
}

fn literal_markers(value: &str, nodes: &[IcuNode]) -> Vec<(String, TargetTextSpan)> {
    let mut markers = Vec::new();
    let mut probe = "PALAMEDES_TARGET_TEXT_PROBE".to_owned();
    while value.contains(&probe) || literal_contains(nodes, &probe) {
        probe.push('_');
    }
    let start_probe = format!("#{probe}_START");
    let end_probe = format!("{probe}_END");
    for (start, _) in value.match_indices('#') {
        let line = value[start..].lines().next().unwrap_or_default();
        let Some(colon) = line.find(':') else {
            continue;
        };
        let end = start + colon + 1;
        // Preserve every original byte, especially apostrophe quoting. Inserting after
        // '#' keeps its original quote trigger and plural-Pound interpretation intact.
        // Both probes must land in one native Literal; formatter styles and separate
        // argument/tag nodes cannot masquerade as a visible metadata header.
        let probed = format!(
            "{}{}{}{}{}",
            &value[..start + 1],
            &start_probe[1..],
            &value[start + 1..end],
            end_probe,
            &value[end..]
        );
        let Ok(parsed_message) = parse_runtime_icu(&probed) else {
            continue;
        };
        let Some(marker) = probed_marker(&parsed_message.nodes, &start_probe, &end_probe) else {
            continue;
        };
        // Let the native PO parser recognize its own decoded metadata grammar,
        // including custom keys. No user catalog state is parsed or written here.
        let Ok(parsed) =
            ferrocat::parse_po(&format!("{marker} value\nmsgid \"x\"\nmsgstr \"x\"\n"))
        else {
            continue;
        };
        if let Some((key, _)) = parsed.items.first().and_then(|item| item.metadata.first()) {
            markers.push((key.to_owned(), TargetTextSpan { start, end }));
        }
    }
    markers
}

#[cfg(test)]
mod tests {
    use super::*;

    const CHECKS: TargetTextCheckOptions = TargetTextCheckOptions {
        boundary_whitespace: true,
        metadata_leakage: true,
    };

    #[test]
    fn distinguishes_render_failures_from_optional_text_checks() {
        let id = crate::TranslationCandidateId {
            catalog: "{locale}".to_owned(),
            locale: "de".to_owned(),
            message: "Save".to_owned(),
            context: None,
        };
        let mut request = TranslationTargetTextRequest {
            targets: vec![TranslationTargetText {
                id,
                translation: TranslationValue::Singular {
                    value: " {broken".to_owned(),
                },
            }],
            checks: CHECKS,
        };
        assert!(
            check_translation_targets(&request)
                .expect("singular syntax left to validator")
                .is_empty()
        );
        request.targets[0].translation = TranslationValue::Plural {
            variable: "n".to_owned(),
            plural_kind: crate::TranslationPluralKind::Cardinal,
            offset: 0,
            values: BTreeMap::from([("other".to_owned(), "{broken".to_owned())]),
        };
        assert!(check_translation_targets(&request).is_err());
        request.checks = TargetTextCheckOptions::default();
        assert!(
            check_translation_targets(&request)
                .expect("disabled checks do not render")
                .is_empty()
        );
    }

    #[test]
    fn checks_only_introduced_whole_message_boundary_whitespace() {
        for (source, target) in [
            (" Save ", " Speichern "),
            ("\tSave\n", "\tSpeichern\n"),
            ("Save!", "Enregistrer\u{a0}!"),
            ("Save", "保存\u{202f}!"),
            ("<b>Save</b>", "<b> Speichern </b>"),
            (
                "{n, plural, other {Save}}",
                "{n, plural, other { Speichern }}",
            ),
            ("Contact", "büro@例え.テスト"),
        ] {
            assert!(
                check_target_text(source, target, CHECKS).is_empty(),
                "{target}"
            );
        }
        for target in [
            " Speichern",
            "\tSpeichern",
            "\nSpeichern",
            "\u{2003}Speichern",
            "\u{a0}Speichern",
        ] {
            let warnings = check_target_text("Save", target, CHECKS);
            assert_eq!(warnings.len(), 1, "{target}");
            assert_eq!(
                &target[warnings[0].span.start..warnings[0].span.end],
                target.chars().next().unwrap().to_string()
            );
        }
        let whitespace_only = check_target_text(" Save", " ", CHECKS);
        assert_eq!(whitespace_only.len(), 1);
        assert!(whitespace_only[0].message.contains("trailing"));
        assert_eq!(check_target_text("Save", " ", CHECKS).len(), 1);
        let warnings = check_target_text("Save", "Épargner\t\n", CHECKS);
        assert_eq!(
            &"Épargner\t\n"[warnings[0].span.start..warnings[0].span.end],
            "\t\n"
        );
    }

    #[test]
    fn recognizes_native_markers_and_counts_source_exemptions_by_key() {
        for target in [
            "Speichern #@ lock: abc",
            "<b>Speichern #@ owner: checkout</b>",
            "{x, select, other {Speichern #@ ai: model}}",
        ] {
            let warnings = check_target_text("Save", target, CHECKS);
            assert_eq!(warnings.len(), 1, "{target}");
            assert_eq!(warnings[0].code, "target.metadata_leakage");
        }
        assert!(
            check_target_text(
                "{n, plural, other {'#@ lock': abc}}",
                "{n, plural, other {'#'@ lock: abc}}",
                CHECKS
            )
            .is_empty()
        );
        let warnings = check_target_text(
            "Use #@ lock: abc",
            "Nutze #@ lock: def\n#@ ai: model",
            CHECKS,
        );
        assert_eq!(warnings.len(), 1);
        assert_eq!(
            &"Nutze #@ lock: def\n#@ ai: model"[warnings[0].span.start..warnings[0].span.end],
            "#@ ai:"
        );
        assert_eq!(
            check_target_text("Use #@ lock: abc", "#@ lock: a\n#@ lock: b", CHECKS).len(),
            1
        );
        assert!(check_target_text("Use #@ lock: abc", "Nutze #@ lock: def", CHECKS).is_empty());
        assert!(check_target_text("Save", "Speichern #@ without a colon", CHECKS).is_empty());
    }

    #[test]
    fn preserves_original_offsets_through_unicode_and_icu_quoting() {
        for target in [
            "Été '#@ lock: abc'",
            "L'été #@ lock: abc",
            "{n, plural, other {'#@ lock: abc'}}",
            "{n, plural, other {'#'@ lock: abc}}",
            "{n, plural, other {'#@ lock': abc}}",
        ] {
            let warnings = check_target_text("Save", target, CHECKS);
            assert_eq!(warnings.len(), 1, "{target}");
            assert_eq!(
                &target[warnings[0].span.start..warnings[0].span.end],
                if target.contains("'#'@") {
                    "#'@ lock:"
                } else if target.contains("lock':") {
                    "#@ lock':"
                } else {
                    "#@ lock:"
                }
            );
        }
        assert!(check_target_text("Save", "{n, plural, other {#@ lock: abc}}", CHECKS).is_empty());
        assert!(check_target_text("Save", "{n, number, #@ lock: abc}", CHECKS).is_empty());
        let target = "{n, number, #@ lock: abc} #@ lock: abc";
        let warnings = check_target_text("Save", target, CHECKS);
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].span.start, target.rfind("#@").unwrap());
        assert!(
            check_target_text(
                "Save",
                " Speichern #@ lock: abc",
                TargetTextCheckOptions::default()
            )
            .is_empty()
        );
        assert!(check_target_text("Save", " {bad", CHECKS).is_empty());
    }
}
