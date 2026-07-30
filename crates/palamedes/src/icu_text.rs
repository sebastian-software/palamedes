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
//! [`escape_icu_literal`] escapes authored literal segments (template literal
//! quasis, JSX text, choice option strings) so an authored apostrophe never
//! turns into a quote that swallows the following placeholder.

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

/// Derives the compiled lookup id for a message text.
///
/// The runtime syntax policy keeps transform-side IDs aligned with Ferrocat's
/// policy-aware artifact compilation. Context is not ICU and stays untouched.
pub(crate) fn compiled_message_key(message: &str, context: Option<&str>) -> String {
    ferrocat::compiled_key_with_policy(
        message,
        context,
        ferrocat::IcuSyntaxPolicy::RuntimeLiteralApostrophes,
    )
}

#[cfg(test)]
mod tests {
    use super::{compiled_message_key, escape_icu_literal};
    use ferrocat::{canonicalize_icu_with_policy, IcuSyntaxPolicy};

    #[test]
    fn doubles_authored_apostrophes() {
        assert_eq!(escape_icu_literal("L'"), "L''");
        assert_eq!(escape_icu_literal("don't"), "don''t");
        assert_eq!(escape_icu_literal("plain"), "plain");
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
            let canonical =
                canonicalize_icu_with_policy(pattern, IcuSyntaxPolicy::RuntimeLiteralApostrophes);
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
            let canonical =
                canonicalize_icu_with_policy(pattern, IcuSyntaxPolicy::RuntimeLiteralApostrophes);
            let repeated = canonicalize_icu_with_policy(
                canonical.as_ref(),
                IcuSyntaxPolicy::RuntimeLiteralApostrophes,
            );
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
