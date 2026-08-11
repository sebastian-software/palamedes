import type { I18nInstance } from "@palamedes/runtime"
import { createScopedI18nRunner, type ServerI18nScope } from "@palamedes/runtime/server"

import type { WakuI18nResolver } from "./index"

export type ScopedWakuI18nRunner<T extends I18nInstance> = {
  run<Result>(request: Request, next: () => Result | Promise<Result>): Promise<Result>
  scope: ServerI18nScope<T>
}

export function createScopedWakuI18nRunner<T extends I18nInstance>(
  resolveI18n: WakuI18nResolver<T>
): ScopedWakuI18nRunner<T> {
  const runner = createScopedI18nRunner(resolveI18n, {
    failureMessage: "Palamedes Waku i18n initialization failed before the handler ran.",
  })

  return {
    run(request, next) {
      return runner.run(request, () => next())
    },
    scope: runner.scope,
  }
}
