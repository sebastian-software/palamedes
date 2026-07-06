import type { I18nInstance } from "@palamedes/runtime"
import { createServerI18nScope } from "@palamedes/runtime/server"

export type RemixI18nResolver<T extends I18nInstance = I18nInstance> = (
  request: Request
) => T | Promise<T>

export type RemixI18nRequestScope<T extends I18nInstance = I18nInstance> = {
  run<Result>(request: Request, callback: (i18n: T) => Result | Promise<Result>): Promise<Result>
  activate(i18n: T): T
  get(): T | undefined
}

export function createRemixI18nRequestScope<T extends I18nInstance = I18nInstance>(
  resolveI18n: RemixI18nResolver<T>
): RemixI18nRequestScope<T> {
  const scope = createServerI18nScope<T>()

  return {
    async run(request, callback) {
      const i18n = await resolveI18n(request)
      return await scope.run(i18n, () => callback(i18n))
    },

    activate(i18n) {
      return scope.activate(i18n)
    },

    get() {
      return scope.get()
    },
  }
}
