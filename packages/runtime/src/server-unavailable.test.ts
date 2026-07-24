import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import type { I18nInstance } from "./index"
import { createServerI18nScope } from "./server-unavailable"

describe("@palamedes/runtime/server fallback", () => {
  it("throws an actionable error outside Node server runtimes", () => {
    expect(() => createServerI18nScope<I18nInstance>()).toThrow(
      /only available in Node\.js server runtimes/
    )
  })

  it("provides matching ESM and CJS fallbacks for non-Node conditions", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8")
    ) as {
      exports: {
        "./server": {
          browser: unknown
          default: unknown
        }
      }
    }
    const fallback = {
      import: "./dist/server-unavailable.mjs",
      require: "./dist/server-unavailable.cjs",
    }

    expect(packageJson.exports["./server"].browser).toStrictEqual(fallback)
    expect(packageJson.exports["./server"].default).toStrictEqual(fallback)
  })
})
