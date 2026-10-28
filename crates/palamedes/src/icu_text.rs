//! Shared helpers that keep authored ICU text and the JS runtime parser aligned.
//!
//! The runtime parser (`packages/core/src/messageFormat.ts`) implements lenient
//! ICU apostrophe quoting:
//!
//! * `''` renders a single literal apostrophe.
//! * A single `'` starts a quoted literal only when the next character is `{`,
//!   `}`, or — inside a plural/selectordinal branch — `#`.
//! * Every other apostrophe is ordinary text (`don't` renders verbatim).
//! * An unterminated quote auto-closes at the end of the pattern.
//!
//! Authored literal text (JSX text, MDX text, template-literal quasis, and
//! choice branch text) is lowered in two steps. [`escape_icu_literal`] turns
//! one literal segment into unambiguous runtime ICU: apostrophes are doubled
//! and literal braces are quoted. Extraction and the transform assemble the
//! same lowered message from these segments. [`catalog_icu_spelling`] then
//! rewrites the whole message into its shortest catalog spelling, which keeps
//! natural prose apostrophes such as `don't` unchanged in persisted `msgid`s.

use std::borrow::Cow;

use ferrocat_icu::{IcuMessage, IcuParseError, parse_icu};

/// ICU quoting policy implemented by the Palamedes JavaScript runtime.
pub(crate) const RUNTIME_ICU_SYNTAX_POLICY: ferrocat::IcuSyntaxPolicy =
    ferrocat::IcuSyntaxPolicy::RuntimeLiteralApostrophes;

/// Canonicalizes ICU text under the JavaScript runtime's apostrophe policy.
pub(crate) fn canonicalize_runtime_icu(value: &str) -> Cow<'_, str> {
    ferrocat::canonicalize_icu_with_policy(value, RUNTIME_ICU_SYNTAX_POLICY)
}

/// Parses ICU text after applying the JavaScript runtime's apostrophe policy.
pub(crate) fn parse_runtime_icu(value: &str) -> Result<IcuMessage, IcuParseError> {
    parse_icu(&canonicalize_runtime_icu(value))
}

/// Escapes one authored literal segment for embedding into an ICU message.
///
/// Odd apostrophe runs are doubled; already doubled ICU apostrophes stay a
/// fixed point, so `It''s` keeps rendering `It's`. Literal `{` and `}` are
/// apostrophe-quoted: a `{` together with its matching `}`, so `Use {name}`
/// becomes `Use '{name}'`, and an unmatched brace on its own (`'{'`). A quote
/// never spans `#`, which stays plural syntax inside choice branches.
///
/// The output never ends inside a quote or with a lone apostrophe, so a
/// generated placeholder or branch brace appended after it stays ICU syntax.
/// The runtime apostrophe policy cannot quote `<`; a literal `<` that reads as
/// a rich-text tag is reported when the lowered message is checked instead.
pub(crate) fn escape_icu_literal(text: &str) -> String {
    if !text.contains(['\'', '{', '}']) {
        return text.to_owned();
    }

    let characters = text.chars().collect::<Vec<_>>();
    let mut output = String::with_capacity(text.len() + 4);
    let mut index = 0;
    while index < characters.len() {
        if is_icu_brace(characters[index]) {
            let end = quote_span_end(&characters, index);
            output.push('\'');
            push_escaped_apostrophes(&characters[index..=end], &mut output);
            output.push('\'');
            index = end + 1;
            continue;
        }

        let stop = characters[index..]
            .iter()
            .position(|character| is_icu_brace(*character))
            .map_or(characters.len(), |offset| index + offset);
        push_escaped_apostrophes(&characters[index..stop], &mut output);
        index = stop;
    }
    output
}

/// Doubles odd apostrophe runs and leaves every other character as ICU.
///
/// Choice branch string literals use this: their braces and `#` stay ICU
/// syntax, so a branch can hold a nested choice, while apostrophes stay
/// literal text as in every other authored message.
pub(crate) fn escape_icu_apostrophes(text: &str) -> String {
    if !text.contains('\'') {
        return text.to_owned();
    }
    let characters = text.chars().collect::<Vec<_>>();
    let mut output = String::with_capacity(text.len() + 2);
    push_escaped_apostrophes(&characters, &mut output);
    output
}

const fn is_icu_brace(character: char) -> bool {
    matches!(character, '{' | '}')
}

/// Returns the index of the last character that a quote opened at the brace
/// at `start` covers.
///
/// A `{` covers everything up to its matching `}`, so `{name}` is quoted as
/// one unit; any other brace covers itself. A span followed by another brace,
/// directly or after a run of apostrophes, absorbs that brace's span and the
/// apostrophes too. Two separate quotes would otherwise touch through their
/// closing and opening apostrophes, and the runtime would read the whole run
/// as escaped apostrophes inside one quote: `'{a}'` + `''` + `'{b}'` renders
/// `{a}''{b}`, while the single quote `'{a}''{b}'` renders `{a}'{b}`.
fn quote_span_end(characters: &[char], start: usize) -> usize {
    let mut end = single_quote_span_end(characters, start);
    loop {
        let next = end
            + 1
            + characters[end + 1..]
                .iter()
                .take_while(|character| **character == '\'')
                .count();
        if !characters
            .get(next)
            .is_some_and(|character| is_icu_brace(*character))
        {
            return end;
        }
        end = single_quote_span_end(characters, next);
    }
}

fn single_quote_span_end(characters: &[char], start: usize) -> usize {
    if characters[start] != '{' {
        return start;
    }
    let mut depth = 0usize;
    for (index, character) in characters.iter().enumerate().skip(start) {
        match character {
            // `#` must stay outside quotes to remain plural syntax.
            '#' => return start,
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return index;
                }
            }
            _ => {}
        }
    }
    start
}

/// Copies characters while doubling every odd apostrophe run.
fn push_escaped_apostrophes(characters: &[char], output: &mut String) {
    let mut index = 0;
    while index < characters.len() {
        if characters[index] != '\'' {
            output.push(characters[index]);
            index += 1;
            continue;
        }

        let run = characters[index..]
            .iter()
            .take_while(|character| **character == '\'')
            .count();
        let escaped = if run % 2 == 1 { run + 1 } else { run };
        output.extend(std::iter::repeat_n('\'', escaped));
        index += run;
    }
}

/// Rewrites a lowered runtime ICU message into its shortest catalog spelling.
///
/// The input is assembled from [`escape_icu_literal`] segments and generated
/// syntax, so every apostrophe outside a quote belongs to an escaped `''`
/// pair. A pair collapses to one apostrophe unless the next character is `'`,
/// `{`, `}`, or `#`, where a single apostrophe could start a quote. Quoted
/// literals are copied verbatim. The result canonicalizes to the same runtime
/// ICU text as the input, so catalog and transform lookup keys stay equal.
pub(crate) fn catalog_icu_spelling(message: &str) -> String {
    if !message.contains('\'') {
        return message.to_owned();
    }

    let characters = message.chars().collect::<Vec<_>>();
    let mut output = String::with_capacity(message.len());
    let mut index = 0;
    while index < characters.len() {
        let character = characters[index];
        if character != '\'' {
            output.push(character);
            index += 1;
            continue;
        }

        match characters.get(index + 1) {
            Some('\'') => {
                let keep_pair = characters
                    .get(index + 2)
                    .is_some_and(|next| matches!(next, '\'' | '{' | '}' | '#'));
                output.push_str(if keep_pair { "''" } else { "'" });
                index += 2;
            }
            Some('{' | '}') => {
                let end = quoted_literal_end(&characters, index + 1);
                output.extend(&characters[index..end]);
                index = end;
            }
            _ => {
                output.push(character);
                index += 1;
            }
        }
    }
    output
}

/// Appends lowered ICU text to lowered ICU text.
///
/// When `left` ends with a closing quote and `right` starts with an opening
/// one, plain concatenation would read `''` as an escaped apostrophe inside a
/// single quote. The two quotes merge into one instead: `'{a}'` followed by
/// `'{b}'` becomes `'{a}{b}'`. Escaped apostrophes between the two quotes
/// move inside the merged quote, where `''` still reads as one apostrophe:
/// `'{a}'` followed by `'''{b}'` becomes `'{a}''{b}'`.
pub(crate) fn append_icu(left: &mut String, right: &str) {
    let escaped_apostrophes = right.bytes().take_while(|byte| *byte == b'\'').count();
    // An even run is escaped apostrophes; one more apostrophe opens a quote
    // when a brace follows it.
    let pairs = escaped_apostrophes - escaped_apostrophes % 2;
    let right_opens_quote = escaped_apostrophes % 2 == 1
        && matches!(right.as_bytes().get(escaped_apostrophes), Some(b'{' | b'}'));
    if right_opens_quote && ends_with_quote_close(left) {
        left.pop();
        left.push_str(&right[..pairs]);
        left.push_str(&right[pairs + 1..]);
    } else {
        left.push_str(right);
    }
}

/// Whether the final apostrophe of lowered ICU text closes a quote.
fn ends_with_quote_close(message: &str) -> bool {
    if !message.ends_with('\'') {
        return false;
    }
    let characters = message.chars().collect::<Vec<_>>();
    let mut index = 0;
    let mut closed_at = None;
    while index < characters.len() {
        if characters[index] != '\'' {
            index += 1;
            continue;
        }
        match characters.get(index + 1) {
            Some('\'') => index += 2,
            Some('{' | '}') => {
                let end = quoted_literal_end(&characters, index + 1);
                closed_at = Some(end - 1);
                index = end;
            }
            _ => index += 1,
        }
    }
    closed_at == Some(characters.len() - 1)
}

/// Returns the index after the apostrophe that closes a quote whose content
/// starts at `start`; `''` inside the quote is an escaped apostrophe.
fn quoted_literal_end(characters: &[char], start: usize) -> usize {
    let mut index = start;
    while index < characters.len() {
        if characters[index] == '\'' {
            if characters.get(index + 1) == Some(&'\'') {
                index += 2;
                continue;
            }
            return index + 1;
        }
        index += 1;
    }
    index
}

/// Derives the compiled lookup id for a message text.
///
/// The runtime syntax policy keeps transform-side IDs aligned with Ferrocat's
/// policy-aware artifact compilation. Context is not ICU and stays untouched.
#[must_use]
pub fn compiled_message_key(message: &str, context: Option<&str>) -> String {
    ferrocat::compiled_key_with_policy(message, context, RUNTIME_ICU_SYNTAX_POLICY)
}

#[cfg(test)]
mod tests {
    use ferrocat_icu::IcuNode;

    use super::{
        append_icu, canonicalize_runtime_icu, catalog_icu_spelling, compiled_message_key,
        escape_icu_literal, parse_runtime_icu,
    };

    /// Catalog spelling of one literal segment, as extraction stores it.
    fn catalog_literal(text: &str) -> String {
        catalog_icu_spelling(&escape_icu_literal(text))
    }

    fn rendered_literal(message: &str) -> String {
        let parsed = parse_runtime_icu(message).expect("lowered literal parses");
        parsed
            .nodes
            .iter()
            .map(|node| match node {
                IcuNode::Literal(text) => text.as_str(),
                other => panic!("{message}: unexpected node {other:?}"),
            })
            .collect()
    }

    #[test]
    fn doubles_authored_apostrophes() {
        assert_eq!(escape_icu_literal("L'"), "L''");
        assert_eq!(escape_icu_literal("don't"), "don''t");
        assert_eq!(escape_icu_literal("It''s"), "It''s");
        assert_eq!(escape_icu_literal("plain"), "plain");
    }

    #[test]
    fn quotes_each_brace_group() {
        assert_eq!(escape_icu_literal("{"), "'{'");
        assert_eq!(escape_icu_literal("}"), "'}'");
        assert_eq!(escape_icu_literal("Use {name} here"), "Use '{name}' here");
        assert_eq!(escape_icu_literal("{a} and {b}"), "'{a}' and '{b}'");
        assert_eq!(escape_icu_literal("{{nested} x}"), "'{{nested} x}'");
        assert_eq!(escape_icu_literal("{a}{b} }{"), "'{a}{b}' '}{'");
        assert_eq!(escape_icu_literal("{it's}"), "'{it''s}'");
        assert_eq!(escape_icu_literal("'{x}'"), "'''{x}'''");
        assert_eq!(escape_icu_literal("{<b>}"), "'{<b>}'");
        // `#` stays outside a quote so it remains plural syntax in branches.
        assert_eq!(escape_icu_literal("{#}"), "'{'#'}'");
    }

    #[test]
    fn appending_merges_a_closing_and_an_opening_quote() {
        let mut message = escape_icu_literal("{a}");
        append_icu(&mut message, &escape_icu_literal("{b}"));
        assert_eq!(message, "'{a}{b}'");

        let mut message = escape_icu_literal("'{a}'");
        append_icu(&mut message, &escape_icu_literal("{b}"));
        assert_eq!(message, "'''{a}''{b}'");
        assert_eq!(rendered_literal(&message), "'{a}'{b}");

        let mut message = "don''t ''".to_owned();
        append_icu(&mut message, "'{b}'");
        assert_eq!(message, "don''t '''{b}'");

        // Escaped apostrophes between the two quotes move inside the merge.
        let mut message = escape_icu_literal("{a}");
        append_icu(&mut message, &escape_icu_literal("'{b}"));
        assert_eq!(message, "'{a}''{b}'");
        assert_eq!(rendered_literal(&message), "{a}'{b}");

        // Apostrophes after a closing quote without a following quote stay
        // outside any merge and still render once.
        let mut message = escape_icu_literal("{a}");
        append_icu(&mut message, &escape_icu_literal("'x"));
        assert_eq!(rendered_literal(&message), "{a}'x");
    }

    #[test]
    fn apostrophes_between_brace_spans_stay_inside_one_quote() {
        assert_eq!(escape_icu_literal("{a}'{b}"), "'{a}''{b}'");
        assert_eq!(escape_icu_literal("}'}"), "'}''}'");
        assert_eq!(escape_icu_literal("{a}''{b}"), "'{a}''{b}'");
        assert_eq!(escape_icu_literal("{a}'''{b}"), "'{a}''''{b}'");
        assert_eq!(escape_icu_literal("{a}' {b}"), "'{a}''' '{b}'");
        for (authored, rendered) in [
            ("Type {a}'{b} to swap", "Type {a}'{b} to swap"),
            ("Close }'} here", "Close }'} here"),
            ("{'}'{'}", "{'}'{'}"),
            ("{a}''{b}", "{a}'{b}"),
            ("{a}'''{b}", "{a}''{b}"),
            ("{a}'{#}", "{a}'{#}"),
            ("{a}' {b}'", "{a}' {b}'"),
        ] {
            for message in [escape_icu_literal(authored), catalog_literal(authored)] {
                assert_eq!(rendered_literal(&message), rendered, "{authored:?}");
            }
        }
    }

    #[test]
    fn escaped_literals_render_their_authored_text() {
        for (authored, rendered) in [
            ("Use {name} here", "Use {name} here"),
            ("{", "{"),
            ("}", "}"),
            ("{a} and {b}", "{a} and {b}"),
            ("{a}{b} }{", "{a}{b} }{"),
            ("{{nested} x}", "{{nested} x}"),
            ("It's '{literal}' ok", "It's '{literal}' ok"),
            ("{it's}", "{it's}"),
            ("'{x}'", "'{x}'"),
            ("don't", "don't"),
            ("It''s", "It's"),
            ("{<b>}", "{<b>}"),
            ("a < b", "a < b"),
        ] {
            for message in [escape_icu_literal(authored), catalog_literal(authored)] {
                assert_eq!(rendered_literal(&message), rendered, "{authored:?}");
            }
        }
    }

    #[test]
    fn catalog_spelling_keeps_natural_apostrophes() {
        assert_eq!(catalog_literal("don't"), "don't");
        assert_eq!(catalog_literal("client's"), "client's");
        assert_eq!(catalog_literal("l'été"), "l'été");
        assert_eq!(catalog_literal("L'"), "L'");
        assert_eq!(catalog_literal("'#' don't"), "''#' don't");
        // Doubled authored apostrophes render one apostrophe, so the shortest
        // spelling of `It''s` is `It's`.
        assert_eq!(catalog_literal("It''s"), "It's");
    }

    #[test]
    fn catalog_spelling_keeps_pairs_before_icu_syntax() {
        assert_eq!(catalog_icu_spelling("L''{title}"), "L''{title}");
        assert_eq!(
            catalog_icu_spelling("{n, plural, one {L''} other {#}}"),
            "{n, plural, one {L''} other {#}}"
        );
        assert_eq!(
            catalog_literal("It's '{literal}' ok"),
            "It's '''{literal}''' ok"
        );
        assert_eq!(catalog_literal("Use {name} here"), "Use '{name}' here");
        assert_eq!(catalog_icu_spelling("'{it''s}' it''s"), "'{it''s}' it's");
    }

    #[test]
    fn catalog_spelling_keeps_the_runtime_lookup_key() {
        for message in [
            "don''t",
            "L''{title}",
            "It''s '''{literal}''' ok",
            "'{x}''' and '{y}' don''t",
            "{n, plural, one {''#'' L''} other {# it''s}}",
            "<0>Joneses''</0> ''",
        ] {
            assert_eq!(
                compiled_message_key(&catalog_icu_spelling(message), None),
                compiled_message_key(message, None),
                "message: {message}"
            );
        }
    }

    #[test]
    fn runtime_apostrophe_policy_keeps_stable_golden_values() {
        let cases = [
            ("don't", "don''t"),
            ("don''t", "don''t"),
            ("L'{title} est prêt", "L'{title} est prêt'"),
            (
                "{count, plural, other {'#' items}}",
                "{count, plural, other {'#' items}}",
            ),
            ("'#' items", "''#'' items"),
            (
                "{count, select, other {'#' items}}",
                "{count, select, other {''#'' items}}",
            ),
        ];

        for (pattern, expected) in cases {
            let canonical = canonicalize_runtime_icu(pattern);
            assert_eq!(canonical.as_ref(), expected, "pattern: {pattern}");
        }
    }

    #[test]
    fn runtime_apostrophe_policy_is_idempotent() {
        for pattern in [
            "don't",
            "L'{title} est prêt",
            "{count, plural, other {'#' items}}",
            "'#' items",
            "''",
        ] {
            let canonical = canonicalize_runtime_icu(pattern);
            let repeated = canonicalize_runtime_icu(canonical.as_ref());
            assert_eq!(repeated, canonical, "pattern: {pattern}");
        }
    }

    #[test]
    fn compiled_message_key_hashes_the_canonical_text() {
        // The raw and the canonical spelling of the same message collapse onto
        // one id, which is what makes a raw-ICU descriptor reachable in a
        // compiled catalog.
        assert_eq!(
            compiled_message_key("Don't greet {name}", None),
            ferrocat::compiled_key("Don''t greet {name}", None)
        );

        // Escaped authored text is a fixed point, so its id never moves.
        for message in ["don''t", "L''{title} est prêt", "Hello {name}"] {
            assert_eq!(
                compiled_message_key(message, None),
                ferrocat::compiled_key(message, None),
                "message: {message}"
            );
        }

        // Context is a plain disambiguation string and stays untouched.
        assert_eq!(
            compiled_message_key("Hello", Some("don't touch")),
            ferrocat::compiled_key("Hello", Some("don't touch"))
        );
    }
}
