import assert from "node:assert/strict"
import test from "node:test"

import {
  formatJsId,
  renderLinguiSource,
  renderPalamedesSource,
  toFormatJsCatalog,
} from "./corpus.mjs"
import { parsePoMsgids } from "./po.mjs"

/*
 * Regression guard for #445. The Palamedes lane used to be rendered with
 * `defineMessage`, which 1.5.0 removed from @palamedes/core/macro — so
 * regenerating the corpus with a current CLI failed outright while the checked
 * report, recorded on an older CLI, kept validating. The mismatch went
 * unnoticed for months because nothing asserted the generated source against
 * the macro surface it is supposed to exercise.
 */
const REMOVED_PALAMEDES_MACROS = ["defineMessage", "msg"]

const SAMPLE_MESSAGES = [
  { current: "Plain toolbar message" },
  { current: "Hello {name}, welcome back" },
  { current: "Another plain message" },
  { current: "Queue item for {name} is ready" },
]

test("Palamedes lane authors messages with the post-1.5.0 macro surface", () => {
  const source = renderPalamedesSource(1, SAMPLE_MESSAGES, "ts", 0)

  for (const macro of REMOVED_PALAMEDES_MACROS) {
    assert.ok(
      !source.includes(macro),
      `Palamedes corpus must not use the removed \`${macro}\` macro — see issue #445`
    )
  }
  assert.match(source, /import \{ t \} from "@palamedes\/core\/macro"/u)
  assert.equal(source.match(/t\(\{ message: /gu)?.length, SAMPLE_MESSAGES.length)
})

test("Palamedes lane keeps interpolated messages intact", () => {
  const source = renderPalamedesSource(1, SAMPLE_MESSAGES, "ts", 0)

  /*
   * The placeholder is part of the message text, so an eager t({ message })
   * carries it into the catalog unchanged. This is what makes dropping the
   * deferred macro safe rather than lossy.
   */
  assert.ok(source.includes('t({ message: "Hello {name}, welcome back" })'))
})

test("both macro lanes render an identical logical message inventory", () => {
  /*
   * The harness compares extracted inventories across tools, so the lanes may
   * differ in authoring style but never in which messages they contain.
   */
  const extract = (source) =>
    [...source.matchAll(/message: ("(?:[^"\\]|\\.)*")/gu)]
      .map((match) => JSON.parse(match[1]))
      .sort()

  assert.deepEqual(
    extract(renderPalamedesSource(1, SAMPLE_MESSAGES, "ts", 0)),
    extract(renderLinguiSource(1, SAMPLE_MESSAGES, "ts", 0))
  )
})

test("FormatJS baseline catalog uses the CLI content-hash ID convention", () => {
  assert.equal(formatJsId("Hello world"), "t/eDuu")
  assert.deepEqual(toFormatJsCatalog(["Hello world", "Hello {name}"]), {
    "t/eDuu": { defaultMessage: "Hello world" },
    QM7ITA: { defaultMessage: "Hello {name}" },
  })
})

test("parsePoMsgids reads multiline ICU msgids", () => {
  const source = [
    'msgid ""',
    'msgstr ""',
    '"Language: en\\n"',
    "",
    'msgid "x"',
    'msgstr "x"',
    "",
    'msgid ""',
    '"{count, plural, one {# queue detail 00042-now} other {# queue details "',
    '"00042-now}}"',
    'msgstr ""',
    '"{count, plural, one {# queue detail 00042-now} other {# queue details "',
    '"00042-now}}"',
    "",
    '#~ msgid "obsolete"',
    '#~ msgstr "obsolete"',
    "",
  ].join("\n")

  assert.deepEqual(parsePoMsgids(source), [
    "x",
    "{count, plural, one {# queue detail 00042-now} other {# queue details 00042-now}}",
  ])
})
