import { createMiddleware } from "@tanstack/solid-start";
import { getRequest } from "@tanstack/solid-start/server";
import type { I18nInstance } from "@palamedes/runtime";
import { createScopedTanStackI18nRunner } from "./scope";
import { createI18nRequestHandler, createServerI18nRequestHandler } from "./middleware";
import type {
  TanStackI18nResolver,
  TanStackLocaleResolver,
  TanStackI18nOptionsResolver,
  TanStackServerI18nRequestMiddlewareOptions,
} from "./types";
export type { TanStackCatalogDeliveryOptions, TanStackServerI18nOptions } from "./server";
export type * from "./types";

/**
 * Create a global TanStack Start request middleware that activates i18n only
 * for server-function requests. Register it in `createStart({ requestMiddleware })`.
 *
 * This is the recommended integration: Start calls it before it parses and
 * invokes the server function, and passes the original `Request` directly to
 * the resolver.
 */
export function createTanStackI18nRequestMiddleware<T extends I18nInstance = I18nInstance>(
  resolveI18n: TanStackI18nResolver<T>,
) {
  return createMiddleware().server(createI18nRequestHandler(resolveI18n));
}

/**
 * Create the standard catalog-backed request middleware. The host supplies
 * locale and optional time-zone policy; the Vite-generated server catalog
 * loader supplies compiled messages for that locale.
 */
export function createTanStackServerI18nRequestMiddleware(
  resolveLocale: TanStackLocaleResolver,
  resolveOptions?: TanStackI18nOptionsResolver,
  middlewareOptions: TanStackServerI18nRequestMiddlewareOptions = {},
) {
  const handler = createServerI18nRequestHandler(resolveLocale, resolveOptions, middlewareOptions);
  return createMiddleware().server(async (context) => (await handler(context)) as Response);
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
  resolveI18n: TanStackI18nResolver<T>,
) {
  const runner = createScopedTanStackI18nRunner(resolveI18n);

  return createMiddleware({ type: "function" }).server(
    async ({ next }) => await runner.run(getRequest(), next),
  );
}
