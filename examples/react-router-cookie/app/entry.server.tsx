import { PassThrough, Transform } from "node:stream"

import type { EntryContext, RouterContextProvider } from "react-router"
import { createReadableStreamFromReadable } from "@react-router/node"
import { ServerRouter } from "react-router"
import { isbot } from "isbot"
import type { RenderToPipeableStreamOptions } from "react-dom/server"
import { renderToPipeableStream } from "react-dom/server"
import { resolveLocaleFromRequest } from "~/lib/i18n"
import {
  createServerI18n,
  getLocaleBinding,
  serverI18nScope,
  type LocaleBinding,
} from "~/lib/i18n.server"

export const streamTimeout = 5000

/*
 * Import-map locale binding: the browser resolves per-route message assets
 * through one import map per locale. The map must be registered before any
 * module load starts, and React 19 hoists modulepreload links above anything
 * rendered from a route component, so injecting the map through the Layout is
 * a race. Splicing it into the stream directly after <head> is the only spot
 * that deterministically precedes every preload.
 *
 * The same pass adds modulepreload hints for the message assets belonging to
 * the code chunks this document already preloads, so messages download in
 * parallel with the code instead of one waterfall step behind it. Buffering
 * ends at </head>; with onShellReady the head arrives in the first flush.
 * Null binding (dev) passes the stream through untouched.
 */
function createLocaleBindingInjector(binding: LocaleBinding | null): Transform {
  if (!binding) {
    return new PassThrough()
  }
  let buffered = ""
  let done = false
  return new Transform({
    transform(chunk, _encoding, callback) {
      if (done) {
        callback(null, chunk)
        return
      }
      buffered += String(chunk)
      const headEnd = buffered.indexOf("</head>")
      if (headEnd === -1) {
        callback()
        return
      }
      done = true
      let html = buffered.replace(
        "<head>",
        `<head><script type="importmap">${binding.importMapJson}</script>`
      )
      const preloads = new Set<string>()
      for (const match of html.matchAll(/<link rel="modulepreload" href="\/(assets\/[^"]+)"/g)) {
        for (const bare of binding.chunkImports[match[1]!] ?? []) {
          const asset = binding.imports[bare]
          if (asset) {
            preloads.add(asset)
          }
        }
      }
      if (preloads.size > 0) {
        const links = [...preloads]
          .map((href) => `<link rel="modulepreload" href="${href}"/>`)
          .join("")
        html = html.replace("</head>", `${links}</head>`)
      }
      buffered = ""
      callback(null, html)
    },
    flush(callback) {
      if (!done && buffered) {
        this.push(buffered)
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

  const locale = resolveLocaleFromRequest(request).locale
  return serverI18nScope.run(
    createServerI18n(locale),
    () =>
      new Promise((resolve, reject) => {
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

              const injector = createLocaleBindingInjector(
                getLocaleBinding(resolveLocaleFromRequest(request).locale)
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
  )
}
