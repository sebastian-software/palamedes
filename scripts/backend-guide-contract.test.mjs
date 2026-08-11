import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { createI18n } from "../packages/core/dist/index.mjs"
import { getI18n, resetI18nRuntime } from "../packages/runtime/dist/index.mjs"
import { createServerI18nScope } from "../packages/runtime/dist/server.mjs"

const CATALOGS = {
  en: { "Welcome to Palamedes": "Welcome to Palamedes" },
  de: { "Welcome to Palamedes": "Willkommen bei Palamedes" },
}

function createRequestI18n(locale) {
  const i18n = createI18n({ locale })
  i18n.load(locale, CATALOGS[locale])
  return i18n
}

test.afterEach(() => resetI18nRuntime())

test("backend guide's request pattern loads the locale catalog before translating", async () => {
  const serverI18n = createServerI18nScope()

  const [english, german] = await Promise.all([
    serverI18n.run(createRequestI18n("en"), async () => getI18n()._("Welcome to Palamedes")),
    serverI18n.run(createRequestI18n("de"), async () => getI18n()._("Welcome to Palamedes")),
  ])

  assert.equal(english, "Welcome to Palamedes")
  assert.equal(german, "Willkommen bei Palamedes")
})

test("backend guide does not present an untransformed macro as runnable Node code", () => {
  const guide = readFileSync(new URL("../docs/backend-servers.md", import.meta.url), "utf8")

  assert.match(guide, /i18n\.load\(locale, CATALOGS\[locale\]\)/u)
  assert.match(guide, /createServerI18nScope/u)
  assert.match(guide, /getI18n\(\)\._\("Welcome to Palamedes"\)/u)
  assert.doesNotMatch(guide, /@palamedes\/core\/macro/u)
})
