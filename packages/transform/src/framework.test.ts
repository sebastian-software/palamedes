import { describe, expect, it } from "vitest"

import { PALAMEDES_BUNDLER_TRANSFORM_INCLUDE } from "./types"
import { resolveMacroRuntimeModule } from "./framework"

describe("PALAMEDES_BUNDLER_TRANSFORM_INCLUDE", () => {
  it("covers the shared Vite and Next source extensions", () => {
    for (const file of [
      "entry.ts",
      "entry.tsx",
      "entry.js",
      "entry.jsx",
      "entry.mjs",
      "entry.cjs",
      "entry.mts",
      "entry.cts",
    ]) {
      expect(PALAMEDES_BUNDLER_TRANSFORM_INCLUDE.test(file)).toBe(true)
    }
    expect(PALAMEDES_BUNDLER_TRANSFORM_INCLUDE.test("entry.css")).toBe(false)
  })
})

describe("resolveMacroRuntimeModule", () => {
  it("keeps macros on the framework-neutral hook-free runtime", () => {
    expect(resolveMacroRuntimeModule()).toBe("@palamedes/runtime")
  })

  it("preserves the advanced explicit runtime-module override", () => {
    expect(resolveMacroRuntimeModule("@acme/runtime")).toBe("@acme/runtime")
  })
})
