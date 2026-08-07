import { AsyncLocalStorage } from "node:async_hooks"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  type I18nInstance,
  getI18n,
  initializeClientI18n,
  loadRegisteredMessages,
  registerMessageLoaderGroup,
  registerMessageLoaders,
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

  it("initializes one client instance for graph-split modules", () => {
    ;(globalThis as Record<string, unknown>).window = {}
    const activate = vi.fn<(locale: string) => void>()
    const load = vi.fn()
    const createI18n = vi.fn(() => ({
      locale: "",
      _: (message: string) => message,
      activate(locale: string) {
        activate(locale)
        this.locale = locale
      },
      load,
    }))

    const first = initializeClientI18n("de", createI18n)
    const second = initializeClientI18n("de", createI18n)

    expect(first).toBe(second)
    expect(createI18n).toHaveBeenCalledOnce()
    expect(activate).toHaveBeenCalledWith("de")
    expect(() => initializeClientI18n("en", createI18n)).toThrow(
      /document was initialized for "de"/
    )
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

  it("loads eager registrations into a request-local server instance", async () => {
    const messages = { keyG: "G" }
    registerMessages({ "reg-server-eager": messages })
    const i18n = createLoadableI18n("reg-server-eager")

    await expect(loadRegisteredMessages(i18n, "reg-server-eager")).resolves.toBe(i18n)
    expect(i18n.loaded["reg-server-eager"]).toEqual([messages])
    expect(i18n.loaded["reg-server-eager"]?.[0]).toBe(messages)
  })

  it("loads only the requested locale from lazy module registrations", async () => {
    const en = { keyH: "H" }
    const de = { keyH: "H-de" }
    const loadEn = vi.fn(async () => en)
    const loadDe = vi.fn(async () => de)
    registerMessageLoaders("reg-server-locale", {
      en: loadEn,
      de: loadDe,
    })
    const i18n = createLoadableI18n("de")

    await loadRegisteredMessages(i18n, "de")

    expect(loadEn).not.toHaveBeenCalled()
    expect(loadDe).toHaveBeenCalledOnce()
    expect(i18n.loaded.de).toEqual([de])
  })

  it("deduplicates lazy imports across concurrent and later requests", async () => {
    const messages = { keyI: "I" }
    const load = vi.fn(async () => messages)
    registerMessageLoaders("reg-server-dedupe", { "reg-server-dedupe": load })
    const first = createLoadableI18n("reg-server-dedupe")
    const second = createLoadableI18n("reg-server-dedupe")

    await Promise.all([
      loadRegisteredMessages(first, "reg-server-dedupe"),
      loadRegisteredMessages(second, "reg-server-dedupe"),
    ])
    await loadRegisteredMessages(first, "reg-server-dedupe")

    expect(load).toHaveBeenCalledOnce()
    expect(first.loaded["reg-server-dedupe"]).toEqual([messages, messages])
    expect(second.loaded["reg-server-dedupe"]).toEqual([messages])
  })

  it("retries a failed lazy import", async () => {
    const load = vi
      .fn<() => Promise<Record<string, string>>>()
      .mockRejectedValueOnce(new Error("temporary import failure"))
      .mockResolvedValueOnce({ keyJ: "J" })
    registerMessageLoaders("reg-server-retry", { "reg-server-retry": load })
    const i18n = createLoadableI18n("reg-server-retry")

    await expect(loadRegisteredMessages(i18n, "reg-server-retry")).rejects.toThrow(
      "temporary import failure"
    )
    await expect(loadRegisteredMessages(i18n, "reg-server-retry")).resolves.toBe(i18n)

    expect(load).toHaveBeenCalledTimes(2)
  })

  it("replaces a stable loader registration during HMR", async () => {
    const first = vi.fn(async () => ({ keyK: "old" }))
    const second = vi.fn(async () => ({ keyK: "new" }))
    registerMessageLoaders("reg-server-hmr", { "reg-server-hmr": first })
    const i18n = createLoadableI18n("reg-server-hmr")
    await loadRegisteredMessages(i18n, "reg-server-hmr")

    registerMessageLoaders("reg-server-hmr", { "reg-server-hmr": second })
    await loadRegisteredMessages(i18n, "reg-server-hmr")

    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
    expect(i18n.loaded["reg-server-hmr"]).toEqual([{ keyK: "old" }, { keyK: "new" }])
  })

  it("replaces a source module's entire registration group", async () => {
    const oldLoader = vi.fn(async () => ({ keyM: "old" }))
    const newLoader = vi.fn(async () => ({ keyM: "new" }))
    registerMessageLoaderGroup("reg-server-group", [{ "reg-server-group": oldLoader }])
    const first = createLoadableI18n("reg-server-group")
    await loadRegisteredMessages(first, "reg-server-group")

    registerMessageLoaderGroup("reg-server-group", [{ "reg-server-group": newLoader }])
    const second = createLoadableI18n("reg-server-group")
    await loadRegisteredMessages(second, "reg-server-group")

    expect(oldLoader).toHaveBeenCalledOnce()
    expect(newLoader).toHaveBeenCalledOnce()
    expect(second.loaded["reg-server-group"]).toEqual([{ keyM: "new" }])
  })

  it("removes a source module's registrations when it no longer has messages", async () => {
    const loader = vi.fn(async () => ({ keyN: "stale" }))
    registerMessageLoaderGroup("reg-server-removed", [{ "reg-server-removed": loader }])
    registerMessageLoaderGroup("reg-server-removed", [])

    await loadRegisteredMessages(createLoadableI18n("reg-server-removed"), "reg-server-removed")

    expect(loader).not.toHaveBeenCalled()
  })

  it("does not let an old module disposal remove its HMR replacement", async () => {
    const oldLoader = vi.fn(async () => ({ keyO: "old" }))
    const newLoader = vi.fn(async () => ({ keyO: "new" }))
    const releaseOld = registerMessageLoaderGroup("reg-server-dispose", [
      { "reg-server-dispose": oldLoader },
    ])
    const releaseNew = registerMessageLoaderGroup("reg-server-dispose", [
      { "reg-server-dispose": newLoader },
    ])
    releaseOld()

    const i18n = createLoadableI18n("reg-server-dispose")
    await loadRegisteredMessages(i18n, "reg-server-dispose")

    expect(oldLoader).not.toHaveBeenCalled()
    expect(newLoader).toHaveBeenCalledOnce()
    releaseNew()
    await expect(
      loadRegisteredMessages(createLoadableI18n("reg-server-dispose"), "reg-server-dispose")
    ).resolves.toBeDefined()
  })

  it("rejects a non-loadable instance only when graph messages exist", async () => {
    const i18n = createTestI18n("reg-server-unloadable")

    await expect(loadRegisteredMessages(i18n, "reg-server-empty")).resolves.toBe(i18n)
    registerMessageLoaders("reg-server-unloadable", {
      "reg-server-unloadable": async () => ({ keyL: "L" }),
    })
    await expect(loadRegisteredMessages(i18n, "reg-server-unloadable")).rejects.toThrow(
      "cannot load generated graph-split messages"
    )
  })
})
