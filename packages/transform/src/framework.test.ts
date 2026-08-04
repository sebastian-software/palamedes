import { describe, expect, it } from "vitest"

import { resolveMacroRuntimeModule } from "./framework"

describe("resolveMacroRuntimeModule", () => {
  it.each(["react", "solid", "none"] as const)(
    "keeps %s macros hook-free when locale changes reload the document",
    (framework) => {
      expect(resolveMacroRuntimeModule(framework)).toBe("@palamedes/runtime")
    }
  )

  it.each([
    ["react", "@palamedes/react/runtime"],
    ["solid", "@palamedes/solid/runtime"],
  ] as const)("opts %s into its reactive runtime for live switching", (framework, expected) => {
    expect(resolveMacroRuntimeModule(framework, undefined, "live")).toBe(expected)
  })

  it("requires an explicit framework contract for live switching", () => {
    expect(() => resolveMacroRuntimeModule("none", undefined, "live")).toThrow(
      /requires framework="react" or framework="solid"/
    )
  })

  it("lets an explicit runtime module override switching and framework defaults", () => {
    expect(resolveMacroRuntimeModule("none", "@acme/runtime", "live")).toBe("@acme/runtime")
  })
})
