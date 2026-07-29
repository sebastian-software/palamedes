/*!
Collation order for `PoOrderBy::Collated`.

Lingui sorts catalogs with `new Intl.Collator("en-US")`, which resolves to the
unmodified CLDR root collation — English carries no tailoring of its own. This
reproduces that order for the repertoire source messages actually contain,
using a generated table rather than a full Unicode collation implementation.

The trade is deliberate. Linking ICU4X buys exact root collation over all of
Unicode for roughly 1.28 MB in every shipped binary; this covers Latin text,
punctuation, symbols and digits in about 20 KB. Since the result only decides
the order entries appear in, the cost of a miss is a line in a diff, not a
wrong translation — so the cheap table is the better trade here.

Known limits, both outside what source catalogs hold in practice:

- Ligatures and digraphs (`ﬁ`, `Ǆ`) expand to several collation elements in
  the real algorithm. A flat table cannot express that, so they sort by their
  own primary weight instead of as `fi` and `dz`.
- Characters outside the table sort after it by code point. Root collation
  also places non-Latin scripts after Latin, so the placement between scripts
  holds, but the order within them does not.
*/

use crate::collation_table::{DECOMPOSITIONS, PRIMARY};

/// Sort key reproducing CLDR root order for the covered repertoire.
///
/// The three levels mirror the real algorithm: base letters first, then
/// diacritics, then case. Comparing the tuple lexicographically gives the same
/// answer as comparing level by level.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct CollationKey {
    primary: Vec<u32>,
    secondary: Vec<u32>,
    tertiary: Vec<u8>,
}

/// Weights above every table entry, so uncovered characters sort after the
/// covered repertoire while staying ordered among themselves.
const UNCOVERED_BASE: u32 = 0x10_000;

fn is_combining(c: char) -> bool {
    ('\u{0300}'..='\u{036F}').contains(&c)
}

fn decomposition(c: char) -> Option<&'static str> {
    DECOMPOSITIONS
        .binary_search_by(|(key, _)| key.cmp(&c))
        .ok()
        .map(|index| DECOMPOSITIONS[index].1)
}

fn primary_weight(c: char) -> u32 {
    /*
     * Case is a tertiary distinction, so both cases share one primary weight
     * and the table only carries the lowercase form.
     */
    let base = c.to_lowercase().next().unwrap_or(c);
    match PRIMARY.binary_search_by(|(key, _)| key.cmp(&base)) {
        Ok(index) => u32::from(PRIMARY[index].1),
        Err(_) => UNCOVERED_BASE + u32::from(base),
    }
}

/// Builds the sort key for a single string.
pub(crate) fn collation_key(text: &str) -> CollationKey {
    let mut key = CollationKey {
        primary: Vec::with_capacity(text.len()),
        secondary: Vec::new(),
        tertiary: Vec::with_capacity(text.len()),
    };

    for character in text.chars() {
        /*
         * Precomposed characters are expanded so an accent reaches the
         * secondary level. Without that, "resume" and "résumé" would produce
         * identical keys and fall through to the raw tie-break.
         */
        match decomposition(character) {
            Some(expanded) => push_char_run(&mut key, expanded.chars()),
            None => push_char_run(&mut key, std::iter::once(character)),
        }
    }

    key
}

fn push_char_run(key: &mut CollationKey, characters: impl Iterator<Item = char>) {
    for character in characters {
        if is_combining(character) {
            key.secondary.push(u32::from(character));
            continue;
        }
        key.primary.push(primary_weight(character));
        key.tertiary.push(u8::from(character.is_uppercase()));
    }
}

#[cfg(test)]
mod tests {
    use super::collation_key;

    fn sorted(mut items: Vec<&str>) -> Vec<&str> {
        items.sort_by(|left, right| {
            collation_key(left)
                .cmp(&collation_key(right))
                .then_with(|| left.cmp(right))
        });
        items
    }

    /*
     * The expected orders below are what `new Intl.Collator("en-US")` produces
     * for the same input, which is the order Lingui writes.
     */

    #[test]
    fn orders_case_as_a_tertiary_difference() {
        assert_eq!(
            sorted(vec!["Apple", "apple", "APPLE"]),
            vec!["apple", "Apple", "APPLE"]
        );
    }

    #[test]
    fn orders_accents_after_their_base_letter() {
        assert_eq!(
            sorted(vec!["éclair", "eclair", "Zebra", "über", "Uber", "Álgebra"]),
            vec!["Álgebra", "eclair", "éclair", "Uber", "über", "Zebra"]
        );
    }

    #[test]
    fn keeps_accent_information_at_the_secondary_level() {
        assert_ne!(collation_key("resume"), collation_key("résumé"));
        assert_eq!(
            collation_key("resume").primary,
            collation_key("résumé").primary
        );
    }

    #[test]
    fn treats_precomposed_and_decomposed_spellings_alike() {
        assert_eq!(collation_key("café"), collation_key("cafe\u{0301}"));
    }

    /*
     * Placeholder and Trans markup open a large share of extracted messages,
     * and code-point order gets this pair backwards: `<` is U+003C and `{` is
     * U+007B, but root collation sorts braces first.
     */
    #[test]
    fn orders_punctuation_the_way_root_collation_does() {
        assert_eq!(
            sorted(vec![
                "<0>Continue</0>",
                "{count, plural, one {#} other {#}}"
            ]),
            vec!["{count, plural, one {#} other {#}}", "<0>Continue</0>"]
        );
    }

    #[test]
    fn orders_punctuation_and_digits_before_letters() {
        assert_eq!(
            sorted(vec!["Alpha", "100%", "!Alert", "(Parens)"]),
            vec!["!Alert", "(Parens)", "100%", "Alpha"]
        );
    }

    #[test]
    fn sorts_uncovered_characters_after_the_covered_repertoire() {
        assert_eq!(sorted(vec!["日本語", "Zebra"]), vec!["Zebra", "日本語"]);
    }
}
