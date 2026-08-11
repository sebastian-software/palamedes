import type { I18nInstance } from "@palamedes/runtime"
import { createScopedI18nRunner, type ServerI18nScope } from "@palamedes/runtime/server"

/** Resolves a fresh, activated i18n instance from React Router's original Fetch request. */
export type ReactRouterRscI18nResolver<T extends I18nInstance = I18nInstance> = (
  request: Request
) => T | Promise<T>

/** Runs the complete React Router RSC entry request inside a request-local i18n scope. */
export type ReactRouterRscI18nRequestScope<T extends I18nInstance = I18nInstance> = {
  run<Result>(request: Request, dispatch: () => Result | Promise<Result>): Promise<Result>
  scope: ServerI18nScope<T>
}

/**
 * Creates the runtime boundary used by a custom React Router `entry.rsc.tsx`.
 *
 * Wrap React Router's default RSC `fetch()` call, not an individual Server
 * Function. The default entry starts `unstable_matchRSCServerRequest` after
 * this callback begins, so argument binding, Server Function dispatch, RSC
 * rendering, automatic revalidation, SSR, and streams created during that work
 * all inherit the same `AsyncLocalStorage` context.
 */
export function createReactRouterRscI18nRequestScope<T extends I18nInstance = I18nInstance>(
  resolveI18n: ReactRouterRscI18nResolver<T>
): ReactRouterRscI18nRequestScope<T> {
  const runner = createScopedI18nRunner(resolveI18n, {
    failureMessage:
      "Palamedes React Router RSC i18n initialization failed before RSC dispatch ran.",
  })

  return {
    run(request, dispatch) {
      return runner.run(request, () => dispatch())
    },
    scope: runner.scope,
  }
}
