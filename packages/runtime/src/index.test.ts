import { AsyncLocalStorage } from "node:async_hooks"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  type I18nInstance,
  getI18n,
  registerMessages,
  resetI18nRuntime,
  setClientI18n,
  setServerI18nGetter,
} from "./index"

function createTestI18n(locale = "en"): I18nInstance {
  return {
    locale,
    _: (message: string) => message,
  }
}

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
    const i18n = createTestI18n()
    setClientI18n(i18n)

    expect(getI18n()).toBe(i18n)
  })

  it("shares the active client instance across isolated module graphs", async () => {
    ;(globalThis as Record<string, unknown>).window = {}
    vi.resetModules()
    const isolatedRuntime = await import("./index")
    const i18n = createTestI18n("de")

    isolatedRuntime.setClientI18n(i18n)

    expect(getI18n()).toBe(i18n)
  })

  it("resolves the request-local server instance", () => {
    const i18n = createTestI18n()
    setServerI18nGetter(() => i18n)

    expect(getI18n()).toBe(i18n)
  })

  it("supports async request-local server instances", async () => {
    const storage = new AsyncLocalStorage<I18nInstance>()
    const deI18n = createTestI18n("de")
    const enI18n = createTestI18n("en")

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

describe("registerMessages", () => {
  // The registration buffer is deliberately global and survives resetI18nRuntime,
  // so every test here uses locale keys unique to that test.
  afterEach(() => {
    resetI18nRuntime()
    delete (globalThis as Record<string, unknown>).window
  })

  function createLoadableI18n(locale = "en") {
    const loaded: Record<string, Record<string, string>[]> = {}
    return {
      locale,
      _: (message: string) => message,
      load(loadLocale: string, messages: Record<string, string>) {
        ;(loaded[loadLocale] ??= []).push(messages)
      },
      loaded,
    }
  }

  it("flushes registrations buffered before the client instance is installed", () => {
    ;(globalThis as Record<string, unknown>).window = {}
    registerMessages({ "reg-flush": { keyA: "A" } })

    const i18n = createLoadableI18n("reg-flush")
    setClientI18n(i18n)

    expect(i18n.loaded["reg-flush"]).toEqual([{ keyA: "A" }])
  })

  it("loads directly into an already-installed client instance", () => {
    ;(globalThis as Record<string, unknown>).window = {}
    const i18n = createLoadableI18n("reg-direct")
    setClientI18n(i18n)

    registerMessages({ "reg-direct": { keyB: "B" } })

    expect(i18n.loaded["reg-direct"]).toEqual([{ keyB: "B" }])
  })

  it("flushes registrations for the same locale individually and in order", () => {
    ;(globalThis as Record<string, unknown>).window = {}
    // Never merged into a copy: generated catalogs carry the compiled-catalog
    // brand, and the parser-free runtime rejects unbranded copies.
    const first = { keyC: "C" }
    const second = { keyD: "D" }
    registerMessages({ "reg-merge": first })
    registerMessages({ "reg-merge": second })

    const i18n = createLoadableI18n("reg-merge")
    setClientI18n(i18n)

    expect(i18n.loaded["reg-merge"]).toEqual([{ keyC: "C" }, { keyD: "D" }])
    expect(i18n.loaded["reg-merge"]?.[0]).toBe(first)
    expect(i18n.loaded["reg-merge"]?.[1]).toBe(second)
  })

  it("survives resetI18nRuntime, because registering modules evaluate only once", () => {
    ;(globalThis as Record<string, unknown>).window = {}
    registerMessages({ "reg-reset": { keyE: "E" } })
    resetI18nRuntime()

    const i18n = createLoadableI18n("reg-reset")
    setClientI18n(i18n)

    expect(i18n.loaded["reg-reset"]).toEqual([{ keyE: "E" }])
  })

  it("ignores instances without a load method", () => {
    ;(globalThis as Record<string, unknown>).window = {}
    registerMessages({ "reg-plain": { keyF: "F" } })

    expect(() => setClientI18n(createTestI18n("reg-plain"))).not.toThrow()
  })
})
