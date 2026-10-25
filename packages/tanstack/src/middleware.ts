import type { I18nInstance } from "@palamedes/runtime";
import { createScopedTanStackI18nRunner } from "./scope";
import type { createTanStackCatalogResponseDelivery } from "./server";
import type {
  TanStackI18nResolver,
  TanStackLocaleResolver,
  TanStackI18nOptionsResolver,
  TanStackServerI18nRequestMiddlewareOptions,
} from "./types";

type RequestContext<Result> = {
  handlerType: string;
  request: Request;
  next: () => Result | Promise<Result>;
};

export function createI18nRequestHandler<T extends I18nInstance>(
  resolveI18n: TanStackI18nResolver<T>,
) {
  const runner = createScopedTanStackI18nRunner(resolveI18n);
  return async <Result>({ handlerType, request, next }: RequestContext<Result>) => {
    if (handlerType !== "serverFn") return await next();
    return await runner.run(request, next);
  };
}

export function createServerI18nRequestHandler(
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

  return async <Result>({ handlerType, next, request }: RequestContext<Result>) => {
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
    return result;
  };
}
