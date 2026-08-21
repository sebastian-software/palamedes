/*!
CLDR root ordering used to validate direct single-pass FCL decoding.

This is the key-building subset of Ferrocat 3.4.2's private collation module. Keep it
byte-for-byte equivalent to Ferrocat; cross-implementation tests exercise canonical
FCL output so dependency upgrades cannot silently drift.

Lingui sorts catalogs with `new Intl.Collator("en-US")`, which resolves to the
unmodified CLDR root collation because English carries no tailoring of its own.
This module reproduces that order for the repertoire source messages normally
contain, using a generated table rather than a full Unicode collation
implementation.

The trade is deliberate. Linking ICU4X adds roughly 1.3 MB to every consumer;
the generated table covers Latin text, punctuation, symbols, and digits at a
small fraction of that cost. Since ordering only changes where an entry appears
in a catalog, a miss creates a line diff rather than an incorrect translation.

Known limits:

- Ligatures and digraphs (`ﬁ`, `Ǆ`) expand to several collation elements in the
  complete algorithm. A flat table cannot express that, so they sort by their
  own primary weight instead of as `fi` and `dz`.
- Characters outside the covered repertoire sort after it by code point. Root
  collation also places non-Latin scripts after Latin, but their internal order
  is only code-point order here.
*/

use super::fcl_collation_table::{Row, EXTRA, MARK_START, MARK_WEIGHTS, RANGE_START, ROWS};

/// Sort key reproducing CLDR root order for the covered repertoire.
///
/// The three levels mirror the real algorithm: base characters first, then
/// diacritics, then case. They share one byte buffer to keep the hot comparison
/// to three slice comparisons while requiring only one allocation per key.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct CollationKey {
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

/// Marks an uncovered character in the primary level. The tag sits above every
/// generated table weight; the four following bytes retain code-point order.
const UNCOVERED_TAG: u8 = 0xFF;

fn is_combining(character: char) -> bool {
    ('\u{0300}'..='\u{036F}').contains(&character)
}

fn row(character: char) -> Option<&'static Row> {
    if let Some(offset) = u32::from(character).checked_sub(RANGE_START) {
        if let Some(row) = usize::try_from(offset)
            .ok()
            .and_then(|index| ROWS.get(index))
        {
            return Some(row);
        }
    }

    // Typographic characters sit far above the dense range, so they use a
    // compact sorted side table rather than padding the dense table.
    EXTRA
        .binary_search_by(|(key, _)| key.cmp(&character))
        .ok()
        .map(|index| &EXTRA[index].1)
}

struct Levels {
    /// Doubles as the finished key buffer; secondary and tertiary are appended.
    primary: Vec<u8>,
    secondary: Vec<u8>,
    tertiary: Vec<u8>,
    primary_position: u32,
}

impl Levels {
    fn push_uncovered(&mut self, character: char) {
        let base = character.to_lowercase().next().unwrap_or(character);
        self.primary.push(UNCOVERED_TAG);
        self.primary
            .extend_from_slice(&u32::from(base).to_be_bytes());
        self.primary_position = self.primary_position.saturating_add(1);
        self.tertiary.push(u8::from(character.is_uppercase()));
    }

    fn push_row(&mut self, row: &Row) {
        self.primary.push(row.primary);
        self.primary_position = self.primary_position.saturating_add(1);
        if row.secondary != 0 {
            self.push_secondary(row.secondary);
        }
        self.tertiary.push(u8::from(row.upper));
    }

    fn push_secondary(&mut self, weight: u8) {
        self.secondary
            .extend_from_slice(&u32::MAX.saturating_sub(self.primary_position).to_be_bytes());
        self.secondary.push(weight);
    }

    fn push_char(&mut self, character: char) {
        // Combining marks must be handled before lookup so decomposed and
        // precomposed accents produce the same key.
        if is_combining(character) {
            self.push_secondary(mark_weight(character));
            return;
        }
        match row(character) {
            Some(row) if row.primary != 0 => self.push_row(row),
            _ => self.push_uncovered(character),
        }
    }
}

fn mark_weight(character: char) -> u8 {
    u32::from(character)
        .checked_sub(MARK_START)
        .and_then(|offset| usize::try_from(offset).ok())
        .and_then(|index| MARK_WEIGHTS.get(index))
        .copied()
        .unwrap_or(u8::MAX)
}
pub(super) fn collation_key(text: &str) -> CollationKey {
    if text.is_empty() {
        return CollationKey {
            bytes: Vec::new(),
            primary_end: 0,
            secondary_end: 0,
        };
    }

    let mut levels = Levels {
        primary: Vec::with_capacity(text.len() * 2 + 8),
        secondary: Vec::new(),
        tertiary: Vec::with_capacity(text.len()),
        primary_position: 0,
    };

    if text.is_ascii() {
        // Source messages are overwhelmingly ASCII. Direct dense-table lookup
        // avoids UTF-8 decoding and side-table searches on that hot path.
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
        primary_position: _,
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
