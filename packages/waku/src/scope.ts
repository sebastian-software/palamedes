import type { I18nInstance } from "@palamedes/runtime"
import { createServerI18nScope, type ServerI18nScope } from "@palamedes/runtime/server"

import type { WakuI18nResolver } from "./index"

export type ScopedWakuI18nRunner<T extends I18nInstance> = {
  run<Result>(request: Request, next: () => Result | Promise<Result>): Promise<Result>
  scope: ServerI18nScope<T>
}

export function createScopedWakuI18nRunner<T extends I18nInstance>(
  resolveI18n: WakuI18nResolver<T>
): ScopedWakuI18nRunner<T> {
  const scope = createServerI18nScope<T>()

  return {
    async run(request, next) {
      let i18n: T
      try {
        i18n = await resolveI18n(request)
      } catch (error) {
        throw new Error("Palamedes Waku i18n initialization failed before the handler ran.", {
          cause: error,
        })
      }
      return await scope.run(i18n, async () => await next())
    },
    scope,
  }
}
