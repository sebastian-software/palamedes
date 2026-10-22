import path from "node:path";
import { Readable } from "node:stream";
import { dev } from "$app/env";
import type { Handle } from "@sveltejs/kit/hooks";
import { createServerI18nScope } from "@palamedes/runtime/server";
import { createBundledServerI18n } from "@palamedes/runtime/server/bundled";
import { createViteCatalogDelivery } from "@palamedes/vite-plugin/delivery";
import { createDemoLocalePolicy } from "@palamedes/example-ui";
import { timeZone } from "./locale";

const scope = createServerI18nScope();
const delivery = createViteCatalogDelivery({
  development: dev,
  clientDirectory: path.resolve("build/client"),
});

export const handlePalamedes: Handle = async ({ event, resolve }) => {
  const policy = createDemoLocalePolicy(
    event.url,
    event.request.headers.get("cookie") ?? "",
    event.request.headers.get("accept-language") ?? "en",
    event.url.pathname.startsWith("/api/") ? "query" : process.env.PALAMEDES_DEMO_STRATEGY,
  );
  if (policy.redirect)
    return new Response(null, {
      status: 302,
      headers: { location: new URL(policy.redirect).pathname + event.url.search },
    });
  const { locale } = policy;
  const i18n = await createBundledServerI18n({ locale, timeZone });
  event.locals.locale = locale;
  return scope.run(i18n, async () => {
    const response = await resolve(event, {
      transformPageChunk: ({ html }) => html.replaceAll("%palamedes.locale%", locale),
    });
    if (!response.body || !response.headers.get("content-type")?.includes("text/html"))
      return response;
    const transformed = Readable.fromWeb(
      response.body as Parameters<typeof Readable.fromWeb>[0],
    ).pipe(delivery.createDocumentTransform(delivery.getLocaleBinding(locale)));
    const headers = new Headers(response.headers);
    headers.set("cache-control", "private, no-store");
    headers.set("vary", "Cookie, Accept-Language");
    headers.delete("content-length");
    headers.delete("etag");
    return new Response(Readable.toWeb(transformed) as ReadableStream<Uint8Array>, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  });
};
