import { createIsomorphicFn, createStart } from "@tanstack/react-start";
import { createTanStackServerI18nRequestMiddleware } from "@palamedes/tanstack";

const tanStackI18nMiddleware = createIsomorphicFn().server(() =>
  createTanStackServerI18nRequestMiddleware({
    async resolveLocale(request) {
      const { resolveLocaleFromRequest } = await import("./lib/i18n.server");
      return resolveLocaleFromRequest(request);
    },
    i18nOptions: { timeZone: "Europe/Berlin" },
  }),
)()!;

export const startInstance = createStart(() => ({
  requestMiddleware: [tanStackI18nMiddleware],
}));
