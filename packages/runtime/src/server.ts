import { AsyncLocalStorage } from "node:async_hooks"

import { type I18nInstance, setServerI18nGetter } from "./index"

const SERVER_SCOPE_STATE_KEY = Symbol.for("palamedes.runtime.serverI18nScopeState")

interface ServerScopeState {
  active: AsyncLocalStorage<I18nInstance>
}

export interface ServerI18nScope<T extends I18nInstance = I18nInstance> {
  run<Result>(i18n: T, callback: () => Result): Result
  activate(i18n: T): T
  get(): T | undefined
}

function getServerScopeState(): ServerScopeState {
  const globalState = globalThis as typeof globalThis &
    Record<symbol, ServerScopeState | undefined>
  const existing = globalState[SERVER_SCOPE_STATE_KEY]
  if (existing) {
    return existing
  }

  const state: ServerScopeState = {
    active: new AsyncLocalStorage<I18nInstance>(),
  }
  globalState[SERVER_SCOPE_STATE_KEY] = state
  return state
}

export function createServerI18nScope<
  T extends I18nInstance = I18nInstance,
>(): ServerI18nScope<T> {
  const sharedState = getServerScopeState()
  const storage = new AsyncLocalStorage<T>()

  const scope: ServerI18nScope<T> = {
    run(i18n, callback) {
      return sharedState.active.run(i18n, () => storage.run(i18n, callback))
    },
    activate(i18n) {
      sharedState.active.enterWith(i18n)
      storage.enterWith(i18n)
      return i18n
    },
    get() {
      return storage.getStore()
    },
  }

  setServerI18nGetter(() => sharedState.active.getStore())

  return scope
}
