import { createScopedI18nRunner, type ServerI18nScope } from "@palamedes/runtime/server"
import type { I18nInstance } from "@palamedes/runtime"

import type { TanStackI18nResolver } from "./index"

export type ScopedTanStackI18nRunner<T extends I18nInstance> = {
  run<Result>(request: Request, next: () => Result | Promise<Result>): Promise<Result>
  scope: ServerI18nScope<T>
}

export function createScopedTanStackI18nRunner<T extends I18nInstance>(
  resolveI18n: TanStackI18nResolver<T>
): ScopedTanStackI18nRunner<T> {
  const runner = createScopedI18nRunner(resolveI18n, {
    failureMessage:
      "Palamedes TanStack i18n initialization failed before server-function dispatch ran.",
  })

  return {
    run(request, next) {
      return runner.run(request, () => next())
    },
    scope: runner.scope,
  }
}
