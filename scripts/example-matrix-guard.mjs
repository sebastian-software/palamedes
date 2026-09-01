import assert from "node:assert/strict"

import { LOCALE_STRATEGIES, SERVER_FRAMEWORKS, VITE_EXAMPLE } from "./example-matrix.mjs"

function sortedUnique(values) {
  return [...new Set(values)].sort()
}

const CANONICAL_SERVER_FRAMEWORKS = [...SERVER_FRAMEWORKS].sort()
const CANONICAL_LOCALE_STRATEGIES = [...LOCALE_STRATEGIES].sort()

export function assertExampleMatrix(matrix) {
  assert.equal(matrix.length, 25, "the verification matrix must contain 25 examples")
  assert.equal(new Set(matrix.map((example) => example.id)).size, 25, "example ids must be unique")
  assert.equal(
    new Set(matrix.map((example) => example.port)).size,
    25,
    "example ports must be unique"
  )

  const serverExamples = matrix.filter((example) => SERVER_FRAMEWORKS.includes(example.framework))
  assert.deepEqual(
    sortedUnique(serverExamples.map((example) => example.framework)),
    CANONICAL_SERVER_FRAMEWORKS,
    "server framework identities must match the canonical list"
  )
  assert.deepEqual(
    sortedUnique(serverExamples.map((example) => example.strategy)),
    CANONICAL_LOCALE_STRATEGIES,
    "server locale strategy identities must match the canonical list"
  )
  assert.equal(serverExamples.length, 24, "the server matrix must contain 24 examples")

  for (const framework of SERVER_FRAMEWORKS) {
    for (const strategy of LOCALE_STRATEGIES) {
      assert.equal(
        matrix.filter((example) => example.framework === framework && example.strategy === strategy)
          .length,
        1,
        `${framework}/${strategy} must appear exactly once in the server matrix`
      )
    }
  }

  const viteExamples = matrix.filter(
    (example) =>
      example.framework === VITE_EXAMPLE.framework && example.strategy === VITE_EXAMPLE.strategy
  )
  assert.equal(viteExamples.length, 1, "Vite must be the one client-only proof entry")
  assert.equal(viteExamples[0].id, VITE_EXAMPLE.id, "Vite must retain its canonical example id")

  const browserExamples = matrix.filter(
    (example) => example.framework !== "remix" || example.id === "remix-cookie"
  )
  assert.equal(
    browserExamples.length,
    22,
    "the browser layer must cover five full families, Vite, and Remix cookie"
  )
  assert.equal(
    browserExamples.filter((example) => example.framework === VITE_EXAMPLE.framework).length,
    1,
    "Vite must be included in the browser layer"
  )

  const screenshotExamples = matrix.filter(
    (example) => example.framework !== "remix" && example.framework !== VITE_EXAMPLE.framework
  )
  assert.equal(
    screenshotExamples.length,
    20,
    "versioned screenshots must cover only the five UI-adapter families"
  )
  assert.equal(
    screenshotExamples.filter((example) => example.framework === VITE_EXAMPLE.framework).length,
    0,
    "Vite has no screenshot artifact"
  )

  /*
   * The browser layer runs on a weekly cron, so the smoke checks are what
   * asserts the served document locale on a pull request. Requiring the key to
   * be present — `null` for a response that has no document element — keeps a
   * client-only regression from hiding as one more check that simply omitted
   * it, which is how the waku families drifted (#635, #667).
   */
  for (const example of matrix) {
    const checks = example.smokeChecks ?? []
    for (const check of checks) {
      assert.ok(
        Object.hasOwn(check, "htmlLang"),
        `${example.id} smoke check ${check.path} must declare htmlLang (use null for a non-document response)`
      )
      assert.ok(
        check.htmlLang === null ||
          (typeof check.htmlLang === "string" && check.htmlLang.length > 0),
        `${example.id} smoke check ${check.path} must set htmlLang to a locale or null`
      )
    }

    /*
     * Per-check validation is vacuous for an entry that declares no checks at
     * all — the shape the waku family sat in while its document locale went
     * unasserted on pull requests. An entry whose served document genuinely
     * carries no locale (the client-only Vite shell) says so in writing.
     */
    const documentChecks = checks.filter((check) => typeof check.htmlLang === "string")
    const optOut = example.smokeDocumentOptOut
    assert.ok(
      optOut === undefined || (typeof optOut === "string" && optOut.length > 0),
      `${example.id} smokeDocumentOptOut must state why the served document carries no locale`
    )
    assert.ok(
      documentChecks.length > 0 || optOut !== undefined,
      `${example.id} must smoke-check the locale of at least one served document, or declare smokeDocumentOptOut`
    )
    assert.ok(
      documentChecks.length === 0 || optOut === undefined,
      `${example.id} smoke-checks a served document locale, so it must drop smokeDocumentOptOut`
    )
  }
}
