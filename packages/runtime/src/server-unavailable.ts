import type { CreateServerI18nScopeOptions, I18nInstance, ServerI18nScope } from "./index"

export type { CreateServerI18nScopeOptions, ServerI18nScope } from "./index"

export type ServerI18nResolver<T extends I18nInstance = I18nInstance> = (
  request: Request
) => T | Promise<T>

export type CreateScopedI18nRunnerOptions = {
  failureMessage: string
}

export type ScopedI18nRunner<T extends I18nInstance = I18nInstance> = {
  run<Result>(request: Request, next: (i18n: T) => Result | Promise<Result>): Promise<Result>
  scope: ServerI18nScope<T>
}

const SERVER_RUNTIME_UNAVAILABLE_MESSAGE =
  "@palamedes/runtime/server is only available in Node.js server runtimes. Import it from server-only Node code, not Client Components or Edge runtime code."

export function createServerI18nScope<T extends I18nInstance = I18nInstance>(
  _options: CreateServerI18nScopeOptions = {}
): ServerI18nScope<T> {
  throw new Error(SERVER_RUNTIME_UNAVAILABLE_MESSAGE)
}

export function createScopedI18nRunner<T extends I18nInstance = I18nInstance>(
  _resolveI18n: ServerI18nResolver<T>,
  _options: CreateScopedI18nRunnerOptions
): ScopedI18nRunner<T> {
  throw new Error(SERVER_RUNTIME_UNAVAILABLE_MESSAGE)
}
