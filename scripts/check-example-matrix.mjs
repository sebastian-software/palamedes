import {
  EXAMPLE_MATRIX,
  LOCALE_STRATEGIES,
  SERVER_EXAMPLES,
  SERVER_FRAMEWORKS,
  selectBrowserExamples,
  selectExamples,
  selectScreenshotExamples,
} from "./example-matrix.mjs"
import { assertExampleMatrix } from "./example-matrix-guard.mjs"

assertExampleMatrix(EXAMPLE_MATRIX)

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
  selectBrowserExamples({}).length !== 21 ||
  selectBrowserExamples({ framework: "remix" }).length !== 0
) {
  throw new Error("the browser selector must include Vite and exclude Remix")
}
if (
  selectScreenshotExamples({}).length !== 20 ||
  selectScreenshotExamples({ framework: "vite" }).length !== 0 ||
  selectScreenshotExamples({ framework: "remix" }).length !== 0
) {
  throw new Error("the screenshot selector must include only the UI-adapter matrix")
}

console.log(
  "Example matrix verified: 25 smoke examples; 21 browser examples; 6 server families × 4 strategies + Vite MDX."
)
