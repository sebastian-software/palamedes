import assert from "node:assert/strict"
import test from "node:test"

import { parsePoMsgids } from "./po.mjs"

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
