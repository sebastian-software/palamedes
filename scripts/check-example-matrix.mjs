import assert from "node:assert/strict"

import {
  EXAMPLE_MATRIX,
  LOCALE_STRATEGIES,
  SERVER_EXAMPLES,
  SERVER_FRAMEWORKS,
  selectBrowserExamples,
  selectExamples,
  selectScreenshotExamples,
} from "./example-matrix.mjs"

assert.equal(EXAMPLE_MATRIX.length, 25, "the verification matrix must contain 25 examples")
assert.equal(
  new Set(EXAMPLE_MATRIX.map((example) => example.id)).size,
  25,
  "example ids must be unique"
)
assert.equal(
  new Set(EXAMPLE_MATRIX.map((example) => example.port)).size,
  25,
  "example ports must be unique"
)

for (const framework of SERVER_FRAMEWORKS) {
  const examples = selectExamples({ framework })
  assert.equal(
    examples.length,
    LOCALE_STRATEGIES.length,
    `${framework} must cover every locale strategy`
  )

  for (const strategy of LOCALE_STRATEGIES) {
    assert.equal(
      selectExamples({ framework, strategy }).length,
      1,
      `${framework}/${strategy} must select exactly one example`
    )
  }
}

assert.equal(SERVER_EXAMPLES.length, 24, "the server matrix must contain 24 examples")
assert.equal(SERVER_FRAMEWORKS.length, 6, "the server matrix must contain six framework families")
assert.equal(LOCALE_STRATEGIES.length, 4, "the server matrix must contain four locale strategies")
assert.equal(selectExamples({ framework: "vite", strategy: "client" }).length, 1)
assert.equal(
  selectBrowserExamples({}).length,
  21,
  "the browser layer must cover five full families plus Vite"
)
assert.equal(selectBrowserExamples({ framework: "remix" }).length, 0, "Remix is smoke-only")
assert.equal(
  selectScreenshotExamples({}).length,
  20,
  "versioned screenshots must cover only the five UI-adapter families"
)
assert.equal(
  selectScreenshotExamples({ framework: "vite" }).length,
  0,
  "Vite has no screenshot artifact"
)
assert.equal(selectScreenshotExamples({ framework: "remix" }).length, 0, "Remix is smoke-only")

console.log(
  "Example matrix verified: 25 smoke examples; 21 browser examples; 6 server families × 4 strategies + Vite MDX."
)
