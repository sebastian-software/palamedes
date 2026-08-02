// @vitest-environment node
import { describe, expect, it } from "vitest"

import { resetI18nRuntime, setServerI18nGetter, type I18nInstance } from "@palamedes/runtime"

import { getI18n } from "./runtime"

describe("@palamedes/react/runtime on the server", () => {
  it("resolves the request-local instance outside component rendering", () => {
    // Route actions and loaders call transformed macros outside any React
    // render. In a server environment this must reach the runtime getter
    // directly instead of a hook, which would crash on React's null
    // production dispatcher.
    const i18n: I18nInstance = { locale: "de", _: () => "" }
    setServerI18nGetter(() => i18n)

    try {
      expect(getI18n()).toBe(i18n)
      expect(getI18n()).toBe(i18n)
    } finally {
      resetI18nRuntime()
    }
  })
})
