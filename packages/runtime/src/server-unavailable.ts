const SERVER_RUNTIME_UNAVAILABLE_MESSAGE =
  "@palamedes/runtime/server is only available in Node.js server runtimes. Import it from server-only Node code, not Client Components or Edge runtime code."

export type ServerI18nScope<T = unknown> = {
  run<Result>(i18n: T, callback: () => Result): Result
  activate(i18n: T): T
  get(): T | undefined
}

export function createServerI18nScope(): never {
  throw new Error(SERVER_RUNTIME_UNAVAILABLE_MESSAGE)
}
