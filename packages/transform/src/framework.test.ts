import { describe, expect, it } from "vitest"

import { resolveMacroRuntimeModule } from "./framework"

describe("resolveMacroRuntimeModule", () => {
  it("keeps macros on the framework-neutral hook-free runtime", () => {
    expect(resolveMacroRuntimeModule()).toBe("@palamedes/runtime")
  })

  it("preserves the advanced explicit runtime-module override", () => {
    expect(resolveMacroRuntimeModule("@acme/runtime")).toBe("@acme/runtime")
  })
})
