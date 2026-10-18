import assert from "node:assert/strict";
import test from "node:test";

import {
  isExpectedSkippedViewTransitionError,
  isKnownArdoBreadcrumbHydrationWarning,
} from "./verify-site-route-errors.mjs";

test("accepts only the observed skipped View Transition page error", () => {
  assert.equal(
    isExpectedSkippedViewTransitionError("pageerror", {
      name: "AbortError",
      message: "Transition was skipped",
    }),
    true,
  );

  for (const [channel, error] of [
    ["console", { name: "AbortError", message: "Transition was skipped" }],
    ["pageerror", { name: "Error", message: "Transition was skipped" }],
    ["pageerror", { name: "AbortError", message: "Transition was skipped." }],
    ["pageerror", { name: "AbortError", message: "Transition was skipped by the app" }],
    ["pageerror", null],
  ]) {
    assert.equal(isExpectedSkippedViewTransitionError(channel, error), false);
  }
});

const breadcrumbWarning =
  "Minified React error #418; visit https://react.dev/errors/418?args[]=HTML&args[]= for details";

test("recognizes the existing ARDO HTML hydration warning only on generated routes", () => {
  for (const path of [
    "/docs",
    "/docs/cli",
    "/docs/rust-applications",
    "/decisions",
    "/decisions/004",
    "/api-reference",
    "/api-reference/core",
    "/blog/measuring-palamedes-honestly",
  ]) {
    assert.equal(isKnownArdoBreadcrumbHydrationWarning(path, breadcrumbWarning), true, path);
  }
  for (const path of ["/", "/frameworks", "/guides", "/docs-other", "/blog"]) {
    assert.equal(isKnownArdoBreadcrumbHydrationWarning(path, breadcrumbWarning), false, path);
  }
});

test("does not exempt other runtime or hydration errors on generated routes", () => {
  for (const message of [
    "TypeError: catalog is undefined",
    "Minified React error #418; visit https://react.dev/errors/418?args[]=text",
    "Minified React error #423; args[]=HTML",
    "Hydration failed",
  ]) {
    assert.equal(isKnownArdoBreadcrumbHydrationWarning("/docs/rust-applications", message), false);
  }
});
