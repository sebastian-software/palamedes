import { PassThrough } from "node:stream";

import type { EntryContext, RouterContextProvider } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { ServerRouter } from "react-router";
import { isbot } from "isbot";
import type { RenderToPipeableStreamOptions } from "react-dom/server";
import { renderToPipeableStream } from "react-dom/server";
import {
  markServerI18nTestBarrierReached,
  waitForServerI18nTestBarrier,
} from "@palamedes/runtime/server/test";
import { resolveLocaleFromRequest } from "~/lib/i18n";
import {
  catalogDelivery,
  createServerI18n,
  getLocaleBinding,
  serverI18nScope,
} from "~/lib/i18n.server";

export const streamTimeout = 5000;

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  loadContext: RouterContextProvider,
) {
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, { status: responseStatusCode, headers: responseHeaders });
  }

  const locale = resolveLocaleFromRequest(request).locale;
  return serverI18nScope.run(createServerI18n(locale), async () => {
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
            const stream = createReadableStreamFromReadable(body);
            responseHeaders.set("Content-Type", "text/html");
            const injector = catalogDelivery.createDocumentTransform(
              getLocaleBinding(locale),
            );
            injector.pipe(body);
            pipe(injector);
            resolve(new Response(stream, { headers: responseHeaders, status: responseStatusCode }));
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
