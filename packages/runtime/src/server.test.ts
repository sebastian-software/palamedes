import { describe, expect, it, afterEach } from "vitest"

import { type I18nInstance, getI18n, resetI18nRuntime } from "./index"
import { createServerI18nScope } from "./server"

function createTestI18n(locale = "en"): I18nInstance {
  return {
    locale,
    _: (message: string) => message,
  }
}

describe("@palamedes/runtime/server", () => {
  afterEach(() => {
    resetI18nRuntime()
  })

  it("registers the scope as the active server i18n getter", () => {
    const scope = createServerI18nScope<I18nInstance>()
    const i18n = createTestI18n()

    expect(scope.get()).toBeUndefined()

    scope.run(i18n, () => {
      expect(scope.get()).toBe(i18n)
      expect(getI18n()).toBe(i18n)
    })

    expect(scope.get()).toBeUndefined()
  })

  it("activates an i18n instance for the current async server context", async () => {
    const scope = createServerI18nScope<I18nInstance>()
    const i18n = createTestI18n()

    expect(scope.activate(i18n)).toBe(i18n)
    expect(scope.get()).toBe(i18n)
    expect(getI18n()).toBe(i18n)

    await Promise.resolve()

    expect(scope.get()).toBe(i18n)
    expect(getI18n()).toBe(i18n)
  })

  it("keeps concurrent async server scopes isolated", async () => {
    const scope = createServerI18nScope<I18nInstance>()
    const deI18n = createTestI18n("de")
    const enI18n = createTestI18n("en")

    await Promise.all([
      scope.run(deI18n, async () => {
        await Promise.resolve()
        expect(scope.get()).toBe(deI18n)
        expect(getI18n()).toBe(deI18n)
      }),
      scope.run(enI18n, async () => {
        await Promise.resolve()
        expect(scope.get()).toBe(enI18n)
        expect(getI18n()).toBe(enI18n)
      }),
    ])
  })
})
