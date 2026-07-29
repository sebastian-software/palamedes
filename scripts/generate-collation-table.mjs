#!/usr/bin/env node
/*
 * Generates the collation table used by `PoOrderBy::Collated`.
 *
 * Lingui orders catalogs with `new Intl.Collator("en-US")`, which resolves to
 * the unmodified CLDR root collation because English carries no tailoring of
 * its own. Rather than linking ICU4X and its ~1.28 MB of baked data to
 * reproduce that, this derives the small part of the root order that source
 * messages actually exercise — primary weights for Latin text, punctuation,
 * symbols and digits, plus the canonical decompositions that map accented
 * characters onto their base letter.
 *
 * Run with `--check` to verify the checked-in table is current.
 */

import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const OUTPUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "crates",
  "palamedes",
  "src",
  "collation_table.rs"
)

const collator = new Intl.Collator("en-US")

/*
 * The covered repertoire: printable ASCII, the typographic characters that
 * show up in UI copy, and Latin-1 Supplement plus Latin Extended-A. Anything
 * outside this sorts after the table by code point, which matches root
 * collation's placement of non-Latin scripts after Latin even though it does
 * not reproduce the order within them.
 */
function repertoire() {
  const chars = []
  for (let c = 0x20; c < 0x7f; c++) chars.push(String.fromCodePoint(c))
  for (const c of "‘’“”–—…·•€£¥©®™°±×÷§¶†‡→←↑↓«»‹›„‚") chars.push(c)
  for (let c = 0xa1; c <= 0x01_7f; c++) chars.push(String.fromCodePoint(c))
  return chars
}

const isCombining = (ch) => /\p{Mn}/u.test(ch)

/** The base letter a character contributes at the primary level. */
function baseOf(ch) {
  const stripped = [...ch.normalize("NFD")].filter((c) => !isCombining(c)).join("")
  return (stripped || ch).toLowerCase()
}

/*
 * The covered range is contiguous, so the table is emitted as a dense array
 * indexed by `code point - RANGE_START`. Building the key is the hot path of a
 * collated extraction — a direct index keeps it a single load per character
 * instead of a search.
 */
const RANGE_START = 0x20
const RANGE_END = 0x01_7f

function buildTable() {
  const chars = repertoire()

  // Primary order: one weight per base character, ordered by ICU itself.
  const bases = [...new Set(chars.map(baseOf))].filter((b) => [...b].length === 1)
  bases.sort((a, b) => collator.compare(a, b) || (a < b ? -1 : 1))
  /*
   * Weights are emitted as single bytes and must stay below the marker the key
   * builder uses for uncovered characters, so the repertoire has a hard cap.
   */
  if (bases.length >= 0xff) {
    throw new Error(
      `Repertoire has ${bases.length} base characters; a primary weight must fit in a byte below 0xFF.`
    )
  }
  const weightOf = new Map(bases.map((b, index) => [b, index + 1]))

  /*
   * One row per code point in the range, folding together everything the key
   * builder needs: the primary weight of the base letter, the diacritic that
   * belongs on the secondary level, and whether the character is uppercase.
   *
   * Carrying the diacritic matters — without it the accent would vanish from
   * the key entirely and "resume" could not be distinguished from "résumé"
   * before the raw tie-break.
   */
  const wide = []
  const rowFor = (ch) => {
    const nfd = [...ch.normalize("NFD")]
    const marks = nfd.filter((c) => isCombining(c))
    if (marks.length > 1) {
      // Rare enough to keep out of the row itself; looked up separately.
      wide.push([ch, nfd.join("")])
    }
    return {
      weight: weightOf.get(baseOf(ch)) ?? 0,
      secondary: marks.length === 1 ? marks[0].codePointAt(0) : 0,
      upper: ch !== ch.toLowerCase(),
      wide: marks.length > 1,
    }
  }

  const rows = []
  for (let code = RANGE_START; code <= RANGE_END; code++) {
    rows.push(rowFor(String.fromCodePoint(code)))
  }

  /*
   * The repertoire also covers typographic characters well above the dense
   * range — curly quotes, dashes, the ellipsis. Missing these is not a subtle
   * degradation: they would fall through to the uncovered fallback and sort
   * after every letter, so a quoted message would land at the end of the
   * catalog.
   */
  const extra = chars
    .filter((ch) => {
      const code = ch.codePointAt(0)
      return code < RANGE_START || code > RANGE_END
    })
    .map((ch) => [ch, rowFor(ch)])
  extra.sort(([a], [b]) => a.codePointAt(0) - b.codePointAt(0))

  wide.sort(([a], [b]) => a.codePointAt(0) - b.codePointAt(0))

  return { rows, extra, wide }
}

/*
 * Format and control characters are emitted as escapes. A literal soft hyphen
 * or zero-width joiner in the source is invisible to a reader and trips
 * clippy's `invisible_characters` lint.
 */
const isInvisible = (ch) =>
  /[\p{Cf}\p{Cc}\p{Zl}\p{Zp}]/u.test(ch) || (/\p{Zs}/u.test(ch) && ch !== " ")

const rustChar = (ch) => {
  if (isInvisible(ch)) return `'\\u{${ch.codePointAt(0).toString(16).toUpperCase()}}'`
  if (ch === "\\") return "'\\\\'"
  if (ch === "'") return "'\\''"
  return `'${ch}'`
}

const rustStr = (s) =>
  `"${[...s]
    .map((ch) => {
      if (isInvisible(ch)) return `\\u{${ch.codePointAt(0).toString(16).toUpperCase()}}`
      if (ch === "\\") return "\\\\"
      if (ch === '"') return '\\"'
      return ch
    })
    .join("")}"`

const renderRow = ({ weight, secondary, upper, wide: isWide }) =>
  `Row { primary: ${weight}, secondary: ${secondary}, upper: ${upper}, wide: ${isWide} }`

function render({ rows, extra, wide }) {
  const dense = rows.map((row) => `    ${renderRow(row)},`).join("\n")
  const extraRows = extra.map(([ch, row]) => `    (${rustChar(ch)}, ${renderRow(row)}),`).join("\n")
  const wideRows = wide.map(([ch, nfd]) => `    (${rustChar(ch)}, ${rustStr(nfd)}),`).join("\n")

  return `// @generated by scripts/generate-collation-table.mjs — do not edit.
//
// Derived from \`Intl.Collator("en-US")\`, which resolves to the unmodified
// CLDR root collation. Regenerate with \`pnpm generate:collation-table\`.

/// Everything the key builder needs for one code point.
pub(crate) struct Row {
    /// Rank of the base letter in CLDR root order, or 0 when uncovered.
    pub(crate) primary: u8,
    /// Combining mark contributed to the secondary level, or 0 for none.
    pub(crate) secondary: u32,
    /// Whether the character is uppercase, which is a tertiary difference.
    pub(crate) upper: bool,
    /// Whether the character decomposes into more than one mark and has to be
    /// looked up in [\`WIDE\`] instead.
    pub(crate) wide: bool,
}

/// First code point covered by [\`ROWS\`].
pub(crate) const RANGE_START: u32 = ${RANGE_START};

/// Dense rows indexed by \`code point - RANGE_START\`.
#[rustfmt::skip]
pub(crate) const ROWS: &[Row] = &[
${dense}
];

/// Covered characters above the dense range — typographic quotes, dashes and
/// the like. Sorted by character so lookups can binary search.
#[rustfmt::skip]
pub(crate) const EXTRA: &[(char, Row)] = &[
${extraRows}
];

/// Canonical decompositions for the few characters carrying several marks,
/// sorted by character.
#[rustfmt::skip]
pub(crate) const WIDE: &[(char, &str)] = &[
${wideRows}
];
`
}

const rendered = render(buildTable())

if (process.argv.includes("--check")) {
  const current = readFileSync(OUTPUT, "utf8")
  if (current !== rendered) {
    console.error(
      `${OUTPUT} is out of date. Run \`pnpm generate:collation-table\` and commit the result.`
    )
    process.exit(1)
  }
  console.log("Collation table is up to date.")
} else {
  writeFileSync(OUTPUT, rendered)
  console.log(`Wrote ${OUTPUT}`)
}
