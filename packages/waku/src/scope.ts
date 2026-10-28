import type { I18nInstance } from "@palamedes/runtime";
import { createScopedI18nRunner, type ServerI18nScope } from "@palamedes/runtime/server";

import type { WakuI18nResolver } from "./index";

export type ScopedWakuI18nRunner<T extends I18nInstance> = {
  run<Result>(request: Request, next: () => Result | Promise<Result>): Promise<Result>;
  scope: ServerI18nScope<T>;
};

export const DEFAULT_WAKU_FAILURE_MESSAGE =
  "Palamedes Waku i18n initialization failed before the handler ran.";

export function createScopedWakuI18nRunner<T extends I18nInstance>(
  resolveI18n: WakuI18nResolver<T>,
  failureMessage: string = DEFAULT_WAKU_FAILURE_MESSAGE,
): ScopedWakuI18nRunner<T> {
  const runner = createScopedI18nRunner(resolveI18n, { failureMessage });

  return {
    run(request, next) {
      return runner.run(request, () => next());
    },
    scope: runner.scope,
  };
}
