import assert from "node:assert/strict"
import test from "node:test"

import { formatJsId, toFormatJsCatalog } from "./corpus.mjs"
import { parsePoMsgids } from "./po.mjs"

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
