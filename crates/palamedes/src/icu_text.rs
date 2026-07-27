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
//! Two things follow from that, and both live here so the extractor, the
//! transform, and catalog validation cannot drift apart:
//!
//! * [`escape_icu_literal`] escapes authored literal segments (template literal
//!   quasis, JSX text, choice option strings) so an authored apostrophe never
//!   turns into a quote that swallows the following placeholder.
//! * [`canonicalize_runtime_quoting`] rewrites a runtime-dialect pattern into
//!   the equivalent strictly quoted pattern that Ferrocat's ICU parser reads the
//!   same way the runtime does.

/// Escapes authored literal text for embedding into an ICU message pattern.
///
/// Doubling every apostrophe (the Lingui-compatible rule) is what makes the
/// escaping robust across segment boundaries: an authored segment ending in `'`
/// followed by a `{placeholder}` cannot form a quote, because the segment is
/// escaped before the placeholder is appended.
pub(crate) fn escape_icu_literal(text: &str) -> String {
    if text.contains('\'') {
        text.replace('\'', "''")
    } else {
        text.to_owned()
    }
}

/// Rewrites a runtime-dialect ICU pattern into strict ICU quoting.
///
/// Ferrocat parses ICU MessageFormat v1 with strict apostrophe rules, where any
/// apostrophe opens a quoted literal. Feeding it the runtime dialect directly
/// either rejects natural apostrophes (`don't`) or — with Ferrocat's
/// `RuntimeLiteralApostrophes` policy, which doubles every apostrophe first —
/// silently models `L'{title}` as a live argument that the runtime actually
/// swallows. Canonicalizing first gives both parsers the same reading:
///
/// * ordinary apostrophes are doubled (`don't` -> `don''t`),
/// * runtime quotes are re-emitted terminated (`L'{title}` -> `L'{title}'`),
/// * `''` stays a single escaped apostrophe.
///
/// The result is a fixed point: every apostrophe in the output is either
/// doubled or opens a terminated quote whose first character is `{`, `}`, or a
/// plural `#`, which the strict and the lenient parser read identically.
pub(crate) fn canonicalize_runtime_quoting(pattern: &str) -> String {
    if !pattern.contains('\'') {
        return pattern.to_owned();
    }

    let bytes = pattern.as_bytes();
    let mut out = String::with_capacity(pattern.len() + 8);
    // Stack of "is `#` syntax here" flags, one per open brace group.
    let mut pound_stack = vec![false];
    let mut index = 0usize;

    while index < bytes.len() {
        match bytes[index] {
            b'\'' => index = push_apostrophe(pattern, index, pound_active(&pound_stack), &mut out),
            b'{' => {
                let inherited = pound_active(&pound_stack);
                pound_stack.push(inherited || opens_plural_argument(pattern, index));
                out.push('{');
                index += 1;
            }
            b'}' => {
                if pound_stack.len() > 1 {
                    pound_stack.pop();
                }
                out.push('}');
                index += 1;
            }
            _ => {
                let start = index;
                index += 1;
                while index < bytes.len() && !matches!(bytes[index], b'\'' | b'{' | b'}') {
                    index += 1;
                }
                out.push_str(&pattern[start..index]);
            }
        }
    }

    out
}

/// Canonicalizes every message text of a parsed catalog in place.
///
/// Catalog validation (audit, artifact compilation, pseudo-localization) runs on
/// Ferrocat's strict ICU parser, so the runtime dialect has to be translated
/// once, right after parsing, for both sides of a message: the `msgid` that the
/// authoring pipeline produced and the translations that came back from
/// translators.
///
/// Canonicalizing the `msgid` also rewrites the compiled-id input for catalogs
/// that still carry unescaped apostrophes from an older extractor; those ids
/// move to the value the current extractor and transform produce, which is
/// exactly what the runtime bundle asks for.
pub(crate) fn canonicalize_catalog_quoting(catalog: &mut ferrocat::ParsedCatalog) {
    for message in &mut catalog.messages {
        canonicalize_in_place(&mut message.msgid);
        match &mut message.translation {
            ferrocat::TranslationShape::Singular { value } => canonicalize_in_place(value),
            ferrocat::TranslationShape::Plural {
                source,
                translation,
                ..
            } => {
                if let Some(one) = source.one.as_mut() {
                    canonicalize_in_place(one);
                }
                canonicalize_in_place(&mut source.other);
                for value in translation.values_mut() {
                    canonicalize_in_place(value);
                }
            }
        }
    }
}

/// Derives the compiled lookup id for a message text.
///
/// Catalog compilation canonicalizes every catalog text on load (see
/// [`canonicalize_catalog_quoting`]) and only then hands the `msgid` to
/// Ferrocat's key derivation, so a compiled artifact is always keyed by the
/// hash of the *canonical* text. Every other derivation of the same id — the
/// lookup key the transform embeds in `getI18n()._("…")`, the ids it reports as
/// `compiled_ids`, extractor-side parity checks — has to go through this helper
/// so it hashes the same string.
///
/// Without it the raw-ICU authoring surfaces (descriptor string literals and
/// the `<Trans message>` attribute, where authors write ICU quoting themselves
/// and neither extractor nor transform escapes anything) hash a text the
/// compiled catalog never contains, and the runtime silently falls back to the
/// source message.
///
/// Only the message text is canonicalized: `context` is a plain disambiguation
/// string, not ICU, and catalog loading leaves it untouched as well.
///
/// Because [`canonicalize_runtime_quoting`] is a fixed point, already-escaped
/// authored text (`don''t`) keeps exactly the id it had before, so ids for the
/// escaping paths are unchanged.
pub(crate) fn compiled_message_key(message: &str, context: Option<&str>) -> String {
    ferrocat::compiled_key(&canonicalize_runtime_quoting(message), context)
}

fn canonicalize_in_place(value: &mut String) {
    if value.contains('\'') {
        *value = canonicalize_runtime_quoting(value);
    }
}

fn pound_active(stack: &[bool]) -> bool {
    stack.last().copied().unwrap_or(false)
}

/// Emits the canonical form of the apostrophe at `index` and returns the next
/// index to read.
fn push_apostrophe(pattern: &str, index: usize, pound_active: bool, out: &mut String) -> usize {
    let bytes = pattern.as_bytes();
    let next = bytes.get(index + 1).copied();

    if next == Some(b'\'') {
        out.push_str("''");
        return index + 2;
    }

    let starts_quote =
        matches!(next, Some(b'{') | Some(b'}')) || (pound_active && next == Some(b'#'));
    if !starts_quote {
        // Ordinary text apostrophe: the runtime renders it verbatim, so escape
        // it for the strict parser.
        out.push_str("''");
        return index + 1;
    }

    let (literal, end) = read_quoted_literal(pattern, index + 1);
    out.push('\'');
    out.push_str(&literal.replace('\'', "''"));
    out.push('\'');
    end
}

/// Reads a runtime quoted literal starting after the opening apostrophe,
/// mirroring `parseQuotedLiteral` in the runtime parser: `''` is a literal
/// apostrophe, a lone `'` closes the quote, and the end of the pattern
/// auto-closes it.
fn read_quoted_literal(pattern: &str, start: usize) -> (String, usize) {
    let bytes = pattern.as_bytes();
    let mut literal = String::new();
    let mut index = start;

    while index < bytes.len() {
        if bytes[index] != b'\'' {
            let chunk_start = index;
            index += 1;
            while index < bytes.len() && bytes[index] != b'\'' {
                index += 1;
            }
            literal.push_str(&pattern[chunk_start..index]);
            continue;
        }

        if bytes.get(index + 1).copied() == Some(b'\'') {
            literal.push('\'');
            index += 2;
            continue;
        }

        return (literal, index + 1);
    }

    (literal, index)
}

/// Reports whether the brace group opening at `index` is a plural or
/// selectordinal argument, whose branches make `#` syntax.
fn opens_plural_argument(pattern: &str, index: usize) -> bool {
    let rest = &pattern[index + 1..];
    let Some((_, after_name)) = split_argument_part(rest) else {
        return false;
    };
    let Some((kind, _)) = split_argument_part(after_name) else {
        return false;
    };

    matches!(kind.trim(), "plural" | "selectordinal")
}

/// Splits `input` at the next `,`, returning the part before it and the rest.
/// Returns `None` when the argument ends (`}`) or is unterminated.
fn split_argument_part(input: &str) -> Option<(&str, &str)> {
    let stop = input.find([',', '}', '{'])?;
    if input.as_bytes()[stop] != b',' {
        return None;
    }

    Some((&input[..stop], &input[stop + 1..]))
}

#[cfg(test)]
mod tests {
    use super::{canonicalize_runtime_quoting, compiled_message_key, escape_icu_literal};

    #[test]
    fn doubles_authored_apostrophes() {
        assert_eq!(escape_icu_literal("L'"), "L''");
        assert_eq!(escape_icu_literal("don't"), "don''t");
        assert_eq!(escape_icu_literal("plain"), "plain");
    }

    #[test]
    fn canonicalizes_natural_apostrophes() {
        assert_eq!(canonicalize_runtime_quoting("don't"), "don''t");
        assert_eq!(
            canonicalize_runtime_quoting("no apostrophe"),
            "no apostrophe"
        );
    }

    #[test]
    fn keeps_escaped_apostrophes_single() {
        assert_eq!(canonicalize_runtime_quoting("don''t"), "don''t");
    }

    #[test]
    fn terminates_runtime_quotes_that_swallow_placeholders() {
        assert_eq!(
            canonicalize_runtime_quoting("L'{title} est prêt"),
            "L'{title} est prêt'"
        );
        assert_eq!(
            canonicalize_runtime_quoting("'{name}' stays"),
            "'{name}' stays"
        );
    }

    #[test]
    fn treats_pound_quotes_as_syntax_only_inside_plural_branches() {
        assert_eq!(
            canonicalize_runtime_quoting("{count, plural, other {'#' items}}"),
            "{count, plural, other {'#' items}}"
        );
        // Outside a plural branch `#` is ordinary text, so both apostrophes are
        // literal characters.
        assert_eq!(canonicalize_runtime_quoting("'#' items"), "''#'' items");
        assert_eq!(
            canonicalize_runtime_quoting("{count, select, other {'#' items}}"),
            "{count, select, other {''#'' items}}"
        );
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

    #[test]
    fn is_idempotent() {
        for pattern in [
            "don't",
            "L'{title} est prêt",
            "{count, plural, other {'#' items}}",
            "'#' items",
            "''",
        ] {
            let once = canonicalize_runtime_quoting(pattern);
            assert_eq!(
                canonicalize_runtime_quoting(&once),
                once,
                "pattern: {pattern}"
            );
        }
    }
}
