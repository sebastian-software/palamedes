/*!
The order Palamedes writes PO catalogs in.

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

use crate::collation_table::{Row, EXTRA, RANGE_START, ROWS, WIDE};

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

fn row(c: char) -> Option<&'static Row> {
    if let Some(offset) = u32::from(c).checked_sub(RANGE_START) {
        if let Some(row) = usize::try_from(offset)
            .ok()
            .and_then(|index| ROWS.get(index))
        {
            return Some(row);
        }
    }
    /*
     * Typographic characters sit far above the dense range, so they get their
     * own sorted table rather than padding the dense one across the gap.
     */
    EXTRA
        .binary_search_by(|(key, _)| key.cmp(&c))
        .ok()
        .map(|index| &EXTRA[index].1)
}

fn wide_decomposition(c: char) -> Option<&'static str> {
    WIDE.binary_search_by(|(key, _)| key.cmp(&c))
        .ok()
        .map(|index| WIDE[index].1)
}

/// Weight for a character the table does not cover.
fn uncovered_weight(c: char) -> u32 {
    /*
     * Case is a tertiary distinction everywhere else, so fold here too rather
     * than letting an uppercase form sort away from its lowercase one.
     */
    let base = c.to_lowercase().next().unwrap_or(c);
    UNCOVERED_BASE + u32::from(base)
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
         * The common path is one array index: the row already carries the
         * primary weight of the base letter, the diacritic that belongs on the
         * secondary level, and the case bit. Building these keys is the hot
         * loop of a collated extraction, so it stays free of searches.
         */
        match row(character) {
            Some(row) if row.wide => {
                let expanded = wide_decomposition(character).unwrap_or_default();
                push_expanded(&mut key, expanded);
            }
            Some(row) if row.primary != 0 => {
                key.primary.push(u32::from(row.primary));
                if row.secondary != 0 {
                    key.secondary.push(row.secondary);
                }
                key.tertiary.push(u8::from(row.upper));
            }
            _ if is_combining(character) => key.secondary.push(u32::from(character)),
            _ => {
                key.primary.push(uncovered_weight(character));
                key.tertiary.push(u8::from(character.is_uppercase()));
            }
        }
    }

    key
}

/// Handles the rare characters that decompose into more than one mark.
fn push_expanded(key: &mut CollationKey, expanded: &str) {
    for character in expanded.chars() {
        if is_combining(character) {
            key.secondary.push(u32::from(character));
            continue;
        }
        match row(character) {
            Some(row) if row.primary != 0 => {
                key.primary.push(u32::from(row.primary));
                key.tertiary.push(u8::from(row.upper));
            }
            _ => {
                key.primary.push(uncovered_weight(character));
                key.tertiary.push(u8::from(character.is_uppercase()));
            }
        }
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

    /*
     * Typographic characters live well above the dense table range. Treating
     * them as uncovered would sort every quoted or dashed message to the end
     * of the catalog, so each one has to resolve to a real weight.
     */
    #[test]
    fn covers_typographic_characters_above_the_dense_range() {
        for text in [
            "“Quoted”",
            "‘Single’",
            "Em — dash",
            "En – dash",
            "Ellipsis…",
        ] {
            assert_eq!(
                sorted(vec![text, "Zebra"]),
                vec![text, "Zebra"],
                "{text} must sort before a plain letter"
            );
        }
    }

    #[test]
    fn orders_typographic_punctuation_the_way_root_collation_does() {
        assert_eq!(
            sorted(vec!["Zebra", "“Quoted”", "{brace}", "!Alert", "100%"]),
            vec!["!Alert", "“Quoted”", "{brace}", "100%", "Zebra"]
        );
    }
}
