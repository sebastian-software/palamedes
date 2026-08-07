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

  const browserExamples = matrix.filter((example) => example.framework !== "remix")
  assert.equal(
    browserExamples.length,
    21,
    "the browser layer must cover five full families plus Vite"
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
}
