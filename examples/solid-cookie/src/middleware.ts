import type { StartMiddleware } from "@solidjs/vite-plugin";
import { createSolidCatalogDeliveryMiddleware } from "@palamedes/solid/server";
import {
  markServerI18nTestBarrierReached,
  waitForServerI18nTestBarrier,
} from "@palamedes/runtime/server/test";
import { createServerI18n, serverI18nScope } from "./lib/i18n.server";
import { locales } from "./lib/i18n";

const catalogDelivery = createSolidCatalogDeliveryMiddleware({
  nonce: process.env.PALAMEDES_CSP_NONCE,
  resolveLocale: (request) =>
    locales.resolve({
      strategy: "cookie",
      acceptLanguageHeader: request.headers.get("accept-language"),
      cookieHeader: request.headers.get("cookie"),
    }).locale,
});

export default [
  (event, next) => catalogDelivery(event.request, next),
  async (event, next) => {
    const request = event.request;
    const nonce = process.env.PALAMEDES_CSP_NONCE;
    if (nonce) event.nonce ??= nonce;
    const { locale } = locales.resolve({
      strategy: "cookie",
      acceptLanguageHeader: request.headers.get("accept-language"),
      cookieHeader: request.headers.get("cookie"),
    });
    return serverI18nScope.run(await createServerI18n(locale), async () => {
      await waitForServerI18nTestBarrier(request);
      const response = await next();
      markServerI18nTestBarrierReached(request, response.headers);
      return response;
    });
  },
] satisfies StartMiddleware[];
