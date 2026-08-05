import { AsyncLocalStorage } from "node:async_hooks"

import { describe, expect, it, afterEach, vi } from "vitest"

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

  it("shares the active request scope with isolated module graphs", async () => {
    const scope = createServerI18nScope<I18nInstance>()
    const i18n = createTestI18n("de")
    vi.resetModules()
    const isolatedRuntime = await import("./index")

    scope.run(i18n, () => {
      expect(isolatedRuntime.getI18n()).toBe(i18n)
    })

    isolatedRuntime.resetI18nRuntime()
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

  it("keeps getI18n connected when multiple server scopes exist", () => {
    const firstScope = createServerI18nScope<I18nInstance>()
    createServerI18nScope<I18nInstance>()
    const i18n = createTestI18n("de")

    firstScope.run(i18n, () => {
      expect(firstScope.get()).toBe(i18n)
      expect(getI18n()).toBe(i18n)
    })
  })

  it("connects an isolated SSR bundle to the active request scope", async () => {
    const scope = createServerI18nScope<I18nInstance>()
    const outerI18n = createTestI18n("en")
    const clientComponentI18n = createTestI18n("de")
    vi.resetModules()
    const isolatedRuntime = await import("./index")

    scope.run(outerI18n, () => {
      expect(isolatedRuntime.activateServerI18n(clientComponentI18n)).toBe(clientComponentI18n)
      expect(isolatedRuntime.getI18n()).toBe(clientComponentI18n)
      expect(getI18n()).toBe(clientComponentI18n)
    })

    isolatedRuntime.resetI18nRuntime()
  })

  it("reuses an active instance when an SSR boundary render is retried", async () => {
    const scope = createServerI18nScope<I18nInstance>()
    const outerI18n = createTestI18n("en")
    const clientComponentI18n = createTestI18n("de")
    vi.resetModules()
    const isolatedRuntime = await import("./index")

    scope.run(outerI18n, () => {
      expect(isolatedRuntime.activateServerI18n(clientComponentI18n)).toBe(clientComponentI18n)
      expect(isolatedRuntime.activateServerI18n(clientComponentI18n)).toBe(clientComponentI18n)
      expect(isolatedRuntime.getI18n()).toBe(clientComponentI18n)
    })

    isolatedRuntime.resetI18nRuntime()
  })

  it("keeps isolated SSR bundle activations request-local under concurrency", async () => {
    const scope = createServerI18nScope<I18nInstance>()
    const deI18n = createTestI18n("de")
    const enI18n = createTestI18n("en")
    vi.resetModules()
    const isolatedRuntime = await import("./index")

    await Promise.all([
      scope.run(enI18n, async () => {
        isolatedRuntime.activateServerI18n(deI18n)
        await Promise.resolve()
        expect(isolatedRuntime.getI18n()).toBe(deI18n)
      }),
      scope.run(deI18n, async () => {
        isolatedRuntime.activateServerI18n(enI18n)
        await Promise.resolve()
        expect(isolatedRuntime.getI18n()).toBe(enI18n)
      }),
    ])

    isolatedRuntime.resetI18nRuntime()
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

  it("keeps concurrent activated server contexts isolated", async () => {
    const requestStorage = new AsyncLocalStorage<string>()
    const scope = createServerI18nScope<I18nInstance>()
    const deI18n = createTestI18n("de")
    const enI18n = createTestI18n("en")

    await Promise.all([
      requestStorage.run("de", async () => {
        scope.activate(deI18n)
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(scope.get()).toBe(deI18n)
        expect(getI18n()).toBe(deI18n)
      }),
      requestStorage.run("en", async () => {
        scope.activate(enI18n)
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(scope.get()).toBe(enI18n)
        expect(getI18n()).toBe(enI18n)
      }),
    ])
  })

  it("restores the request instance through a host render key after context resumption", () => {
    const requestStorage = new AsyncLocalStorage<object>()
    const scope = createServerI18nScope<I18nInstance>({
      requestKeyProvider: {
        get: () => requestStorage.getStore(),
        id: Symbol("test-request"),
      },
    })
    const requestKey = {}
    const i18n = createTestI18n("de")

    requestStorage.run(requestKey, () => {
      const resumeFromBeforeActivation = AsyncLocalStorage.snapshot()
      scope.activate(i18n)

      resumeFromBeforeActivation(() => {
        expect(scope.get()).toBe(i18n)
        expect(getI18n()).toBe(i18n)
      })
    })
  })

  it("prefers a nested run scope over the host render fallback", () => {
    const requestStorage = new AsyncLocalStorage<object>()
    const scope = createServerI18nScope<I18nInstance>({
      requestKeyProvider: {
        get: () => requestStorage.getStore(),
        id: Symbol("test-nested-run"),
      },
    })
    const requestI18n = createTestI18n("de")
    const nestedI18n = createTestI18n("en")

    requestStorage.run({}, () => {
      scope.activate(requestI18n)

      scope.run(nestedI18n, () => {
        expect(scope.get()).toBe(nestedI18n)
        expect(getI18n()).toBe(nestedI18n)
      })

      expect(scope.get()).toBe(requestI18n)
      expect(getI18n()).toBe(requestI18n)
    })
  })

  it("keeps sibling run branches isolated when one branch activates another instance", async () => {
    const scope = createServerI18nScope<I18nInstance>()
    const outerI18n = createTestI18n("en")
    const nestedI18n = createTestI18n("de")

    await scope.run(outerI18n, async () => {
      let markActivated: () => void = () => {}
      const activated = new Promise<void>((resolve) => {
        markActivated = resolve
      })

      const activatingBranch = (async () => {
        await Promise.resolve()
        scope.activate(nestedI18n)
        markActivated()
        await Promise.resolve()
        expect(scope.get()).toBe(nestedI18n)
        expect(getI18n()).toBe(nestedI18n)
      })()
      const siblingBranch = (async () => {
        await activated
        expect(scope.get()).toBe(outerI18n)
        expect(getI18n()).toBe(outerI18n)
      })()

      await Promise.all([activatingBranch, siblingBranch])
    })
  })

  it("keeps host render keys isolated when requests resume concurrently", async () => {
    const requestStorage = new AsyncLocalStorage<object>()
    const scope = createServerI18nScope<I18nInstance>({
      requestKeyProvider: {
        get: () => requestStorage.getStore(),
        id: Symbol("test-concurrent-requests"),
      },
    })
    const deI18n = createTestI18n("de")
    const enI18n = createTestI18n("en")

    async function render(i18n: I18nInstance) {
      return requestStorage.run({}, async () => {
        const resumeFromBeforeActivation = AsyncLocalStorage.snapshot()
        scope.activate(i18n)
        await new Promise((resolve) => setTimeout(resolve, 0))
        return resumeFromBeforeActivation(() => getI18n())
      })
    }

    await expect(Promise.all([render(deI18n), render(enI18n)])).resolves.toEqual([deI18n, enI18n])
  })

  it("replaces a framework request-key provider with the same stable id", () => {
    const providerId = Symbol("test-hmr-provider")
    const staleRequestStorage = new AsyncLocalStorage<object>()
    const currentRequestStorage = new AsyncLocalStorage<object>()
    let staleProviderCalls = 0
    createServerI18nScope<I18nInstance>({
      requestKeyProvider: {
        get() {
          staleProviderCalls += 1
          return staleRequestStorage.getStore()
        },
        id: providerId,
      },
    })
    const scope = createServerI18nScope<I18nInstance>({
      requestKeyProvider: {
        get: () => currentRequestStorage.getStore(),
        id: providerId,
      },
    })

    scope.activate(createTestI18n())
    expect(staleProviderCalls).toBe(0)
  })

  it("shares external request activation with an isolated SSR module graph", async () => {
    const requestStorage = new AsyncLocalStorage<object>()
    const scope = createServerI18nScope<I18nInstance>({
      requestKeyProvider: {
        get: () => requestStorage.getStore(),
        id: Symbol("test-isolated-ssr-request"),
      },
    })
    const serverI18n = createTestI18n("en")
    const clientComponentI18n = createTestI18n("de")
    vi.resetModules()
    const isolatedRuntime = await import("./index")

    requestStorage.run({}, () => {
      const resumeFromBeforeActivation = AsyncLocalStorage.snapshot()
      scope.activate(serverI18n)
      isolatedRuntime.activateServerI18n(clientComponentI18n)

      resumeFromBeforeActivation(() => {
        expect(scope.get()).toBe(clientComponentI18n)
        expect(isolatedRuntime.getI18n()).toBe(clientComponentI18n)
        expect(getI18n()).toBe(clientComponentI18n)
      })
    })

    isolatedRuntime.resetI18nRuntime()
  })
})
