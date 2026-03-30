import { AsyncLocalStorage } from "node:async_hooks"

import { afterEach, describe, expect, it } from "vitest"

import { createI18n } from "@palamedes/core"

import { getI18n, resetI18nRuntime, setClientI18n, setServerI18nGetter } from "./index"

describe("@palamedes/runtime", () => {
  afterEach(() => {
    resetI18nRuntime()
    delete (globalThis as Record<string, unknown>).window
  })

  it("fails loudly when no server instance is configured", () => {
    expect(() => getI18n()).toThrow(/No active server i18n instance/)
  })

  it("fails loudly when no client instance is configured", () => {
    ;(globalThis as Record<string, unknown>).window = {}
    expect(() => getI18n()).toThrow(/No active client i18n instance/)
  })

  it("resolves the active client instance", () => {
    ;(globalThis as Record<string, unknown>).window = {}
    const i18n = createI18n()
    setClientI18n(i18n)

    expect(getI18n()).toBe(i18n)
  })

  it("resolves the request-local server instance", () => {
    const i18n = createI18n()
    setServerI18nGetter(() => i18n)

    expect(getI18n()).toBe(i18n)
  })

  it("supports async request-local server instances", async () => {
    const storage = new AsyncLocalStorage<ReturnType<typeof createI18n>>()
    const deI18n = createI18n()
    const enI18n = createI18n()

    setServerI18nGetter(() => storage.getStore())

    await Promise.all([
      storage.run(deI18n, async () => {
        await Promise.resolve()
        expect(getI18n()).toBe(deI18n)
      }),
      storage.run(enI18n, async () => {
        await Promise.resolve()
        expect(getI18n()).toBe(enI18n)
      }),
    ])
  })
})
