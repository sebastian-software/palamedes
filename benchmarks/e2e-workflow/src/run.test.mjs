import assert from "node:assert/strict"
import test from "node:test"

import {
  fbteeTextHash,
  formatJsId,
  renderFbteeSource,
  renderGtSource,
  renderLinguiSource,
  renderPalamedesSource,
  toFbteeBaselineTranslations,
  toFormatJsCatalog,
  toGtBaselineCatalog,
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

test("React Intl baseline catalog uses the @formatjs/cli content-hash ID convention", () => {
  assert.equal(formatJsId("Hello world"), "t/eDuu")
  assert.deepEqual(toFormatJsCatalog(["Hello world", "Hello {name}"]), {
    "t/eDuu": { defaultMessage: "Hello world" },
    QM7ITA: { defaultMessage: "Hello {name}" },
  })
})

test("General Translation lane authors every message exactly once", () => {
  /*
   * GT keys `<T>` children and `t()` strings separately, so a message authored
   * both ways would reach the catalog under two keys and inflate the extracted
   * inventory past the generated one.
   */
  const source = renderGtSource(1, SAMPLE_MESSAGES, "tsx", 0)

  for (const message of SAMPLE_MESSAGES) {
    const occurrences = source.split(message.current).length - 1
    assert.equal(occurrences, 1, `${message.current} must be authored exactly once`)
  }
  assert.match(source, /import \{ T, useGT \} from "gt-react"/u)
  assert.ok(source.includes("<T>Plain toolbar message</T>"))
})

test("General Translation lane skips <T> when every message is interpolated", () => {
  /*
   * GT rejects a `{name}` placeholder in JSX children — it reads as a runtime
   * expression — so an all-interpolated file must keep its JSX but author the
   * messages through t() only. Message index 0-14 of the generated inventory
   * are all interpolated, which puts whole files in this state.
   */
  const interpolated = SAMPLE_MESSAGES.filter((entry) => entry.current.includes("{name}"))
  const source = renderGtSource(1, interpolated, "tsx", 0)

  assert.ok(!source.includes("<T>"), "no <T> may wrap an interpolated message")
  assert.match(source, /import \{ useGT \} from "gt-react"/u)
  assert.ok(source.includes("<section>"), "the file stays a JSX module")
})

test("General Translation baseline reuses real keys and synthesizes stale ones", () => {
  const currentKeys = new Map([["Unchanged message", "aaaabbbbccccdddd"]])
  const catalog = toGtBaselineCatalog(["Unchanged message", "Previous message"], currentKeys)

  assert.equal(catalog.aaaabbbbccccdddd, "Unchanged message")

  const staleKey = Object.keys(catalog).find((key) => key !== "aaaabbbbccccdddd")
  assert.match(staleKey, /^[0-9a-f]{16}$/u, "a stale entry must look like a GT content hash")
  assert.equal(catalog[staleKey], "Previous message")
})

test("fbtee lane authors every message exactly once with required descriptions", () => {
  const source = renderFbteeSource(1, SAMPLE_MESSAGES, "tsx", 0)

  for (const message of SAMPLE_MESSAGES) {
    const occurrences = source.split(message.current).length - 1
    assert.equal(occurrences, 1, `${message.current} must be authored exactly once`)
  }
  assert.match(source, /import \{ fbs \} from "fbtee"/u)
  assert.ok(source.includes('<fbt desc="Workflow benchmark message">Plain toolbar message</fbt>'))
  assert.ok(source.includes('fbs("Hello {name}, welcome back", "Workflow benchmark message")'))
})

test("fbtee lane skips <fbt> when every message carries a literal placeholder", () => {
  const interpolated = SAMPLE_MESSAGES.filter((entry) => entry.current.includes("{name}"))
  const source = renderFbteeSource(1, interpolated, "tsx", 0)

  assert.ok(!source.includes("<fbt"), "no <fbt> may duplicate an fbs-authored message")
  assert.equal(source.match(/fbs\(/gu)?.length, interpolated.length)
})

test("fbtee baseline reuses collected keys and hashes stale source identities", () => {
  const currentKeys = new Map([["Unchanged message", "real-current-key"]])
  const catalog = toFbteeBaselineTranslations(
    ["Unchanged message", "Previous message"],
    currentKeys,
    "de"
  )

  assert.equal(catalog["real-current-key"].translations[0].translation, "[de] Unchanged message")

  const staleKey = fbteeTextHash("Previous message")
  assert.equal(catalog[staleKey].description, "Workflow benchmark message")
  assert.equal(catalog[staleKey].status, "translated")
  assert.equal(catalog[staleKey].translations[0].translation, "[de] Previous message")
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
