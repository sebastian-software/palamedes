import { PassThrough, Transform } from "node:stream"

import type { EntryContext, RouterContextProvider } from "react-router"
import { createReadableStreamFromReadable } from "@react-router/node"
import { ServerRouter } from "react-router"
import { isbot } from "isbot"
import type { RenderToPipeableStreamOptions } from "react-dom/server"
import { renderToPipeableStream } from "react-dom/server"
import { resolveLocaleFromRequest } from "~/lib/i18n"
import { getLocaleImportMap } from "~/lib/i18n.server"

export const streamTimeout = 5000

/*
 * Import-map locale binding: the browser resolves per-route message assets
 * through one import map per locale. The map must be registered before any
 * module load starts, and React 19 hoists modulepreload links above anything
 * rendered from a route component, so injecting the map through the Layout is
 * a race. Splicing it into the stream directly after <head> is the only spot
 * that deterministically precedes every preload. Null map (dev) passes the
 * stream through untouched.
 */
function createImportMapInjector(importMap: string | null): Transform {
  if (!importMap) {
    return new PassThrough()
  }
  const injection = `<head><script type="importmap">${importMap}</script>`
  let injected = false
  let carry = ""
  return new Transform({
    transform(chunk, _encoding, callback) {
      if (injected) {
        callback(null, chunk)
        return
      }
      const text = carry + String(chunk)
      const index = text.indexOf("<head>")
      if (index === -1) {
        // Keep a tail that could contain a split "<head>" across chunks.
        carry = text.slice(-6)
        callback(null, text.slice(0, text.length - carry.length))
        return
      }
      injected = true
      carry = ""
      callback(null, text.slice(0, index) + injection + text.slice(index + "<head>".length))
    },
    flush(callback) {
      if (carry) {
        this.push(carry)
      }
      callback()
    },
  })
}

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  loadContext: RouterContextProvider
) {
  // https://httpwg.org/specs/rfc9110.html#HEAD
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, {
      status: responseStatusCode,
      headers: responseHeaders,
    })
  }

  return new Promise((resolve, reject) => {
    let shellRendered = false
    const userAgent = request.headers.get("user-agent")

    // Ensure requests from bots and SPA Mode renders wait for all content to load before responding
    // https://react.dev/reference/react-dom/server/renderToPipeableStream#waiting-for-all-content-to-load-for-crawlers-and-static-generation
    const readyOption: keyof RenderToPipeableStreamOptions =
      (userAgent && isbot(userAgent)) || routerContext.isSpaMode ? "onAllReady" : "onShellReady"

    // Abort the rendering stream after the `streamTimeout` so it has time to
    // flush down the rejected boundaries
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
              // Clear the timeout to prevent retaining the closure and memory leak
              clearTimeout(timeoutId)
              timeoutId = undefined
              callback()
            },
          })
          const stream = createReadableStreamFromReadable(body)

          responseHeaders.set("Content-Type", "text/html")

          const injector = createImportMapInjector(
            getLocaleImportMap(resolveLocaleFromRequest(request).locale)
          )
          injector.pipe(body)
          pipe(injector)

          resolve(
            new Response(stream, {
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
          // Log streaming rendering errors from inside the shell.  Don't log
          // errors encountered during initial shell rendering since they'll
          // reject and get logged in handleDocumentRequest.
          if (shellRendered) {
            console.error(error)
          }
        },
      }
    )
  })
}
