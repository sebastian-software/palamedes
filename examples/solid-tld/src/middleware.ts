import path from "node:path";
import type { FetchMiddleware } from "@solidjs/web";
import { createSolidCatalogDeliveryMiddleware } from "@palamedes/solid/server";
import {
  markServerI18nTestBarrierReached,
  waitForServerI18nTestBarrier,
} from "@palamedes/runtime/server/test";
import { createServerI18n, serverI18nScope } from "./lib/i18n.server";
import { locales } from "./lib/i18n";

const catalogDelivery = createSolidCatalogDeliveryMiddleware({
  clientDirectory: path.resolve(process.cwd(), ".output/public"),
  development: process.env.NODE_ENV !== "production",
  nonce: process.env.PALAMEDES_CSP_NONCE,
  resolveLocale: (request) =>
    locales.resolve({
      strategy: "tld",
      acceptLanguageHeader: request.headers.get("accept-language"),
      requestHost: request.headers.get("host"),
    }).locale,
});

export default [
  catalogDelivery,
  async (request: Request, next: () => Promise<Response>) => {
    const { locale } = locales.resolve({
      strategy: "tld",
      acceptLanguageHeader: request.headers.get("accept-language"),
      requestHost: request.headers.get("host"),
    });
    return serverI18nScope.run(await createServerI18n(locale), async () => {
      await waitForServerI18nTestBarrier(request);
      const response = await next();
      markServerI18nTestBarrierReached(request, response.headers);
      return response;
    });
  },
] satisfies FetchMiddleware[];
