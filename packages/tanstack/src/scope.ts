import { createServerI18nScope, type ServerI18nScope } from "@palamedes/runtime/server"
import type { I18nInstance } from "@palamedes/runtime"

import type { TanStackI18nResolver } from "./index"

export type ScopedTanStackI18nRunner<T extends I18nInstance> = {
  run<Result>(request: Request, next: () => Result | Promise<Result>): Promise<Result>
  scope: ServerI18nScope<T>
}

export function createScopedTanStackI18nRunner<T extends I18nInstance>(
  resolveI18n: TanStackI18nResolver<T>
): ScopedTanStackI18nRunner<T> {
  const scope = createServerI18nScope<T>()

  return {
    async run(request, next) {
      const i18n = await resolveI18n(request)
      return await scope.run(i18n, async () => await next())
    },
    scope,
  }
}
