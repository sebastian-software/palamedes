import type { StartMiddleware } from "@solidjs/vite-plugin";
import { createSolidCatalogDeliveryMiddleware } from "@palamedes/solid/server";
import {
  markServerI18nTestBarrierReached,
  waitForServerI18nTestBarrier,
} from "@palamedes/runtime/server/test";
import { createServerI18n, serverI18nScope } from "./lib/i18n.server";
import { DEFAULT_LOCALE, normalizeLocale } from "./lib/i18n";

const catalogDelivery = createSolidCatalogDeliveryMiddleware({
  nonce: process.env.PALAMEDES_CSP_NONCE,
  resolveLocale: (request) =>
    normalizeLocale(new URL(request.url).pathname.split("/").filter(Boolean)[0]),
});

export default [
  (event, next) => catalogDelivery(event.request, next),
  async (event, next) => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return new Response(null, { status: 302, headers: { location: `/${DEFAULT_LOCALE}` } });
    }

    const locale = normalizeLocale(url.pathname.split("/").filter(Boolean)[0]);
    return serverI18nScope.run(await createServerI18n(locale), async () => {
      await waitForServerI18nTestBarrier(request);
      const response = await next();
      markServerI18nTestBarrierReached(request, response.headers);
      return response;
    });
  },
] satisfies StartMiddleware[];
