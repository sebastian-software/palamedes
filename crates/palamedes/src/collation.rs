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
/// diacritics, then case.
///
/// All three live in one byte buffer rather than three vectors. Catalogs are
/// sorted by building a key per entry, so the allocation count per entry is
/// what this costs in practice, and comparing byte slices lets the comparison
/// itself run as a memcmp.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct CollationKey {
    bytes: Vec<u8>,
    primary_end: u32,
    secondary_end: u32,
}

impl CollationKey {
    fn primary(&self) -> &[u8] {
        &self.bytes[..self.primary_end as usize]
    }

    fn secondary(&self) -> &[u8] {
        &self.bytes[self.primary_end as usize..self.secondary_end as usize]
    }

    fn tertiary(&self) -> &[u8] {
        &self.bytes[self.secondary_end as usize..]
    }
}

impl Ord for CollationKey {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.primary()
            .cmp(other.primary())
            .then_with(|| self.secondary().cmp(other.secondary()))
            .then_with(|| self.tertiary().cmp(other.tertiary()))
    }
}

impl PartialOrd for CollationKey {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

/// Marks an uncovered character in the primary level. Above every table
/// weight, so uncovered characters sort after the covered repertoire, and the
/// four code-point bytes that follow order them among themselves.
const UNCOVERED_TAG: u8 = 0xFF;

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

/// The levels being filled while walking a string once.
struct Levels {
    /// Doubles as the finished key buffer: the other two are appended to it.
    primary: Vec<u8>,
    secondary: Vec<u8>,
    tertiary: Vec<u8>,
}

impl Levels {
    fn push_uncovered(&mut self, character: char) {
        /*
         * Case is a tertiary distinction everywhere else, so fold here too
         * rather than letting an uppercase form sort away from its lowercase
         * one.
         */
        let base = character.to_lowercase().next().unwrap_or(character);
        self.primary.push(UNCOVERED_TAG);
        self.primary
            .extend_from_slice(&u32::from(base).to_be_bytes());
        self.tertiary.push(u8::from(character.is_uppercase()));
    }

    fn push_row(&mut self, row: &Row) {
        // Table weights are ranks in a repertoire far smaller than
        // `UNCOVERED_TAG`, so one byte holds them and keeps them below it.
        self.primary.push(row.primary);
        if row.secondary != 0 {
            push_mark(&mut self.secondary, row.secondary);
        }
        self.tertiary.push(u8::from(row.upper));
    }

    fn push_char(&mut self, character: char) {
        /*
         * Combining marks sit above the table's range, so this has to come
         * before the lookup — otherwise a decomposed "café" would treat its
         * accent as an uncovered character and stop matching the precomposed
         * spelling.
         */
        if is_combining(character) {
            push_mark(&mut self.secondary, u32::from(character));
            return;
        }
        match row(character) {
            Some(row) if row.wide => {
                for expanded in wide_decomposition(character).unwrap_or_default().chars() {
                    self.push_char(expanded);
                }
            }
            Some(row) if row.primary != 0 => self.push_row(row),
            _ => self.push_uncovered(character),
        }
    }
}

/// Combining marks are confined to U+0300..=U+036F, so the offset into that
/// block fits in a byte and keeps their relative order.
fn push_mark(out: &mut Vec<u8>, mark: u32) {
    out.push(u8::try_from(mark.saturating_sub(0x0300)).unwrap_or(u8::MAX));
}

/// Builds the sort key for a single string.
pub(crate) fn collation_key(text: &str) -> CollationKey {
    /*
     * Most entries have no gettext context, so the empty key is the single
     * most common one in a catalog sort. Returning it without touching the
     * allocator saves one allocation per entry.
     */
    if text.is_empty() {
        return CollationKey {
            bytes: Vec::new(),
            primary_end: 0,
            secondary_end: 0,
        };
    }

    let mut levels = Levels {
        // Primary and tertiary are one byte per ASCII character.
        primary: Vec::with_capacity(text.len() * 2 + 8),
        secondary: Vec::new(),
        tertiary: Vec::with_capacity(text.len()),
    };

    if text.is_ascii() {
        /*
         * Source messages are overwhelmingly ASCII, and there the whole
         * repertoire lives in the dense table: no UTF-8 decoding, no combining
         * marks, no expansions, no lookup past a bounds check.
         */
        for &byte in text.as_bytes() {
            let index = usize::from(byte).wrapping_sub(RANGE_START as usize);
            match ROWS.get(index) {
                Some(row) if row.primary != 0 => levels.push_row(row),
                _ => levels.push_uncovered(char::from(byte)),
            }
        }
    } else {
        for character in text.chars() {
            levels.push_char(character);
        }
    }

    let Levels {
        mut primary,
        secondary,
        tertiary,
    } = levels;
    let primary_end = primary.len();
    primary.extend_from_slice(&secondary);
    let secondary_end = primary.len();
    primary.extend_from_slice(&tertiary);

    CollationKey {
        bytes: primary,
        primary_end: u32::try_from(primary_end).unwrap_or(u32::MAX),
        secondary_end: u32::try_from(secondary_end).unwrap_or(u32::MAX),
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
            collation_key("resume").primary(),
            collation_key("résumé").primary()
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
