import type { I18nInstance } from "@palamedes/runtime";
import { unstable_getRequest, type HandlerInterceptor } from "waku/router/server";

import { createScopedWakuI18nRunner } from "./scope";

const REQUEST_UNAVAILABLE_MESSAGE =
  "Palamedes Waku i18n interceptor could not read the Waku request: unstable_getRequest() threw. " +
  "Waku runs handler interceptors inside its request store, so this usually means @palamedes/waku " +
  "loaded a separate copy of waku/router/server (for example when Vite externalizes an installed " +
  "@palamedes/waku). Register palamedes() from @palamedes/vite-plugin in the Waku Vite config and " +
  "register the interceptor through Waku's router instead of calling it directly.";

/** Creates one fresh request-local i18n instance from Waku's original Fetch request. */
export type WakuI18nResolver<T extends I18nInstance = I18nInstance> = (
  request: Request,
) => T | Promise<T>;

export type WakuI18nInterceptorOptions = {
  /** Message of the error thrown when `resolveI18n` fails; the original error is its `cause`. */
  readonly failureMessage?: string;
};

/**
 * Creates a Waku handler interceptor that activates i18n around the complete
 * awaited Waku handler invocation. Place it in `src/pages/_interceptors/` when
 * using `fsRouter()`.
 */
export function createWakuI18nInterceptor<T extends I18nInstance = I18nInstance>(
  resolveI18n: WakuI18nResolver<T>,
  options: WakuI18nInterceptorOptions = {},
): HandlerInterceptor {
  const runner = createScopedWakuI18nRunner(resolveI18n, options.failureMessage);

  return async <Result>(next: () => Promise<Result>) => {
    let request: Request;
    try {
      request = unstable_getRequest();
    } catch (error) {
      // Waku invokes interceptors only inside its router request store, for
      // both requests and static builds. A throw here therefore means the
      // interceptor reads a different `waku/router/server` instance than the
      // router, or was called outside Waku. Passing through would hide that
      // cause behind a later "No active server i18n instance" error.
      throw new Error(REQUEST_UNAVAILABLE_MESSAGE, { cause: error });
    }
    return await runner.run(request, next);
  };
}
