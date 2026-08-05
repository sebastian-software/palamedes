import { AsyncLocalStorage } from "node:async_hooks"

import {
  type CreateServerI18nScopeOptions,
  type I18nInstance,
  type ServerI18nScope,
  setServerI18nGetter,
} from "./index"

export type { CreateServerI18nScopeOptions, ServerI18nScope } from "./index"

const SERVER_SCOPE_STATE_KEY = Symbol.for("palamedes.runtime.serverI18nScopeState")

type ServerScopeState = {
  active: AsyncLocalStorage<I18nInstance>
  activate(i18n: I18nInstance): void
  get(): I18nInstance | undefined
  getRun(): I18nInstance | undefined
  requestI18n: WeakMap<object, I18nInstance>
  requestKeyProviders: Map<symbol, () => object | undefined>
  run<Result>(i18n: I18nInstance, callback: () => Result): Result
}

function getServerScopeState(): ServerScopeState {
  const globalState = globalThis as typeof globalThis & Record<symbol, ServerScopeState | undefined>
  const existing = globalState[SERVER_SCOPE_STATE_KEY]
  if (existing) {
    return existing
  }

  const active = new AsyncLocalStorage<I18nInstance>()
  const running = new AsyncLocalStorage<I18nInstance>()
  const requestI18n = new WeakMap<object, I18nInstance>()
  const requestKeyProviders = new Map<symbol, () => object | undefined>()
  const state: ServerScopeState = {
    active,
    activate(i18n) {
      if (running.getStore()) running.enterWith(i18n)
      active.enterWith(i18n)
      for (const getRequestKey of requestKeyProviders.values()) {
        const requestKey = getRequestKey()
        if (requestKey) requestI18n.set(requestKey, i18n)
      }
    },
    get() {
      const runI18n = running.getStore()
      if (runI18n) return runI18n
      for (const getRequestKey of requestKeyProviders.values()) {
        const requestKey = getRequestKey()
        if (!requestKey) continue
        const requestScopedI18n = requestI18n.get(requestKey)
        if (requestScopedI18n) return requestScopedI18n
      }
      return active.getStore()
    },
    getRun: () => running.getStore(),
    requestI18n,
    requestKeyProviders,
    run: (i18n, callback) => running.run(i18n, () => active.run(i18n, callback)),
  }
  globalState[SERVER_SCOPE_STATE_KEY] = state
  return state
}

export function createServerI18nScope<T extends I18nInstance = I18nInstance>(
  options: CreateServerI18nScopeOptions = {}
): ServerI18nScope<T> {
  const sharedState = getServerScopeState()
  const storage = new AsyncLocalStorage<T>()
  const requestKeyProvider = options.requestKeyProvider
  const getRequestKey = requestKeyProvider?.get
  if (requestKeyProvider) {
    sharedState.requestKeyProviders.set(requestKeyProvider.id, requestKeyProvider.get)
  }

  const scope: ServerI18nScope<T> = {
    run(i18n, callback) {
      return sharedState.run(i18n, () => storage.run(i18n, callback))
    },
    activate(i18n) {
      // enterWith() binds to the CURRENT async context: call this inside a
      // per-request context (middleware, loader, handler). Calling it at
      // module scope leaks one request's i18n into every later request.
      sharedState.activate(i18n)
      storage.enterWith(i18n)
      return i18n
    },
    get() {
      const runI18n = sharedState.getRun()
      if (runI18n) return runI18n as T
      const requestKey = getRequestKey?.()
      if (requestKey) {
        const requestScopedI18n = sharedState.requestI18n.get(requestKey)
        if (requestScopedI18n) return requestScopedI18n as T
      }
      return storage.getStore()
    },
  }

  setServerI18nGetter(() => sharedState.get())

  return scope
}
