import { createIsomorphicFn, createStart } from "@tanstack/solid-start";
import { createTanStackServerI18nRequestMiddleware } from "@palamedes/tanstack/solid";
const middleware = createIsomorphicFn().server(() =>
  createTanStackServerI18nRequestMiddleware(async (request) => {
    const { resolveLocale } = await import("./locale");
    return resolveLocale(request);
  }),
)()!;
export const startInstance = createStart(() => ({ requestMiddleware: [middleware] }));
