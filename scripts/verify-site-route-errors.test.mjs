import assert from "node:assert/strict"
import test from "node:test"

import { isExpectedSkippedViewTransitionError } from "./verify-site-route-errors.mjs"

test("accepts only the observed skipped View Transition page error", () => {
  assert.equal(
    isExpectedSkippedViewTransitionError("pageerror", {
      name: "AbortError",
      message: "Transition was skipped",
    }),
    true
  )

  for (const [channel, error] of [
    ["console", { name: "AbortError", message: "Transition was skipped" }],
    ["pageerror", { name: "Error", message: "Transition was skipped" }],
    ["pageerror", { name: "AbortError", message: "Transition was skipped." }],
    ["pageerror", { name: "AbortError", message: "Transition was skipped by the app" }],
    ["pageerror", null],
  ]) {
    assert.equal(isExpectedSkippedViewTransitionError(channel, error), false)
  }
})
