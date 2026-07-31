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
//! [`escape_icu_literal`] escapes authored literal segments for runtime use,
//! while [`escape_icu_source_literal`] preserves natural apostrophes in catalog
//! identities and only escapes a run that could start ICU syntax.

/// Escapes authored literal text for embedding into an ICU message pattern.
///
/// Odd apostrophe runs are doubled; already doubled ICU apostrophes stay a
/// fixed point. Escaping before a placeholder is appended prevents a trailing
/// apostrophe from turning into a quote that swallows the placeholder.
pub(crate) fn escape_icu_literal(text: &str) -> String {
    escape_apostrophe_runs(text, |_| true)
}

/// Escapes authored text for a persisted source identity.
///
/// The runtime parser already treats ordinary prose apostrophes literally, so
/// changing `don't` into `don''t` in a gettext `msgid` is unnecessary and
/// breaks upgrades from Lingui and older Palamedes catalogs. A single
/// apostrophe is escaped only before ICU syntax. Callers assemble generated
/// placeholders before applying this helper so a final prose apostrophe is not
/// changed merely because it ended one parser segment. Existing pairs stay
/// unchanged.
pub(crate) fn escape_icu_source_literal(text: &str) -> String {
    escape_apostrophe_runs(text, |next| {
        next.is_some_and(|character| matches!(character, '{' | '}' | '#'))
    })
}

fn escape_apostrophe_runs(
    text: &str,
    should_escape_odd_run: impl Fn(Option<char>) -> bool,
) -> String {
    if !text.contains('\'') {
        return text.to_owned();
    }

    let mut output = String::with_capacity(text.len() + 2);
    let mut characters = text.chars().peekable();
    while let Some(character) = characters.next() {
        if character != '\'' {
            output.push(character);
            continue;
        }

        let mut count = 1usize;
        while characters.next_if_eq(&'\'').is_some() {
            count += 1;
        }
        output.extend(std::iter::repeat_n('\'', count));
        if count % 2 == 1 && should_escape_odd_run(characters.peek().copied()) {
            output.push('\'');
        }
    }
    output
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
    use super::{compiled_message_key, escape_icu_literal, escape_icu_source_literal};
    use ferrocat::{canonicalize_icu_with_policy, IcuSyntaxPolicy};

    #[test]
    fn doubles_authored_apostrophes() {
        assert_eq!(escape_icu_literal("L'"), "L''");
        assert_eq!(escape_icu_literal("don't"), "don''t");
        assert_eq!(escape_icu_literal("It''s"), "It''s");
        assert_eq!(escape_icu_literal("plain"), "plain");
    }

    #[test]
    fn source_literals_preserve_natural_and_already_doubled_apostrophes() {
        assert_eq!(escape_icu_source_literal("don't"), "don't");
        assert_eq!(escape_icu_source_literal("client's"), "client's");
        assert_eq!(escape_icu_source_literal("l'été"), "l'été");
        assert_eq!(escape_icu_source_literal("It''s"), "It''s");
    }

    #[test]
    fn source_literals_still_escape_icu_boundaries() {
        assert_eq!(escape_icu_source_literal("L'"), "L'");
        assert_eq!(escape_icu_source_literal("L'{title}"), "L''{title}");
        assert_eq!(escape_icu_source_literal("'#' don't"), "''#' don't");
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
