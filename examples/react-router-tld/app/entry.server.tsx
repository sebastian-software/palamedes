import path from "node:path";
import { PassThrough } from "node:stream";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import type { EntryContext, RouterContextProvider } from "react-router";
import { ServerRouter } from "react-router";
import type { RenderToPipeableStreamOptions } from "react-dom/server";
import { renderToPipeableStream } from "react-dom/server";
import { createViteCatalogDelivery } from "@palamedes/vite-plugin/delivery";
import {
  markServerI18nTestBarrierReached,
  waitForServerI18nTestBarrier,
} from "@palamedes/runtime/server/test";
import { resolveLocaleFromRequest } from "~/lib/i18n";
import { createServerI18n, serverI18nScope } from "~/lib/i18n.server";

export const streamTimeout = 5000;
const catalogDelivery = createViteCatalogDelivery({
  clientDirectory: path.resolve(import.meta.dirname, "../client"),
  development: import.meta.env.DEV,
});

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: RouterContextProvider,
) {
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, {
      status: responseStatusCode,
      headers: responseHeaders,
    });
  }

  const locale = resolveLocaleFromRequest(request);
  const binding = catalogDelivery.getLocaleBinding(locale);
  const i18n = await createServerI18n(locale);
  return serverI18nScope.run(i18n, async () => {
    await waitForServerI18nTestBarrier(request);
    markServerI18nTestBarrierReached(request, responseHeaders);
    return new Promise((resolve, reject) => {
      let shellRendered = false;
      const userAgent = request.headers.get("user-agent");
      const readyOption: keyof RenderToPipeableStreamOptions =
        (userAgent && isbot(userAgent)) || routerContext.isSpaMode ? "onAllReady" : "onShellReady";
      let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(
        () => abort(),
        streamTimeout + 1000,
      );
      const { pipe, abort } = renderToPipeableStream(
        <ServerRouter context={routerContext} url={request.url} />,
        {
          [readyOption]() {
            shellRendered = true;
            const body = new PassThrough({
              final(callback) {
                clearTimeout(timeoutId);
                timeoutId = undefined;
                callback();
              },
            });
            responseHeaders.set("Content-Type", "text/html");
            const documentTransform = catalogDelivery.createDocumentTransform(binding);
            documentTransform.pipe(body);
            pipe(documentTransform);
            resolve(
              new Response(createReadableStreamFromReadable(body), {
                headers: responseHeaders,
                status: responseStatusCode,
              }),
            );
          },
          onShellError(error: unknown) {
            reject(error);
          },
          onError(error: unknown) {
            responseStatusCode = 500;
            if (shellRendered) console.error(error);
          },
        },
      );
    });
  });
}
