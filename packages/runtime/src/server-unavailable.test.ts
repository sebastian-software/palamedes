import { describe, expect, it } from "vitest"

import { createServerI18nScope } from "./server-unavailable"

describe("@palamedes/runtime/server fallback", () => {
  it("throws an actionable error outside Node server runtimes", () => {
    expect(() => createServerI18nScope()).toThrow(/only available in Node\.js server runtimes/)
  })
})
