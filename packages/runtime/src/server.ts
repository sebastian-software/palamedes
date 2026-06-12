import { AsyncLocalStorage } from "node:async_hooks"

import { type I18nInstance, setServerI18nGetter } from "./index"

export interface ServerI18nScope<T extends I18nInstance = I18nInstance> {
  run<Result>(i18n: T, callback: () => Result): Result
  activate(i18n: T): T
  get(): T | undefined
}

export function createServerI18nScope<
  T extends I18nInstance = I18nInstance,
>(): ServerI18nScope<T> {
  const storage = new AsyncLocalStorage<T>()

  const scope: ServerI18nScope<T> = {
    run(i18n, callback) {
      return storage.run(i18n, callback)
    },
    activate(i18n) {
      storage.enterWith(i18n)
      return i18n
    },
    get() {
      return storage.getStore()
    },
  }

  setServerI18nGetter(() => scope.get())

  return scope
}
