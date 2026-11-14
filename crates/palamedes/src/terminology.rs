//! Caller-owned terminology relevance, independent of catalogs and translation providers.

use std::collections::BTreeSet;

use ferrocat_icu::IcuNode;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::icu_text::parse_runtime_icu;

/// Caller intent; neither variant turns a source match into target-language QA.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TerminologyKind {
    /// Exact spelling the caller wants to preserve, including a supplied target spelling.
    Protected,
    /// Translation guidance the caller may adapt for grammar, inflection, or context.
    Advisory,
}

/// One format-neutral entry supplied and owned by the caller.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminologyEntry {
    /// Nonblank, unique, case-sensitive identity; returned unchanged in matches.
    pub id: String,
    /// Nonblank literal source phrase, not ICU syntax.
    pub source: String,
    /// Whether this is exact protection or advisory translation guidance.
    pub kind: TerminologyKind,
    /// Optional nonblank target spelling; absent protected entries preserve `source`.
    pub preferred_target: Option<String>,
    /// Optional caller guidance; the matcher does not interpret it.
    pub note: Option<String>,
}

/// One decoded authored ICU message and its caller-supplied terminology.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminologyRequest {
    /// ICU MessageFormat v1 under Palamedes' runtime apostrophe policy.
    pub message: String,
    /// Entries validated before any matches are returned. An empty list is allowed.
    pub entries: Vec<TerminologyEntry>,
}

/// One exact occurrence in a native parsed ICU literal.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminologyMatch {
    /// Stable identity of the supplied entry, including nonpreferred overlaps.
    pub entry_id: String,
    /// Caller intent, preserved without assigning linguistic correctness.
    pub kind: TerminologyKind,
    /// AST path: node index, then child index for tags, or option index and node index
    /// for plural/select branches, recursively. Indices follow native parser order.
    pub literal_path: Vec<usize>,
    /// Decoded native literal containing this occurrence.
    pub literal: String,
    /// Inclusive UTF-8 byte offset in `literal`, never in the raw ICU message.
    pub start: usize,
    /// Exclusive UTF-8 byte offset in `literal`, never a JavaScript UTF-16 index.
    pub end: usize,
    /// Part of the longest-first nonoverlapping selection within this literal.
    /// Other relevant matches remain present, including protected/advisory overlaps.
    pub preferred: bool,
}

/// Invalid terminology input or malformed authored ICU. No partial matches are returned.
#[derive(Debug, Error)]
pub enum TerminologyError {
    /// A required string or supplied target spelling was blank.
    #[error("Terminology entry {index} has a blank {field}.")]
    BlankField {
        /// Zero-based input entry index.
        index: usize,
        /// Name of the invalid field.
        field: &'static str,
    },
    /// Two entries used the same exact identifier.
    #[error("Duplicate terminology entry ID: {id}")]
    DuplicateId {
        /// Duplicated identity.
        id: String,
    },
    /// Native ICU parsing failed.
    #[error(transparent)]
    ParseIcu(#[from] ferrocat_icu::IcuParseError),
}

/// Finds caller-supplied phrases in decoded native ICU literal nodes.
///
/// Matching is exact, case-sensitive substring matching: no Unicode normalization,
/// case folding, word segmentation, or punctuation/whitespace rewriting. A phrase
/// never crosses a placeholder, tag, choice branch, or other literal boundary.
/// Placeholder names, tag names, selectors, and formatter styles are not searched.
///
/// Every occurrence is returned, including self-overlaps. Within each literal,
/// `preferred` greedily selects nonoverlapping matches by descending UTF-8 byte
/// length, then ascending start offset and entry ID. Output follows native AST
/// traversal, then start offset, descending length, and ID; entry input order
/// does not affect it. Protection has no implicit precedence over advisory terms.
///
/// This is a relevance primitive, not target validation. Callers own any review
/// policy; source/target substring agreement cannot establish linguistic quality.
///
/// # Errors
///
/// Rejects blank IDs/sources/explicit targets, duplicate IDs, and malformed ICU.
pub fn match_terminology(
    request: &TerminologyRequest,
) -> Result<Vec<TerminologyMatch>, TerminologyError> {
    let mut ids = BTreeSet::new();
    for (index, entry) in request.entries.iter().enumerate() {
        for (field, value) in [
            ("id", Some(entry.id.as_str())),
            ("source", Some(entry.source.as_str())),
            ("preferredTarget", entry.preferred_target.as_deref()),
        ] {
            if value.is_some_and(|value| value.trim().is_empty()) {
                return Err(TerminologyError::BlankField { index, field });
            }
        }
        if !ids.insert(&entry.id) {
            return Err(TerminologyError::DuplicateId {
                id: entry.id.clone(),
            });
        }
    }
    let message = parse_runtime_icu(&request.message)?;
    let mut matches = Vec::new();
    visit_literals(
        &message.nodes,
        &mut Vec::new(),
        &request.entries,
        &mut matches,
    );
    Ok(matches)
}

fn visit_literals(
    nodes: &[IcuNode],
    path: &mut Vec<usize>,
    entries: &[TerminologyEntry],
    matches: &mut Vec<TerminologyMatch>,
) {
    for (index, node) in nodes.iter().enumerate() {
        path.push(index);
        match node {
            IcuNode::Literal(literal) => matches.extend(match_literal(literal, path, entries)),
            IcuNode::Tag { children, .. } => visit_literals(children, path, entries, matches),
            IcuNode::Plural { options, .. } | IcuNode::Select { options, .. } => {
                for (option_index, option) in options.iter().enumerate() {
                    path.push(option_index);
                    visit_literals(&option.value, path, entries, matches);
                    path.pop();
                }
            }
            _ => {}
        }
        path.pop();
    }
}

fn match_literal(
    literal: &str,
    path: &[usize],
    entries: &[TerminologyEntry],
) -> Vec<TerminologyMatch> {
    let mut matches = Vec::new();
    for entry in entries {
        // `match_indices` omits self-overlaps. Starting at every Unicode scalar
        // boundary retains them without ever slicing within a UTF-8 sequence.
        for (start, _) in literal.char_indices() {
            if literal[start..].starts_with(&entry.source) {
                matches.push(TerminologyMatch {
                    entry_id: entry.id.clone(),
                    kind: entry.kind,
                    literal_path: path.to_vec(),
                    literal: literal.to_owned(),
                    start,
                    end: start + entry.source.len(),
                    preferred: false,
                });
            }
        }
    }
    matches.sort_by(|left, right| {
        (right.end - right.start)
            .cmp(&(left.end - left.start))
            .then_with(|| left.start.cmp(&right.start))
            .then_with(|| left.entry_id.cmp(&right.entry_id))
    });
    let mut preferred_ranges = Vec::new();
    for matched in &mut matches {
        if preferred_ranges
            .iter()
            .all(|&(start, end)| matched.end <= start || matched.start >= end)
        {
            matched.preferred = true;
            preferred_ranges.push((matched.start, matched.end));
        }
    }
    matches.sort_by(|left, right| {
        left.start
            .cmp(&right.start)
            .then_with(|| (right.end - right.start).cmp(&(left.end - left.start)))
            .then_with(|| left.entry_id.cmp(&right.entry_id))
    });
    matches
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str, source: &str, kind: TerminologyKind) -> TerminologyEntry {
        TerminologyEntry {
            id: id.into(),
            source: source.into(),
            kind,
            preferred_target: None,
            note: None,
        }
    }

    fn run(message: &str, entries: Vec<TerminologyEntry>) -> Vec<TerminologyMatch> {
        match_terminology(&TerminologyRequest {
            message: message.into(),
            entries,
        })
        .unwrap()
    }

    #[test]
    fn retains_protected_overlaps_and_prefers_longest_independent_of_entry_order() {
        let entries = vec![
            entry("java", "Java", TerminologyKind::Protected),
            entry("script", "JavaScript", TerminologyKind::Advisory),
            entry("alias", "JavaScript", TerminologyKind::Advisory),
        ];
        let matches = run("JavaScript, Java!", entries.clone());
        assert_eq!(
            matches
                .iter()
                .map(|m| (m.entry_id.as_str(), m.start, m.end, m.preferred))
                .collect::<Vec<_>>(),
            [
                ("alias", 0, 10, true),
                ("script", 0, 10, false),
                ("java", 0, 4, false),
                ("java", 12, 16, true)
            ]
        );
        assert_eq!(matches[2].kind, TerminologyKind::Protected);
        assert_eq!(
            matches,
            run("JavaScript, Java!", entries.into_iter().rev().collect())
        );
    }

    #[test]
    fn exact_substrings_cover_cjk_punctuation_and_unicode_without_normalization() {
        let matches = run(
            "東京。JavaScript java café cafe\u{301} 🙂東京",
            vec![
                entry("city", "東京", TerminologyKind::Protected),
                entry("java", "Java", TerminologyKind::Advisory),
                entry("accent", "café", TerminologyKind::Advisory),
                entry("punctuation", "。", TerminologyKind::Advisory),
            ],
        );
        assert_eq!(
            matches
                .iter()
                .map(|m| m.entry_id.as_str())
                .collect::<Vec<_>>(),
            ["city", "punctuation", "java", "accent", "city"]
        );
        for m in matches {
            let expected = match m.entry_id.as_str() {
                "city" => "東京",
                "java" => "Java",
                "accent" => "café",
                _ => "。",
            };
            assert_eq!(&m.literal[m.start..m.end], expected);
            assert_eq!(m.literal_path, [0]);
        }
    }

    #[test]
    fn traverses_choice_and_tag_literals_but_ignores_syntax_and_fragment_boundaries() {
        let matches = run(
            "{Java} <Java>Java</Java> {Java, select, Java {Java} other {{count, plural, one {Java} other {# Java}}}}",
            vec![
                entry("java", "Java", TerminologyKind::Protected),
                entry("count", "count", TerminologyKind::Advisory),
                entry("cross", "Java Java", TerminologyKind::Advisory),
            ],
        );
        assert_eq!(matches.len(), 4);
        assert!(matches.iter().all(|m| m.entry_id == "java"));
        assert_eq!(matches[0].literal_path, [2, 0]);
        assert_ne!(matches[1].literal_path, matches[2].literal_path);
        assert_ne!(matches[2].literal_path, matches[3].literal_path);
        assert!(
            run(
                "{Java, number} <Java></Java>",
                vec![entry("java", "Java", TerminologyKind::Advisory)]
            )
            .is_empty()
        );
    }

    #[test]
    fn ranges_index_decoded_quoted_literals_and_all_self_overlaps_are_retained() {
        let quoted = run(
            "🙂 '{Java}' don't",
            vec![entry("quoted", "{Java}", TerminologyKind::Protected)],
        );
        assert_eq!(quoted[0].literal, "🙂 {Java} don't");
        assert_eq!((quoted[0].start, quoted[0].end), (5, 11));
        let overlaps = run(
            "ababa",
            vec![entry("aba", "aba", TerminologyKind::Advisory)],
        );
        assert_eq!(
            overlaps
                .iter()
                .map(|m| (m.start, m.end, m.preferred))
                .collect::<Vec<_>>(),
            [(0, 3, true), (2, 5, false)]
        );
    }

    #[test]
    fn longer_later_occurrences_win_without_dropping_earlier_protection() {
        let matches = run(
            "abcde",
            vec![
                entry("short", "abc", TerminologyKind::Protected),
                entry("long", "bcde", TerminologyKind::Advisory),
            ],
        );
        assert_eq!(
            matches
                .iter()
                .map(|m| (m.entry_id.as_str(), m.preferred))
                .collect::<Vec<_>>(),
            [("short", false), ("long", true)]
        );
    }

    #[test]
    fn ordinal_branches_are_literals_but_formatter_styles_and_entry_guidance_are_not() {
        let matches = run(
            "{rank, selectordinal, one {東京語} other {# 東京}} {amount, number, ::currency/USD}",
            vec![
                entry("city", "東京", TerminologyKind::Protected),
                entry("style", "USD", TerminologyKind::Advisory),
                TerminologyEntry {
                    preferred_target: Some("東京".into()),
                    note: Some("東京".into()),
                    ..entry("guidance", "absent", TerminologyKind::Advisory)
                },
            ],
        );
        assert_eq!(matches.len(), 2);
        assert!(matches.iter().all(|m| m.entry_id == "city"));
        assert_eq!(matches[0].literal, "東京語");
    }

    #[test]
    fn validates_all_entries_and_icu_including_when_no_terms_match() {
        for (field, invalid) in [
            (
                "id",
                TerminologyEntry {
                    id: " ".into(),
                    ..entry("valid", "Java", TerminologyKind::Protected)
                },
            ),
            ("source", entry("valid", "\t", TerminologyKind::Advisory)),
            (
                "preferredTarget",
                TerminologyEntry {
                    preferred_target: Some(String::new()),
                    ..entry("valid", "Java", TerminologyKind::Advisory)
                },
            ),
        ] {
            assert!(
                matches!(match_terminology(&TerminologyRequest { message: "other".into(), entries: vec![invalid] }),
                Err(TerminologyError::BlankField { index: 0, field: f }) if f == field)
            );
        }
        let duplicate = vec![
            entry("same", "one", TerminologyKind::Protected),
            entry("same", "two", TerminologyKind::Advisory),
        ];
        assert!(matches!(
            match_terminology(&TerminologyRequest {
                message: "other".into(),
                entries: duplicate
            }),
            Err(TerminologyError::DuplicateId { .. })
        ));
        assert!(matches!(
            match_terminology(&TerminologyRequest {
                message: "{broken".into(),
                entries: vec![]
            }),
            Err(TerminologyError::ParseIcu(_))
        ));
        assert!(run("valid", vec![]).is_empty());
    }
}
