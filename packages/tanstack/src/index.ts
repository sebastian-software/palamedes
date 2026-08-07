import { createMiddleware } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import type { I18nInstance } from "@palamedes/runtime"
import { createScopedTanStackI18nRunner } from "./scope"

/**
 * Creates one fresh request-local i18n instance. The incoming request is the
 * original TanStack Start request, including its headers and cookies.
 */
export type TanStackI18nResolver<T extends I18nInstance = I18nInstance> = (
  request: Request
) => T | Promise<T>

/**
 * Create a global TanStack Start request middleware that activates i18n only
 * for server-function requests. Register it in `createStart({ requestMiddleware })`.
 *
 * This is the recommended integration: Start calls it before it parses and
 * invokes the server function, and passes the original `Request` directly to
 * the resolver.
 */
export function createTanStackI18nRequestMiddleware<T extends I18nInstance = I18nInstance>(
  resolveI18n: TanStackI18nResolver<T>
) {
  const runner = createScopedTanStackI18nRunner(resolveI18n)

  return createMiddleware().server(async ({ handlerType, next, request }) => {
    if (handlerType !== "serverFn") {
      return await next()
    }

    return await runner.run(request, next)
  })
}

/**
 * Create composable server-function middleware. Add it globally through
 * `createStart({ functionMiddleware })`, or to selected `createServerFn()`
 * declarations through `.middleware([middleware])`.
 *
 * The resolver receives Start's original request through its supported server
 * request accessor. Use `createTanStackI18nRequestMiddleware()` when a typed
 * request middleware callback or scope before request decoding is required.
 */
export function createTanStackI18nMiddleware<T extends I18nInstance = I18nInstance>(
  resolveI18n: TanStackI18nResolver<T>
) {
  const runner = createScopedTanStackI18nRunner(resolveI18n)

  return createMiddleware({ type: "function" }).server(
    async ({ next }) => await runner.run(getRequest(), next)
  )
}
