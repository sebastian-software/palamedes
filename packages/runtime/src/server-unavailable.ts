import type { I18nInstance, ServerI18nScope } from "./index"

export type { ServerI18nScope } from "./index"

const SERVER_RUNTIME_UNAVAILABLE_MESSAGE =
  "@palamedes/runtime/server is only available in Node.js server runtimes. Import it from server-only Node code, not Client Components or Edge runtime code."

export function createServerI18nScope<T extends I18nInstance = I18nInstance>(): ServerI18nScope<T> {
  throw new Error(SERVER_RUNTIME_UNAVAILABLE_MESSAGE)
}
