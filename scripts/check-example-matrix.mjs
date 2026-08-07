import assert from "node:assert/strict"

import { EXAMPLE_MATRIX, selectBrowserExamples, selectExamples } from "./example-matrix.mjs"

const SERVER_FRAMEWORKS = ["nextjs", "tanstack", "waku", "react-router", "solidstart", "remix"]
const STRATEGIES = ["cookie", "route", "subdomain", "tld"]

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
  assert.equal(examples.length, STRATEGIES.length, `${framework} must cover every locale strategy`)

  for (const strategy of STRATEGIES) {
    assert.equal(
      selectExamples({ framework, strategy }).length,
      1,
      `${framework}/${strategy} must select exactly one example`
    )
  }
}

assert.equal(selectExamples({ framework: "vite", strategy: "client" }).length, 1)
assert.equal(
  selectBrowserExamples({}).length,
  21,
  "the browser layer must cover five full families plus Vite"
)
assert.equal(selectBrowserExamples({ framework: "remix" }).length, 0, "Remix is smoke-only")

console.log(
  "Example matrix verified: 25 smoke examples; 21 browser examples; 6 server families × 4 strategies + Vite MDX."
)
