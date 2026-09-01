import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

import {
  EXAMPLE_MATRIX,
  LOCALE_STRATEGIES,
  ROOT,
  SERVER_EXAMPLES,
  SERVER_FRAMEWORKS,
  selectBrowserExamples,
  selectExamples,
  selectScreenshotExamples,
} from "./example-matrix.mjs"
import { assertExampleMatrix } from "./example-matrix-guard.mjs"

function axisSlugs(source, name) {
  const body = source.match(
    new RegExp(`export const ${name}:[\\s\\S]+?= \\[([\\s\\S]+?)\\n\\]`, "u")
  )?.[1]
  assert.ok(body, `site matrix must export ${name}`)
  return [...body.matchAll(/slug: "([^"]+)"/gu)].map((match) => match[1]).sort()
}

export function assertSiteMatrixAxes(source) {
  assert.deepEqual(
    axisSlugs(source, "FRAMEWORKS"),
    [...SERVER_FRAMEWORKS].sort(),
    "site framework axes must match the canonical example matrix"
  )
  assert.deepEqual(
    axisSlugs(source, "STRATEGIES"),
    [...LOCALE_STRATEGIES].sort(),
    "site strategy axes must match the canonical example matrix"
  )
}

assertExampleMatrix(EXAMPLE_MATRIX)
assertSiteMatrixAxes(readFileSync(path.join(ROOT, "site/app/data/matrix.ts"), "utf8"))

if (
  SERVER_EXAMPLES.length !== 24 ||
  SERVER_FRAMEWORKS.length !== 6 ||
  LOCALE_STRATEGIES.length !== 4
) {
  throw new Error("canonical server matrix exports must remain six families by four strategies")
}
if (selectExamples({ framework: "vite", strategy: "client" }).length !== 1) {
  throw new Error("the Vite selector must return the single client-only proof")
}
if (
  selectBrowserExamples({}).length !== 22 ||
  selectBrowserExamples({ framework: "remix" }).length !== 1
) {
  throw new Error("the browser selector must include Vite and the focused Remix cookie proof")
}
if (
  selectScreenshotExamples({}).length !== 20 ||
  selectScreenshotExamples({ framework: "vite" }).length !== 0 ||
  selectScreenshotExamples({ framework: "remix" }).length !== 0
) {
  throw new Error("the screenshot selector must include only the UI-adapter matrix")
}

console.log(
  "Example matrix verified: 25 smoke examples; 22 browser examples; 6 server families × 4 strategies + Vite MDX."
)
