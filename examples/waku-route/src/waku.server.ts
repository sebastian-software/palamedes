import { fsRouter } from "waku";
import adapter from "waku/adapters/default";
import { createWakuCatalogDeliveryMiddleware } from "@palamedes/waku/server";
import {
  markServerI18nTestBarrierReached,
  waitForServerI18nTestBarrier,
} from "@palamedes/runtime/server/test";
import { normalizeLocale } from "./lib/i18n";
import { createServerI18n, serverI18nScope } from "./lib/i18n.server";

// Glob keys must keep the `pages/` prefix so fsRouter's default `pagesDir: "pages"`
// matches them. Globbing from `/src` and stripping the leading `/src/` yields
// `pages/[locale].tsx`, `pages/_root.tsx`, ... — the shape fsRouter expects. Using a
// `base: "./pages"` glob instead drops that prefix and silently registers no
// routes, which makes every RSC payload 404.
const modules = Object.fromEntries(
  Object.entries(import.meta.glob("/src/pages/**/*.{tsx,ts}")).map(([key, value]) => [
    key.slice("/src/".length),
    value,
  ]),
);

export default adapter(fsRouter(modules), {
  middlewareFns: [
    () =>
      createWakuCatalogDeliveryMiddleware({
        clientDirectory: "dist/public",
        development: process.env.NODE_ENV !== "production",
        resolveLocale: (request) =>
          normalizeLocale(new URL(request.url).pathname.split("/").filter(Boolean)[0]),
      }),
    () => async (context, next) => {
      const segment = new URL(context.req.raw.url).pathname.split("/").filter(Boolean)[0];
      return serverI18nScope.run(await createServerI18n(normalizeLocale(segment)), async () => {
        await waitForServerI18nTestBarrier(context.req.raw);
        markServerI18nTestBarrierReached(context.req.raw, context.res.headers);
        return next();
      });
    },
  ],
});
