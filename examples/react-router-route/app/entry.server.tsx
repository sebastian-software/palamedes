import { PassThrough } from "node:stream"
import { createReadableStreamFromReadable } from "@react-router/node"
import { isbot } from "isbot"
import type { EntryContext, RouterContextProvider } from "react-router"
import { ServerRouter } from "react-router"
import type { RenderToPipeableStreamOptions } from "react-dom/server"
import { renderToPipeableStream } from "react-dom/server"
import { waitForServerI18nTestBarrier } from "@palamedes/runtime/server/test"
import { createServerI18n, resolveLocaleFromRequest } from "~/lib/i18n"
import { serverI18nScope } from "~/lib/i18n.server"

export const streamTimeout = 5000

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: RouterContextProvider
) {
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, { status: responseStatusCode, headers: responseHeaders })
  }

  const i18n = createServerI18n(resolveLocaleFromRequest(request))
  return serverI18nScope.run(i18n, async () => {
    await waitForServerI18nTestBarrier(request)
    return new Promise((resolve, reject) => {
      let shellRendered = false
      const userAgent = request.headers.get("user-agent")
      const readyOption: keyof RenderToPipeableStreamOptions =
        (userAgent && isbot(userAgent)) || routerContext.isSpaMode ? "onAllReady" : "onShellReady"
      let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(
        () => abort(),
        streamTimeout + 1000
      )
      const { pipe, abort } = renderToPipeableStream(
        <ServerRouter context={routerContext} url={request.url} />,
        {
          [readyOption]() {
            shellRendered = true
            const body = new PassThrough({
              final(callback) {
                clearTimeout(timeoutId)
                timeoutId = undefined
                callback()
              },
            })
            responseHeaders.set("Content-Type", "text/html")
            pipe(body)
            resolve(
              new Response(createReadableStreamFromReadable(body), {
                headers: responseHeaders,
                status: responseStatusCode,
              })
            )
          },
          onShellError(error: unknown) {
            reject(error)
          },
          onError(error: unknown) {
            responseStatusCode = 500
            if (shellRendered) console.error(error)
          },
        }
      )
    })
  })
}
