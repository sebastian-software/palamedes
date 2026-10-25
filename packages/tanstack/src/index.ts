import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import type { I18nInstance } from "@palamedes/runtime";
import { createScopedTanStackI18nRunner } from "./scope";
import type {
  createTanStackCatalogResponseDelivery,
  TanStackCatalogDeliveryOptions,
  TanStackServerI18nOptions,
} from "./server";

export type { TanStackCatalogDeliveryOptions, TanStackServerI18nOptions } from "./server";

/**
 * Creates one fresh request-local i18n instance. The incoming request is the
 * original TanStack Start request, including its headers and cookies.
 */
export type TanStackI18nResolver<T extends I18nInstance = I18nInstance> = (
  request: Request,
) => T | Promise<T>;

/** Resolve only request policy; catalog loading remains adapter-owned. */
export type TanStackLocaleResolver = (request: Request) => string | Promise<string>;

/** Resolve optional request-local formatting settings alongside the locale. */
export type TanStackI18nOptionsResolver = (
  request: Request,
) => Omit<TanStackServerI18nOptions, "locale"> | Promise<Omit<TanStackServerI18nOptions, "locale">>;

export type TanStackServerI18nRequestMiddlewareOptions = {
  /** Adapter-owned production HTML catalog delivery. */
  readonly catalogDelivery?: TanStackCatalogDeliveryOptions | false;
};

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
  const runner = createScopedTanStackI18nRunner(resolveI18n);

  return createMiddleware().server(async ({ handlerType, next, request }) => {
    if (handlerType !== "serverFn") {
      return await next();
    }

    return await runner.run(request, next);
  });
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
  const catalogDelivery = middlewareOptions.catalogDelivery;
  type CatalogDelivery = ReturnType<typeof createTanStackCatalogResponseDelivery>;
  let deliveryPromise: Promise<CatalogDelivery> | undefined;

  const getDelivery = () => {
    if (catalogDelivery === false) return;
    deliveryPromise ??= import("./server").then(({ createTanStackCatalogResponseDelivery }) =>
      createTanStackCatalogResponseDelivery(catalogDelivery),
    );
    return deliveryPromise;
  };

  return createMiddleware().server(async ({ handlerType, next, request }) => {
    let activeLocale: string | undefined;
    const runner = createScopedTanStackI18nRunner(async (currentRequest) => {
      const locale = await resolveLocale(currentRequest);
      activeLocale = locale;
      const options = resolveOptions ? await resolveOptions(currentRequest) : {};
      // Keep the root middleware entry loadable without Vite. The server entry
      // imports the generated virtual catalog module and is loaded only when a
      // catalog-backed middleware is actually invoked.
      const { createTanStackServerI18n } = await import("./server");
      return await createTanStackServerI18n({ ...options, locale });
    });
    const result = await runner.run(request, async () => {
      const nextResult = await next();
      const delivery = await getDelivery();
      return handlerType === "router" && delivery && activeLocale
        ? await delivery(nextResult, activeLocale, request)
        : nextResult;
    });
    // TanStack's middleware declaration is narrower than the framework's
    // router result union; the runner preserves that result at runtime.
    return result as Response;
  });
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
