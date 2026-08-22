import type { I18nInstance } from "@palamedes/runtime"
import { unstable_getRequest, type HandlerInterceptor } from "waku/router/server"

import { createScopedWakuI18nRunner } from "./scope"

/** Creates one fresh request-local i18n instance from Waku's original Fetch request. */
export type WakuI18nResolver<T extends I18nInstance = I18nInstance> = (
  request: Request
) => T | Promise<T>

/**
 * Creates a Waku handler interceptor that activates i18n around the complete
 * awaited Waku handler invocation. Place it in `src/pages/_interceptors/` when
 * using `fsRouter()`.
 */
export function createWakuI18nInterceptor<T extends I18nInstance = I18nInstance>(
  resolveI18n: WakuI18nResolver<T>
): HandlerInterceptor {
  const runner = createScopedWakuI18nRunner(resolveI18n)

  return async <Result>(next: () => Promise<Result>) => {
    let request: Request
    try {
      request = unstable_getRequest()
    } catch {
      // Waku exposes no stable error type or code for its intentionally
      // unstable request accessor. A throw means this interceptor is running
      // outside a request phase, so preserve the documented pass-through path
      // without coupling it to an upstream diagnostic sentence.
      return await next()
    }
    return await runner.run(request, next)
  }
}
